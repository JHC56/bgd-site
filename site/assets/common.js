// Shared script for the BbiGeuDeok site (no build step: edits here go live as-is).
// UI strings stay Korean because the site is for Korean visitors.
export const STATUS_KO = { good: "적합", warn: "주의", bad: "부적합", info: "참고", none: "측정 없음" };

// Sensor order and names. Keys match the water_logger board output and the clean CSV columns.
export const SENSORS = [
  { key: "temp_c", name: "수온", unit: "°C", digits: 1 },
  { key: "turb_ntu", name: "탁도", unit: "NTU", digits: 1 },
  { key: "ec_uS_cm", name: "전도도", unit: "µS/cm", digits: 0 },
  { key: "ph", name: "pH", unit: "", digits: 2 },
  { key: "level_mm", name: "수위", unit: "mm", digits: 0 },
];

// Decimal places per metric (including TDS, which has no tile)
export const DIGITS = { temp_c: 1, turb_ntu: 1, ec_uS_cm: 0, tds_ppm: 0, ph: 2, level_mm: 0 };

// Flag bits from water_logger.ino (1 temperature fault, 2 turbidity below 2.5 V, 4 TDS probe out of water, 8 pH not connected)
export function flagNote(key, flag) {
  if (!flag) return "";
  if (key === "temp_c" && flag & 1) return "수온 센서 이상";
  if (key === "turb_ntu" && flag & 2) return "매우 탁하거나 센서 이상";
  if ((key === "ec_uS_cm" || key === "tds_ppm") && flag & 4) return "탐침이 물 밖";
  if (key === "ph" && flag & 8) return "pH 센서 미연결";
  return "";
}

export async function getJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

export async function getCSV(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  const lines = (await res.text()).replace(/^﻿/, "").trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const c = l.split(",");
    return Object.fromEntries(header.map((h, i) => [h, c[i] ?? ""]));
  });
}

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const fmt = (v, d = 1) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? "–" : Number(v).toFixed(d));

export function when(iso) {
  if (!iso) return "";
  const [d, t = ""] = iso.split("T");
  return `${d.slice(5).replace("-", ".")} ${t.slice(0, 5)}`;
}

export const stChip = (s) => `<span class="st st--${s}">${STATUS_KO[s] ?? s}</span>`;

export function limitText(m) {
  if (!m) return "기준 없음";
  const u = m.unit ? " " + m.unit : "";
  if (m.limit_min != null && m.limit_max != null) return `기준 ${m.limit_min}~${m.limit_max}${u}`;
  if (m.limit_max != null) return `기준 ${m.limit_max}${u} 이하`;
  if (m.limit_min != null) return `기준 ${m.limit_min}${u} 이상`;
  return "기준 없는 참고값";
}

// Judge a single live value against the criteria (same rules as the reports)
export function judgeValue(key, v, criteria) {
  const c = criteria?.metrics?.[key];
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "none";
  if (!c || !c.enabled) return "info";
  const x = Number(v);
  if ((c.min != null && x < c.min) || (c.max != null && x > c.max)) return "bad";
  return "good";
}

// Tiny Markdown renderer for report bodies (###, -, **bold**, paragraphs). Escapes HTML first.
export function md(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const out = [];
  let list = false;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (/^[-*] /.test(line)) {
      if (!list) out.push("<ul>"), (list = true);
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (list) out.push("</ul>"), (list = false);
    if (!line) continue;
    const h = /^#{1,4} (.*)$/.exec(line);
    out.push(h ? `<h3>${inline(h[1])}</h3>` : `<p>${inline(line)}</p>`);
  }
  if (list) out.push("</ul>");
  return out.join("");
}

// Natural sort for site ids (P1, P2, ... P10)
export const siteSort = (a, b) => a.localeCompare(b, "ko", { numeric: true });

