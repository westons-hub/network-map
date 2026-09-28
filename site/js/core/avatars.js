// Fallback pictures drawn in code (SVG data URIs): initials avatars for people
// and initials logos for organizations. Nothing is downloaded, so they work offline.

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
