// Report generator. For every CSV in data/clean that has no report yet:
//   1) Judge it in code (every number and pass/fail decision is made here)
//   2) Ask an AI to turn the judgement into prose (it only receives computed values, so it cannot invent numbers)
//   3) Write reports/<id>.json and the PR body (.report-pr.md)
// Usage: node scripts/report.ts            (new CSVs only)
//        node scripts/report.ts --all      (rebuild every report)
// AI used for the prose (first available wins; with none, a fixed template is used):
//   1) GitHub Models: works inside Actions with GITHUB_TOKEN, no key needed (workflow needs `models: read`)
//      GITHUB_MODEL (default openai/gpt-4.1-mini)
//   2) Gemini: when GEMINI_API_KEY is set, GEMINI_MODEL (default gemini-3.6-flash)
//   Force one with AI_PROVIDER=github | gemini
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, listCsv, idOf, judgeFile, loadCriteria, STATUS_KO, type Judgement } from "./lib.ts";
import { template, summaryLine } from "./report-text.ts";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GH_MODEL = process.env.GITHUB_MODEL || "openai/gpt-4.1-mini";
const GH_TOKEN = process.env.GITHUB_TOKEN || "";
const PROVIDER = process.env.AI_PROVIDER || (GH_TOKEN ? "github" : GEMINI_KEY ? "gemini" : "none");
const MODEL = PROVIDER === "github" ? GH_MODEL : PROVIDER === "gemini" ? GEMINI_MODEL : "template";
const KEY = PROVIDER === "github" ? GH_TOKEN : PROVIDER === "gemini" ? GEMINI_KEY : "";
const REPORT_DIR = join(ROOT, "reports");

// ---------------- Prompt ----------------
// The report itself is written in Korean for the campus facilities team and students.
const SYSTEM = `You write water-quality reports for "BbiGeuDeok", a duck-shaped robot that patrols Ingyeongho pond at Inha University.
Rules:
- Use only numbers that appear in the input JSON. Never add new numbers, estimates, or claims about causes.
- Keep every status exactly as given in the input (적합 / 주의 / 부적합 / 참고). Never change a judgement.
- Items with status "참고" have no official limit; mention them only as "기준 없음, 참고값".
- Write in Korean, in a short business-report style for facility managers (end sentences with ~함 / ~임).
- Output Markdown with exactly these sections and nothing else:
### 종합 판정
(one or two sentences)
### 항목별 결과
(one line per item, starting with "- ")
### 권고 사항
(lines starting with "- ", at most 3; if nothing is 주의 or 부적합, write the single line "- 정기 측정 유지")`;

function facts(j: Judgement) {
  return {
    site: j.site_name,
    date: j.date,
    start: j.start,
    end: j.end,
    samples: j.rows,
    overall_status: STATUS_KO[j.overall],
    items: j.metrics.map((m) => ({
      item: m.label,
      unit: m.unit,
      status: STATUS_KO[m.status],
      mean: m.mean,
      min: m.min,
      max: m.max,
      limit_min: m.limit_min,
      limit_max: m.limit_max,
      out_of_limit_percent: m.status === "info" ? null : m.exceed_pct,
    })),
  };
}

// GitHub Models has had more than one endpoint and API version.
// Try them in order and keep the first real answer; collect every error for the PR comment.
const GH_ATTEMPTS: { url: string; model: string; headers: Record<string, string> }[] = [
  {
    url: "https://models.github.ai/inference/chat/completions",
    model: GH_MODEL,
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" },
  },
  {
    url: "https://models.github.ai/inference/chat/completions",
    model: GH_MODEL,
    headers: { Accept: "application/json" },
  },
  {
    // Older Azure-hosted endpoint: same GITHUB_TOKEN, model name without the publisher prefix
    url: "https://models.inference.ai.azure.com/chat/completions",
    model: GH_MODEL.replace(/^[^/]+\//, ""),
    headers: { Accept: "application/json" },
  },
];

async function askGitHub(j: Judgement): Promise<string> {
  const errors: string[] = [];
  for (const a of GH_ATTEMPTS) {
    try {
      const res = await fetch(a.url, {
        method: "POST",
        redirect: "manual", // a redirect would turn the POST into a GET and hide the real error
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, ...a.headers },
        body: JSON.stringify({
          model: a.model,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: "Measurement results:\n" + JSON.stringify(facts(j), null, 2) },
          ],
        }),
      });
      const raw = await res.text();
      const where = `${new URL(a.url).host} ${res.status}`;
      if (res.status >= 300 && res.status < 400) {
        errors.push(`${where} redirect to ${res.headers.get("location") ?? "?"}`);
        continue;
      }
      if (!res.ok) {
        errors.push(`${where}: ${raw.slice(0, 150)}`);
        continue;
      }
      let data: any;
      try {
        data = JSON.parse(raw);
      } catch {
        errors.push(`${where} non-JSON (${res.headers.get("content-type") ?? "?"}): ${JSON.stringify(raw.slice(0, 60))}`);
        continue;
      }
      const text = (data.choices?.[0]?.message?.content ?? "").trim();
      if (text) return text;
      errors.push(`${where}: empty answer`);
    } catch (e) {
      errors.push(`${new URL(a.url).host}: ${(e as Error).message}`);
    }
  }
  throw new Error(errors.join(" | "));
}

