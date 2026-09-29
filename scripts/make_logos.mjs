// Build the demo's crisp vector logos: each brand mark centered on a white circle (512x512 SVG).
//   npm install && node scripts/make_logos.mjs
//
// Sources (see site/demo/logos/SOURCES.md):
// - Simple Icons (CC0 1.0), in each brand's color: Delta, Goldman Sachs, Qualtrics, Google, Apple, Nike
// - Wikimedia Commons files marked public domain (kept in scripts/logo-sources/): Microsoft, Adobe,
//   Deloitte, Stanford, University of Utah (Simple Icons doesn't carry these brands)
// Logos are trademarks of their owners; they're used only to identify the organizations in the demo.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as icons from "simple-icons";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "site", "demo", "logos");
const SRC = join(ROOT, "scripts", "logo-sources");
mkdirSync(OUT, { recursive: true });

const SIZE = 512;
const frame = (inner, box = 300) => {
  const at = (SIZE - box) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<circle cx="256" cy="256" r="256" fill="#fff"/>` +
    `<svg x="${at}" y="${at}" width="${box}" height="${box}" ${inner}</svg></svg>\n`;
};

// Simple Icons: a single path on a 24x24 grid, drawn in the brand color.
const SIMPLE = { "delta": icons.siDelta, "goldman-sachs": icons.siGoldmansachs, "qualtrics": icons.siQualtrics,
                 "google": icons.siGoogle, "apple": icons.siApple, "nike": icons.siNike };
const BOX = { "delta": 440, "goldman-sachs": 340 }; // wordmarks need more width
for (const [slug, icon] of Object.entries(SIMPLE)) {
  writeFileSync(join(OUT, `${slug}.svg`), frame(`viewBox="0 0 24 24"><path fill="#${icon.hex}" d="${icon.path}"/>`, BOX[slug] ?? 280));
}

// Commons SVGs: reuse their drawing, fit into the circle.
function nest(file, { box = 300, drop = [] } = {}) {
  let svg = readFileSync(join(SRC, file), "utf8").replace(/<\?xml[^>]*>/, "").replace(/<metadata[\s\S]*?<\/metadata>/g, "");
  for (const re of drop) svg = svg.replace(re, "");
  const open = svg.match(/<svg\b[^>]*>/)[0];
  const num = name => parseFloat((open.match(new RegExp(`\\b${name}="([\\d.]+)`)) ?? [])[1]);
  const viewBox = (open.match(/viewBox="([^"]+)"/) ?? [])[1] ?? `0 0 ${num("width")} ${num("height")}`;
  const inner = svg.slice(svg.indexOf(open) + open.length, svg.lastIndexOf("</svg>"));
  return frame(`viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${inner}`, box);
}
const COMMONS = {
  "microsoft": nest("Microsoft_logo.svg", { box: 260, drop: [/<path fill="#f3f3f3"[^>]*\/>/] }), // drop the grey backdrop
  "adobe": nest("Adobe_Corporate_Horizontal_Red_HEX.svg", { box: 260 }),
  "deloitte": nest("Logo_of_Deloitte.svg", { box: 400 }), // a wordmark: give it more width
  "stanford": nest("Stanford_Cardinal_logo.svg", { box: 320 }),
  "university-of-utah": nest("Utah_Utes_-_U_logo.svg", { box: 290 }),
};
for (const [slug, svg] of Object.entries(COMMONS)) writeFileSync(join(OUT, `${slug}.svg`), svg);

console.log(`wrote ${Object.keys(SIMPLE).length + Object.keys(COMMONS).length} logos to site/demo/logos`);
