// Site build: copies site/ to _site/ and writes the JSON/CSV the pages read under _site/data/
//   _site/data/reports.json        report list (newest first, without the body)
//   _site/data/reports/<id>.json   full reports
//   _site/data/csv/<id>.csv        clean CSVs (for download and charts)
//   _site/data/criteria.json       judgement criteria
//   _site/data/live.json           live relay server URL
//   _site/data/{sites,site,activities}.json  copied from config/
// If there are no real reports yet, the pages are built from samples/ and show a "sample data" banner.
// Usage: node scripts/build.ts
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, listCsv, idOf, judgeFile, loadCriteria } from "./lib.ts";
import { template, summaryLine } from "./report-text.ts";

const OUT = join(ROOT, "_site");
const DATA = join(OUT, "data");
rmSync(OUT, { recursive: true, force: true });
cpSync(join(ROOT, "site"), OUT, { recursive: true });
mkdirSync(join(DATA, "reports"), { recursive: true });
mkdirSync(join(DATA, "csv"), { recursive: true });

const criteria = loadCriteria();
type Report = Record<string, any>;
let reports: Report[] = [];
let demo = false;

// 1) Real reports (merged = approved)
const reportDir = join(ROOT, "reports");
if (existsSync(reportDir)) {
  for (const f of readdirSync(reportDir).filter((f) => f.endsWith(".json"))) {
    const rep: Report = JSON.parse(readFileSync(join(reportDir, f), "utf8"));
    const csv = join(ROOT, "data", "clean", rep.id + ".csv");
    rep.has_csv = existsSync(csv);
    if (rep.has_csv) copyFileSync(csv, join(DATA, "csv", rep.id + ".csv"));
    reports.push(rep);
  }
}

// 2) Fall back to samples when there are no real reports
if (reports.length === 0) {
  demo = true;
  for (const f of listCsv(join(ROOT, "samples", "clean"))) {
    const j = judgeFile(f, criteria);
    reports.push({ ...j, summary: summaryLine(j), body_md: template(j), writer: "template", ai_check: { ok: true }, has_csv: true, demo: true });
    copyFileSync(f, join(DATA, "csv", idOf(f) + ".csv"));
  }
}

reports.sort((a, b) => String(b.start).localeCompare(String(a.start)));
for (const r of reports) writeFileSync(join(DATA, "reports", r.id + ".json"), JSON.stringify(r));

const list = reports.map(({ body_md, ...rest }) => rest);
writeFileSync(join(DATA, "reports.json"), JSON.stringify({ demo, built_at: new Date().toISOString(), reports: list }));
writeFileSync(join(DATA, "criteria.json"), JSON.stringify(criteria));
for (const name of ["sites", "site", "activities"]) {
  const p = join(ROOT, "config", name + ".json");
  if (existsSync(p)) copyFileSync(p, join(DATA, name + ".json"));
}
const live = join(ROOT, "config", "live.json");
writeFileSync(join(DATA, "live.json"), existsSync(live) ? readFileSync(live, "utf8") : '{"url":""}');

console.log(`✓ Built _site with ${reports.length} report(s)${demo ? " (sample data)" : ""}`);
