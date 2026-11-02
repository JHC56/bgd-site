// Inbox processor: turns whatever measurement files people drop into data/inbox/ into clean CSVs.
//
// Accepts, in any mix:
//   - raw water_logger.py output (2-second rows with board flags)
//   - one file covering a whole patrol, with a site column that changes along the way
//   - one file per site, with the site given by a folder (data/inbox/P3/...), the file name
//     (..._P3.csv), or the .json file water_logger.py writes next to the CSV
//   - files saved from Excel (CP949, semicolons, decimal commas, Korean column names, "오후 3:20")
//
// For every file it: works out the site of each row, drops values the board flagged or that are
// impossible, splits the data into sessions (a new session starts after a gap), averages each
// session into 1-minute rows, and writes data/clean/YYYY-MM-DD_SITE_HHMM.csv.
// The original file is moved to data/raw/YYYY-MM-DD/ so nothing is lost.
//
// Usage: node scripts/ingest.ts            process data/inbox
//        node scripts/ingest.ts --check    report only, write nothing (used by PR checks)
// Options: --gap 20 (minutes between sessions), --every 60 (seconds per averaged row)
// Writes a Markdown summary to .ingest-summary.md and exits with code 1 if any file failed.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync } from "node:fs";
import { join, relative, basename, extname } from "node:path";
import { ROOT, SANE, loadSites, type Site } from "./lib.ts";
import { readTable, toNumber, parseTime, fmtTime } from "./csvkit.ts";

const args = process.argv.slice(2);
const opt = (name: string, def: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const CHECK = args.includes("--check");
const GAP_MS = opt("--gap", 20) * 60e3;
const EVERY_MS = opt("--every", 60) * 1e3;
const MAX_BYTES = 20 * 1024 * 1024;
const MIN_ROWS = 3; // averaged rows needed for a session to count

const INBOX = join(ROOT, "data", "inbox");
const CLEAN = join(ROOT, "data", "clean");
const RAW = join(ROOT, "data", "raw");
const METRICS = ["temp_c", "turb_ntu", "ec_uS_cm", "tds_ppm", "level_mm", "ph", "lat", "lon"] as const;
type Metric = (typeof METRICS)[number];
type Rec = { t: number; site: string } & Partial<Record<Metric, number | null>>;

const SITES = loadSites();

// ---------------- Site detection ----------------
function siteFromToken(token: string): string | null {
  const s = token.trim();
  if (!s) return null;
  let m = /^p\s*0*(\d{1,2})$/i.exec(s) || /^(\d{1,2})\s*(번|번지점)?$/.exec(s);
  if (m) {
    const id = "P" + Number(m[1]);
    return SITES.length === 0 || SITES.some((x) => x.id === id) ? id : null;
  }
  const byName = SITES.find((x: Site) => s.replace(/\s/g, "").includes(x.name.replace(/\s/g, "")));
  return byName ? byName.id : null;
}

function siteFromPath(rel: string): string | null {
  const parts = rel.split(/[\\/]/);
  for (const dir of parts.slice(0, -1).reverse()) {
    const s = siteFromToken(dir);
    if (s) return s;
  }
  const m = /(?:^|[_\-\s.])(p\d{1,2})(?=[_\-\s.]|$)/i.exec(basename(rel, extname(rel)));
  return m ? siteFromToken(m[1]) : null;
}

function dateFromPath(rel: string): string | undefined {
  const m = /(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/.exec(rel);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

// ---------------- Helpers ----------------
function listInbox(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listInbox(p));
    else if (/\.(csv|tsv|txt)$/i.test(name)) out.push(p);
  }
  return out.sort();
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

function spikes(values: number[]): number {
  if (values.length < 10) return 0;
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med))) * 1.4826;
  if (mad === 0) return 0;
  return values.filter((v) => Math.abs(v - med) > 6 * mad).length;
}

function longestRun(values: (number | null | undefined)[]): number {
  let best = 0, run = 0, prev: number | null | undefined = undefined;
  for (const v of values) {
    if (v != null && v === prev) run++;
    else run = v == null ? 0 : 1;
    prev = v;
    best = Math.max(best, run);
  }
  return best;
}

const DIGITS: Record<Metric, number> = { temp_c: 2, turb_ntu: 1, ec_uS_cm: 0, tds_ppm: 0, level_mm: 1, ph: 2, lat: 6, lon: 6 };

