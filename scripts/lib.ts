// Shared helpers: CSV parsing, criteria loading, statistics and judgement.
// Node 22.18+ runs .ts files directly (no build step).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------- Clean CSV format ----------------
export const REQUIRED = ["time", "site", "temp_c", "turb_ntu", "ec_uS_cm"] as const;
export const OPTIONAL = ["tds_ppm", "level_mm", "ph", "lat", "lon"] as const;
export const METRIC_KEYS = ["temp_c", "turb_ntu", "ec_uS_cm", "tds_ppm", "ph", "level_mm"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

// Physically plausible ranges. Used to catch sensor faults and unit mistakes; NOT the judgement criteria.
export const SANE: Record<string, [number, number]> = {
  temp_c: [-5, 45],
  turb_ntu: [0, 4000],
  ec_uS_cm: [0, 20000],
  tds_ppm: [0, 10000],
  ph: [0, 14],
  level_mm: [0, 5000],
  lat: [-90, 90],
  lon: [-180, 180],
};

// File name: 2026-11-06_P1_1030.csv  (date_site_start-time)
export const NAME_RE = /^(\d{4}-\d{2}-\d{2})_([A-Za-z0-9]+)_(\d{4})\.csv$/;

export type Row = Record<string, string>;

export function parseCsv(text: string): { header: string[]; rows: Row[] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Row = {};
    header.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
  return { header, rows };
}

export function readCsv(path: string) {
  return parseCsv(readFileSync(path, "utf8"));
}

export function listCsv(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".csv"))
    .sort()
    .map((f) => join(dir, f));
}

export const idOf = (path: string) => basename(path, ".csv");

// ---------------- Criteria ----------------
export type Criterion = {
  label: string;
  unit: string;
  min: number | null;
  max: number | null;
  enabled: boolean;
  source: string;
};
export type Criteria = { status_rule: { warn_pct: number }; metrics: Record<string, Criterion> };

export function loadCriteria(): Criteria {
  return JSON.parse(readFileSync(join(ROOT, "config", "criteria.json"), "utf8"));
}

// ---------------- Sites ----------------
export type Site = { id: string; no: number; name: string; sub: string; desc: string; x: number; y: number };
export function loadSites(): Site[] {
  const p = join(ROOT, "config", "sites.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).sites : [];
}
export function siteLabel(id: string, sites = loadSites()): string {
  const s = sites.find((x) => x.id === id);
  return s ? `${s.no}번 ${s.name}` : id;
}

// Decimal places per metric (for report text and display)
export const DIGITS: Record<string, number> = { temp_c: 1, turb_ntu: 1, ec_uS_cm: 0, tds_ppm: 0, ph: 2, level_mm: 0 };

// ---------------- Statistics and judgement ----------------
// Status labels below are Korean because they are shown to site visitors.
export type Status = "good" | "warn" | "bad" | "info" | "none";
export const STATUS_KO: Record<Status, string> = {
  good: "적합",
  warn: "주의",
  bad: "부적합",
  info: "참고",
  none: "측정 없음",
};

export type MetricResult = {
  key: string;
  label: string;
  unit: string;
  n: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  last: number | null;
  limit_min: number | null;
  limit_max: number | null;
  exceed_n: number;
  exceed_pct: number;
  status: Status;
};

const r = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export function judgeMetric(key: string, values: number[], c: Criterion, warnPct: number): MetricResult {
  const base = {
    key,
    label: c.label,
    unit: c.unit,
    limit_min: c.enabled ? c.min : null,
    limit_max: c.enabled ? c.max : null,
  };
  if (values.length === 0) {
    return { ...base, n: 0, mean: null, min: null, max: null, last: null, exceed_n: 0, exceed_pct: 0, status: "none" };
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let exceed = 0;
  if (c.enabled) {
    for (const v of values) {
      if ((c.min !== null && v < c.min) || (c.max !== null && v > c.max)) exceed++;
    }
  }
  const pct = (exceed / values.length) * 100;
  let status: Status = "info";
  if (c.enabled) status = exceed === 0 ? "good" : pct < warnPct ? "warn" : "bad";
  return {
    ...base,
    n: values.length,
    mean: r(mean),
    min: r(Math.min(...values)),
    max: r(Math.max(...values)),
    last: r(values[values.length - 1]),
    exceed_n: exceed,
    exceed_pct: r(pct, 1),
    status,
  };
}

const RANK: Record<Status, number> = { none: 0, info: 0, good: 1, warn: 2, bad: 3 };

export function overallStatus(results: MetricResult[]): Status {
  let worst: Status = "none";
  for (const m of results) if (RANK[m.status] > RANK[worst] && m.status !== "info") worst = m.status;
  return worst;
}

export function numbers(rows: Row[], key: string): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const s = row[key];
    if (s === undefined || s === "") continue;
    const v = Number(s);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

export function judgeFile(path: string, criteria = loadCriteria()) {
  const { rows } = readCsv(path);
  const id = idOf(path);
  const m = NAME_RE.exec(basename(path));
  const metrics = METRIC_KEYS.map((k) =>
    judgeMetric(k, numbers(rows, k), criteria.metrics[k], criteria.status_rule.warn_pct),
  ).filter((x) => x.n > 0 || criteria.metrics[x.key].enabled);
  const site = m ? m[2] : rows[0]?.site ?? "";
  return {
    id,
    site,
    site_name: siteLabel(site),
    date: m ? m[1] : (rows[0]?.time ?? "").slice(0, 10),
    start: rows[0]?.time ?? "",
    end: rows[rows.length - 1]?.time ?? "",
    rows: rows.length,
    metrics,
    overall: overallStatus(metrics),
  };
}

export type Judgement = ReturnType<typeof judgeFile>;
