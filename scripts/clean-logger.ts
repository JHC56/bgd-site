// Convert a raw water_logger.py CSV into the clean CSV uploaded to the site.
//   - Averages over 1-minute buckets (default)
//   - Drops values the board flagged: flag 1 (temperature fault) drops temp, flag 4 (TDS probe out of water) drops EC/TDS
//   - pH stays empty until the sensor is calibrated (add the calibration formula here later)
// Usage: node scripts/clean-logger.ts <raw.csv> --site P1 [--every 60] [--out data/clean]
//   Without --site, the site is read from the .json file saved next to the raw CSV.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, readCsv } from "./lib.ts";

const args = process.argv.slice(2);
const opt = (name: string, def = "") => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const src = args.find((a) => a.endsWith(".csv"));
if (!src) {
  console.log("Usage: node scripts/clean-logger.ts <raw.csv> --site P1 [--every 60] [--out data/clean]");
  process.exit(1);
}

let site = opt("--site");
const metaPath = src.replace(/\.csv$/, ".json");
if (!site && existsSync(metaPath)) site = JSON.parse(readFileSync(metaPath, "utf8")).site ?? "";
if (!site || !/^[A-Za-z0-9]+$/.test(site)) {
  console.log("A site id is required (letters and digits only): --site P1");
  process.exit(1);
}
const every = Number(opt("--every", "60")) * 1000;
const outDir = opt("--out", join(ROOT, "data", "clean"));

const { rows } = readCsv(src);
const COLS = ["temp_c", "turb_ntu", "ec_uS_cm", "tds_ppm", "level_mm"] as const;
type Bucket = { t: number; sums: Record<string, number>; counts: Record<string, number> };
const buckets = new Map<number, Bucket>();
let dropped = 0;
let lowTurb = 0;

for (const row of rows) {
  const t = Date.parse(row.pc_time);
  if (Number.isNaN(t)) continue;
  const flag = Number(row.flag || 0);
  const key = Math.floor(t / every) * every;
  const b = buckets.get(key) ?? { t: key, sums: {}, counts: {} };
  buckets.set(key, b);
  for (const c of COLS) {
    if (c === "temp_c" && flag & 1) { dropped++; continue; }
    if ((c === "ec_uS_cm" || c === "tds_ppm") && flag & 4) { dropped++; continue; }
    const v = Number(row[c]);
    if (row[c] === undefined || row[c] === "" || !Number.isFinite(v)) continue;
    b.sums[c] = (b.sums[c] ?? 0) + v;
    b.counts[c] = (b.counts[c] ?? 0) + 1;
  }
  if (flag & 2) lowTurb++;
}

const pad = (n: number) => String(n).padStart(2, "0");
const local = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const sorted = [...buckets.values()].sort((a, b) => a.t - b.t);
if (sorted.length === 0) {
  console.log("No measurements to convert (check the pc_time column)");
  process.exit(1);
}
const header = ["time", "site", ...COLS, "ph"];
const lines = [header.join(",")];
for (const b of sorted) {
  const cell = (c: string, d: number) => (b.counts[c] ? (b.sums[c] / b.counts[c]).toFixed(d) : "");
  lines.push([local(b.t), site, cell("temp_c", 2), cell("turb_ntu", 1), cell("ec_uS_cm", 0), cell("tds_ppm", 0), cell("level_mm", 1), ""].join(","));
}

const first = local(sorted[0].t);
const name = `${first.slice(0, 10)}_${site}_${first.slice(11, 13)}${first.slice(14, 16)}.csv`;
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, name), lines.join("\n") + "\n");
console.log(`✓ ${rows.length} rows -> ${sorted.length} rows (${every / 1000}s averages) -> ${join(outDir, name)}`);
if (dropped) console.log(`  Dropped ${dropped} values flagged by the board`);
if (lowTurb) console.log(`  ! Turbidity sensor below 2.5 V ${lowTurb} times (very turbid water or a sensor fault). Values kept; check the field notes.`);
console.log("  Next: node scripts/validate.ts " + join(outDir, name));
