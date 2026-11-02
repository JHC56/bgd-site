// Clean-CSV validator. Clean files are normally written by scripts/ingest.ts, but people can also
// upload them straight to data/clean/, so every rule is checked here.
// Usage: node scripts/validate.ts data/clean            (whole folder)
//        node scripts/validate.ts data/clean/a.csv b.csv (specific files)
// Exits with code 1 if any file fails, so the PR check shows ✗.
//
// Errors (the file is rejected):
//   wrong file name, not UTF-8, not comma-separated, missing columns, rows with the wrong number of
//   cells, unreadable or unsorted or duplicate times, unknown site, more than one site,
//   values that are not numbers or are physically impossible, no measurements at all,
//   too few rows, file too large
// Warnings (the file passes):
//   unknown columns, mostly-empty columns, future or very old dates, big gaps,
//   a sensor reading that never changes, a file that spans more than one day
import { statSync, appendFileSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { listCsv, NAME_RE, REQUIRED, OPTIONAL, SANE, loadSites } from "./lib.ts";
import { decode } from "./csvkit.ts";

const MIN_ROWS = 3;
const MAX_ROWS = 5000;
const MAX_BYTES = 5 * 1024 * 1024;
const BIG_GAP_MS = 20 * 60e3;
const KNOWN = new Set<string>([...REQUIRED, ...OPTIONAL]);
const METRICS = ["temp_c", "turb_ntu", "ec_uS_cm", "tds_ppm", "level_mm", "ph", "lat", "lon"];
const SITE_IDS = new Set(loadSites().map((s) => s.id));
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

export function validateFile(path: string): { errors: string[]; warnings: string[]; rows: number } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = basename(path);
  const m = NAME_RE.exec(name);
  if (!m) errors.push(`File name does not match the format: ${name} (expected YYYY-MM-DD_SITE_HHMM.csv, e.g. 2026-11-06_P1_1030.csv)`);

  const size = statSync(path).size;
  if (size > MAX_BYTES) return { errors: [...errors, `File is larger than ${MAX_BYTES / 1024 / 1024} MB`], warnings, rows: 0 };
  const { text, encoding } = decode(readFileSync(path));
  if (!encoding.startsWith("utf-8")) errors.push(`File is ${encoding}, not UTF-8 (put files saved from Excel in data/inbox/ instead)`);

  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { errors: [...errors, "File is empty"], warnings, rows: 0 };
  const header = lines[0].split(",").map((h) => h.trim());
  if (header.length === 1 && /[;\t]/.test(lines[0])) errors.push("File is not comma-separated (put it in data/inbox/ and it will be converted)");
  for (const col of REQUIRED) if (!header.includes(col)) errors.push(`Missing required column: ${col}`);
  const dupCols = header.filter((h, i) => header.indexOf(h) !== i);
  if (dupCols.length) errors.push(`Duplicate column(s): ${[...new Set(dupCols)].join(", ")}`);
  for (const col of header) if (!KNOWN.has(col)) warnings.push(`Unknown column ignored: ${col}`);

  const rows = lines.slice(1).map((l) => l.split(","));
  if (rows.length < MIN_ROWS) errors.push(`Too few rows: ${rows.length} (minimum ${MIN_ROWS})`);
  if (rows.length > MAX_ROWS) errors.push(`Too many rows: ${rows.length} (maximum ${MAX_ROWS}; clean files hold 1-minute averages)`);
  if (errors.length) return { errors, warnings, rows: rows.length };

  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const bad: string[] = [];
  const sites = new Set<string>();
  const filled: Record<string, number> = {};
  const series: Record<string, number[]> = {};
  let prev = -Infinity;
  const times: number[] = [];
  rows.forEach((cells, i) => {
    const line = i + 2; // the header is line 1
    if (cells.length !== header.length) return bad.push(`Line ${line}: ${cells.length} cells, expected ${header.length}`);
    const time = cells[idx.time].trim();
    const t = TIME_RE.test(time) ? Date.parse(time + "Z") : NaN;
    if (Number.isNaN(t)) bad.push(`Line ${line}: invalid time "${time}" (expected YYYY-MM-DDTHH:MM:SS)`);
    else {
      if (t === prev) bad.push(`Line ${line}: duplicate time ${time}`);
      else if (t < prev) bad.push(`Line ${line}: time is earlier than the previous line (sort rows by time)`);
      prev = Math.max(prev, t);
      times.push(t);
    }
    const site = cells[idx.site].trim();
    sites.add(site);
    for (const col of METRICS) {
      if (idx[col] === undefined) continue;
      const s = cells[idx[col]].trim();
      if (s === "") continue;
      const v = Number(s);
      if (!/^-?\d+(\.\d+)?$/.test(s) || !Number.isFinite(v)) bad.push(`Line ${line}: ${col} is not a plain number: "${s}"`);
      else if (SANE[col] && (v < SANE[col][0] || v > SANE[col][1])) bad.push(`Line ${line}: ${col}=${v} is outside the plausible range ${SANE[col][0]}..${SANE[col][1]} (check the sensor or units)`);
      else {
        filled[col] = (filled[col] ?? 0) + 1;
        (series[col] ??= []).push(v);
      }
    }
  });
  if (bad.length > 10) errors.push(...bad.slice(0, 10), `... and ${bad.length - 10} more`);
  else errors.push(...bad);

  if (sites.size > 1) errors.push(`Multiple sites in one file: ${[...sites].join(", ")} (use one file per site, or put the file in data/inbox/ to split it)`);
  const site = [...sites][0];
  if (site !== undefined && !/^[A-Za-z0-9]+$/.test(site)) errors.push(`Invalid site id "${site}" (letters and digits only)`);
  else if (site !== undefined && SITE_IDS.size && !SITE_IDS.has(site)) errors.push(`Unknown site "${site}" (known: ${[...SITE_IDS].join(", ")}; add new sites to config/sites.json)`);
  if (m && sites.size === 1 && !sites.has(m[2])) errors.push(`Site in file name (${m[2]}) differs from the site column (${site})`);
  if (!["temp_c", "turb_ntu", "ec_uS_cm"].some((c) => filled[c])) errors.push("No temperature, turbidity or conductivity values at all");

  for (const col of METRICS) {
    if (idx[col] === undefined) continue;
    const share = (filled[col] ?? 0) / rows.length;
    if ((REQUIRED as readonly string[]).includes(col) && share < 0.5) warnings.push(`${col} is empty in ${Math.round((1 - share) * 100)}% of rows`);
    const v = series[col] ?? [];
    if (v.length >= 10 && v.every((x) => x === v[0]) && col !== "level_mm" && col !== "ph") warnings.push(`${col} never changes (${v[0]}); is the sensor stuck?`);
  }
  if (times.length) {
    const first = new Date(times[0]), last = new Date(times[times.length - 1]);
    const nowKst = Date.now() + 9 * 3600e3;
    if (times[times.length - 1] > nowKst + 86400e3) warnings.push("Some times are in the future (check the logger's clock)");
    if (first.getUTCFullYear() < 2024) warnings.push("Some times are before 2024 (check the logger's clock)");
    if (m && rows[0][idx.time].slice(0, 10) !== m[1]) warnings.push(`Date in file name (${m[1]}) differs from the first timestamp (${rows[0][idx.time]})`);
    if (first.toISOString().slice(0, 10) !== last.toISOString().slice(0, 10)) warnings.push("File spans more than one day");
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const big = gaps.filter((g) => g > BIG_GAP_MS).length;
    if (big) warnings.push(`${big} gap(s) longer than 20 minutes (maybe separate sessions?)`);
  }
  return { errors, warnings, rows: rows.length };
}

// ---------------- Run ----------------
if (import.meta.main ?? process.argv[1]?.endsWith("validate.ts")) {
  const args = process.argv.slice(2);
  const files = (args.length ? args : ["data/clean"]).flatMap((p) => (statSync(p).isDirectory() ? listCsv(p) : [p]));
  let failed = 0;
  const md: string[] = ["## CSV check results", "", "| File | Rows | Result |", "| --- | --- | --- |"];
  for (const f of files) {
    const { errors, warnings, rows } = validateFile(f);
    const ok = errors.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? "✓" : "✗"} ${basename(f)} (${rows} rows)`);
    for (const e of errors) console.log(`    ✗ ${e}`);
    for (const w of warnings) console.log(`    ! ${w}`);
    md.push(`| ${basename(f)} | ${rows} | ${ok ? "✅ passed" : "❌ " + errors.join("<br>")}${warnings.length ? "<br>⚠️ " + warnings.join("<br>⚠️ ") : ""} |`);
  }
  if (files.length === 0) console.log("No CSV files to check");
  console.log(`\n${files.length - failed} of ${files.length} passed`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n") + "\n");
  process.exit(failed ? 1 : 0);
}