// ---------------- Line chart (one metric, limit lines, hover tooltip) ----------------
export function lineChart(box, points, opt = {}) {
  // points: [{t: Date, v: number}]
  const W = 520, H = 170, L = 38, R = 10, T = 10, B = 22;
  const pts = points.filter((p) => Number.isFinite(p.v));
  if (pts.length < 2) {
    box.insertAdjacentHTML("beforeend", `<p class="note" style="padding:20px 0">측정값 없음</p>`);
    return;
  }
  const t0 = pts[0].t.getTime(), t1 = pts[pts.length - 1].t.getTime();
  let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  for (const lim of [opt.min, opt.max]) if (lim != null) (lo = Math.min(lo, lim)), (hi = Math.max(hi, lim));
  const pad = (hi - lo) * 0.12 || 1;
  lo -= pad; hi += pad;
  const x = (t) => L + ((t - t0) / Math.max(t1 - t0, 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t.getTime()).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const band = (a, b) => `<rect x="${L}" y="${Math.min(y(a), y(b))}" width="${W - L - R}" height="${Math.abs(y(a) - y(b))}" fill="var(--bad)" opacity=".07"/>`;
  const limLine = (v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--bad)" stroke-width="1" stroke-dasharray="4 4" opacity=".7"/><text x="${W - R}" y="${y(v) - 4}" text-anchor="end" font-size="10" fill="var(--bad)">기준 ${v}</text>`;
  const hh = (t) => { const z = new Date(t); return `${String(z.getHours()).padStart(2, "0")}:${String(z.getMinutes()).padStart(2, "0")}`; };
  const svg = `
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label || "")} 측정값 그래프">
    ${opt.max != null ? band(opt.max, hi) + limLine(opt.max) : ""}
    ${opt.min != null ? band(lo, opt.min) + limLine(opt.min) : ""}
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(22,33,30,.08)"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end" font-size="10" fill="var(--muted)" >${fmt(v, opt.digits ?? 1)}</text>`).join("")}
    <text x="${L}" y="${H - 4}" font-size="10" fill="var(--muted)" >${hh(t0)}</text>
    <text x="${W - R}" y="${H - 4}" text-anchor="end" font-size="10" fill="var(--muted)" >${hh(t1)}</text>
    <path d="${d}" fill="none" stroke="var(--water-deep)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <line class="xh" y1="${T}" y2="${H - B}" stroke="var(--ink)" stroke-width="1" opacity="0" vector-effect="non-scaling-stroke"/>
    <circle class="dot" r="4" fill="var(--water-deep)" stroke="#fff" stroke-width="2" opacity="0"/>
    <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="hit"/>
  </svg>`;
  box.insertAdjacentHTML("beforeend", svg);
  const el = box.querySelector("svg:last-of-type");
  const tip = document.createElement("div");
  tip.className = "tip"; tip.hidden = true; box.appendChild(tip);
  const xh = el.querySelector(".xh"), dot = el.querySelector(".dot");
  el.querySelector(".hit").addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const t = t0 + ((sx - L) / (W - L - R)) * (t1 - t0);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    const px = x(best.t.getTime()), py = y(best.v);
    xh.setAttribute("x1", px); xh.setAttribute("x2", px); xh.setAttribute("opacity", ".25");
    dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("opacity", "1");
    tip.hidden = false;
    const br = box.getBoundingClientRect(); // tooltip is positioned relative to the chart box
    tip.style.left = (r.left - br.left + (px / W) * r.width) + "px";
    tip.style.top = (r.top - br.top + (py / H) * r.height) + "px";
    tip.innerHTML = `${hh(best.t.getTime())}  <b class="mono">${fmt(best.v, opt.digits ?? 1)}</b> ${esc(opt.unit || "")}`;
  });
  el.querySelector(".hit").addEventListener("pointerleave", () => {
    tip.hidden = true; xh.setAttribute("opacity", "0"); dot.setAttribute("opacity", "0");
  });
}

// Small sparkline under each sensor tile (no axes)
export function sparkline(values, color = "var(--water-deep)") {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return "";
  const W = 120, H = 30, lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const d = v.map((x, i) => `${i ? "L" : "M"}${((i / (v.length - 1)) * W).toFixed(1)},${(H - 3 - ((x - lo) / span) * (H - 6)).toFixed(1)}`).join("");
  return `<svg class="tile__spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