// ---------------- Process one file ----------------
type Result = { file: string; outputs: string[]; notes: string[]; warnings: string[]; errors: string[]; sessions: Rec[][] };

function processFile(path: string): Result {
  const rel = relative(INBOX, path);
  const res: Result = { file: rel, outputs: [], notes: [], warnings: [], errors: [], sessions: [] };
  const size = statSync(path).size;
  if (size === 0) return res.errors.push("file is empty"), res;
  if (size > MAX_BYTES) return res.errors.push(`file is larger than ${MAX_BYTES / 1024 / 1024} MB`), res;

  const table = readTable(readFileSync(path));
  res.notes.push(...table.notes);
  const col = (name: string) => table.header.indexOf(name);
  const iTime = col("time"), iDate = col("date"), iClock = col("clock"), iSite = col("site"), iFlag = col("flag");
  if (table.rows.length === 0) return res.errors.push("no data rows"), res;
  if (iTime < 0 && !(iDate >= 0 && iClock >= 0)) {
    return res.errors.push(`no time column found (columns: ${table.rawHeader.join(", ")})`), res;
  }
  const found = METRICS.filter((m) => col(m) >= 0);
  if (!found.some((m) => m === "temp_c" || m === "turb_ntu" || m === "ec_uS_cm")) {
    return res.errors.push(`no temperature, turbidity or conductivity column found (columns: ${table.rawHeader.join(", ")})`), res;
  }
  // raw water_logger columns that are expected and not needed after cleaning
  const LOGGER = ["board_ms", "turb_raw", "turb_v", "tds_raw", "tds_v", "level_raw", "level_v", "ph_raw", "ph_v"];
  const unknown = table.rawHeader.filter((_, i) => ![...LOGGER, "time", "date", "clock", "site", "flag", ...METRICS].includes(table.header[i]));
  if (unknown.length) res.notes.push(`ignored columns: ${unknown.join(", ")}`);

  // Site: per-row column first, then the JSON file next to the CSV, then folder or file name
  let fileSite = siteFromPath(rel);
  const sidecar = path.replace(/\.(csv|tsv|txt)$/i, ".json");
  if (existsSync(sidecar)) {
    try {
      const s = JSON.parse(readFileSync(sidecar, "utf8")).site;
      if (s && siteFromToken(String(s))) fileSite = siteFromToken(String(s));
    } catch { res.warnings.push("could not read the .json file next to it"); }
  }
  const fallbackDate = dateFromPath(rel);
  const named = /(?:^|[_\-\s.\/\\])(p\d{1,2})(?=[_\-\s.\/\\]|$)/i.exec(rel);

  const recs: Rec[] = [];
  let badTime = 0, noSite = 0, flagged = 0, sensorFault = 0;
  const outOfRange: Record<string, number> = {};
  const unknownSites = new Set<string>();
  if (!fileSite && named) unknownSites.add(named[1].toUpperCase());
  for (const r of table.rows) {
    // a time column may hold only the clock ("15:20:05") next to a separate date column
    let t = iTime >= 0 ? parseTime(r[iTime] ?? "", fallbackDate) : parseTime(`${r[iDate]} ${r[iClock]}`);
    if (t === null && iTime >= 0 && iDate >= 0) t = parseTime(`${r[iDate]} ${r[iTime]}`);
    if (t === null) { badTime++; continue; }
    let site = fileSite;
    if (iSite >= 0 && (r[iSite] ?? "").trim()) {
      site = siteFromToken(r[iSite]);
      if (!site) unknownSites.add(r[iSite]);
    }
    if (!site) { noSite++; continue; }
    const rec: Rec = { t, site };
    for (const m of found) rec[m] = toNumber(r[col(m)], table.decimalComma);
    // board flags from water_logger.ino: 1 temperature fault, 4 TDS probe out of water, 8 pH not connected
    const flag = iFlag >= 0 ? Number(r[iFlag] || 0) : 0;
    if (flag & 1 && rec.temp_c != null) (rec.temp_c = null), flagged++;
    if (flag & 4 && (rec.ec_uS_cm != null || rec.tds_ppm != null)) (rec.ec_uS_cm = rec.tds_ppm = null), flagged++;
    if (flag & 8) rec.ph = null;
    // DS18B20 fault codes: -127 = disconnected, 85 = power-on reset value
    if (rec.temp_c === -127 || rec.temp_c === 85) (rec.temp_c = null), sensorFault++;
    if (rec.ec_uS_cm != null && rec.ec_uS_cm <= 0) (rec.ec_uS_cm = rec.tds_ppm = null), sensorFault++;
    for (const m of found) {
      const v = rec[m], range = SANE[m];
      if (v != null && range && (v < range[0] || v > range[1])) (rec[m] = null), (outOfRange[m] = (outOfRange[m] ?? 0) + 1);
    }
    recs.push(rec);
  }
  if (badTime) (badTime === table.rows.length ? res.errors : res.warnings).push(`${badTime} row(s) with an unreadable time were skipped`);
  if (noSite) {
    const known = SITES.map((x) => x.id).join(", ");
    const why = unknownSites.size ? `unknown site value(s): ${[...unknownSites].slice(0, 5).join(", ")} (known: ${known})` : "no site column, and no site in the folder or file name (e.g. data/inbox/P3/file.csv or file_P3.csv)";
    (recs.length === 0 ? res.errors : res.warnings).push(`${noSite} row(s) without a known site were skipped: ${why}`);
  }
  if (flagged) res.notes.push(`${flagged} value(s) dropped because the board flagged them`);
  if (sensorFault) res.warnings.push(`${sensorFault} sensor fault value(s) dropped (temperature -127/85 or conductivity 0)`);
  for (const [m, n] of Object.entries(outOfRange)) res.warnings.push(`${n} impossible ${m} value(s) dropped (allowed ${SANE[m][0]}..${SANE[m][1]})`);
  if (res.errors.length || recs.length === 0) return res;

  // Time sanity
  const now = Date.now() + 9 * 3600e3;
  const future = recs.filter((r) => r.t > now + 86400e3).length;
  if (future) res.warnings.push(`${future} row(s) are dated in the future (check the logger's clock)`);
  const old = recs.filter((r) => new Date(r.t).getUTCFullYear() < 2024).length;
  if (old) res.warnings.push(`${old} row(s) are dated before 2024 (check the logger's clock)`);

  // Split by site, sort, remove duplicate timestamps, then split into sessions at gaps
  const bySite = new Map<string, Rec[]>();
  for (const r of recs) {
    const list = bySite.get(r.site);
    if (list) list.push(r);
    else bySite.set(r.site, [r]);
  }
  for (const [site, list] of bySite) {
    if (list.some((r, i) => i > 0 && r.t < list[i - 1].t)) res.notes.push(`${site}: rows were out of time order and were sorted`);
    list.sort((a, b) => a.t - b.t);
    const uniq: Rec[] = [];
    let dups = 0;
    for (const r of list) {
      if (uniq.length && uniq[uniq.length - 1].t === r.t) { dups++; continue; }
      uniq.push(r);
    }
    if (dups) res.notes.push(`${site}: ${dups} duplicate timestamp(s) removed`);
    let cur: Rec[] = [];
    for (const r of uniq) {
      if (cur.length && r.t - cur[cur.length - 1].t > GAP_MS) res.sessions.push(cur), (cur = []);
      cur.push(r);
    }
    if (cur.length) res.sessions.push(cur);
  }
  return res;
}

