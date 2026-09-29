// Light / dark mode: System (follows your computer), Light or Dark, remembered in this browser.
// Sets <html data-theme="light|dark">; app.css has both palettes. Orbit logos swap with the theme
// (navy on light, white on dark) wherever an <img data-brand="logo|mark"> is used.

const KEY = "orbit:theme";
const MODES = ["system", "light", "dark"];
const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
const listeners = new Set();

const read = () => { try { const v = localStorage.getItem(KEY); return MODES.includes(v) ? v : "system"; } catch { return "system"; } };
let mode = read();

export const themeMode = () => mode;
export const resolvedTheme = () => (mode === "system" ? (media?.matches ? "dark" : "light") : mode);
export const isDark = () => resolvedTheme() === "dark";

/** Brand image for the current theme: brandSrc("logo") -> "brand/orbit-logo-white.svg" on dark. */
export const brandSrc = (kind, dark = isDark()) => `brand/orbit-${kind}${dark ? "-white" : ""}.svg`;

/** A small sign-off for the bottom of a view: just the Orbit mark, in the theme's color. */
export function brandFooter() {
  const f = document.createElement("footer");
  f.className = "brand-footer";
  const img = Object.assign(document.createElement("img"), { src: brandSrc("mark"), alt: "Orbit", width: 22, height: 22 });
  img.dataset.brand = "mark";
  f.append(img);
  return f;
}

function apply() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themeMode = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#131A26" : "#FFFFFF");
  for (const img of document.querySelectorAll("img[data-brand]")) img.src = brandSrc(img.dataset.brand);
  listeners.forEach(fn => fn(theme));
}

export function setTheme(next) {
  mode = MODES.includes(next) ? next : "system";
  try { localStorage.setItem(KEY, mode); } catch { /* storage blocked */ }
  apply();
}
export const nextThemeMode = () => MODES[(MODES.indexOf(mode) + 1) % MODES.length];
export const onThemeChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

media?.addEventListener?.("change", () => { if (mode === "system") apply(); });
apply();
