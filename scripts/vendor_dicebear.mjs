// Copy DiceBear (core + the CC0 "Notionists" style) into site/vendor/dicebear as plain ES modules.
//   npm install && node scripts/vendor_dicebear.mjs
// Only the runtime .js files and licenses are copied, so the site needs no npm install or build step.

import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "site", "vendor", "dicebear");

function copyJs(from, to) {
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    if (statSync(src).isDirectory()) copyJs(src, join(to, name));
    else if (name.endsWith(".js")) {
      mkdirSync(to, { recursive: true });
      cpSync(src, join(to, name));
    }
  }
}

rmSync(OUT, { recursive: true, force: true });
for (const pkg of ["core", "notionists"]) {
  const dir = join(ROOT, "node_modules", "@dicebear", pkg);
  copyJs(join(dir, "lib"), join(OUT, pkg));
  cpSync(join(dir, "LICENSE"), join(OUT, pkg, "LICENSE"));
  console.log(`vendored @dicebear/${pkg} -> ${relative(ROOT, join(OUT, pkg))}`);
}
