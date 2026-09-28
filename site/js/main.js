// Network Map: app wiring. The demo loads by default; "Use my own data" opens a
// workbook or a LinkedIn CSV. Everything happens in this browser tab.

import { buildGraph } from "./core/graph.js";
import { applyOp, replay } from "./core/ops.js";
import { normalizeOrg } from "./core/org.js";
import { bestPath } from "./core/paths.js";
import { parseCsv, parseLinkedInCsv, personKey } from "./core/people.js";
import { saveDoc } from "./core/sync.js";
import { emptyModel, readPeopleCsvRows, readWorkbook, writeWorkbook } from "./core/workbook.js";
import * as files from "./store/files.js";
import { addBackup, kvDelete, kvGet, kvSet, listBackups } from "./store/local.js";
import { ask, toast } from "./ui/dialog.js";
import { companySuggestions, photoForm, targetForm } from "./ui/forms.js";
import { createImages } from "./ui/images.js";
import { createMap } from "./ui/map.js";
import { el, renderDetails, renderTargets } from "./ui/panels.js";

const $ = id => document.getElementById(id);
const DEMO_URL = "demo/demo_network.xlsx";
const TEMPLATE_URL = "template/contacts_template.xlsx";
const DEFAULT_NAME = "my_network.xlsx";
const PREFS = { layout: "network-map:layout", gravatar: "network-map:gravatar" };

const pref = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const setPref = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } };

// doc = { model, base (bytes last read/written), lastModified, pending (unsaved edits) }
const state = { mode: "demo", fileName: "", handle: null, doc: null, graph: null, paths: new Map(), selected: null,
                neverSaved: false, lastHandle: null };

// ---- rendering ---------------------------------------------------------------

const images = createImages({ onChange: () => { map.refresh(); renderSidebar(); } });

/** Best path to the target a node stands for (null for anything else). */
function pathFor(id) {
  const t = state.graph?.targets.find(x => x.focus === id);
  return t ? state.paths.get(t.key) ?? null : null;
}

const map = createMap($("map"), {
  images,
  pathFor,
  onSelect: id => { state.selected = id; renderSidebar(); },
  onDeselect: () => { state.selected = null; renderSidebar(); },
});

function render() {
  const { model } = state.doc;
  const me = model.me || "You";
  state.graph = buildGraph(model.people, { me, targets: model.targets });
  state.paths = new Map(state.graph.targets.map(t => [t.key, bestPath(state.graph, model.people, t, me)]));
  if (state.selected && !state.graph.nodes.some(n => n.id === state.selected)) state.selected = null;
  images.configure({ companies: model.companies, allowNetwork: state.mode !== "demo",
                     gravatar: pref(PREFS.gravatar, "off") === "on" });
  map.render(state.graph, model.layout);
  renderSidebar();
  renderChrome();
}

function renderSidebar() {
  if (!state.graph) return;
  const ctx = { graph: state.graph, model: state.doc.model, mode: state.mode, selected: state.selected,
                paths: state.paths, images };
  const handlers = { onFocus: focus, onRename: name => edit({ type: "setMe", name }), onEditTarget: editTarget,
                     onMakeTarget: company => addTarget(company), onPhoto: editPhoto };
  renderTargets($("targets"), ctx, handlers);
  renderDetails($("details"), ctx, handlers);
}

