// Duck illustration, ported from the team's design mockup (BeGreenDuck app HTML).
// duckSVG(mood, width), duckFace(mood, width)
var C = {
  line:  "#16503C",
  body:  "#FFFFFF",
  shade: "#EAF3EE",
  bill:  "#F5A623",
  panel: "#1E3F63",
  cell:  "#7FB3DC",
  water: "#5FBCC7",
  tear:  "#3FA3B2",
  blush: "#FF9EB5",
  sensor:"#2E7D5B"
};

/* Duck drawing: side view from the presentation slides.
   viewBox 0 0 300 210, head (234,82) r36, bill (272,80) */
var uid = 0;

/* Silhouette: draw one thick dark shape, then cover it in white so the outline reads as a single line.
   Head r42, body rx80: a duckling, but close to real duck proportions. */
var TUFT = "M189 45C185 33 192 25 203 25C195 31 195 38 198 44Z";
var PARTS =
    '<path d="M100 112C86 108 70 104 58 96C66 106 68 116 66 128C78 126 90 120 100 112Z"/>'
  + '<ellipse cx="142" cy="132" rx="80" ry="46"/>'
  + '<circle cx="200" cy="80" r="42"/>'
  + '<path d="' + TUFT + '"/>';

function silhouette(){
  return '<g fill="' + C.line + '" stroke="' + C.line + '" stroke-width="7" stroke-linejoin="round">' + PARTS + '</g>'
       + '<g fill="' + C.body + '">' + PARTS + '</g>';
}

/* Panel on the back, like a small backpack */
function panel(){
  return '<path d="M99 116L157 102L163 126L105 140Z" fill="#12294A" opacity=".45"/>'
    + '<path d="M96 110L154 96L160 120L102 134Z" fill="' + C.panel + '" stroke="' + C.line + '" stroke-width="3" stroke-linejoin="round"/>'
    + '<g stroke="' + C.cell + '" stroke-width="1.5" opacity=".8" stroke-linecap="round">'
    + '<path d="M115.3 105.5L121.3 129.5M134.7 100.8L140.7 124.8M99 122L157 108"/></g>'
    + '<path d="M101.8 108.6L119.4 104.4L125.4 128.4L107.8 132.6Z" fill="#FFFFFF" opacity=".18"/>'
    + '<path d="M98 112L156 98" stroke="#FFFFFF" stroke-width="1.6" opacity=".35" stroke-linecap="round" fill="none"/>';
}

/* Eyes at a three-quarter angle: far eye 184,72, near eye 218,68 */
function shine(cx, cy, r){
  return '<circle cx="' + (cx + r*0.34) + '" cy="' + (cy - r*0.42) + '" r="' + (r*0.40).toFixed(1) + '" fill="#fff"/>'
       + '<circle cx="' + (cx - r*0.42) + '" cy="' + (cy + r*0.44) + '" r="' + (r*0.22).toFixed(1) + '" fill="#fff" opacity=".9"/>'
       + '<ellipse cx="' + (cx - r*0.08) + '" cy="' + (cy + r*0.70) + '" rx="' + (r*0.40).toFixed(1) + '" ry="' + (r*0.16).toFixed(1) + '" fill="#fff" opacity=".35"/>';
}
var EYE = {
  arcUp:  '<path d="M176 76q8-12 16 0" stroke="' + C.line + '" stroke-width="4.4" fill="none" stroke-linecap="round"/>'
        + '<path d="M209 72q9-13 18 0" stroke="' + C.line + '" stroke-width="4.8" fill="none" stroke-linecap="round"/>',
  round:  '<circle cx="184" cy="72" r="7.4" fill="' + C.line + '"/>' + shine(184,72,7.4)
        + '<circle cx="218" cy="68" r="8.4" fill="' + C.line + '"/>' + shine(218,68,8.4),
  small:  '<circle cx="184" cy="72" r="5.4" fill="' + C.line + '"/>' + shine(184,72,5.4)
        + '<circle cx="218" cy="68" r="6.2" fill="' + C.line + '"/>' + shine(218,68,6.2),
  squint: '<path d="M175 74q9-9 18 0q-9 9-18 0z" fill="' + C.line + '"/>'
        + '<path d="M208 70q10-10 20 0q-10 10-20 0z" fill="' + C.line + '"/>'
        + '<path d="M174 59q9-4 17 3" stroke="' + C.line + '" stroke-width="2.8" fill="none" stroke-linecap="round"/>'
        + '<path d="M207 55q10-4 19 3" stroke="' + C.line + '" stroke-width="2.8" fill="none" stroke-linecap="round"/>',
  teary:  '<circle cx="184" cy="71" r="8.4" fill="' + C.line + '"/>' + shine(184,71,8.4)
        + '<circle cx="218" cy="67" r="9.4" fill="' + C.line + '"/>' + shine(218,67,9.4)
        + '<ellipse cx="176" cy="85" rx="4" ry="5.2" fill="' + C.tear + '"/>'
        + '<ellipse cx="210" cy="82" rx="4.2" ry="5.4" fill="' + C.tear + '"/>',
  arcDown:'<path d="M176 69q8 12 16 0" stroke="' + C.line + '" stroke-width="4.4" fill="none" stroke-linecap="round"/>'
        + '<path d="M209 65q9 13 18 0" stroke="' + C.line + '" stroke-width="4.8" fill="none" stroke-linecap="round"/>'
};

