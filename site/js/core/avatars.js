// Pictures drawn in code (SVG data URIs): initials avatars and logos used as
// fallbacks, plus the illustrated faces and logos for the fictional demo.
// Nothing here is downloaded, so it's safe for demo data and works offline.

/** Stable 32-bit hash (FNV-1a) so the same name always gets the same picture. */
export function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const pick = (list, h, salt = 0) => list[(h >>> salt) % list.length];

export const PALETTE = ["#2e6fd8", "#1f9d6b", "#8b5cf6", "#e8590c", "#0891b2", "#c2255c", "#5c7cfa", "#2f9e44",
                        "#d6336c", "#7048e8", "#1971c2", "#b35c00"];

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const svgUri = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const SMALL = new Set(["of", "the", "and", "for", "at", "&", "inc", "llc", "co"]);
/** 'Jordan Lee' -> 'JL'; 'University of Utah' -> 'UU'; 'Delta' -> 'DE'. */
export function initials(name, max = 2) {
  const words = String(name ?? "").replace(/[^\p{L}\p{N}\s&]/gu, " ").split(/\s+/).filter(Boolean);
  const main = words.filter(w => !SMALL.has(w.toLowerCase()));
  const use = main.length ? main : words;
  if (!use.length) return "?";
  if (use.length === 1) return use[0].slice(0, max === 1 ? 1 : 2).toUpperCase();
  return use.slice(0, max).map(w => [...w][0]).join("").toUpperCase();
}

const TEXT = 'font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-weight="700" text-anchor="middle"';

/** A colored circle with initials. */
export function initialsAvatar(name) {
  const bg = pick(PALETTE, hash(name));
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<rect width="96" height="96" fill="${bg}"/>` +
    `<text x="48" y="61" font-size="36" fill="#fff" ${TEXT}>${esc(initials(name))}</text></svg>`);
}

/** A rounded-square logo with initials (fallback for real companies and schools). */
export function initialsLogo(name) {
  const bg = pick(PALETTE, hash(`org:${name}`));
  const text = initials(name, 3);
  const size = text.length > 2 ? 30 : 38;
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<rect width="96" height="96" fill="#fff"/><rect x="14" y="14" width="68" height="68" rx="16" fill="${bg}"/>` +
    `<text x="48" y="${48 + size * 0.36}" font-size="${size}" fill="#fff" ${TEXT}>${esc(text)}</text></svg>`);
}

// ---- demo art ------------------------------------------------------------------

// Simple icons (white, drawn in a 96x96 box) picked by keywords in the name.
const ICONS = [
  [/air|flight|jet/i, '<path d="M48 22l6 20 20 8v6l-20-4-2 16 7 5v5l-11-3-11 3v-5l7-5-2-16-20 4v-6l20-8z" fill="#fff"/>'],
  [/bank|capital|financ|partners/i, '<path d="M48 22l28 13v5H20v-5z M26 44h7v22h-7z M44.5 44h7v22h-7z M63 44h7v22h-7z M20 70h56v6H20z" fill="#fff"/>'],
  [/game|play|studio/i, '<rect x="20" y="36" width="56" height="28" rx="14" fill="#fff"/><path d="M32 45v10M27 50h10" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="60" cy="47" r="3.5" fill="currentColor"/><circle cx="67" cy="54" r="3.5" fill="currentColor"/>'],
  [/health|care|medic|clinic/i, '<path d="M40 22h16v18h18v16H56v18H40V56H22V40h18z" fill="#fff"/>'],
  [/universit|college|school|institute|academy/i, '<path d="M48 24l32 14-32 14-32-14z M28 46v14c0 6 9 12 20 12s20-6 20-12V46l-20 9z M76 40v18" fill="#fff" stroke="#fff" stroke-width="2"/>'],
  [/consult|strategy|advis/i, '<path d="M24 70V52h10v18z M43 70V38h10v32z M62 70V26h10v44z" fill="#fff"/>'],
  [/lab|bio|science|research/i, '<path d="M40 22h16v6h-3v14l17 26c2 4-1 8-5 8H31c-4 0-7-4-5-8l17-26V28h-3z" fill="#fff"/>'],
  [/media|news|film|video/i, '<path d="M38 28l32 20-32 20z" fill="#fff"/>'],
  [/venture|rocket|growth/i, '<path d="M48 18c10 8 14 20 12 34l-6 8H42l-6-8c-2-14 2-26 12-34z M36 56l-8 12 10-2z M60 56l8 12-10-2z" fill="#fff"/><circle cx="48" cy="38" r="5" fill="currentColor"/>'],
];
const SHAPES = [
  c => `<rect x="10" y="10" width="76" height="76" rx="20" fill="${c}"/>`,
  c => `<circle cx="48" cy="48" r="38" fill="${c}"/>`,
  c => `<path d="M48 8l35 20v40L48 88 13 68V28z" fill="${c}"/>`,
  c => `<rect x="10" y="10" width="76" height="76" rx="6" fill="${c}"/>`,
];

