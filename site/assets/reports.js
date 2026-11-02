// Reports page: filterable list on the left, detail on the right (status table, charts, report body)
import { chrome, demoBanner, getJSON, getCSV, STATUS_KO, stChip, fmt, when, md, esc,
         limitText, lineChart, siteSort, DIGITS } from "./common.js";

chrome("reports.html");
const $ = (id) => document.getElementById(id);
let all = [];

async function init() {
  const data = await getJSON("data/reports.json");
  all = data.reports;
  $("banner").innerHTML = demoBanner(data);
  const sites = [...new Set(all.map((r) => r.site))].sort(siteSort);
  const nameOf = (id) => all.find((r) => r.site === id)?.site_name || id;
  $("fSite").insertAdjacentHTML("beforeend", sites.map((s) => `<option value="${esc(s)}">${esc(nameOf(s))}</option>`).join(""));
  $("fSite").onchange = $("fStatus").onchange = renderList;
  renderList();
  const id = new URLSearchParams(location.search).get("id") || all[0]?.id;
  if (id) show(id);
}

function renderList() {
  const s = $("fSite").value, st = $("fStatus").value;
  const items = all.filter((r) => (!s || r.site === s) && (!st || r.overall === st));
  $("count").textContent = `${items.length}건`;
  const cur = new URLSearchParams(location.search).get("id");
  $("list").innerHTML = items.length
    ? items.map((r) => `<li><a href="?id=${encodeURIComponent(r.id)}" data-id="${esc(r.id)}"${r.id === cur ? ' aria-current="true"' : ""}>
        <div><b>${esc(r.site_name || r.site)}</b><span class="when mono">${when(r.start)}</span></div>${stChip(r.overall)}</a></li>`).join("")
    : `<li class="empty">조건에 맞는 보고서 없음</li>`;
}

$("list").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-id]");
  if (!a) return;
  e.preventDefault();
  history.replaceState(null, "", "?id=" + encodeURIComponent(a.dataset.id));
  for (const x of document.querySelectorAll(".rlist a")) x.toggleAttribute("aria-current", x === a);
  if (a) a.setAttribute("aria-current", "true");
  show(a.dataset.id);
});

async function show(id) {
  const r = await getJSON(`data/reports/${encodeURIComponent(id)}.json`);
  const rows = r.has_csv ? await getCSV(`data/csv/${encodeURIComponent(id)}.csv`).catch(() => []) : [];
  const unknown = r.ai_check && r.ai_check.ok === false ? r.ai_check.unknown_numbers : null;

  $("detail").innerHTML = `
    <div class="card__hd">
      <div>
        <h2 class="section-title">${esc(r.site_name || r.site)}</h2>
        <p class="card__meta" style="margin-top:4px">${esc(r.date)} ${when(r.start).slice(6)}~${when(r.end).slice(6)}, ${r.rows}번 측정</p>
      </div>
      ${stChip(r.overall)}
    </div>

    <div style="overflow-x:auto"><table class="mtable">
      <thead><tr><th>항목</th><th>판정</th><th class="num">평균</th><th class="num">최소</th><th class="num">최대</th><th>기준</th><th class="num">기준 이탈</th></tr></thead>
      <tbody>${r.metrics.map((m) => {
        const d = DIGITS[m.key] ?? 2;
        return `<tr><td><b>${esc(m.label)}</b></td><td>${stChip(m.status)}</td>
          <td class="num mono">${fmt(m.mean, d)}</td><td class="num mono">${fmt(m.min, d)}</td><td class="num mono">${fmt(m.max, d)}</td>
          <td>${limitText(m)}</td><td class="num mono">${m.status === "info" || m.status === "none" ? "–" : m.exceed_pct + "%"}</td></tr>`;
      }).join("")}</tbody>
    </table></div>

    <div class="charts" id="charts"></div>

    <h3 class="h-jua" style="font-size:19px;margin:24px 0 8px">보고서</h3>
    <div class="md">${md(r.body_md)}</div>
    ${unknown ? `<div class="warnbox">⚠ 본문에 측정 결과에 없던 숫자가 있습니다: ${unknown.map(esc).join(", ")} — 표의 값을 기준으로 읽어 주세요.</div>` : ""}

    <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
      ${r.has_csv ? `<a class="btn" href="data/csv/${encodeURIComponent(r.id)}.csv" download>CSV 다운로드</a>` : ""}
      <a class="btn btn--ghost" href="index.html">실시간 화면</a>
    </div>
    <p class="note" style="margin-top:12px">판정은 기준을 벗어난 측정 비율로 정해요. 0%면 적합, 10% 미만이면 주의, 그 이상이면 부적합. 기준이 없는 항목은 참고값입니다.
      판정 숫자는 코드가 계산하고, 보고서 문장은 ${r.writer === "template" ? "기본 틀로" : "AI(" + esc(r.writer) + ")가"} 작성했습니다.</p>`;

  const box = $("charts");
  for (const m of r.metrics) {
    const s = { digits: DIGITS[m.key] ?? 2 };
    const pts = rows.map((row) => ({ t: new Date(row.time), v: row[m.key] === "" ? NaN : Number(row[m.key]) }));
    const wrap = document.createElement("div");
    wrap.className = "chart";
    wrap.innerHTML = `<h4>${esc(m.label)} <span>${[m.unit, m.limit_min != null || m.limit_max != null ? "빨간 점선 = 기준" : ""].filter(Boolean).map(esc).join(", ")}</span></h4>`;
    box.appendChild(wrap);
    lineChart(wrap, pts, { min: m.limit_min, max: m.limit_max, unit: m.unit, digits: s.digits, label: m.label });
  }
  document.title = `삐그덕 · ${r.site_name || r.site} ${r.date}`;
}

init().catch((e) => { console.error(e); $("detail").innerHTML = `<p class="empty">보고서를 불러오지 못했습니다.</p>`; });