/* Bill, hinged at (200,86) */
function bill(rot){
  return '<g transform="rotate(' + rot + ' 200 86)">'
       + '<ellipse cx="222" cy="94" rx="18" ry="11.5" fill="' + C.bill + '" stroke="' + C.line + '" stroke-width="3"/>'
       + '<path d="M209 95q12 5 25-1" stroke="#DE861B" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".65"/></g>';
}
var BILL = {
  up:   bill(-7),
  flat: bill(2),
  down: bill(11),
  open: '<ellipse cx="221" cy="96" rx="15" ry="8.5" fill="#C0442E"/>'
      + '<ellipse cx="222" cy="98" rx="7.5" ry="3.2" fill="#FF8FA0"/>'
      + '<g transform="rotate(-8 200 84)"><ellipse cx="222" cy="85" rx="18" ry="8" fill="' + C.bill + '" stroke="' + C.line + '" stroke-width="3"/></g>'
      + '<g transform="rotate(9 200 102)"><ellipse cx="219" cy="107" rx="16" ry="7.5" fill="' + C.bill + '" stroke="' + C.line + '" stroke-width="3"/></g>'
};

var EXTRA = {
  sparkle:'<g class="dk-spark" fill="' + C.bill + '"><path d="M130 34l3.2 8.6 8.6 3.2-8.6 3.2-3.2 8.6-3.2-8.6-8.6-3.2 8.6-3.2z"/>'
        + '<path d="M262 44l2.4 6.4 6.4 2.4-6.4 2.4-2.4 6.4-2.4-6.4-6.4-2.4 6.4-2.4z"/>'
        + '<path d="M160 18l2 5.4 5.4 2-5.4 2-2 5.4-2-5.4-5.4-2 5.4-2z"/></g>',
  question:'<text x="116" y="62" font-size="36" font-family="Jua, sans-serif" fill="' + C.line + '" opacity=".42">?</text>',
  sweat:'<path d="M148 26c0 0-9 12-9 17a9 9 0 0 0 18 0c0-5-9-17-9-17z" fill="' + C.tear + '"/>',
  drop:'<path d="M174 88q-5.5 11-2 15.5t8-2q.6-5-6-13.5z" fill="' + C.tear + '"/>',
  cry:'<path d="M177 84q-12 20-9 38 12-15 12-36z" fill="' + C.tear + '"/>'
     + '<path d="M227 76q9 13 10 25-8-10-14-23z" fill="' + C.tear + '"/>'
     + '<circle cx="160" cy="134" r="4.6" fill="' + C.tear + '"/>'
     + '<circle cx="243" cy="112" r="3.8" fill="' + C.tear + '"/>'
     + '<circle cx="151" cy="154" r="3" fill="' + C.tear + '" opacity=".8"/>'
};

var MOODS = {
  love:  { eye:EYE.arcUp,   bill:BILL.up,   blush:.85, extra:"sparkle",  name:"활짝" },
  happy: { eye:EYE.arcUp,   bill:BILL.up,   blush:.7,  extra:"sparkle",  name:"방긋" },
  smile: { eye:EYE.round,   bill:BILL.up,   blush:.55, extra:"",         name:"미소" },
  hmm:   { eye:EYE.small,   bill:BILL.flat, blush:.38, extra:"question", name:"갸웃" },
  sweat: { eye:EYE.squint,  bill:BILL.down, blush:.28, extra:"sweat",    name:"찡그림" },
  teary: { eye:EYE.teary,   bill:BILL.down, blush:.32, extra:"drop",     name:"울먹" },
  cry:   { eye:EYE.arcDown, bill:BILL.open, blush:.36, extra:"cry",      name:"엉엉" }
};

