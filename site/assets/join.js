// Join page: action log with before/after, clean-up event, participation by department, reporting
import { chrome, getJSON, esc, demoTag, fmt } from "./common.js";

const info = await chrome("join.html");
const $ = (id) => document.getElementById(id);
const act = await getJSON("data/activities.json").catch(() => ({ actions: [] }));
const sites = (await getJSON("data/sites.json").catch(() => ({ sites: [] }))).sites;
const siteName = (id) => { const s = sites.find((x) => x.id === id); return s ? `${s.no}번 ${s.name}` : ""; };

$("actions").innerHTML = (act.actions || []).map((a) => {
  let ba = "";
  if (a.before != null && a.after != null) {
    const pct = ((a.after - a.before) / a.before) * 100;
    ba = `<div class="ba"><div><small>전</small><strong>${fmt(a.before)}</strong></div><span>→</span>
      <div><small>후</small><strong>${fmt(a.after)}</strong></div>
      <em>${esc(a.metric)} ${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}%</em></div>`;
  }
  return `<div class="act">
    <div class="act__when mono">${esc(a.period)}${a.site ? `<br>${esc(siteName(a.site))}` : ""}</div>
    <div><b>${esc(a.title)}</b>${demoTag(a.demo)}<p>${esc(a.desc)}</p></div>
    ${ba || "<div></div>"}</div>`;
}).join("") || `<p class="empty">아직 기록된 조치가 없어요</p>`;

const ev = act.event;
if (ev) {
  const form = info.join_form_url;
  $("event").innerHTML = `
    <div class="card__hd"><h2 class="card__title">${esc(ev.title)}${demoTag(ev.demo)}</h2><span class="card__meta">${esc(ev.sub)}</span></div>
    <div class="event__meta">${[ev.when, ev.where, ev.size, ev.credit].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("")}</div>
    <p class="section-lead" style="margin-top:12px">${esc(ev.note)}</p>
    <div style="margin-top:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      ${form ? `<a class="btn" href="${esc(form)}" target="_blank" rel="noopener">신청하기</a>` : `<a class="btn" aria-disabled="true">신청 준비 중</a>`}
      ${ev.next ? `<span class="note">다음 회차 ${esc(ev.next)}</span>` : ""}
    </div>`;
}

const d = act.departments;
if (d) {
  $("deptyear").innerHTML = esc(d.year) + demoTag(d.demo);
  const max = Math.max(...d.rows.map((r) => r.v));
  $("rank").innerHTML = d.rows.map((r) => `<div><span>${esc(r.name)}</span><i style="width:${((r.v / max) * 100).toFixed(0)}%"></i><span>${r.v}명</span></div>`).join("");
}

$("reportBtn").href = info.repo ? `${info.repo}/issues/new?template=water-report.yml` : "#";