async function askGemini(j: Judgement): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: "Measurement results:\n" + JSON.stringify(facts(j), null, 2) }] }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}

// Flag numbers in the AI text that were not in the input (catches invented numbers)
function unknownNumbers(text: string, j: Judgement): string[] {
  const allowed = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v !== "number") return;
    for (const d of [0, 1, 2]) allowed.add(String(Math.round(v * 10 ** d) / 10 ** d));
  };
  add(j.rows);
  for (const m of j.metrics) [m.mean, m.min, m.max, m.limit_min, m.limit_max, m.exceed_pct, m.n].forEach(add);
  for (const s of [j.date, j.start, j.end, j.site_name]) for (const n of s.match(/\d+(\.\d+)?/g) ?? []) allowed.add(String(Number(n)));
  const found = text.match(/\d+(\.\d+)?/g) ?? [];
  return [...new Set(found.filter((n) => Number(n) > 3 && !allowed.has(String(Number(n)))))];
}

// ---------------- Run ----------------
const all = process.argv.includes("--all");
const criteria = loadCriteria();
mkdirSync(REPORT_DIR, { recursive: true });

const targets = listCsv(join(ROOT, "data", "clean")).filter(
  (f) => all || !existsSync(join(REPORT_DIR, idOf(f) + ".json")),
);
if (targets.length === 0) {
  console.log("No new reports to create");
  writeFileSync(join(ROOT, ".report-pr.md"), "No new reports.\n"); // so the PR step never fails on a missing body file
  process.exit(0);
}
console.log(KEY ? `Prose writer: ${PROVIDER} (${MODEL})` : "! No AI configured -> using the template text");

const pr: string[] = [
  "## Automated water-quality reports. Review and merge to publish them on the site.",
  "",
  "| Report | Site | Status | Summary | Written by | Check |",
  "| --- | --- | --- | --- | --- | --- |",
];

for (const f of targets) {
  const j = judgeFile(f, criteria);
  let body = "";
  let writer = "template";
  let error = "";
  if (KEY) {
    try {
      body = PROVIDER === "github" ? await askGitHub(j) : await askGemini(j);
      writer = MODEL;
    } catch (e) {
      error = String(e);
      console.log(`! ${j.id} AI failed -> using the template text: ${error}`);
    }
  }
  if (!body) body = template(j);
  const suspect = writer === "template" ? [] : unknownNumbers(body, j);

  const report = {
    ...j,
    summary: summaryLine(j),
    body_md: body,
    writer,
    ai_check: suspect.length ? { ok: false, unknown_numbers: suspect } : { ok: true },
    generated_at: new Date().toISOString(),
    criteria_source: Object.fromEntries(Object.entries(criteria.metrics).map(([k, c]) => [k, c.source])),
  };
  writeFileSync(join(REPORT_DIR, j.id + ".json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`✓ ${j.id}  ${STATUS_KO[j.overall]}  (${writer})${suspect.length ? "  ! numbers to check: " + suspect.join(", ") : ""}`);
  pr.push(
    `| \`${j.id}\` | ${j.site_name} | ${STATUS_KO[j.overall]} | ${report.summary} | ${writer} | ${
      suspect.length ? "⚠️ numbers not in the input: " + suspect.join(", ") : error ? "⚠️ AI failed, template text used: " + error.replace(/\|/g, "/").slice(0, 160) : "—"
    } |`,
  );
}

pr.push("", "- Statuses (적합/주의/부적합) were computed by code; the AI only wrote the prose.", "- If a row shows ⚠️, open the report, check the numbers, and edit it in this PR if needed.");
writeFileSync(join(ROOT, ".report-pr.md"), pr.join("\n") + "\n");