function focus(id) {
  state.selected = id;
  map.select(id);
  renderSidebar();
  $("details-section").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function clearSelection() {
  state.selected = null;
  map.clear();
  renderSidebar();
}

function unsaved() {
  return state.mode === "file" && (state.doc.pending.length > 0 || state.neverSaved);
}

function renderChrome() {
  const { model } = state.doc;
  const first = model.me ? model.me.split(" ")[0] : "";
  $("title").textContent = first ? `${first}'s Network` : "Network Map";
  document.title = first ? `${first}'s Network · Network Map` : "Network Map";

  const save = $("save");
  save.hidden = state.mode !== "file";
  save.classList.toggle("dirty", unsaved());
  save.textContent = state.handle || !files.canSaveInPlace ? "Save" : "Save as…";
  save.title = files.canSaveInPlace ? "" : "Your browser can't write to files directly, so Save downloads the updated workbook.";

  const status = $("file-status");
  if (state.mode === "demo") status.textContent = "Demo · fictional people";
  else {
    const n = state.doc.pending.length;
    status.textContent = `${state.fileName}${n ? ` · ${n} unsaved change${n === 1 ? "" : "s"}` : state.neverSaved ? " · not saved yet" : " · saved"}`;
  }

  const banner = $("banner");
  banner.replaceChildren();
  if (state.mode === "demo") {
    banner.append("You're viewing fictional demo data. ");
    banner.append(el("button", "Use my own data →", { class: "linklike", type: "button",
                                                      onclick: e => { e.stopPropagation(); openMenu(); } }));
    if (state.doc.pending.length) {
      banner.append(" · ", el("button", "Reset demo", { class: "linklike", type: "button", onclick: resetDemo }));
    }
    if (state.lastHandle) {
      banner.append(el("br"), el("button", `Reopen ${state.lastHandle.name}`, { class: "linklike", type: "button",
                                                                           onclick: reopen }));
    }
    banner.hidden = false;
  } else banner.hidden = true;

  const reopenItem = document.querySelector('[data-action="reopen"]');
  reopenItem.hidden = !state.lastHandle || state.mode === "file";
  reopenItem.textContent = state.lastHandle ? `Reopen ${state.lastHandle.name}` : "";
  document.querySelector('[data-action="demo"]').hidden = state.mode === "demo";
}

// ---- edits -------------------------------------------------------------------

function edit(op) {
  const doc = state.doc;
  state.doc = { ...doc, model: applyOp(doc.model, op), pending: [...doc.pending, op] };
  persistDraft();
  render();
}

/** Unsaved edits are kept in this browser so a refresh doesn't lose them. */
function persistDraft() {
  if (state.mode === "demo") return kvSet("demo-edits", state.doc.pending);
  return kvSet("draft", { fileName: state.fileName, pending: state.doc.pending, time: Date.now() });
}

async function addTarget(company = "") {
  const existing = state.doc.model.targets.find(t => company && normalizeOrg(t.company) === normalizeOrg(company));
  if (existing) return editTarget(normalizeOrg(existing.company));
  const result = await targetForm({ suggestions: companySuggestions(state.doc.model, state.graph), company });
  if (!result) return;
  const key = normalizeOrg(result.target.company);
  const dup = state.doc.model.targets.find(t => normalizeOrg(t.company) === key);
  edit({ type: "upsertTarget", key: dup ? key : undefined, target: dup ? { ...dup, ...result.target } : result.target });
  const t = state.graph.targets.find(x => x.key === key);
  if (t) focus(t.focus);
  toast(`${result.target.company} is now a target.`);
}

async function editTarget(key) {
  const target = state.doc.model.targets.find(t => normalizeOrg(t.company) === key);
  if (!target) return;
  const result = await targetForm({ target, suggestions: companySuggestions(state.doc.model, state.graph) });
  if (!result) return;
  if (result.action === "remove") {
    edit({ type: "removeTarget", key });
    clearSelection();
    toast(`Removed ${target.company} from your targets.`);
    return;
  }
  edit({ type: "upsertTarget", key, target: result.target });
  const t = state.graph.targets.find(x => x.key === normalizeOrg(result.target.company));
  if (t) focus(t.focus);
}

async function editPhoto(node) {
  const key = node.id.slice(2);
  const person = state.doc.model.people.find(p => personKey(p) === key);
  if (!person) return;
  try {
    const result = await photoForm({ name: person.name, current: person.photo });
    if (!result) return;
    edit({ type: "upsertPerson", key, person: { ...person, photo: result.photo } });
    toast(result.photo ? `Photo saved for ${person.name}.` : `Photo removed for ${person.name}.`);
  } catch (e) {
    console.error(e);
    toast(`Couldn't use that image: ${e.message}`);
  }
}

// ---- loading -----------------------------------------------------------------

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

async function loadDemo() {
  const base = await fetchBytes(DEMO_URL);
  const edits = (await kvGet("demo-edits")) ?? [];
  let model = readWorkbook(base);
  let pending = edits;
  try { model = replay(model, edits); } catch { pending = []; await kvDelete("demo-edits"); }
  Object.assign(state, { mode: "demo", fileName: "", handle: null, neverSaved: false, selected: null,
                         doc: { model, base, lastModified: null, pending } });
  render();
}

async function resetDemo() {
  await kvDelete("demo-edits");
  await loadDemo();
  toast("Demo reset.");
}

/** Open a picked file: an .xlsx workbook, a LinkedIn Connections.csv, or a CSV with a Name column. */
async function openPicked(picked) {
  const { name, bytes, lastModified, handle } = picked;
  if (/\.csv$/i.test(name)) {
    const text = new TextDecoder().decode(bytes);
    const model = emptyModel(state.mode === "file" ? state.doc.model.me : "");
    let message;
    try {
      model.pool = parseLinkedInCsv(text, name);
      message = `Imported ${model.pool.length} LinkedIn connections into your pool. They stay off the map until you add them.`;
    } catch {
      const rows = parseCsv(text);
      const records = rows.slice(1).map(r => Object.fromEntries(rows[0].map((h, i) => [h, r[i] ?? ""])));
      model.people = readPeopleCsvRows(records);
      if (!model.people.length) throw new Error(`${name} isn't a LinkedIn export and has no Name column.`);
      message = `Loaded ${model.people.length} people from ${name}.`;
    }
    Object.assign(state, { mode: "file", fileName: DEFAULT_NAME, handle: null, neverSaved: true, selected: null,
                           doc: { model, base: null, lastModified: null, pending: [] } });
    render();
    toast(`${message} Save to create ${DEFAULT_NAME}.`, 7000);
    return;
  }

  let model = readWorkbook(bytes);
  let pending = [];
  const draft = await kvGet("draft");
  if (draft?.fileName === name && draft.pending?.length) {
    const when = new Date(draft.time).toLocaleString();
    const choice = await ask("Restore unsaved changes?",
      `You have ${draft.pending.length} unsaved change(s) to ${name} from ${when}.`,
      [{ label: "Discard", value: "discard" }, { label: "Restore", value: "restore", primary: true }]);
    if (choice === "restore") {
      try { model = replay(model, draft.pending); pending = draft.pending; }
      catch { toast("Those changes couldn't be applied to this version of the file."); }
    } else await kvDelete("draft");
  }
  Object.assign(state, { mode: "file", fileName: name, handle, neverSaved: false, selected: null,
                         doc: { model, base: bytes, lastModified, pending } });
  if (handle) { state.lastHandle = handle; kvSet("last-handle", handle); }
  render();
  map.fit();
  const notes = model.notices.length ? ` ${model.notices.join(" ")} Save to update the file.` : "";
  toast(`Opened ${name}: ${model.people.length} people, ${model.targets.length} targets.${notes}`, notes ? 8000 : 4000);
}

async function openFile() {
  const picked = await files.pickFile();
  if (picked) await openPicked(picked);
}

async function reopen() {
  const handle = state.lastHandle;
  if (!handle) return;
  const ok = (await handle.queryPermission?.({ mode: "read" })) === "granted"
          || (await handle.requestPermission?.({ mode: "read" })) === "granted";
  if (!ok) return toast("Permission was not granted. Use “Open my workbook…” instead.");
  await openPicked({ ...(await files.readHandle(handle)), handle });
}

async function newWorkbook() {
  const body = el("label", undefined, { class: "field" });
  const input = el("input", undefined, { placeholder: "Your name", autocomplete: "name", name: "me" });
  body.append(el("span", "Your name (shown in the center of your map)"), input);
  const choice = await ask("Start a new workbook", body,
    [{ label: "Cancel", value: "" }, { label: "Create", value: "create", primary: true }]);
  if (choice !== "create") return;
  Object.assign(state, { mode: "file", fileName: DEFAULT_NAME, handle: null, neverSaved: true, selected: null,
                         doc: { model: emptyModel(input.value.trim()), base: null, lastModified: null, pending: [] } });
  render();
  toast("New workbook ready. Add your target companies, then Save.");
}

// ---- saving ------------------------------------------------------------------

async function save() {
  if (state.mode !== "file") return;
  try {
    if (!state.handle && files.canSaveInPlace) {
      const handle = await files.pickSaveLocation(state.fileName || DEFAULT_NAME);
      if (handle === undefined) return; // cancelled
      state.handle = handle;
    }
    const { handle, fileName } = state;
    let io;
    if (handle) {
      if (!(await files.ensureWritable(handle))) return toast("Permission to save was not granted.");
      io = { read: () => files.readHandle(handle), write: b => files.writeHandle(handle, b),
             backup: b => addBackup(fileName, b) };
    } else {
      io = { read: async () => null, write: async b => { files.download(b, fileName); return null; },
             backup: b => addBackup(fileName, b) };
    }
    const count = state.doc.pending.length;
    const result = await saveDoc(state.doc, io);
    state.doc = { ...result, model: { ...result.model, notices: [] } };
    if (handle) {
      state.fileName = handle.name;
      state.lastHandle = handle;
      kvSet("last-handle", handle);
    }
    state.neverSaved = false;
    await kvDelete("draft");
    render();
    toast(result.reloaded
      ? `${state.fileName} had changed (edited in Excel?), so it was reloaded and your ${count} change(s) were applied on top. Saved.`
      : handle ? `Saved to ${state.fileName}.` : `Downloaded ${fileName}. Replace your old copy with it.`, 6000);
  } catch (e) {
    console.error(e);
    toast(`Couldn't save: ${e.message}. If the file is open in Excel, close it and try again.`, 8000);
  }
}

async function downloadCopy() {
  const name = state.mode === "demo" ? "network_map_demo.xlsx" : state.fileName || DEFAULT_NAME;
  files.download(writeWorkbook(state.doc.model, state.doc.base), name);
}

async function downloadTemplate() {
  files.download(await fetchBytes(TEMPLATE_URL), "network_template.xlsx");
}

async function showBackups() {
  const backups = await listBackups();
  const body = el("div");
  if (!backups.length) body.append(el("p", "No backups yet. A copy of your workbook is kept here every time you save.", { class: "muted" }));
  else {
    body.append(el("p", "The previous version is kept in this browser each time you save (last 10).", { class: "muted small" }));
    const ul = el("ul", undefined, { class: "backup-list" });
    for (const b of backups) {
      const li = el("li");
      li.append(el("span", `${b.fileName} · ${new Date(b.time).toLocaleString()}`));
      const actions = el("span");
      actions.append(el("button", "Download", { class: "btn small", type: "button",
        onclick: () => files.download(b.bytes, b.fileName.replace(/\.xlsx$/i, "") + `-backup-${b.time}.xlsx`) }));
      if (state.mode === "file") {
        actions.append(" ", el("button", "Restore", { class: "btn small", type: "button", onclick: () => {
          edit({ type: "replaceModel", model: readWorkbook(b.bytes) });
          $("dialog").close();
          toast("Backup restored. Save to write it to your file.");
        } }));
      }
      li.append(actions);
      ul.append(li);
    }
    body.append(ul);
  }
  await ask("Backups", body, [{ label: "Close", value: "", primary: true }]);
}

// ---- menu, search, toggles -----------------------------------------------------

const menu = $("data-menu");
const menuBtn = $("data-menu-btn");
function openMenu() {
  menu.hidden = false;
  menuBtn.setAttribute("aria-expanded", "true");
  menu.querySelector("button:not([hidden])")?.focus();
}
function closeMenu() {
  menu.hidden = true;
  menuBtn.setAttribute("aria-expanded", "false");
}
menuBtn.addEventListener("click", e => { e.stopPropagation(); menu.hidden ? openMenu() : closeMenu(); });
document.addEventListener("click", e => { if (!menu.contains(e.target)) closeMenu(); });

const ACTIONS = { open: openFile, reopen, new: newWorkbook, template: downloadTemplate, download: downloadCopy,
                  backups: showBackups, demo: loadDemo };
menu.addEventListener("click", async e => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  closeMenu();
  if (action !== "download" && action !== "backups" && action !== "template" && unsaved()) {
    const choice = await ask("Unsaved changes", `You have unsaved changes to ${state.fileName}.`,
      [{ label: "Cancel", value: "" }, { label: "Continue without saving", value: "go" }]);
    if (choice !== "go") return;
  }
  try { await ACTIONS[action](); } catch (err) { console.error(err); toast(err.message, 8000); }
});

