// The Orbit welcome intro: a recreation of "Orbit Welcome Short.mp4" (6.5 s) in SVG, driven by one
// timeline function (no video file, no animation library). Laid out on the video's 1920×1080 frame.
//
//   0.0–0.35 the white core pops in
//   0.25–1.1 the orbit arc draws around it (rose → orange, arrowhead on the tip); the satellite pops on
//   1.35–2.6 the mark shrinks and drops; "Map your orbit" appears letter by letter; then "Find your path."
//   3.5–4.7  a wide ellipse draws around the small mark; the mark slides left and "Orbit" appears beside it
//   4.0–6.0  an orange and a rose dot travel the ellipse
//   6.0–6.5  everything fades and the app is there
//
// Plays on the first visit (remembered in localStorage), can be replayed from Settings, skipped with a click,
// any key or "Skip", and becomes a short still title with prefers-reduced-motion.

const NS = "http://www.w3.org/2000/svg";
const SEEN_KEY = "orbit:intro-seen";
const DURATION = 6.5;

// Geometry from the brand files (mark centered at 60,60; wordmark path from orbit-logo-white.svg).
const RING = "M78 28.82A36 36 0 1 1 46.51 26.62";
const ARROW = "M36.24 22.68L46.51 26.62L41.86 36.59";
const ARROW_TIP = { x: 46.51, y: 26.62 };
const WORDMARK = "M164.58 87.94L164.58 87.94Q156.62 87.94 150.54 84.35Q144.45 80.76 141.02 74.40Q137.59 68.05 137.59 59.70L137.59 59.70Q137.59 51.35 141.02 45.00Q144.45 38.64 150.54 35.05Q156.62 31.46 164.58 31.46L164.58 31.46Q172.61 31.46 178.69 35.05Q184.78 38.64 188.17 45.00Q191.56 51.35 191.56 59.70L191.56 59.70Q191.56 68.05 188.17 74.40Q184.78 80.76 178.69 84.35Q172.61 87.94 164.58 87.94ZM164.58 78.50L164.58 78.50Q169.57 78.50 173.19 76.20Q176.82 73.90 178.85 69.68Q180.88 65.47 180.88 59.70L180.88 59.70Q180.88 53.85 178.85 49.68Q176.82 45.50 173.19 43.24Q169.57 40.98 164.58 40.98L164.58 40.98Q159.66 40.98 156.00 43.24Q152.33 45.50 150.30 49.68Q148.27 53.85 148.27 59.70L148.27 59.70Q148.27 65.47 150.30 69.68Q152.33 73.90 156.00 76.20Q159.66 78.50 164.58 78.50ZM210.83 87L200.30 87L200.30 47.69L209.66 47.69L210.67 54.94Q212.08 52.37 214.22 50.57Q216.37 48.78 219.14 47.77Q221.91 46.75 225.26 46.75L225.26 46.75L225.26 57.91L221.67 57.91Q219.33 57.91 217.34 58.45Q215.35 59.00 213.87 60.21Q212.39 61.42 211.61 63.52Q210.83 65.63 210.83 68.83L210.83 68.83L210.83 87ZM255.45 87.94L255.45 87.94Q252.40 87.94 250.02 87.16Q247.65 86.38 245.81 85.01Q243.98 83.65 242.73 81.93L242.73 81.93L241.56 87L232.20 87L232.20 30.84L242.73 30.84L242.73 53.15Q244.60 50.42 247.68 48.59Q250.77 46.75 255.37 46.75L255.37 46.75Q260.83 46.75 265.08 49.44Q269.33 52.13 271.79 56.77Q274.24 61.42 274.24 67.42L274.24 67.42Q274.24 73.27 271.79 77.95Q269.33 82.63 265.12 85.28Q260.91 87.94 255.45 87.94ZM252.95 78.73L252.95 78.73Q256.07 78.73 258.45 77.29Q260.83 75.85 262.15 73.31Q263.48 70.78 263.48 67.42Q263.48 64.07 262.15 61.45Q260.83 58.84 258.45 57.40Q256.07 55.96 252.95 55.96L252.95 55.96Q249.91 55.96 247.53 57.40Q245.15 58.84 243.78 61.42Q242.42 63.99 242.42 67.34Q242.42 70.70 243.78 73.31Q245.15 75.92 247.53 77.33Q249.91 78.73 252.95 78.73ZM294.06 87L283.53 87L283.53 47.69L294.06 47.69L294.06 87ZM288.83 42.31L288.83 42.31Q286.02 42.31 284.19 40.63Q282.36 38.95 282.36 36.38L282.36 36.38Q282.36 33.80 284.19 32.13Q286.02 30.45 288.83 30.45L288.83 30.45Q291.72 30.45 293.55 32.13Q295.38 33.80 295.38 36.38L295.38 36.38Q295.38 38.95 293.55 40.63Q291.72 42.31 288.83 42.31ZM329.47 87L322.37 87Q318.24 87 315.16 85.71Q312.07 84.43 310.36 81.42Q308.64 78.42 308.64 73.19L308.64 73.19L308.64 56.50L301.93 56.50L301.93 47.69L308.64 47.69L309.81 37.00L319.17 37.00L319.17 47.69L329.55 47.69L329.55 56.50L319.17 56.50L319.17 73.35Q319.17 76.00 320.34 77.02Q321.51 78.03 324.32 78.03L324.32 78.03L329.47 78.03L329.47 87Z";