// ---------------- Duck moods ----------------
// Map the three statuses to duck faces from the design (3 of the 7 moods)
export const MOOD = {
  good: { mood: "smile", say: "괜찮아요, 놀러 오세요" },
  warn: { mood: "sweat", say: "조금 걱정돼요…" },
  bad:  { mood: "teary", say: "으앙, 물이 답답해요" },
  info: { mood: "hmm",   say: "음… 아직 잘 모르겠어요" },
  none: { mood: "hmm",   say: "음… 아직 잘 모르겠어요" },
};
export const STATUS_COLOR = { good: "#10A97C", warn: "#E8850A", bad: "#E5484D", info: "#7C8D88", none: "#AFBDB8" };

// ---------------- Ingyeongho lake map (taken from the design mockup) ----------------
const LAKE = "M236 18C268 14 284 32 281 60C278 86 264 100 246 112C232 122 226 134 225 152C224 180 221 214 216 246C211 278 200 312 186 338C178 352 168 362 156 358C138 352 112 340 90 322C72 308 62 298 70 286C82 270 106 248 126 228C146 208 160 188 172 162C184 136 194 104 204 74C212 48 220 26 236 18Z";
const ROUTE = "M136 346C158 342 178 316 191 288C199 268 202 254 205 235C209 210 209 190 212 168C216 140 228 112 244 92C254 78 260 62 258 48C255 34 240 28 230 38C221 48 216 62 208 80C198 104 184 128 168 158C152 188 130 224 112 258C104 274 97 288 95 302C92 320 106 340 124 345C128 346 132 346 136 346Z";
const LABELS = { 3: [118, 58, 94], 4: [228, 148, 108], 2: [228, 224, 106], 5: [0, 264, 84], 1: [22, 358, 84] };

export function lakeMap(sites, statusOf = () => "none", robotAt = null) {
  const dots = sites.map((s) => {
    const c = STATUS_COLOR[statusOf(s.id)] || STATUS_COLOR.none;
    return `<g class="mapsite" data-site="${esc(s.id)}" tabindex="0" role="button" aria-label="${s.no}번 ${esc(s.name)}">
      <circle cx="${s.x}" cy="${s.y}" r="21" fill="${c}" opacity=".28"/>
      <circle cx="${s.x}" cy="${s.y}" r="15" fill="${c}" stroke="#fff" stroke-width="3.4"/>
      <text x="${s.x}" y="${s.y + 5.4}" text-anchor="middle" font-size="15" font-family="Jua, sans-serif" fill="#fff">${s.no}</text></g>`;
  }).join("");
  const labels = sites.map((s) => {
    const l = LABELS[s.no]; if (!l) return "";
    return `<rect x="${l[0]}" y="${l[1]}" width="${l[2]}" height="22" rx="10" fill="#FFFFFF" opacity=".96"/>
      <text x="${l[0] + l[2] / 2}" y="${l[1] + 15.5}" text-anchor="middle">${s.no} ${esc(s.name)}</text>`;
  }).join("");
  const r = robotAt ? sites.find((s) => s.id === robotAt) : null;
  const robot = r ? `<g transform="translate(${r.x + 22},${r.y - 18})"><circle r="16" fill="#FFA61F" opacity=".25"/>
      <g fill="#14513C" stroke="#14513C" stroke-width="5" stroke-linejoin="round"><ellipse cx="-1" cy="4" rx="10" ry="6.4"/><circle cx="6" cy="-4" r="7"/></g>
      <g fill="#fff"><ellipse cx="-1" cy="4" rx="10" ry="6.4"/><circle cx="6" cy="-4" r="7"/></g>
      <ellipse cx="14" cy="-3" rx="4.4" ry="2.8" fill="#FFA61F" stroke="#14513C" stroke-width="1.4"/><circle cx="8" cy="-5.5" r="1.4" fill="#14513C"/></g>` : "";
  return `<svg class="lakemap" viewBox="0 0 340 390" role="img" aria-label="인하대 인경호 지도와 5개 측정 지점">
    <defs><linearGradient id="lkw" x1="0.2" y1="0" x2="0.9" y2="1"><stop offset="0" stop-color="#AFE2F0"/><stop offset="1" stop-color="#66C6D8"/></linearGradient></defs>
    <rect width="340" height="390" fill="#F1F7F4"/>
    <g fill="#E6EFEA"><rect x="-14" y="-14" width="74" height="58" rx="10"/><rect x="-14" y="54" width="52" height="76" rx="10"/><rect x="-14" y="300" width="56" height="60" rx="10"/><rect x="288" y="8" width="66" height="94" rx="10"/><rect x="292" y="170" width="62" height="76" rx="10"/><rect x="294" y="304" width="60" height="72" rx="10"/></g>
    <g stroke="#FFFFFF" fill="none" stroke-linecap="round"><path d="M92 -16 L-16 202" stroke-width="27"/><path d="M-16 264 L206 400" stroke-width="25"/><path d="M300 -16 L346 182" stroke-width="21"/><path d="M262 400 L346 296" stroke-width="19"/></g>
    <g fill="none" stroke="#DEEAE4" stroke-width="2.4"><circle cx="240" cy="356" r="12"/><circle cx="240" cy="356" r="20"/><circle cx="240" cy="356" r="28"/><circle cx="240" cy="356" r="36"/></g>
    <text x="240" y="360" font-size="10.5" fill="#8FB0A2" text-anchor="middle">통일광장</text>
    <path d="${LAKE}" fill="url(#lkw)"/><path d="${LAKE}" fill="none" stroke="#14513C" stroke-width="2.8"/>
    <path class="ants" d="${ROUTE}" fill="none" stroke="#FFFFFF" stroke-width="3.4" stroke-dasharray="8 8" stroke-linecap="round"/>
    ${dots}
    <g font-size="11" font-weight="600" fill="#14513C">${labels}</g>
    <g font-size="10.5" fill="#7FA595"><text x="318" y="114" text-anchor="middle">입구</text><text x="322" y="288" text-anchor="middle">대학서적</text><text x="320" y="336" text-anchor="middle">하나은행</text></g>
    ${robot}
  </svg>`;
}

