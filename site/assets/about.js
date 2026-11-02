// About page: large duck illustration + places the robot could go next
import { chrome } from "./common.js";
import { duckSVG } from "./duck.js";

chrome("about.html");
document.getElementById("bigduck").innerHTML = duckSVG("happy", 300);

const PLACES = [
  ["단지 앞 저류지", `<rect x="6" y="18" width="32" height="18" rx="5" fill="#7FD4E0"/><path d="M10 14h8v4h-8zM26 10h8v8h-8z" fill="#AFBDB8"/>`],
  ["공원 연못", `<ellipse cx="22" cy="28" rx="17" ry="9" fill="#7FD4E0"/><path d="M8 18c2-6 6-6 8 0M30 16c2-6 6-6 8 0" stroke="#10A97C" stroke-width="3" fill="none" stroke-linecap="round"/>`],
  ["산책로 수로", `<path d="M4 30c8-6 14-6 20 0s12 6 20 0" stroke="#14A8BE" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M4 16h36" stroke="#AFBDB8" stroke-width="3" stroke-dasharray="4 4"/>`],
  ["도시 수변공원", `<path d="M4 32h36" stroke="#14A8BE" stroke-width="6" stroke-linecap="round"/><circle cx="14" cy="16" r="7" fill="#4CC38A"/><path d="M14 22v6" stroke="#4E5F5A" stroke-width="2"/><rect x="26" y="12" width="12" height="14" rx="2" fill="#AFBDB8"/>`],
];
document.getElementById("places").innerHTML = PLACES.map(([t, g]) =>
  `<div><svg viewBox="0 0 44 44" aria-hidden="true">${g}</svg>${t}</div>`).join("");
