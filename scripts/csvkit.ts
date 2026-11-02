// Forgiving CSV reader for real-world measurement files.
// Handles: UTF-8 with or without BOM, UTF-16, CP949/EUC-KR (Korean Excel), comma / semicolon / tab
// delimiters, quoted fields, CRLF, decimal commas, repeated header lines (logger restarts),
// Korean or English column names with units, and many timestamp formats.

// ---------------- Decoding ----------------
export function decode(buf: Uint8Array): { text: string; encoding: string } {
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(buf.subarray(2)), encoding: "utf-16le" };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(buf.subarray(2)), encoding: "utf-16be" };
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bom ? buf.subarray(3) : buf);
    return { text, encoding: bom ? "utf-8 (BOM)" : "utf-8" };
  } catch {
    return { text: new TextDecoder("euc-kr").decode(buf), encoding: "cp949" };
  }
}

// ---------------- Parsing ----------------
function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#")).slice(0, 8);
  let best = ",", bestScore = -1;
  for (const d of [",", ";", "\t"]) {
    const counts = lines.map((l) => splitLine(l, d).length - 1);
    const min = Math.min(...counts);
    const same = counts.filter((c) => c === counts[0]).length;
    const score = min > 0 ? same * 100 + min : -1;
    if (score > bestScore) (best = d), (bestScore = score);
  }
  return best;
}

function splitLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) out.push(cur), (cur = "");
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Join physical lines that belong to one quoted record
function records(text: string): string[] {
  const out: string[] = [];
  let buf = "", quotes = 0;
  for (const line of text.split(/\r?\n/)) {
    buf = buf ? buf + "\n" + line : line;
    quotes += (line.match(/"/g) || []).length;
    if (quotes % 2 === 0) out.push(buf), (buf = ""), (quotes = 0);
  }
  if (buf) out.push(buf);
  return out;
}

// ---------------- Column names ----------------
const ALIASES: Record<string, string[]> = {
  time: ["time", "timestamp", "datetime", "date_time", "pc_time", "measured_at", "시간", "시각", "측정시각", "측정시간", "일시", "측정일시"],
  date: ["date", "날짜", "일자", "측정일"],
  clock: ["clock", "hms", "시분초"],
  site: ["site", "station", "point", "spot", "site_id", "지점", "측정지점", "위치"],
  temp_c: ["temp_c", "temp", "temperature", "water_temp", "watertemp", "수온", "온도"],
  turb_ntu: ["turb_ntu", "turbidity", "turb", "ntu", "탁도"],
  ec_uS_cm: ["ec_us_cm", "ec", "conductivity", "cond", "ec_uscm", "전도도", "전기전도도"],
  tds_ppm: ["tds_ppm", "tds", "총용존고형물"],
  ph: ["ph", "p_h", "수소이온농도"],
  level_mm: ["level_mm", "level", "water_level", "waterlevel", "수위"],
  lat: ["lat", "latitude", "위도"],
  lon: ["lon", "lng", "long", "longitude", "경도"],
  flag: ["flag", "flags"],
  board_ms: ["board_ms"],
  turb_v: ["turb_v"],
  tds_v: ["tds_v"],
};
const LOOKUP = new Map<string, string>();
for (const [k, list] of Object.entries(ALIASES)) for (const a of list) LOOKUP.set(a, k);

export function normalizeHeader(h: string): string {
  const base = h
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/\s*[\[(（].*?[\])）]\s*/g, "") // drop units in brackets: "수온(°C)", "EC [uS/cm]"
    .replace(/[°µ]/g, "")
    .replace(/[\s\-./]+/g, "_")
    .replace(/_+$/, "");
  return LOOKUP.get(base) ?? LOOKUP.get(base.replace(/_/g, "")) ?? base;
}

// ---------------- Values ----------------
const NULLS = new Set(["", "nan", "null", "none", "-", "--", "n/a", "na", "inf", "-inf", "#value!", "#n/a", "err", "error", "?"]);

export function toNumber(s: string | undefined, decimalComma = false): number | null {
  if (s === undefined) return null;
  let t = s.trim();
  if (NULLS.has(t.toLowerCase())) return null;
  if (decimalComma) t = t.replace(",", ".");
  const m = /^([-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?)\s*[a-z°µ/%²]*$/i.exec(t); // allow a trailing unit: "13.2°C"
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

// ---------------- Time ----------------
// Times are kept as "naive Korean time": milliseconds where the UTC fields hold the local clock.
// Inputs with an explicit offset (Z, +00:00) are converted to Korea time (+09:00).
const KST = 9 * 3600e3;
const pad = (n: number) => String(n).padStart(2, "0");

export function parseTime(s: string, fallbackDate?: string): number | null {
  const t = s.trim();
  if (!t) return null;
  // Excel serial date (e.g. 46329.43)
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const v = Number(t);
    if (v > 40000 && v < 80000) return Math.round((v - 25569) * 86400e3);
  }
  // Korean Excel "2026-11-03 오후 3:20:05"
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?\s+(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m) {
    let h = Number(m[5]) % 12;
    if (m[4] === "오후") h += 12;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], h, +m[6], +(m[7] ?? 0));
  }
  // YYYY-MM-DD[T ]HH:MM[:SS[.fff]][Z|±HH:MM], also / and . separators
  m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(t);
  if (m) {
    const ms = m[7] ? Math.round(Number("0." + m[7]) * 1000) : 0;
    let v = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), ms);
    if (m[8]) {
      const z = m[8].toUpperCase() === "Z" ? 0 : (m[8][0] === "-" ? -1 : 1) * (Number(m[8].slice(1, 3)) * 60 + Number(m[8].slice(-2))) * 60e3;
      v = v - z + KST;
    }
    return v;
  }
  // Time of day only: "15:20:05" -> needs a date from the file or folder name
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m && fallbackDate) {
    const [y, mo, d] = fallbackDate.split("-").map(Number);
    return Date.UTC(y, mo - 1, d, +m[1], +m[2], +(m[3] ?? 0));
  }
  return null;
}

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// ---------------- Table ----------------
export type Table = {
  header: string[];      // normalized column names
  rawHeader: string[];   // as written in the file
  rows: string[][];
  notes: string[];       // things fixed while reading (for the summary)
  decimalComma: boolean;
};

