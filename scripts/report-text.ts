// Template report text (Korean). Used when no AI is configured or the AI call fails,
// and when building the site from sample data.
import { STATUS_KO, DIGITS, type Judgement, type MetricResult } from "./lib.ts";

export function template(j: Judgement): string {
  const f = (m: MetricResult, v: number | null) => (v === null ? "–" : v.toFixed(DIGITS[m.key] ?? 2));
  const u = (m: MetricResult) => (m.unit && m.unit !== "°C" ? " " + m.unit : m.unit);
  const line = (m: MetricResult) =>
    m.status === "info"
      ? `- ${m.label}: 평균 ${f(m, m.mean)}${u(m)} (기준 없음, 참고값)`
      : m.status === "none"
        ? `- ${m.label}: 측정값 없음${m.key === "ph" ? " (센서 연결 전)" : ""}`
        : `- ${m.label}: ${STATUS_KO[m.status]} — 평균 ${f(m, m.mean)}${u(m)}, 범위 ${f(m, m.min)}~${f(m, m.max)}${u(m)}, 기준 이탈 ${m.exceed_pct}%`;
  const bad = j.metrics.filter((m) => m.status === "bad" || m.status === "warn");
  return [
    "### 종합 판정",
    `${j.date} ${j.site_name} 지점에서 ${j.rows}회 측정한 결과, 종합 판정은 **${STATUS_KO[j.overall]}**임.`,
    "",
    "### 항목별 결과",
    ...j.metrics.map(line),
    "",
    "### 권고 사항",
    ...(bad.length ? bad.map((m) => `- ${m.label} 재측정 및 현장 확인 필요`) : ["- 정기 측정 유지"]),
  ].join("\n");
}

export function summaryLine(j: Judgement): string {
  const issues = j.metrics.filter((m) => m.status === "bad" || m.status === "warn");
  if (issues.length === 0) return "판정 항목 모두 기준 이내";
  return issues.map((m) => `${m.label} ${STATUS_KO[m.status]}(이탈 ${m.exceed_pct}%)`).join(", ");
}