// ---------------- Shared header and footer ----------------
import { duckFace } from "./duck.js";

export const NAV = [
  ["index.html", "실시간"], ["lake.html", "인경호"], ["reports.html", "보고서"],
  ["join.html", "참여"], ["about.html", "소개"], ["data.html", "데이터"],
];

export async function chrome(current) {
  // no decorative background: plain mint paper
  const page = document.querySelector(".page");
  page.insertAdjacentHTML("afterbegin", `
  <header class="top">
    <a class="brand" href="index.html"><span class="brand__mark">${duckFace("smile", 40)}</span>
      <div><div class="brand__name">삐그덕</div><div class="brand__sub">인하대 인경호 수질 순찰</div></div>
    </a>
    <div class="top__r">
      <div class="livebar" id="livebar" aria-live="polite"></div>
      <nav class="nav" aria-label="메뉴">${NAV.map(([h, t]) => `<a href="${h}"${h === current ? ' aria-current="page"' : ""}>${t}</a>`).join("")}</nav>
    </div>
  </header>`);
  const info = await getJSON("data/site.json").catch(() => ({}));
  page.insertAdjacentHTML("beforeend", `<footer class="foot">
    ${esc(info.school || "인하대학교")} ${esc(info.team || "팀 최정김")}이 만들었습니다.${info.contest ? " " + esc(info.contest) + " 출품작." : ""}
    ${info.repo ? ` <a href="${esc(info.repo)}">코드 보기</a>` : ""}</footer>`);
  return info;
}

export function demoBanner(data) {
  if (!data?.demo) return "";
  return `<div class="banner">지금 보이는 측정값은 <b>시연용 예시</b>예요. 실제 순찰 데이터가 올라오면 바뀝니다.</div>`;
}

export const demoTag = (on) => (on ? `<span class="tag-demo">시연용 예시</span>` : "");
