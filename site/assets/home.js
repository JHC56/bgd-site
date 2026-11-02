// Main page: live video + latest report per site + five sensor tiles
import { chrome, demoBanner, getJSON, getCSV, SENSORS, STATUS_KO, stChip, fmt, when, md, esc,
         limitText, judgeValue, flagNote, sparkline, siteSort, MOOD, STATUS_COLOR } from "./common.js";
import { duckFace } from "./duck.js";

chrome("index.html");

const $ = (id) => document.getElementById(id);
const state = { data: null, criteria: null, sites: [], site: null, live: false, liveHist: {}, liveSite: null };
const siteOf = (id) => state.sites.find((s) => s.id === id);
const siteName = (id) => { const s = siteOf(id); return s ? `${s.no}. ${s.name}` : id; };

// ---------------- Report ----------------
async function init() {
  const [data, criteria, live, siteCfg] = await Promise.all([
    getJSON("data/reports.json"),
    getJSON("data/criteria.json"),
    getJSON("data/live.json").catch(() => ({ url: "" })),
    getJSON("data/sites.json").catch(() => ({ sites: [] })),
  ]);
  state.data = data;
  state.sites = siteCfg.sites;
  state.criteria = criteria;
  $("banner").innerHTML = demoBanner(data);

  const latest = latestBySite(data.reports);
  const sites = Object.keys(latest).sort(siteSort);
  state.site = data.reports[0]?.site ?? sites[0] ?? null;

  $("sites").innerHTML = sites.map((s) => {
    const st = latest[s].overall;
    return `<button class="sitebtn" data-site="${esc(s)}" aria-pressed="false" title="${esc(siteName(s))} ${STATUS_KO[st]}">
      <i style="background:${STATUS_COLOR[st]}"></i>${siteOf(s) ? siteOf(s).no + "번" : esc(s)}</button>`;
  }).join("");
  $("sites").addEventListener("click", (e) => {
    const b = e.target.closest(".sitebtn");
    if (b) selectSite(b.dataset.site);
  });

  if (sites.length === 0) {
    $("rbody").innerHTML = `<p class="empty">아직 승인된 보고서가 없습니다.</p>`;
    renderTiles(null, []);
  } else {
    await selectSite(state.site);
  }
  liveBar();
  if (live.url) connectLive(live.url);
}

function latestBySite(reports) {
  const out = {};
  for (const r of reports) if (!out[r.site] || r.start > out[r.site].start) out[r.site] = r;
  return out;
}

async function selectSite(site) {
  state.site = site;
  for (const b of document.querySelectorAll(".sitebtn")) b.setAttribute("aria-pressed", String(b.dataset.site === site));
  const brief = latestBySite(state.data.reports)[site];
  const full = await getJSON(`data/reports/${brief.id}.json`);
  const mood = MOOD[full.overall] || MOOD.none;
  $("rmeta").textContent = `${when(full.start)} 측정`;
  $("rhead").innerHTML = `
    <span class="report__face">${duckFace(mood.mood, 76)}</span>
    <div class="bubble"><p>${mood.say}</p><span>${esc(siteName(site))} ${stChip(full.overall)}</span></div>`;
  $("rbody").innerHTML = md(full.body_md);
  $("rfoot").innerHTML = `<span>${when(full.start)}부터 ${full.rows}번 잼</span><a href="reports.html?id=${encodeURIComponent(full.id)}">그래프로 보기</a>`;

  if (!state.live) {
    let rows = [];
    if (full.has_csv) rows = await getCSV(`data/csv/${full.id}.csv`).catch(() => []);
    renderTiles(full, rows);
  }
}

// ---------------- Sensor tiles ----------------
function liveBar() {
  const el = document.getElementById("livebar");
  if (!el) return;
  const last = state.data?.reports?.[0];
  el.innerHTML = state.live
    ? `<span class="pill pill--live">LIVE</span><span>오리 3호 순찰 중${state.liveSite ? ", <b>" + esc(siteName(state.liveSite)) + "</b> 근처" : ""}</span>`
    : `<span class="pill pill--off">오프라인</span><span>${last ? `마지막 측정 <b>${when(last.end)}</b>` : "측정 기록 없음"}</span>`;
}

function tile(s, value, status, sub, spark) {
  return `<div class="tile tile--${status}" role="group" aria-label="${s.name} ${value == null ? "값 없음" : fmt(value, s.digits) + s.unit} ${STATUS_KO[status]}">
    <div class="tile__hd"><span class="tile__name">${s.name}</span>${status === "good" || status === "warn" || status === "bad" ? stChip(status) : ""}</div>
    <div class="tile__val mono">${fmt(value, s.digits)}<small>${s.unit}</small></div>
    <div class="tile__sub">${sub}</div>
    ${spark || ""}
  </div>`;
}

