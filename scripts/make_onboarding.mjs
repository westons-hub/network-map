// Illustrations for the "Start your own" guide: simple, generic UI mockups (no LinkedIn logo, not a copy of
// LinkedIn's design) with an orange highlight and arrow on the thing to click. Swap any of them for a real
// screenshot by replacing site/onboarding/stepN.svg.
//   node scripts/make_onboarding.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "site", "onboarding");
const W = 640, H = 360;
const C = { bg: "#F5F6F8", panel: "#FFFFFF", line: "#E4E7EC", text: "#1D2330", muted: "#8A94A6", soft: "#EEF1F5",
            navy: "#1E3A5F", orange: "#F97316", rose: "#F43F5E" };
const FONT = `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"`;
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

const rect = (x, y, w, h, fill, r = 6, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${extra}/>`;
const text = (x, y, s, { size = 14, fill = C.text, weight = 400, anchor = "start" } = {}) =>
  `<text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
const bar = (x, y, w, fill = C.soft) => rect(x, y, w, 9, fill, 4.5);
/** The orange "click here" ring. */
const ring = (x, y, w, h) => rect(x - 5, y - 5, w + 10, h + 10, "none", 10, `stroke="${C.orange}" stroke-width="3"`);
/** A curved arrow from (x1,y1) to (x2,y2), with a head. */
function arrow(x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2 + (y2 - y1) * 0.25, my = (y1 + y2) / 2 - (x2 - x1) * 0.25;
  const a = Math.atan2(y2 - my, x2 - mx), l = 12;
  const p = (da) => `${x2 - l * Math.cos(a + da)},${y2 - l * Math.sin(a + da)}`;
  return `<path d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" fill="none" stroke="${C.orange}" stroke-width="3" stroke-linecap="round"/>` +
         `<polyline points="${p(0.45)} ${x2},${y2} ${p(-0.45)}" fill="none" stroke="${C.orange}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
}
/** A step number badge in the corner. */
const badge = n => `<circle cx="34" cy="34" r="18" fill="${C.navy}"/>${text(34, 40, n, { size: 16, fill: "#fff", weight: 700, anchor: "middle" })}`;
/** A browser window with a generic top bar (search box, nav icons). */
function browser(inner) {
  return rect(60, 20, 560, 320, C.panel, 12, `stroke="${C.line}"`) +
    `<path d="M60 32a12 12 0 0 1 12-12h536a12 12 0 0 1 12 12v18H60z" fill="${C.soft}"/>` +
    [0, 1, 2].map(i => `<circle cx="${78 + i * 14}" cy="35" r="4" fill="${C.line}"/>`).join("") +
    rect(140, 29, 300, 12, C.panel, 6) + inner;
}
const svg = (n, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">` +
  `<rect width="${W}" height="${H}" rx="16" fill="${C.bg}"/>${body}${badge(n)}</svg>\n`;

// Generic site nav: logo block, search, icons with labels; "Me" is the last.
const nav = (highlightMe = false) => rect(60, 50, 560, 44, C.panel, 0) + `<line x1="60" y1="94" x2="620" y2="94" stroke="${C.line}"/>` +
  rect(78, 62, 22, 22, C.navy, 5) + rect(110, 64, 150, 18, C.soft, 9) +
  ["Home", "Network", "Jobs", "Messages"].map((l, i) => rect(318 + i * 58, 60, 18, 14, C.line, 4) + text(327 + i * 58, 88, l, { size: 9, fill: C.muted, anchor: "middle" })).join("") +
  `<circle cx="566" cy="67" r="9" fill="${C.line}"/>` + text(566, 88, "Me ▾", { size: 10, fill: highlightMe ? C.text : C.muted, weight: highlightMe ? 700 : 400, anchor: "middle" }) +
  (highlightMe ? ring(550, 57, 32, 34) : "");

const steps = {
  1: svg(1, browser(nav(true) +
    rect(430, 104, 170, 150, C.panel, 10, `stroke="${C.line}" filter="drop-shadow(0 4px 10px rgba(16,24,40,.12))"`) +
    `<circle cx="452" cy="126" r="11" fill="${C.line}"/>` + bar(470, 118, 90, C.line) + bar(470, 132, 60) +
    rect(446, 150, 138, 22, "#fff", 11, `stroke="${C.line}"`) +
    text(456, 198, "Settings & Privacy", { size: 13, weight: 700 }) + ring(448, 184, 140, 20) +
    bar(456, 216, 80) + bar(456, 234, 100) +
    arrow(566, 100, 590, 190) +
    bar(90, 120, 300) + bar(90, 140, 260) + rect(90, 165, 300, 120, C.soft, 8))),

  2: svg(2, browser(rect(60, 50, 560, 290, C.bg, 0) +
    rect(80, 66, 150, 250, C.panel, 10) + text(96, 92, "Settings", { size: 14, weight: 700 }) +
    ["Account preferences", "Sign in & security", "Visibility"].map((l, i) => text(96, 122 + i * 26, l, { size: 11, fill: C.muted })).join("") +
    text(96, 200, "Data privacy", { size: 12, weight: 700 }) + ring(90, 186, 124, 20) +
    text(96, 226, "Advertising data", { size: 11, fill: C.muted }) +
    rect(248, 66, 350, 250, C.panel, 10) + text(266, 92, "How we use your data", { size: 14, weight: 700 }) +
    bar(266, 108, 280) +
    text(266, 146, "Get a copy of your data", { size: 13, weight: 700, fill: C.navy }) + ring(260, 131, 176, 22) +
    bar(266, 166, 250) + bar(266, 190, 290) + bar(266, 214, 210) + bar(266, 238, 260) +
    arrow(214, 196, 256, 150))),

  3: svg(3, browser(rect(60, 50, 560, 290, C.bg, 0) +
    rect(96, 66, 488, 256, C.panel, 10) + text(118, 94, "Get a copy of your data", { size: 15, weight: 700 }) +
    `<circle cx="126" cy="125" r="7" fill="none" stroke="${C.navy}" stroke-width="2"/><circle cx="126" cy="125" r="3.5" fill="${C.navy}"/>` +
    text(142, 130, "Download larger data archive", { size: 13, weight: 700 }) +
    text(142, 148, "Includes Connections, Positions, Education and more", { size: 11, fill: C.muted }) + ring(114, 112, 330, 44) +
    `<circle cx="126" cy="182" r="7" fill="none" stroke="${C.muted}" stroke-width="2"/>` +
    text(142, 187, "Want something in particular?", { size: 13, fill: C.muted }) +
    // Crossed out: that list has no Connections.
    `<line x1="138" y1="183" x2="330" y2="183" stroke="${C.rose}" stroke-width="2"/>` +
    rect(142, 198, 250, 24, "#FFF1F3", 6) + text(152, 214, "✗ No connections in this list", { size: 12, weight: 700, fill: C.rose }) +
    rect(118, 262, 150, 34, C.navy, 17) + text(193, 284, "Request archive", { size: 12, weight: 700, fill: "#fff", anchor: "middle" }) +
    ring(118, 262, 150, 34) + arrow(470, 110, 446, 128))),

  4: svg(4, rect(80, 50, 250, 180, C.panel, 12, `stroke="${C.line}"`) +
    `<path d="M80 62a12 12 0 0 1 12-12h226a12 12 0 0 1 12 12v8l-125 70-125-70z" fill="${C.soft}"/>` +
    text(205, 170, "Your data archive is ready", { size: 13, weight: 700, anchor: "middle" }) +
    text(205, 192, "With connections: ~10 minutes", { size: 11, fill: C.muted, anchor: "middle" }) +
    text(205, 208, "Complete archive: up to 24 hours", { size: 11, fill: C.muted, anchor: "middle" }) +
    arrow(338, 140, 420, 140) +
    rect(430, 80, 80, 100, C.panel, 8, `stroke="${C.orange}" stroke-width="2"`) + rect(462, 80, 16, 100, C.soft, 0) +
    [0, 1, 2, 3].map(i => rect(465, 88 + i * 12, 10, 6, C.muted, 2)).join("") + text(470, 200, "LinkedIn export .zip", { size: 12, weight: 700, anchor: "middle" }) +
    text(320, 290, "Download the zip. No need to unzip it.", { size: 14, weight: 700, fill: C.navy, anchor: "middle" })),

  5: svg(5, rect(120, 60, 400, 230, C.panel, 16, `stroke="${C.orange}" stroke-width="3" stroke-dasharray="10 8"`) +
    rect(280, 100, 80, 96, "#fff", 8, `stroke="${C.line}" stroke-width="2"`) + rect(313, 100, 14, 96, C.soft, 0) +
    [0, 1, 2, 3].map(i => rect(315, 108 + i * 12, 10, 6, C.muted, 2)).join("") + text(320, 184, "ZIP", { size: 13, weight: 700, fill: C.orange, anchor: "middle" }) +
    `<path d="M320 206v34m-14-14 14 14 14-14" fill="none" stroke="${C.navy}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
    text(320, 272, "Drop the whole .zip on Orbit", { size: 15, weight: 700, anchor: "middle" }) +
    text(320, 318, "It stays in your browser. Nothing is uploaded.", { size: 12, fill: C.muted, anchor: "middle" })),
};

mkdirSync(OUT, { recursive: true });
for (const [n, s] of Object.entries(steps)) writeFileSync(join(OUT, `step${n}.svg`), s);
console.log(`Wrote ${Object.keys(steps).length} illustrations to site/onboarding/`);
