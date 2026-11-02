// Clean-CSV validator: checks that CSVs submitted in a PR follow the format and plausible value ranges.
// Usage: node scripts/validate.ts data/clean            (whole folder)
//        node scripts/validate.ts data/clean/a.csv b.csv (specific files)
// Exits with code 1 if any file fails, so the PR check shows ✗.
import { statSync, appendFileSync } from "node:fs";
import { basename } from "node:path";
import { readCsv, listCsv, NAME_RE, REQUIRED, OPTIONAL, SANE } from "./lib.ts";

const MIN_ROWS = 5;
const KNOWN = new Set<string>([...REQUIRED, ...OPTIONAL]);

export function validateFile(path: string): { errors: string[]; warnings: string[]; rows: number } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = basename(path);
  const m = NAME_RE.exec(name);
  if (!m) errors.push(`File name does not match the format: ${name} (expected e.g. 2026-11-06_P1_1030.csv = date_site_start-time)`);

  const { header, rows } = readCsv(path);
  for (const col of REQUIRED) if (!header.includes(col)) errors.push(`Missing required column: ${col}`);
  for (const col of header) if (!KNOWN.has(col)) warnings.push(`Unknown column ignored: ${col}`);
  if (rows.length < MIN_ROWS) errors.push(`Too few rows: ${rows.length} (minimum ${MIN_ROWS})`);
  if (errors.length) return { errors, warnings, rows: rows.length };

  let prev = -Infinity;
  const sites = new Set<string>();
  const bad: string[] = [];
  rows.forEach((row, i) => {
    const line = i + 2; // the header is line 1
    const t = Date.parse(row.time);
    if (Number.isNaN(t)) bad.push(`Line ${line}: invalid time "${row.time}" (expected e.g. 2026-11-06T10:30:00)`);
    else {
      if (t < prev) bad.push(`Line ${line}: time is earlier than the previous line (sort rows by time)`);
      prev = t;
    }
    sites.add(row.site);
    for (const [col, [lo, hi]] of Object.entries(SANE)) {
      const s = row[col];
      if (s === undefined || s === "") {
        if ((REQUIRED as readonly string[]).includes(col)) bad.push(`Line ${line}: ${col} is empty`);
        continue;
      }
      const v = Number(s);
      if (!Number.isFinite(v)) bad.push(`Line ${line}: ${col} is not a number: "${s}"`);
      else if (v < lo || v > hi) bad.push(`Line ${line}: ${col}=${v} is outside the plausible range ${lo}..${hi} (check the sensor or units)`);
    }
  });
  if (bad.length > 10) errors.push(...bad.slice(0, 10), `... and ${bad.length - 10} more`);
  else errors.push(...bad);

  if (sites.size > 1) errors.push(`Multiple sites in one file: ${[...sites].join(", ")} (use one file per site)`);
  if (m && sites.size === 1 && !sites.has(m[2])) errors.push(`Site in file name (${m[2]}) differs from the site column (${[...sites][0]})`);
  if (m && rows[0]?.time && !rows[0].time.startsWith(m[1])) warnings.push(`Date in file name (${m[1]}) differs from the first timestamp (${rows[0].time})`);
  return { errors, warnings, rows: rows.length };
}

// ---------------- Run ----------------
if (import.meta.main ?? process.argv[1]?.endsWith("validate.ts")) {
  const args = process.argv.slice(2);
  const files = (args.length ? args : ["data/clean"]).flatMap((p) =>
    statSync(p).isDirectory() ? listCsv(p) : [p],
  );
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
