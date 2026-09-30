// Getting your LinkedIn data export into Orbit: drop the .zip, the unzipped folder (subfolders too) or single CSVs,
// or choose them. Files are read in this tab; the ones Orbit doesn't use are skipped by name before they're read
// (and never unzipped). Then a summary with a checkbox per item before anything is imported.

import { exportFileKind, exportSummary, readExport, unzipExport } from "../core/linkedinExport.js";
import { ask } from "./dialog.js";
import { el } from "./dom.js";

const usable = path => !["never", "ignored", null].includes(exportFileKind(path));
let fflate;
const loadZip = async () => (fflate ??= await import("../../vendor/fflate.mjs"));

/** Files (from an input or a drop) -> [{ path, text }] of the export files Orbit uses. */
export async function readExportFiles(fileList) {
  const out = [];
  for (const f of fileList) {
    const path = f.webkitRelativePath || f.relPath || f.name;
    if (/\.zip$/i.test(f.name)) out.push(...unzipExport(await loadZip(), new Uint8Array(await f.arrayBuffer()), `${path}/`));
    else if (usable(path)) out.push({ path, text: await f.text() });
  }
  return out;
}

/** A drop: walk folders (webkitGetAsEntry) and collect every file with its path. Also returns any PDF dropped. */
export async function filesFromDrop(dataTransfer) {
  const files = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      file.relPath = `${prefix}${entry.name}`;
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries returns batches; keep reading until it's empty.
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  const entries = [...(dataTransfer.items ?? [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) for (const e of entries) await walk(e, "");
  else files.push(...dataTransfer.files);
  return files;
}

/** Does this drop/selection look like (part of) a LinkedIn export? */
export const isExportFile = f => /\.zip$/i.test(f.name) || usable(f.relPath || f.webkitRelativePath || f.name);

/** Buttons for choosing a zip, a folder or CSV files. onFiles(fileList). */
export function exportPickers(onFiles) {
  const zip = el("input", undefined, { type: "file", accept: ".zip,application/zip", hidden: true, onchange: e => onFiles(e.target.files) });
  const dir = el("input", undefined, { type: "file", hidden: true, onchange: e => onFiles(e.target.files) });
  dir.webkitdirectory = true;
  const csv = el("input", undefined, { type: "file", accept: ".csv,text/csv", multiple: true, hidden: true, onchange: e => onFiles(e.target.files) });
  const row = el("div", undefined, { class: "export-pickers" });
  row.append(el("button", "Choose the .zip…", { class: "btn small", type: "button", onclick: () => zip.click() }),
             el("button", "Choose the folder…", { class: "btn small", type: "button", onclick: () => dir.click() }),
             el("button", "Choose CSV files…", { class: "btn small", type: "button", onclick: () => csv.click() }), zip, dir, csv);
  return row;
}

export const PRIVACY_LINE = "Your files never leave your computer. Messages, phone numbers, ID verification and ad data are ignored.";

/** The "Wrong zip?" help: which option to pick on LinkedIn, with its picture. */
export function wrongZipHelp() {
  const box = el("div", undefined, { class: "wrong-zip" });
  box.append(el("p", undefined),
    el("img", undefined, { src: "onboarding/step3.svg", alt: "Choose Download larger data archive, the top option", class: "onboarding-img small" }));
  box.firstChild.append(el("strong", "Wrong zip? "), "On LinkedIn choose ", el("strong", "Download larger data archive"),
    " (the top option), not \"Want something in particular?\". That list doesn't include your connections: picking only Profile " +
    "gives a zip with just Profile.csv. The first zip with connections usually arrives in about 10 minutes.");
  return box;
}

/**
 * The summary before importing. Resolves with { found, rows: Set, targets: [] } or null.
 */
export async function importSummary(files, model) {
  const found = readExport(files);
  if (!found.files.length) return { found, empty: true };
  const { rows, noConnections } = exportSummary(found, model);
  const body = el("div", undefined, { class: "import-summary" });
  body.append(el("p", `Found in your LinkedIn export: ${rows.map(r => r.label).join(" · ")}.`, { class: "small" }));
  const list = el("div", undefined, { class: "import-rows" });
  const boxes = new Map();
  const followBoxes = [];
  for (const r of rows) {
    const line = el("label", undefined, { class: `import-row${r.key === "messages" ? " opt-in" : ""}` });
    const box = el("input", undefined, { type: "checkbox", checked: r.on });
    boxes.set(r.key, box);
    const text = el("span");
    text.append(el("strong", r.key === "messages" ? "Use message history for \"last contacted\"" : r.label), el("span", r.detail ? ` · ${r.detail}` : "", { class: "muted small" }));
    line.append(box, text);
    list.append(line);
    if (r.key === "follows") {
      const sub = el("div", undefined, { class: "import-follows" });
      const have = new Set(model.targets.map(t => t.company.toLowerCase()));
      for (const c of found.follows.filter(c => !have.has(c.toLowerCase()))) {
        const l = el("label", undefined, { class: "small" });
        const b = el("input", undefined, { type: "checkbox" });
        followBoxes.push([c, b]);
        l.append(b, ` ${c}`);
        sub.append(l);
      }
      list.append(sub);
    }
  }
  body.append(list);
  if (noConnections) body.append(el("div", undefined, { class: "warn" }), wrongZipHelp());
  if (noConnections) body.querySelector(".warn").textContent = "This export doesn't include your connections. Your profile can still be imported.";
  body.append(el("p", `🔒 ${PRIVACY_LINE}`, { class: "muted small privacy-line" }));
  const choice = await ask("Import your LinkedIn export", body, [{ label: "Cancel", value: "" }, { label: "Import", value: "import", primary: true, cta: true }]);
  if (choice !== "import") return null;
  return { found, noConnections, rows: new Set([...boxes].filter(([, b]) => b.checked).map(([k]) => k)),
           targets: boxes.get("follows")?.checked ? followBoxes.filter(([, b]) => b.checked).map(([c]) => c) : [] };
}
