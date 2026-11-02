// Lake page: map + site list and detail, site-by-date status history, duck mood chart
import { chrome, demoBanner, getJSON, SENSORS, STATUS_KO, STATUS_COLOR, stChip, fmt, when, esc, MOOD, lakeMap } from "./common.js";
import { duckFace } from "./duck.js";

chrome("lake.html");
const $ = (id) => document.getElementById(id);

// Display ranges for the bars (visual only, unrelated to the criteria)
const RANGE = { temp_c: [0, 35], turb_ntu: [0, 30], ec_uS_cm: [0, 800], ph: [6, 10], level_mm: [0, 50] };

const [data, siteCfg] = await Promise.all([getJSON("data/reports.json"), getJSON("data/sites.json")]);
const sites = siteCfg.sites;
$("banner").innerHTML = demoBanner(data);

const latest = {};
for (const r of data.reports) if (!latest[r.site] || r.start > latest[r.site].start) latest[r.site] = r;
const statusOf = (id) => latest[id]?.overall ?? "none";

$("map").innerHTML = lakeMap(sites, statusOf);
$("sitelist").innerHTML = sites.map((s) => {
  const st = statusOf(s.id);
  return `<li><button class="site" type="button" data-site="${esc(s.id)}" aria-pressed="false">
    <span class="site__face">${duckFace(MOOD[st].mood, 42)}</span>
    <span><span class="site__name">${s.no}. ${esc(s.name)}</span><span class="site__sub">${esc(s.sub)}</span></span>
    ${stChip(st)}</button></li>`;
}).join("");

async function pick(id) {
  for (const b of document.querySelectorAll(".site")) b.setAttribute("aria-pressed", String(b.dataset.site === id));
  const s = sites.find((x) => x.id === id);
  const brief = latest[id];
  let rows = "";
  if (brief) {
    const r = await getJSON(`data/reports/${encodeURIComponent(brief.id)}.json`);
    rows = SENSORS.map((k) => {
      const m = r.metrics.find((x) => x.key === k.key);
      if (!m || m.n === 0) return `<div class="kv"><span>${k.name}</span><span class="kv__bar"></span><span class="kv__v mono">–</span></div>`;
      const [lo, hi] = RANGE[k.key];
      const pct = Math.max(4, Math.min(100, ((m.mean - lo) / (hi - lo)) * 100));
      return `<div class="kv"><span>${k.name}</span><span class="kv__bar"><i style="width:${pct.toFixed(0)}%;background:${STATUS_COLOR[m.status]}"></i></span>
        <span class="kv__v mono">${fmt(m.mean, k.digits)} <small>${k.unit}</small></span></div>`;
    }).join("") + `<p class="note" style="margin-top:8px">${when(r.start)} 측정 평균. <a href="reports.html?id=${encodeURIComponent(r.id)}">보고서 보기</a></p>`;
  }
  const st = statusOf(id);
  $("sitedetail").innerHTML = `<div class="sitedetail">
    <b style="font-size:16px">${s.no}. ${esc(s.name)}</b> ${stChip(st)}
    <p style="font-family:Jua,sans-serif;color:var(--water-deep);font-size:16px">“${MOOD[st].say}”</p>
    <p>${esc(s.desc)}</p>
    <div style="margin-top:10px">${rows || `<p class="note">아직 이 지점 측정 기록이 없어요.</p>`}</div></div>`;
}
$("sitelist").addEventListener("click", (e) => { const b = e.target.closest(".site"); if (b) pick(b.dataset.site); });
$("map").addEventListener("click", (e) => { const g = e.target.closest(".mapsite"); if (g) pick(g.dataset.site); });
$("map").addEventListener("keydown", (e) => { const g = e.target.closest(".mapsite"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(g.dataset.site); } });
if (sites.length) pick(sites.find((s) => latest[s.id])?.id ?? sites[0].id);

// Site x date history (the worst status wins when a site was measured more than once a day)
const RANK = { none: 0, info: 0, good: 1, warn: 2, bad: 3 };
const dates = [...new Set(data.reports.map((r) => r.date))].sort().slice(-14);
const cell = {};
for (const r of data.reports) {
  const k = r.site + "|" + r.date;
  if (!cell[k] || RANK[r.overall] > RANK[cell[k].overall]) cell[k] = r;
}
$("heat").innerHTML = dates.length
  ? `<table class="heat"><thead><tr><th></th>${dates.map((d) => `<th>${d.slice(5).replace("-", ".")}</th>`).join("")}</tr></thead>
     <tbody>${sites.map((s) => `<tr><th>${s.no}. ${esc(s.name)}</th>${dates.map((d) => {
       const r = cell[s.id + "|" + d];
       return r ? `<td style="background:${STATUS_COLOR[r.overall]}" title="${esc(s.name)} ${d} ${STATUS_KO[r.overall]}"><a href="reports.html?id=${encodeURIComponent(r.id)}">${STATUS_KO[r.overall].slice(0, 2)}</a></td>`
               : `<td class="none" title="측정 없음">·</td>`;
     }).join("")}</tr>`).join("")}</tbody></table>`
  : `<p class="empty">아직 기록이 없어요</p>`;

// Duck mood chart (the 7 levels from the design)
const GRADES = [
  { code: "Ia", label: "매우좋음", bg: "#3FA9F5", mood: "love", say: "완전 깨끗해요!" },
  { code: "Ib", label: "좋음", bg: "#56C7E8", mood: "happy", say: "기분 최고예요!" },
  { code: "II", label: "약간좋음", bg: "#4CC38A", mood: "smile", say: "괜찮아요, 놀러 오세요" },
  { code: "III", label: "보통", bg: "#F5C542", mood: "hmm", say: "음… 보통이에요" },
  { code: "IV", label: "약간나쁨", bg: "#F5943A", mood: "sweat", say: "조금 걱정돼요…" },
  { code: "V", label: "나쁨", bg: "#EF5F5F", mood: "teary", say: "으앙, 물이 답답해요" },
  { code: "VI", label: "매우나쁨", bg: "#B96BC9", mood: "cry", say: "엉엉… 도와주세요!" },
];
const USED = { smile: "적합", sweat: "주의", teary: "부적합" };
$("moods").innerHTML = GRADES.map((g) => `<div class="mood${USED[g.mood] ? " mood--used" : ""}">
  <i style="background:${g.bg}">${g.code}</i>${duckFace(g.mood, 74)}
  <b>${g.label}${USED[g.mood] ? ` (${USED[g.mood]})` : ""}</b><span>${g.say}</span></div>`).join("");