function cheeks(o){
  return '<ellipse cx="168" cy="90" rx="13.5" ry="8.4" fill="' + C.blush + '" opacity="' + (o*0.36).toFixed(2) + '"/>'
       + '<ellipse cx="168" cy="90" rx="10.2" ry="5.9" fill="' + C.blush + '" opacity="' + o + '"/>'
       + '<ellipse cx="232" cy="81" rx="9.8" ry="6.4" fill="' + C.blush + '" opacity="' + (o*0.36).toFixed(2) + '"/>'
       + '<ellipse cx="232" cy="81" rx="7.3" ry="4.5" fill="' + C.blush + '" opacity="' + o + '"/>'
       + '<ellipse cx="164.5" cy="87.5" rx="3" ry="1.7" fill="#FFFFFF" opacity="' + (o*0.55).toFixed(2) + '"/>'
       + '<ellipse cx="229.5" cy="79" rx="2.3" ry="1.3" fill="#FFFFFF" opacity="' + (o*0.55).toFixed(2) + '"/>';
}

function waterArt(){
  return '<path d="M0 168q38-9 75 0t75 0 75 0 75 0v46H0z" fill="' + C.water + '"/>'
    + '<path d="M0 168q38-9 75 0t75 0 75 0 75 0" fill="none" stroke="#FFFFFF" stroke-width="3" opacity=".75"/>'
    + '<path d="M124 174v11M156 174v11" stroke="' + C.line + '" stroke-width="4" stroke-linecap="round"/>'
    + '<rect x="114" y="183" width="52" height="25" rx="9" fill="' + C.sensor + '" stroke="' + C.line + '" stroke-width="3"/>'
    + '<circle cx="127" cy="195.5" r="3.2" fill="#fff"/><circle cx="140" cy="195.5" r="3.2" fill="#fff"/><circle cx="153" cy="195.5" r="3.2" fill="#fff"/>';
}

function blink(){
  return '<g class="dk-blink">'
       + '<circle cx="184" cy="72" r="11" fill="' + C.body + '"/>'
       + '<circle cx="218" cy="68" r="12" fill="' + C.body + '"/>'
       + '<path d="M176 74q8-10 16 0" stroke="' + C.line + '" stroke-width="4.4" fill="none" stroke-linecap="round"/>'
       + '<path d="M209 70q9-11 18 0" stroke="' + C.line + '" stroke-width="4.8" fill="none" stroke-linecap="round"/>'
       + '</g>';
}

function duckParts(mood, opt){
  opt = opt || {};
  var m = MOODS[mood] || MOODS.smile;
  var wet = (m.extra === "cry" || m.extra === "drop");
  return silhouette() + panel() + cheeks(m.blush) + m.bill + m.eye
       + (wet ? "" : blink())
       + (EXTRA[m.extra] || "") + (opt.water === false ? "" : waterArt());
}

/* Full duck */
function duckSVG(mood, w, opt){
  var m = MOODS[mood] || MOODS.smile;
  return '<svg viewBox="0 0 300 214" width="' + w + '" height="' + Math.round(w * 214 / 300)
    + '" role="img" aria-label="오리 로봇이 ' + m.name + ' 표정을 짓고 있습니다">'
    + duckParts(mood, opt) + '</svg>';
}

/* Face only (angled crop) */
function duckFace(mood, w){
  var m = MOODS[mood] || MOODS.smile;
  return '<svg viewBox="150 18 106 112" width="' + w + '" height="' + Math.round(w * 112 / 106)
    + '" role="img" aria-label="오리 ' + m.name + ' 표정">'
    + '<g fill="' + C.line + '" stroke="' + C.line + '" stroke-width="7" stroke-linejoin="round">'
    + '<circle cx="200" cy="80" r="42"/><path d="' + TUFT + '"/></g>'
    + '<g fill="' + C.body + '"><circle cx="200" cy="80" r="42"/><path d="' + TUFT + '"/></g>'
    + cheeks(m.blush) + m.bill + m.eye
    + ((m.extra === "cry" || m.extra === "drop") ? "" : blink()) + '</svg>';
}

export { C, MOODS, duckSVG, duckFace, duckParts };