// ---------------- Average a session into clean rows ----------------
function average(session: Rec[]): Rec[] {
  const gaps = session.slice(1).map((r, i) => r.t - session[i].t);
  if (gaps.length === 0 || median(gaps) >= EVERY_MS) return session; // already at or below one row per minute
  const buckets = new Map<number, Rec[]>();
  for (const r of session) {
    const k = Math.floor(r.t / EVERY_MS) * EVERY_MS;
    const b = buckets.get(k);
    if (b) b.push(r);
    else buckets.set(k, [r]);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, rs]) => {
    const out: Rec = { t: k, site: rs[0].site };
    for (const m of METRICS) {
      const v = rs.map((r) => r[m]).filter((x): x is number => x != null);
      if (v.length) out[m] = v.reduce((a, b) => a + b, 0) / v.length;
      else if (rs.some((r) => m in r)) out[m] = null;
    }
    return out;
  });
}

function toCsv(rows: Rec[]): string {
  const cols: Metric[] = ["temp_c", "turb_ntu", "ec_uS_cm", "tds_ppm", "level_mm", "ph"];
  if (rows.some((r) => r.lat != null || r.lon != null)) cols.push("lat", "lon");
  const cell = (r: Rec, m: Metric) => (r[m] == null ? "" : (r[m] as number).toFixed(DIGITS[m]));
  return [["time", "site", ...cols].join(","), ...rows.map((r) => [fmtTime(r.t), r.site, ...cols.map((m) => cell(r, m))].join(","))].join("\n") + "\n";
}

