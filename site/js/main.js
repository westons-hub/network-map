// Network Map: app wiring. The demo loads by default; "Use my own data" opens a
// workbook or a LinkedIn CSV. Everything happens in this browser tab.

import { buildGraph } from "./core/graph.js";
import { normalizeOrg } from "./core/org.js";
import { applyOp, replay } from "./core/ops.js";
import { parseCsv, parseLinkedInCsv } from "./core/people.js";
import { saveDoc } from "./core/sync.js";
import { emptyModel, readPeopleCsvRows, readWorkbook, writeWorkbook } from "./core/workbook.js";
import * as files from "./store/files.js";
import { addBackup, kvDelete, kvGet, kvSet, listBackups } from "./store/local.js";
import { createMap } from "./ui/map.js";
import { el, renderDetails, renderTargets } from "./ui/panels.js";

const $ = id => document.getElementById(id);
const DEMO_URL = "demo/demo_network.xlsx";
const TEMPLATE_URL = "template/contacts_template.xlsx";
const DEFAULT_NAME = "my_network.xlsx";

// doc = { model, base (bytes last read/written), lastModified, pending (unsaved edits) }
const state = { mode: "demo", fileName: "", handle: null, doc: null, graph: null, selected: null,
                neverSaved: false, lastHandle: null };

// ---- rendering ---------------------------------------------------------------

const map = createMap($("map"), {
  onSelect: id => { state.selected = id; renderSidebar(); },
  onDeselect: () => { state.selected = null; renderSidebar(); },
});

function render() {
  const { model } = state.doc;
  state.graph = buildGraph(model.people, { me: model.me || "You", targets: model.targets });
  if (state.selected && !state.graph.nodes.some(n => n.id === state.selected)) state.selected = null;
  map.render(state.graph, model.layout);
  renderSidebar();
  renderChrome();
}

function renderSidebar() {
  const ctx = { graph: state.graph, model: state.doc.model, mode: state.mode, selected: state.selected,
                connected: id => map.connected(id) };
  const handlers = { onFocus: focus, onRename: name => edit({ type: "setMe", name }) };
  renderTargets($("targets"), ctx, handlers);
  renderDetails($("details"), ctx, handlers);
}

function focus(id) {
  state.selected = id;
  map.focus(id);
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
    banner.append(el("button", "Use my own data →", { class: "linklike", type: "button", onclick: e => { e.stopPropagation(); openMenu(); } }));
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

// ---- toast & dialogs -----------------------------------------------------------

let toastTimer;
function toast(message, ms = 4500) {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/** A small modal. buttons: [{ label, value, primary }]. Resolves with the clicked value. */
function ask(title, body, buttons) {
  const dialog = $("dialog");
  const form = $("dialog-body");
  form.replaceChildren(el("h3", title));
  if (body instanceof Node) form.append(body); else if (body) form.append(el("p", body));
  const actions = el("div", undefined, { class: "actions" });
  for (const b of buttons) actions.append(el("button", b.label, { class: `btn${b.primary ? " primary" : ""}`, value: b.value }));
  form.append(actions);
  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
    dialog.returnValue = "";
    dialog.showModal();
  });
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
  try { model = replay(model, edits); } catch { await kvDelete("demo-edits"); }
  Object.assign(state, { mode: "demo", fileName: "", handle: null, neverSaved: false, selected: null,
                         doc: { model, base, lastModified: null, pending: edits } });
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
  toast("New workbook ready. Add your target companies and people, then Save.");
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
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });

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
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && state.mode === "file") { e.preventDefault(); save(); }
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
$("status").addEventListener("change", e => map.set({ statusColors: e.target.checked }));
$("physics").addEventListener("change", e => map.setPhysics(e.target.checked));
$("fit").addEventListener("click", () => map.fit());

window.addEventListener("beforeunload", e => {
  if (unsaved()) { e.preventDefault(); e.returnValue = ""; }
});

// ---- start ---------------------------------------------------------------------

(async () => {
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