/** A made-up logo for a fictional organization: colored shape + a simple icon (or initials). */
export function demoLogo(name) {
  const h = hash(`logo:${name}`);
  const color = pick(PALETTE, h);
  const icon = ICONS.find(([re]) => re.test(name))?.[1];
  const inner = icon ? `<g style="color:${color}">${icon}</g>`
    : `<text x="48" y="61" font-size="34" fill="#fff" ${TEXT}>${esc(initials(name))}</text>`;
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<rect width="96" height="96" fill="#fff"/>${pick(SHAPES, h, 3)(color)}${inner}</svg>`);
}

const SKIN = ["#f6d7c3", "#eec1a0", "#d9a07a", "#b97a56", "#8d5a3b", "#5f3b26"];
const HAIR = ["#2b1d14", "#4a2f1d", "#6b4226", "#a0612b", "#d9a441", "#1f1f1f", "#8a8a8a", "#b5452b"];
const BACKS = ["#dbe7ff", "#d3f5e6", "#ece3ff", "#ffe3d3", "#d5f1f8", "#ffdbe7", "#fff1c2", "#e3e8ef"];
const HAIRSTYLES = [
  c => `<path d="M22 44c0-18 12-28 26-28s26 10 26 28c-6-8-16-12-26-12s-20 4-26 12z" fill="${c}"/>`,               // short
  c => `<path d="M20 50c0-22 12-34 28-34s28 12 28 34v26h-9V46c-5-6-12-9-19-9s-14 3-19 9v30h-9z" fill="${c}"/>`, // long
  c => `<circle cx="48" cy="14" r="10" fill="${c}"/><path d="M22 44c0-17 12-27 26-27s26 10 26 27c-6-7-16-11-26-11s-20 4-26 11z" fill="${c}"/>`, // bun
  c => `<path d="M20 46c-4-16 8-30 28-30s32 14 28 30c-4-3-6-8-6-8s-4 6-11 6-7-6-11-6-4 6-11 6-7-6-7-6-2 5-10 8z" fill="${c}"/>`, // curly
  () => "",                                                                                                        // none
];

/** An illustrated face for a fictional person. */
export function demoFace(name) {
  const h = hash(`face:${name}`);
  const skin = pick(SKIN, h), hair = pick(HAIR, h, 4), back = pick(BACKS, h, 8), shirt = pick(PALETTE, h, 12);
  const style = pick(HAIRSTYLES, h, 16)(hair);
  const glasses = (h >>> 20) % 5 === 0
    ? '<g fill="none" stroke="#1f2937" stroke-width="2"><circle cx="40" cy="47" r="6"/><circle cx="56" cy="47" r="6"/><path d="M46 47h4"/></g>' : "";
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<rect width="96" height="96" fill="${back}"/>` +
    `<path d="M16 96c2-16 15-24 32-24s30 8 32 24z" fill="${shirt}"/>` +
    `<rect x="42" y="60" width="12" height="14" rx="5" fill="${skin}"/>` +
    `<ellipse cx="48" cy="46" rx="21" ry="24" fill="${skin}"/>${style}` +
    `<circle cx="40" cy="47" r="2.6" fill="#1f2937"/><circle cx="56" cy="47" r="2.6" fill="#1f2937"/>${glasses}` +
    `<path d="M41 57c4 4 10 4 14 0" fill="none" stroke="#7a3b2e" stroke-width="2.4" stroke-linecap="round"/></svg>`);
}