// ---------------- Run ----------------
if (import.meta.main ?? process.argv[1]?.endsWith("ingest.ts")) {
  const files = listInbox(INBOX);
  const md: string[] = ["## Inbox processing", ""];
  if (files.length === 0) {
    console.log("No files in data/inbox");
    md.push("No files in data/inbox.");
  }
  let failed = 0, written = 0;
  for (const f of files) {
    const res = processFile(f);
    for (const s of res.sessions) {
      const site = s[0].site;
      const rows = average(s);
      if (rows.length < MIN_ROWS) {
        res.warnings.push(`${site} session at ${fmtTime(s[0].t)} skipped: only ${rows.length} averaged row(s), need ${MIN_ROWS}`);
        continue;
      }
      for (const m of ["temp_c", "turb_ntu", "ec_uS_cm"] as Metric[]) {
        const vals = s.map((r) => r[m]).filter((x): x is number => x != null);
        const n = spikes(vals);
        if (n) res.warnings.push(`${site}: ${n} sudden ${m} spike(s) kept (bubbles or debris?)`);
        if (longestRun(s.map((r) => r[m])) >= 30 && m !== "turb_ntu") res.warnings.push(`${site}: ${m} stayed exactly the same for 30+ readings (sensor stuck?)`);
        if (vals.length === 0 && s.some((r) => m in r)) res.warnings.push(`${site}: no usable ${m} values in this session`);
      }
      const start = fmtTime(rows[0].t);
      const name = `${start.slice(0, 10)}_${site}_${start.slice(11, 13)}${start.slice(14, 16)}.csv`;
      const out = join(CLEAN, name);
      const csv = toCsv(rows);
      if (existsSync(out) && readFileSync(out, "utf8") !== csv) {
        res.errors.push(`data/clean/${name} already exists with different data`);
        continue;
      }
      res.outputs.push(`${name} (${site}, ${start.slice(11, 16)}–${fmtTime(rows[rows.length - 1].t).slice(11, 16)}, ${rows.length} rows from ${s.length})`);
      if (!CHECK) mkdirSync(CLEAN, { recursive: true }), writeFileSync(out, csv), written++;
    }
    if (res.errors.length === 0 && res.outputs.length === 0) res.errors.push("no usable session in this file");

    // Archive the original (and its .json) under data/raw/<date>/
    if (!CHECK && res.errors.length === 0) {
      const date = res.outputs[0].slice(0, 10);
      const dest = join(RAW, date);
      mkdirSync(dest, { recursive: true });
      for (const p of [f, f.replace(/\.(csv|tsv|txt)$/i, ".json")]) {
        if (!existsSync(p)) continue;
        let target = join(dest, basename(p));
        for (let i = 2; existsSync(target); i++) target = join(dest, basename(p, extname(p)) + `_${i}` + extname(p));
        renameSync(p, target);
      }
    }

    if (res.errors.length) failed++;
    const status = res.errors.length ? "❌" : res.warnings.length ? "⚠️" : "✅";
    console.log(`${status} ${res.file}`);
    md.push(`### ${status} \`${res.file}\``);
    for (const o of res.outputs) console.log(`    -> ${o}`), md.push(`- creates \`${o}\``);
    for (const e of res.errors) console.log(`    ✗ ${e}`), md.push(`- ❌ ${e}`);
    for (const w of res.warnings) console.log(`    ! ${w}`), md.push(`- ⚠️ ${w}`);
    for (const n of res.notes) console.log(`    · ${n}`), md.push(`- ${n}`);
    md.push("");
  }
  console.log(`\n${files.length - failed} of ${files.length} file(s) processed${CHECK ? " (check only, nothing written)" : `, ${written} clean file(s) written`}`);
  writeFileSync(join(ROOT, ".ingest-summary.md"), md.join("\n") + "\n");
  process.exit(failed ? 1 : 0);
}

export { processFile, average, toCsv };
