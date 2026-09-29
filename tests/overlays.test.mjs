// Regression: a full-screen overlay's class must not be reused by anything else.
// (The welcome intro was styled as `.intro`, and the "Introduced" badge in a person's Connections list also had
// the class `intro`, so clicking someone turned that badge into a giant circle over the whole page.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../site/", import.meta.url).pathname;
const css = readFileSync(join(root, "app.css"), "utf8");

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? jsFiles(join(dir, d.name)) : d.name.endsWith(".js") ? [join(dir, d.name)] : []);
}

/** Class names of rules that cover the viewport (position: fixed + inset: 0). */
function overlayClasses() {
  const out = new Set();
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/position:\s*fixed/.test(body) || !/inset:\s*0/.test(body)) continue;
    for (const [, cls] of selector.matchAll(/\.([\w-]+)/g)) out.add(cls);
  }
  return out;
}

/** Every whitespace-separated token inside string literals of a JS file. */
function classTokens(src) {
  const tokens = new Set();
  for (const [, s] of src.matchAll(/["'`]([^"'`\n]*)["'`]/g)) for (const t of s.split(/[\s.]+/)) if (t) tokens.add(t);
  return tokens;
}

test("full-screen overlay classes are used by exactly one module", () => {
  const overlays = overlayClasses();
  assert.ok(overlays.has("orbit-intro"), "the welcome intro is a full-screen overlay");
  const files = jsFiles(join(root, "js")).map(f => ({ f, tokens: classTokens(readFileSync(f, "utf8")) }));
  for (const cls of overlays) {
    const users = files.filter(x => x.tokens.has(cls)).map(x => x.f.slice(root.length));
    assert.ok(users.length <= 1, `.${cls} covers the whole screen but is used in ${users.join(", ")}`);
  }
});

test("the Connections badge doesn't share a class with the intro", () => {
  const details = readFileSync(join(root, "js/ui/details.js"), "utf8");
  const classValues = [...details.matchAll(/class:\s*(`[^`]*`|"[^"]*")/g)].map(m => m[1]).join(" ");
  assert.ok(!/["\s`]intro["\s`]/.test(classValues), "details.js must not use the bare class `intro`");
  assert.ok(!/^\.intro\b/m.test(css), "no bare .intro rule in app.css");
});