$("save").addEventListener("click", save);
$("add-target").addEventListener("click", () => addTarget());
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && state.mode === "file") { e.preventDefault(); save(); }
  if (e.key === "Escape" && !$("dialog").open) {
    if (!menu.hidden) closeMenu();
    else if (state.selected) clearSelection();
  }
});

$("search").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim().toLowerCase();
  if (!q) return;
  const orgQ = normalizeOrg(q);
  const hit = state.graph.nodes.find(n => n.label?.toLowerCase().includes(q))
           ?? state.graph.nodes.find(n => [n.company, n.school].some(v => v && (v.toLowerCase().includes(q) || normalizeOrg(v) === orgQ)));
  if (hit) focus(hit.id); else toast(`No one on the map matches “${e.target.value.trim()}”.`);
});

$("show2").addEventListener("change", e => map.set({ showSecond: e.target.checked }));
$("gravatar").checked = pref(PREFS.gravatar, "off") === "on";
$("gravatar").addEventListener("change", e => { setPref(PREFS.gravatar, e.target.checked ? "on" : "off"); render(); });
$("fit").addEventListener("click", () => map.fit());

// Free | Ring layout switch (remembered in this browser).
const layoutButtons = [...document.querySelectorAll("[data-layout]")];
function setLayout(mode, animate = true) {
  layoutButtons.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.layout === mode)));
  setPref(PREFS.layout, mode);
  map.setLayout(mode, animate);
}
layoutButtons.forEach(b => b.addEventListener("click", () => setLayout(b.dataset.layout)));

window.addEventListener("beforeunload", e => {
  if (unsaved()) { e.preventDefault(); e.returnValue = ""; }
});

// ---- start ---------------------------------------------------------------------

(async () => {
  const layout = pref(PREFS.layout, "free") === "ring" ? "ring" : "free";
  layoutButtons.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.layout === layout)));
  map.set({ layout });
  try {
    await loadDemo();
  } catch (e) {
    console.error(e);
    toast(`Couldn't load the demo: ${e.message}`, 10000);
    return;
  }
  const handle = await kvGet("last-handle");
  if (handle?.getFile) { state.lastHandle = handle; renderChrome(); }
})();