const BIG = { x: 960, y: 540, k: 3.3 };     // the mark alone, centered
const SMALL = { x: 960, y: 912, k: 1.15 };  // under the title
const LOGO_X = 828;                         // where the mark sits once the wordmark is beside it
const ELLIPSE = { cx: 960, cy: 912, rx: 840, ry: 148 };
const TITLE = "Map your orbit";

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const span = (t, a, b) => clamp((t - a) / (b - a));
const easeInOut = p => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const easeOut = p => 1 - (1 - p) ** 3;
const easeOutBack = p => 1 + 2.4 * (p - 1) ** 3 + 1.4 * (p - 1) ** 2;
const lerp = (a, b, p) => a + (b - a) * p;
const mix = (c1, c2, p) => `rgb(${c1.map((v, i) => Math.round(lerp(v, c2[i], p))).join(",")})`;

function svg(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
}

export const introSeen = () => { try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked: it may play again */ } };

/** Build the intro and play it. Resolves when it's gone (finished or skipped). */
export function playIntro({ reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches, freezeAt } = {}) {
  if (freezeAt === undefined) markSeen();
  const overlay = document.createElement("div");
  overlay.className = "intro";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Welcome to Orbit. Map your orbit. Find your path.");
  const root = svg("svg", { viewBox: "0 0 1920 1080", preserveAspectRatio: "xMidYMid meet", "aria-hidden": "true" }, overlay);
  const defs = svg("defs", {}, root);
  const grad = svg("linearGradient", { id: "intro-grad", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
  svg("stop", { offset: "0", "stop-color": "#F43F5E" }, grad);
  svg("stop", { offset: "1", "stop-color": "#F97316" }, grad);
  const egrad = svg("linearGradient", { id: "intro-egrad", x1: "0", y1: "0", x2: "1", y2: "0" }, defs);
  svg("stop", { offset: "0", "stop-color": "#F43F5E" }, egrad);
  svg("stop", { offset: "1", "stop-color": "#F97316" }, egrad);
  const clip = svg("clipPath", { id: "intro-wordclip" }, defs);
  const clipRect = svg("rect", { x: "128", y: "20", width: "0", height: "80" }, clip);

  // Title, letter by letter (all letters exist from the start so centering never shifts).
  const title = svg("text", { x: "960", y: "458", "text-anchor": "middle", class: "intro-title" }, root);
  const letters = [...TITLE].map(ch => { const t = svg("tspan", { opacity: "0" }, title); t.textContent = ch; return t; });
  const sub = svg("text", { x: "960", y: "572", "text-anchor": "middle", class: "intro-sub", opacity: "0" }, root);
  sub.textContent = "Find your path.";

  // The wide ellipse and its two travelling dots.
  const e = ELLIPSE;
  const ell = svg("path", { d: `M${e.cx - e.rx} ${e.cy}A${e.rx} ${e.ry} 0 1 1 ${e.cx + e.rx} ${e.cy}A${e.rx} ${e.ry} 0 1 1 ${e.cx - e.rx} ${e.cy}`,
    fill: "none", stroke: "url(#intro-egrad)", "stroke-width": "2.5", opacity: "0.6" }, root);
  const dotO = svg("circle", { r: "11", fill: "#F97316", opacity: "0" }, root);
  const dotR = svg("circle", { r: "8", fill: "#F43F5E", opacity: "0" }, root);

  // The mark (+ wordmark), in the logo's own coordinates.
  const mark = svg("g", {}, root);
  const ring = svg("path", { d: RING, fill: "none", stroke: "url(#intro-grad)", "stroke-width": "7", "stroke-linecap": "round" }, mark);
  const arrow = svg("path", { d: ARROW, fill: "none", stroke: "#F43F5E", "stroke-width": "7", "stroke-linecap": "round",
                              "stroke-linejoin": "round", opacity: "0" }, mark);
  const sat = svg("circle", { cx: "78", cy: "28.82", r: "0", fill: "#F97316" }, mark);
  const core = svg("circle", { cx: "60", cy: "60", r: "0", fill: "#FFFFFF" }, mark);
  const word = svg("path", { d: WORDMARK, fill: "#FFFFFF", "clip-path": "url(#intro-wordclip)" }, mark);

  const skip = document.createElement("button");
  skip.className = "intro-skip";
  skip.type = "button";
  skip.textContent = "Skip ›";
  overlay.append(skip);
  document.body.append(overlay);

  const ringLen = ring.getTotalLength();
  const tipAngle = (() => { const a = ring.getPointAtLength(ringLen - 0.5), b = ring.getPointAtLength(ringLen); return Math.atan2(b.y - a.y, b.x - a.x); })();
  ring.setAttribute("stroke-dasharray", `${ringLen} ${ringLen}`);
  const ellLen = ell.getTotalLength();
  ell.setAttribute("stroke-dasharray", `${ellLen} ${ellLen}`);

  function frame(t) {
    // 1. Core pops in.
    core.setAttribute("r", String(15 * clamp(easeOutBack(span(t, 0, 0.35)), 0, 1.2)));
    // 2. The arc draws, arrowhead riding its tip; the satellite pops on.
    const p = easeInOut(span(t, 0.25, 1.05));
    ring.setAttribute("stroke-dashoffset", String(ringLen * (1 - p)));
    ring.setAttribute("opacity", p > 0.005 ? "1" : "0");
    if (p > 0.005) {
      const at = ring.getPointAtLength(ringLen * p), before = ring.getPointAtLength(Math.max(0, ringLen * p - 0.5));
      const angle = (Math.atan2(at.y - before.y, at.x - before.x) - tipAngle) * 180 / Math.PI;
      arrow.setAttribute("transform", `translate(${at.x} ${at.y}) rotate(${angle}) translate(${-ARROW_TIP.x} ${-ARROW_TIP.y})`);
      arrow.setAttribute("opacity", "1");
    } else arrow.setAttribute("opacity", "0");
    sat.setAttribute("r", String(8 * clamp(easeOutBack(span(t, 0.85, 1.1)), 0, 1.25)));
    // 3. Shrink and drop; then slide left for the wordmark.
    const m = easeInOut(span(t, 1.35, 1.9)), slide = easeInOut(span(t, 3.45, 4.15));
    const k = lerp(BIG.k, SMALL.k, m), x = lerp(lerp(BIG.x, SMALL.x, m), LOGO_X, slide), y = lerp(BIG.y, SMALL.y, m);
    mark.setAttribute("transform", `translate(${x} ${y}) scale(${k}) translate(-60 -60)`);
    // Title letters, then the subtitle.
    letters.forEach((l, i) => {
      const q = easeOut(span(t, 1.84 + i * 0.06, 2.04 + i * 0.06));
      l.setAttribute("opacity", String(q));
      l.setAttribute("fill", mix([91, 107, 128], [255, 255, 255], q));
    });
    sub.setAttribute("opacity", String(easeOut(span(t, 2.95, 3.35))));
    // 4. Ellipse draws; wordmark revealed left to right.
    ell.setAttribute("stroke-dashoffset", String(ellLen * (1 - easeInOut(span(t, 3.5, 4.7)))));
    clipRect.setAttribute("width", String(210 * easeInOut(span(t, 3.6, 4.3))));
    // 5. Two dots travel the ellipse, half a lap apart.
    const dotsIn = easeOut(span(t, 3.95, 4.3));
    const theta = (122 + 44 * Math.max(0, t - 4)) * Math.PI / 180;
    for (const [dot, off] of [[dotO, 0], [dotR, Math.PI]]) {
      dot.setAttribute("cx", String(e.cx + e.rx * Math.cos(theta + off)));
      dot.setAttribute("cy", String(e.cy + e.ry * Math.sin(theta + off)));
      dot.setAttribute("opacity", String(dotsIn));
    }
    // 6. Fade out.
    overlay.style.opacity = String(1 - easeInOut(span(t, 6.0, DURATION)));
  }

  return new Promise(resolve => {
    let raf = 0, start = 0, ended = false;
    const end = (fast = false) => {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      removeEventListener("keydown", onKey, true);
      overlay.style.transition = `opacity ${fast ? 0.3 : 0}s ease`;
      overlay.style.opacity = "0";
      setTimeout(() => { overlay.remove(); resolve(); }, fast ? 320 : 0);
    };
    const onKey = ev => { ev.preventDefault(); ev.stopPropagation(); end(true); };
    overlay.addEventListener("click", () => end(true));
    addEventListener("keydown", onKey, true);

    if (freezeAt !== undefined) { frame(freezeAt); overlay.style.opacity = "1"; return; } // ?intro=2.6 (for checking)
    if (reducedMotion) {
      // A still title: the finished logo and tagline, then a gentle fade.
      frame(5.2);
      overlay.style.opacity = "1";
      setTimeout(() => end(true), 1100);
      return;
    }
    frame(0);
    const run = now => {
      if (!start) start = now;
      const t = (now - start) / 1000;
      frame(Math.min(t, DURATION));
      if (t >= DURATION) end(); else raf = requestAnimationFrame(run);
    };
    // Wait (briefly) for DM Sans so the title doesn't swap fonts mid-animation.
    const fontReady = document.fonts?.load("700 176px 'DM Sans'").catch(() => {}) ?? Promise.resolve();
    Promise.race([fontReady, new Promise(r => setTimeout(r, 700))]).then(() => { raf = requestAnimationFrame(run); });
  });
}