export function readTable(buf: Uint8Array): Table {
  const { text, encoding } = decode(buf);
  const notes: string[] = [];
  if (encoding !== "utf-8") notes.push(`encoding ${encoding} converted to UTF-8`);
  const d = sniffDelimiter(text);
  if (d !== ",") notes.push(`delimiter "${d === "\t" ? "tab" : d}" detected`);

  const recs = records(text).filter((r) => r.trim() !== "" && !r.trim().startsWith("#"));
  if (recs.length === 0) return { header: [], rawHeader: [], rows: [], notes, decimalComma: false };
  const rawHeader = splitLine(recs[0], d).map((h) => h.trim());
  const header = rawHeader.map(normalizeHeader);
  const headerKey = rawHeader.join("|").toLowerCase();

  const rows: string[][] = [];
  let repeated = 0, ragged = 0;
  for (const r of recs.slice(1)) {
    const cells = splitLine(r, d).map((c) => c.trim());
    if (cells.join("|").toLowerCase() === headerKey) { repeated++; continue; } // logger restarted and wrote the header again
    while (cells.length > header.length && cells[cells.length - 1] === "") cells.pop(); // trailing commas
    if (cells.length !== header.length) ragged++;
    rows.push(cells);
  }
  if (repeated) notes.push(`${repeated} repeated header line(s) skipped`);
  if (ragged) notes.push(`${ragged} row(s) with a different number of columns`);

  // Decimal comma: only possible when the delimiter is not a comma
  const decimalComma = d !== "," && rows.slice(0, 50).some((r) => r.some((c) => /^-?\d+,\d+$/.test(c)));
  if (decimalComma) notes.push("decimal commas converted");
  return { header, rawHeader, rows, notes, decimalComma };
}
