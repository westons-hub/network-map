// WCAG AA contrast (4.5:1 for text) for the text/background pairs the app uses, in the light and dark themes.
// The colors come straight from app.css, so changing a token re-checks it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../site/app.css", import.meta.url), "utf8");
const tokens = block => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map(m => [m[1], m[2]]));
const light = tokens(css.match(/:root \{([\s\S]*?)\n\}/)[1]);
const dark = { ...light, ...tokens(css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)[1]) };

const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const PAIRS = [["text", "bg"], ["text", "panel"], ["text", "paper"], ["muted", "panel"], ["muted", "bg"], ["accent-text", "accent"],
  ["link-text", "panel"], ["link-text", "bg"], ["warn-text", "warn-bg"], ["warn-strong", "panel"], ["ok-text", "ok-bg"], ["err-text", "err-bg"],
  ["info-text", "info-bg"], ["purple-text", "purple-bg"], ["neutral-text", "neutral-bg"], ["meeting-text", "meeting-bg"],
  ["task-text", "task-bg"], ["overdue-text", "overdue-bg"], ["intro-sub", "intro-bg"], ["intro-ink", "intro-bg"]];

for (const [name, theme] of [["light", light], ["dark", dark]]) {
  test(`${name} theme: text meets WCAG AA (4.5:1)`, () => {
    const fails = PAIRS.map(([fg, bg]) => [fg, bg, ratio(theme[fg], theme[bg])]).filter(([, , r]) => r < 4.5)
      .map(([fg, bg, r]) => `${fg} on ${bg}: ${r.toFixed(2)}`);
    assert.deepEqual(fails, []);
    assert.ok(ratio("#ffffff", theme["badge-red"]) >= 4.5, "white on the red count badge");
  });
}

test("dark theme uses the brand kit colors", () => {
  assert.equal(dark.bg, "#131A26");
  assert.equal(dark.text, "#F4F6FA");
  assert.equal(dark.muted, "#A3AEBF");
});