function renderTiles(report, rows) {
  $("sensors").innerHTML = SENSORS.map((s) => {
    const m = report?.metrics?.find((x) => x.key === s.key);
    const lim = limitText({ ...(m || {}), unit: s.unit, limit_min: state.criteria.metrics[s.key]?.enabled ? state.criteria.metrics[s.key].min : null, limit_max: state.criteria.metrics[s.key]?.enabled ? state.criteria.metrics[s.key].max : null });
    if (!m || m.n === 0) return tile(s, null, "none", `${lim}<br>${s.key === "ph" ? "pH 센서 연결 전" : "이번 측정에 값 없음"}`, "");
    const series = rows.map((r) => Number(r[s.key])).filter(Number.isFinite);
    return tile(s, m.last, m.status, `${lim}<br>${esc(siteName(report.site))}, ${when(report.end)}`, sparkline(series));
  }).join("");
}

function renderLiveTiles(d) {
  $("sensors").innerHTML = SENSORS.map((s) => {
    const raw = d[s.key];
    const v = raw === "" || raw == null ? null : Number(raw);
    const note = flagNote(s.key, Number(d.flag || 0));
    const hist = (state.liveHist[s.key] ||= []);
    if (v !== null && !note) { hist.push(v); if (hist.length > 90) hist.shift(); }
    const status = note ? "none" : judgeValue(s.key, v, state.criteria);
    const c = state.criteria.metrics[s.key];
    const lim = limitText({ unit: s.unit, limit_min: c?.enabled ? c.min : null, limit_max: c?.enabled ? c.max : null });
    return tile(s, note ? null : v, status, `${lim}<br>${note ? "⚠ " + note : "지금 " + (state.liveSite ? esc(siteName(state.liveSite)) : "순찰 중")}`, sparkline(hist));
  }).join("");
}

// ---------------- Live (laptop relay server) ----------------
// Message format agreed with the relay server:
//   text    {"type":"sensor","site":"P1","data":{temp_c, turb_ntu, ec_uS_cm, tds_ppm, level_mm, ph, flag}}
//           {"type":"objects","items":[{"name":"person","conf":0.87}, …]}
//   binary  one JPEG frame (with YOLO boxes drawn)
function connectLive(url) {
  let ws, frames = 0, lastUrl = null, t0 = performance.now(), lastMsg = 0;
  const setLive = (on) => {
    if (state.live === on) return;   // redraw only on change (no flicker on every reconnect attempt)
    state.live = on;
    $("livePill").className = "pill pill--live";
    $("livePill").hidden = !on;   // the offline state is shown in the header only
    $("livePill").textContent = on ? "LIVE" : "오프라인";
    $("cam").hidden = !on; $("offline").hidden = on; $("vstats").hidden = !on;
    if (!on) { $("objs").textContent = ""; if (state.site) selectSite(state.site); }
    liveBar();
  };
  const open = () => {
    try { ws = new WebSocket(url); } catch { return setTimeout(open, 5000); }
    ws.binaryType = "blob";
    ws.onmessage = (e) => {
      lastMsg = performance.now();
      if (!state.live) setLive(true);
      if (typeof e.data !== "string") {
        const u = URL.createObjectURL(e.data);
        $("cam").src = u;
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastUrl = u; frames++;
        const dt = (performance.now() - t0) / 1000;
        if (dt > 1) { $("vstats").textContent = `${(frames / dt).toFixed(1)} fps`; frames = 0; t0 = performance.now(); }
        return;
      }
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === "sensor") {
        const changed = state.liveSite !== (msg.site || null);
        state.liveSite = msg.site || null;
        renderLiveTiles(msg.data || {});
        if (changed) liveBar();
      }
      if (msg.type === "objects") {
        const items = msg.items || [];
        $("objs").innerHTML = items.length ? "인식: " + items.map((o) => `<b>${esc(o.name)}</b>`).join(", ") : "인식된 물체 없음";
      }
    };
    ws.onclose = () => { setLive(false); setTimeout(open, 5000); };  // retry every 5 s
    ws.onerror = () => ws.close();
  };
  // treat 10 s without messages as disconnected
  setInterval(() => { if (state.live && performance.now() - lastMsg > 10000) ws?.close(); }, 3000);
  open();
}

init().catch((e) => {
  console.error(e);
  $("rbody").innerHTML = `<p class="empty">데이터를 불러오지 못했습니다.</p>`;
});
