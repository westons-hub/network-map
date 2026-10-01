// Orbit: app wiring. The demo loads by default; "Use my own data" opens a
// workbook or a LinkedIn CSV. Everything happens in this browser tab.

import { DEFAULT_GROUP_BY, GROUP_FIELDS, buildGraph, newGroups } from "./core/graph.js";
import { replay } from "./core/ops.js";
import { normalizeName, normalizeOrg } from "./core/org.js";
import { exportWorkbook } from "./core/export.js";
import { searchMap } from "./core/search.js";
import { bestPath, neighborhood } from "./core/paths.js";
import { parseCsv, parseLinkedInCsv, personKey } from "./core/people.js";
import { checkInOps, demoEditsForToday, meetingOps, meetingTasks, shiftDemoDates, taskBadge, todayIso } from "./core/schedule.js";
import { saveDoc } from "./core/sync.js";
import { emptyModel, readPeopleCsvRows, readWorkbook, writeWorkbook } from "./core/workbook.js";
import * as files from "./store/files.js";
import { addBackup, kvDelete, kvGet, kvSet, listBackups } from "./store/local.js";
import { createCalendar } from "./ui/calendar.js";
import { createDetails } from "./ui/details.js";
import { ask, toast } from "./ui/dialog.js";
import {
  companySuggestions, orgForm, personForm, photoForm, settingsForm, targetForm, taskForm,
} from "./ui/forms.js";
import { meetingForm } from "./ui/meetingEditor.js";
import { createImages } from "./ui/images.js";
import { createMap } from "./ui/map.js";
import { el, renderOverview, renderTargets } from "./ui/panels.js";
import { createTodo } from "./ui/todo.js";
import { buildSuggestions } from "./core/suggest.js";
import { setSuggestionSource } from "./ui/typeahead.js";
import { introSeen, playIntro } from "./ui/intro.js";
import { showOnboarding, showWelcome, welcomeSeen } from "./ui/welcome.js";
import { exportPickers, filesFromDrop, importSummary, isExportFile, readExportFiles } from "./ui/exportImport.js";
import { exportOps } from "./core/linkedinExport.js";
import { isDark, nextThemeMode, onThemeChange, setTheme, themeMode } from "./ui/theme.js";
import * as calendars from "./store/calendars.js";
import { addPersonFlow, peopleFromPool } from "./ui/addPerson.js";
import { isPdf } from "./ui/pdf.js";
import { createPoolView } from "./ui/poolView.js";
import { createPeopleView } from "./ui/peopleView.js";

const $ = id => document.getElementById(id);
const DEMO_URL = "demo/demo_network.xlsx";
const TEMPLATE_URL = "template/contacts_template.xlsx";
const DEFAULT_NAME = "my_network.xlsx";
const PREFS = { layout: "network-map:layout", view: "network-map:view" };

const pref = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const setPref = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } };

// doc = { model, base (bytes last read/written), lastModified, pending (unsaved edits) }
const state = { mode: "demo", fileName: "", handle: null, doc: null, graph: null, paths: new Map(), selected: null,
                neverSaved: false, lastHandle: null, view: "map" };

// ---- rendering ---------------------------------------------------------------

const images = createImages({ onChange: () => { map.refresh(); renderSidebar(); details.render(); } });

/** Best path to the target a node stands for (null for anything else). */
function pathFor(id) {
  const t = state.graph?.targets.find(x => x.focus === id);
  return t ? state.paths.get(t.key) ?? null : null;
}

const map = createMap($("map"), {
  images,
  pathFor,
  onSelect: id => { state.selected = id; details.open(id); },
  onDeselect: () => { state.selected = null; details.close(); },
  // Dragged positions go in the Layout sheet (and, in the demo, in this browser's demo copy).
  onMoved: positions => edit({ type: "setLayout", positions }),
});

const details = createDetails({
  sidebar: $("sidebar"),
  getCtx: () => ({ graph: state.graph, model: state.doc.model, paths: state.paths, images, mode: state.mode }),
  handlers: {
    close: clearSelection,
    focus,
    patchPerson: (key, fields) => { edit({ type: "patchPerson", key, fields }); followRename(key, fields); details.saved(); },
    // One of the person's own columns (Date Reached Out, Referral?, Relationship Plan…); empty removes it.
    patchExtra: (key, header, value) => { patchExtra(key, header, value); details.saved(); },
    setProfile: fields => { edit({ type: "setProfile", fields }); details.saved(); },
    setZoomLink: link => { edit({ type: "setSettings", settings: { zoomLink: link } }); details.saved(); },
    addConnection: connection => {
      if (!connection.b || !connection.a || normalizeName(connection.a) === normalizeName(connection.b)) return;
      edit({ type: "addConnection", connection });
      details.saved();
    },
    removeConnection: connection => { edit({ type: "removeConnection", connection }); toast("Connection removed."); },
    editMyPhoto: async () => {
      try {
        const result = await photoForm({ name: state.doc.model.me || "you", current: state.doc.model.profile?.photo });
        if (result) { edit({ type: "setProfile", fields: { photo: result.photo } }); toast(result.photo ? "Your photo is saved." : "Photo removed."); }
      } catch (e) { toast(`Couldn't use that image: ${e.message}`); }
    },
    editPhoto,
    editAll,
    exportPerson: name => runExport({ kind: "people", names: [name] }),
    editOrg,
    importPdfFor: (name, file) => addPerson({ pdf: file, into: name }),
    removePerson,
    scheduleMeeting: opts => editMeeting(null, opts),
    editMeeting: m => editMeeting(m),
    inviteMeeting: m => editMeeting(m), // the editor has the send options
    addTask: opts => editTask(null, opts),
    toggleTask,
    editTarget,
    makeTarget: company => addTarget(company),
    setTargetStage: (key, stage) => {
      const target = state.doc.model.targets.find(t => normalizeOrg(t.company) === key);
      if (target) { edit({ type: "upsertTarget", key, target: { ...target, stage } }); details.saved(); }
    },
  },
});

const calendar = createCalendar($("calendar-view"), {
  getModel: () => state.doc.model,
  getExternal: (from, to) => externalEvents(from, to),
  onDay: (date, kind) => (kind === "meeting" ? editMeeting(null, { date }) : editTask(null, { date })),
  onSlot: (date, start) => editMeeting(null, { date, start }),
  onItem: item => {
    if (item.kind === "meeting") {
      const m = state.doc.model.meetings.find(x => x.id === item.id);
      if (m) editMeeting(m);
    } else {
      const t = state.doc.model.tasks.find(x => x.id === item.id);
      if (t) editTask(t);
    }
  },
  onMove: (id, date, start, end) => moveMeeting(id, date, start, end),
});

const pool = createPoolView($("pool-view"), {
  getModel: () => state.doc.model,
  onImport: () => chooseExport(),
  onAdd: entry => addPerson({ entry }),
  onAddMany: entries => addMany(entries),
  onOpen: name => openPerson(name),
});

// ---- connected calendar (optional) ------------------------------------------------
// Your own events are fetched for the range the Calendar shows and drawn muted; they're never saved.
const external = { key: "", events: [], loading: false };
function externalEvents(from, to) {
  if (!calendars.status().provider) return [];
  const key = `${from}|${to}`;
  if (external.key !== key && !external.loading) {
    external.loading = true;
    calendars.listEvents(from, to)
      .then(events => { Object.assign(external, { key, events }); if (state.view === "calendar") calendar.render(); })
      .catch(e => toast(e.message, 7000))
      .finally(() => { external.loading = false; });
  }
  const own = new Set(state.doc.model.meetings.map(m => m.eventId).filter(Boolean));
  return external.key === key ? external.events.filter(e => !own.has(e.id)) : [];
}
calendars.onChange(() => { external.key = ""; renderViews(); });

/** After a meeting is saved: if a calendar is connected, create/update its event there (sends the invite). */
async function syncToCalendar(meeting) {
  if (!calendars.status().provider || state.mode === "demo") return false;
  const model = state.doc.model;
  const person = model.people.find(p => normalizeName(p.name) === normalizeName(meeting.person));
  try {
    const { fillTemplate } = await import("./core/schedule.js");
    const synced = await calendars.syncMeeting(meeting, { me: model.me, email: person?.email ?? "",
      message: fillTemplate(model.settings.inviteTemplate, { meeting, me: model.me }) });
    if (synced && (synced.eventId !== meeting.eventId || synced.link !== meeting.link)) {
      edit({ type: "upsertMeeting", meeting: { ...meeting, eventId: synced.eventId, link: synced.link ?? meeting.link } });
    }
    toast(`Saved to your ${calendars.status().provider === "google" ? "Google Calendar" : "Outlook calendar"}` +
          (person?.email ? `; ${meeting.person} gets the invite.` : "."));
    external.key = "";
    return true;
  } catch (e) {
    console.error(e);
    toast(`Couldn't update your calendar: ${e.message}`, 8000);
    return false;
  }
}

function moveMeeting(id, date, start, end) {
  const m = state.doc.model.meetings.find(x => x.id === id);
  if (!m) return;
  const moved = { ...m, date, start, end };
  edit(meetingOps(state.doc.model, moved).filter(op => op.type !== "upsertTask"));
  toast(`Moved to ${new Date(`${date}T${start}`).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`);
  syncToCalendar(moved);
}

// ---- adding people ------------------------------------------------------------------

async function addPerson({ pdf, entry, into } = {}) {
  const result = await addPersonFlow({ model: state.doc.model, demo: state.mode === "demo", pdf, entry, into });
  if (!result) return;
  if (result.open) return openPerson(result.open);
  const { person: { links = [], history, ...person }, existingKey } = result;
  const people = state.doc.model.people;
  const known = name => people.find(p => normalizeName(p.name) === normalizeName(name))?.name ?? name;
  edit([{ type: "upsertPerson", key: existingKey, person: { ...person, connectedThrough: person.connectedThrough ? known(person.connectedThrough) : "",
                                                             source: person.source || "excel" } },
        ...links.map(l => ({ type: "addConnection", connection: { a: person.name, b: known(l.other), type: l.type } })),
        ...(history ? [{ type: "addHistory", ...history }] : [])]);
  focus(`p:${normalizeName(person.name)}`, { follow: !existingKey });
  toast(existingKey ? `Updated ${person.name}.` : `Added ${person.name} to your map.`);
}

function addMany(entries) {
  const people = peopleFromPool(state.doc.model, entries);
  if (!people.length) return toast("Everyone selected is already on your map.");
  edit(people.map(person => ({ type: "upsertPerson", person })));
  toast(`Added ${people.length} ${people.length === 1 ? "person" : "people"} to your map.`);
}


const peopleView = createPeopleView($("people-view"), {
  getModel: () => state.doc.model,
  images,
  onOpen: name => openPerson(name),
  onPatch: (key, fields) => edit({ type: "patchPerson", key, fields }),
  onPatchExtra: patchExtra,
  onAdd: () => addPerson(),
});

/** Set or clear one of a person's own columns (Date Reached Out, Relationship Plan…). */
function patchExtra(key, header, value) {
  const p = state.doc.model.people.find(x => personKey(x) === key);
  if (!p) return;
  const extra = Object.fromEntries(Object.entries(p.extra ?? {}).filter(([k]) => k.toLowerCase() !== header.toLowerCase()));
  if (value) extra[header] = value;
  edit({ type: "patchPerson", key, fields: { extra } });
}

const todo = createTodo($("todo-view"), {
  getModel: () => state.doc.model,
  onAdd: task => { edit({ type: "upsertTask", task }); toast("Task added."); },
  onToggle: toggleTask,
  onEdit: t => editTask(t),
  onPerson: name => openPerson(name),
});

// Type-ahead everywhere: suggestions from everything entered, rebuilt when the data changes.
let suggestions = null;
setSuggestionSource({
  suggestions: () => (suggestions ??= buildSuggestions(state.doc.model)),
  logo: (name, kind) => images.forOrg({ label: name, key: normalizeOrg(name), kind }).image,
});

function render() {
  const { model } = state.doc;
  suggestions = null;
  const me = model.me || "Your Name"; // a new map: fill in My profile to put your name here
  const before = state.announceGroups ? state.graph : null;
  state.graph = buildGraph(model.people, { me, profile: model.profile, connections: model.connections, targets: model.targets,
                                           minGroupSize: groupSize(), groupBy: groupBy() });
  // Company / school dots appear live once enough people share one; say so.
  const created = newGroups(before, state.graph);
  if (created.length) {
    const said = created.slice(0, 2).map(n => `Created ${n.label} group (${n.count} ${n.count === 1 ? "person" : "people"})`);
    const note = `${said.join(" · ")}${created.length > 2 ? ` and ${created.length - 2} more` : ""}.`;
    // After the edit's own message ("Added …"), so both show.
    setTimeout(() => { const t = $("toast"); toast(t.hidden ? note : `${t.textContent} ${note}`, 7000); }, 0);
  }
  state.paths = new Map(state.graph.targets.map(t => [t.key, bestPath(state.graph, model.people, t, me, model.profile)]));
  if (state.selected && !state.graph.nodes.some(n => n.id === state.selected)) { state.selected = null; details.close(); }
  images.configure({ companies: model.companies, guessDomains: state.mode !== "demo", avatarStyle: model.avatarStyle });
  map.render(state.graph, model.layout);
  renderSidebar();
  renderGrouping();
  renderChrome();
  renderViews();
  details.render();
}

// Legend & view → grouping (saved in the workbook's Settings). While the slider moves, the map previews it.
let groupPreview = null;
const groupSize = () => groupPreview ?? (Number(state.doc.model.settings.groupSize) || 3);
function groupBy() {
  const v = String(state.doc.model.settings.groupBy ?? "").split(/[,;]/).map(x => x.trim().toLowerCase())
    .filter(x => GROUP_FIELDS.some(([f]) => f === x));
  return v.length || state.doc.model.settings.groupBy === "" ? v : DEFAULT_GROUP_BY;
}
function renderGrouping() {
  $("group-size").value = String(groupSize());
  $("group-size-value").textContent = String(groupSize());
  const on = new Set(groupBy());
  for (const box of document.querySelectorAll(".group-by input")) box.checked = on.has(box.value);
}
$("group-size").addEventListener("input", e => { groupPreview = Number(e.target.value); $("group-size-value").textContent = e.target.value; render(); });
$("group-size").addEventListener("change", e => {
  groupPreview = null;
  if (Number(e.target.value) !== (Number(state.doc.model.settings.groupSize) || 3)) edit({ type: "setSettings", settings: { groupSize: Number(e.target.value) } });
});
document.querySelector(".group-by").addEventListener("change", () => {
  const picked = [...document.querySelectorAll(".group-by input:checked")].map(b => b.value);
  edit({ type: "setSettings", settings: { groupBy: picked.join(", ") } });
});

function renderSidebar() {
  if (!state.graph) return;
  const ctx = { graph: state.graph, model: state.doc.model, mode: state.mode, paths: state.paths, images };
  const handlers = { onFocus: focus, onRename: name => edit({ type: "setMe", name }), onEditTarget: editTarget,
                     onPerson: openPerson, onView: showView };
  renderTargets($("targets"), ctx, handlers);
  renderOverview($("details"), ctx, handlers);
}

function renderViews() {
  const n = taskBadge(state.doc.model.tasks);
  const badge = $("todo-badge");
  badge.hidden = !n;
  badge.textContent = String(n);
  badge.title = `${n} overdue or due today`;
  $("pool-count").textContent = state.doc.model.pool.length ? String(state.doc.model.pool.length) : "";
  if (state.view === "calendar") calendar.render();
  if (state.view === "todo") todo.render();
  if (state.view === "pool") pool.render();
  if (state.view === "people") peopleView.render();
}

// Map | Calendar | To-Do tabs (the choice is remembered in this browser).
const tabs = [...document.querySelectorAll(".view-tabs [data-view]")];
function showView(view) {
  state.view = ["map", "people", "calendar", "todo", "pool"].includes(view) ? view : "map";
  setPref(PREFS.view, state.view);
  tabs.forEach(t => t.setAttribute("aria-selected", String(t.dataset.view === state.view)));
  for (const v of document.querySelectorAll("#main-pane > .view")) v.hidden = v.dataset.view !== state.view;
  renderViews();
}
tabs.forEach(t => t.addEventListener("click", () => showView(t.dataset.view)));

/** Select a node on the map, highlight it, and open its details in the sidebar. */
function focus(id, opts) {
  if (state.view !== "map") showView("map");
  state.selected = id;
  map.select(id, opts);
  details.open(id);
}

const personOnMap = name => state.graph.nodes.some(n => n.id === `p:${normalizeName(name)}`);
function openPerson(name) {
  if (personOnMap(name)) focus(`p:${normalizeName(name)}`);
  else toast(`${name} isn't on your map.`);
}

function clearSelection() {
  state.selected = null;
  map.clear();
  details.close();
}

/** After renaming someone in their details, keep the details on them. */
function followRename(key, fields) {
  if (fields.name === undefined || normalizeName(fields.name) === key) return;
  const id = `p:${normalizeName(fields.name)}`;
  state.selected = id;
  map.select(id);
  details.open(id);
}

function unsaved() {
  return state.mode === "file" && (state.doc.pending.length > 0 || state.neverSaved);
}

function renderChrome() {
  const { model } = state.doc;
  $("illustrated").checked = model.avatarStyle === "notionists";
  const first = model.me ? model.me.split(" ")[0] : "";
  $("title").textContent = first ? `${first}'s orbit` : "Your orbit";
  document.title = first ? `${first}'s orbit · Orbit` : "Orbit";

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
  } else if (!model.me) {
    // A new map: start with your profile (your name goes in the center).
    banner.append("Welcome to your map! Start with your profile: your name, photo, schools, jobs and Zoom link. ");
    banner.append(el("button", "Fill in my profile →", { class: "linklike", type: "button", onclick: () => focus("me") }));
    banner.hidden = false;
  } else banner.hidden = true;
  renderDataMenu();
}

/** "Use my own data" in the demo; your map's name + its menu once you're on your own map. */
function renderDataMenu() {
  const own = state.mode === "file";
  menuBtn.textContent = own ? `${state.fileName.replace(/\.xlsx$/i, "")} ▾` : "Use my own data";
  menuBtn.title = own ? "Save, open another file, export, or switch to the demo" : "";
  const item = (action, label) => el("button", label, { role: "menuitem", type: "button", "data-action": action });
  const items = own
    ? [item("save", "Save"), item("open", "Open another file…"), item("export", "Export…"), item("demo", "Switch to demo"), el("hr"),
       item("importPool", "Import your LinkedIn export (zip, folder or CSV)…"), item("download", "Download a copy (.xlsx)"), item("settings", "Settings…"),
       item("backups", "Backups…"), item("new", "Start a new, empty map"), item("template", "Download the blank template")]
    : [item("start", "Start your own map (step by step)…"), item("importPool", "Import your LinkedIn export (zip, folder or CSV)…"),
       item("open", "Open my workbook…"),
       ...(state.lastHandle ? [item("reopen", `Reopen ${state.lastHandle.name}`)] : []),
       item("new", "Start a new, empty map"), item("template", "Download the blank template"), el("hr"),
       item("download", "Download a copy of the demo (.xlsx)"), item("settings", "Settings…"), item("backups", "Backups…")];
  menu.replaceChildren(...items);
}

// ---- edits -------------------------------------------------------------------

/** Apply one edit (or several at once, e.g. a meeting plus its status change and task). */
function edit(opOrOps) {
  let ops = Array.isArray(opOrOps) ? opOrOps : [opOrOps];
  if (!ops.length) return;
  const doc = state.doc;
  let model = replay(doc.model, ops);
  // "Keep In Contact" people always have their next check-in on the To-Do list.
  const checkIns = checkInOps(model);
  if (checkIns.length) { model = replay(model, checkIns); ops = [...ops, ...checkIns]; }
  state.doc = { ...doc, model, pending: [...doc.pending, ...ops] };
  persistDraft();
  state.announceGroups = true; // only edits announce new company/school dots (not opening a file)
  try { render(); } finally { state.announceGroups = false; }
}

/** Unsaved edits are kept in this browser so a refresh doesn't lose them. */
function persistDraft() {
  // Demo edits are stored with the day they were saved, so their dates can be moved forward next time.
  if (state.mode === "demo") return kvSet("demo-edits", { savedOn: todayIso(), ops: state.doc.pending });
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

/** Edit a company / school dot: type (moves people), website and logo (the Companies sheet). */
async function editOrg(node) {
  const model = state.doc.model;
  const name = node.label.replace(/\s*\(.*$/, "");
  const row = model.companies.find(c => normalizeOrg(c.company) === node.key) ?? {};
  const kind = node.kind === "school" ? "school" : "company";
  const result = await orgForm({ name, kind, website: row.website ?? "", logo: row.logo ?? "", preview: images.forOrg(node).image,
                                 canChangeType: node.kind !== "tag" && !node.target });
  if (!result) return;
  const ops = [{ type: "upsertCompany", company: { company: row.company || name, website: result.website, logo: result.logo } }];
  if (result.kind !== kind) ops.push({ type: "changeOrgKind", name, to: result.kind });
  edit(ops);
  if (result.kind !== kind) focus(`${result.kind}:${node.key}`);
  toast(result.kind !== kind ? `${name} is now a ${result.kind}; people's fields were updated.` : `Saved ${name}.`);
}

async function editPhoto(node) {
  const key = node.id.slice(2);
  const person = state.doc.model.people.find(p => personKey(p) === key);
  if (!person) return;
  try {
    const result = await photoForm({ name: person.name, current: person.photo });
    if (!result) return;
    edit({ type: "patchPerson", key, fields: { photo: result.photo } });
    toast(result.photo ? `Photo saved for ${person.name}.` : `Photo removed for ${person.name}.`);
  } catch (e) {
    console.error(e);
    toast(`Couldn't use that image: ${e.message}`);
  }
}

async function editAll(key) {
  const person = state.doc.model.people.find(p => personKey(p) === key);
  if (!person) return;
  const fields = await personForm({ model: state.doc.model, person });
  if (!fields || !Object.keys(fields).length) return;
  edit({ type: "patchPerson", key, fields });
  followRename(key, fields);
  details.saved();
}

async function removePerson(key, name) {
  const choice = await ask(`Remove ${name}?`,
    `${name} will be taken off your map and out of the People sheet. Their meetings and tasks stay in your workbook.`,
    [{ label: "Cancel", value: "" }, { label: "Remove", value: "remove", danger: true, primary: true }]);
  if (choice !== "remove") return;
  edit({ type: "removePerson", key });
  clearSelection();
  toast(`Removed ${name}.`);
}

// ---- meetings & tasks ------------------------------------------------------------

async function editMeeting(meeting, opts = {}) {
  const model = state.doc.model;
  const result = await meetingForm({ model, meeting, ...opts, calendar: calendars.status(), demo: state.mode === "demo",
                                     download: files.download, canOpen: !!meeting && personOnMap(meeting.person) });
  if (!result) return;
  if (result.action === "open") return openPerson(meeting.person);
  if (result.action === "delete") {
    // Its automatic tasks go with it; ones you've edited only if you say so.
    const { untouched, edited } = meetingTasks(model, meeting);
    let remove = untouched;
    if (edited.length) {
      const n = edited.length;
      const list = el("ul", undefined, { class: "small" });
      for (const t of edited) list.append(el("li", t.task));
      const body = el("div");
      body.append(el("p", `You edited ${n === 1 ? "a task" : `${n} tasks`} made for this meeting:`), list);
      const choice = await ask(`Also remove ${n} related task${n === 1 ? "" : "s"}?`, body,
        [{ label: "Keep them", value: "keep" }, { label: n === 1 ? "Remove it too" : "Remove them too", value: "remove", primary: true }]);
      if (choice === "remove") remove = [...untouched, ...edited];
    }
    edit([{ type: "removeMeeting", id: meeting.id }, ...remove.map(t => ({ type: "removeTask", id: t.id }))]);
    toast(`Meeting deleted${remove.length ? `, with ${remove.length} related task${remove.length === 1 ? "" : "s"}` : ""}.`);
    if (meeting.eventId && calendars.status().provider && state.mode !== "demo") {
      calendars.cancelMeeting(meeting).then(() => toast("Canceled on your calendar; they get a cancellation."))
        .catch(e => toast(`Couldn't cancel on your calendar: ${e.message}`, 8000));
    }
    return;
  }
  const ops = [];
  const person = model.people.find(p => normalizeName(p.name) === normalizeName(result.meeting.person));
  if (result.email && person) ops.push({ type: "patchPerson", key: personKey(person), fields: { email: result.email } });
  if (result.zoomLink) ops.push({ type: "setSettings", settings: { zoomLink: result.zoomLink } });
  // Saving it adds it to the Calendar, sets their status (Scheduled / Met) and adds a "Send thank-you" task.
  ops.push(...meetingOps(model, result.meeting));
  edit(ops);
  const who = result.meeting.person;
  const SENT = { google: `Google Calendar is open with everything filled in. Click Save there to send the invite to ${who}.`,
                 outlook: "Outlook is open with the event filled in. Click Save to send the invite.",
                 "outlook-office": "Outlook is open with the event filled in. Click Save to send the invite.",
                 gmail: "Your Gmail draft is open. Send it when it looks right.", mailto: "Your email app has the message ready.",
                 ics: "Calendar file downloaded. Open it to add the event and send the invite." };
  if (result.sent === "connected") await syncToCalendar(result.meeting);
  else if (result.sent) toast(`Meeting saved. ${SENT[result.sent]}`, 8000);
  else toast(meeting ? "Meeting updated." : result.meeting.date >= todayIso() ? "Meeting saved (no invite sent)." : "Meeting logged.");
}

async function editTask(task, opts = {}) {
  const result = await taskForm({ model: state.doc.model, task, ...opts });
  if (!result) return;
  if (result.action === "delete") { edit({ type: "removeTask", id: task.id }); toast("Task deleted."); return; }
  edit({ type: "upsertTask", task: result.task });
  toast(task ? "Task updated." : "Task added.");
}

function toggleTask(task) {
  edit({ type: "upsertTask", task: { ...task, done: !task.done } });
  if (!task.done) toast(`Done: ${task.task}`);
}

async function openSettings() {
  const result = await settingsForm({ model: state.doc.model, demo: state.mode === "demo", calendar: calendars,
                                     onProfile: () => focus("me"), onReplayIntro: () => playIntro(),
                                     onWelcome: () => welcome() });
  if (!result) return;
  const ops = [{ type: "setSettings", settings: result.settings }];
  if (result.me !== state.doc.model.me) ops.push({ type: "setMe", name: result.me });
  if (result.avatarStyle !== state.doc.model.avatarStyle) ops.push({ type: "setAvatarStyle", style: result.avatarStyle });
  edit(ops);
  toast("Settings saved.");
}

// ---- loading -----------------------------------------------------------------

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

async function loadDemo() {
  const base = await fetchBytes(DEMO_URL);
  const edits = demoEditsForToday(await kvGet("demo-edits"));
  let model = shiftDemoDates(readWorkbook(base)); // keep the demo's meetings and tasks around today
  let pending = edits;
  try { model = replay(model, edits); } catch { pending = []; await kvDelete("demo-edits"); }
  Object.assign(state, { mode: "demo", fileName: "", handle: null, neverSaved: false, selected: null,
                         doc: { model, base, lastModified: null, pending } });
  render();
  addDueCheckIns();
}

/** Opening a map: add any check-in that's now due for "Keep In Contact" people. */
function addDueCheckIns() {
  const ops = checkInOps(state.doc.model);
  if (ops.length) edit(ops);
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
  addDueCheckIns();
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

/** A new, empty map: "Your Name" in the center and a prompt to fill in My profile. */
async function newWorkbook({ quiet = false } = {}) {
  Object.assign(state, { mode: "file", fileName: DEFAULT_NAME, handle: null, neverSaved: true, selected: null,
                         doc: { model: emptyModel(""), base: null, lastModified: null, pending: [] } });
  render();
  showView("map");
  if (!quiet) toast("Your new map is ready. Start with your profile, then add people and targets. Save when you like.", 7000);
}

/** "Start your own": the step-by-step LinkedIn export guide, then a new map with your connections in the Pool. */
async function startOwn() {
  if (unsaved()) {
    const choice = await ask("Unsaved changes", `You have unsaved changes to ${state.fileName}.`,
      [{ label: "Cancel", value: "" }, { label: "Continue without saving", value: "go" }]);
    if (choice !== "go") return;
  }
  const r = await showOnboarding();
  if (!r) return;
  await newWorkbook({ quiet: !!r.files });
  if (r.files) await importExport(r.files);
  else if (r.manual) addPerson();
}

/**
 * Your LinkedIn data export (zip, folder or CSVs) -> a summary with checkboxes -> your pool, profile, targets.
 * In the demo it starts your own map first (the demo stays as it was).
 */
async function importExport(fileList) {
  try {
    const files = await readExportFiles(fileList);
    const r = await importSummary(files, state.mode === "demo" ? emptyModel("") : state.doc.model);
    if (!r) return;
    if (r.empty) return toast("That doesn't look like a LinkedIn export (no Connections.csv, Profile.csv…). Drop the .zip LinkedIn emailed you.", 8000);
    if (state.mode === "demo") await newWorkbook({ quiet: true }); // your own map; the demo stays as it was
    const before = state.doc.model.pool.length;
    const { ops, pool } = exportOps(state.doc.model, r.found, r);
    if (ops.length) edit(ops);
    const added = state.doc.model.pool.length - before;
    const bits = [r.rows.has("connections") && `${r.found.connections.length} connections into your LinkedIn pool` +
                    `${added - pool.pending < r.found.connections.length ? ` (${Math.max(0, added - pool.pending)} new)` : ""}`,
                  pool.pending && `${pool.pending} pending ${pool.pending === 1 ? "invite" : "invites"}`, r.rows.has("profile") && "your profile",
                  r.targets.length && `${r.targets.length} new target${r.targets.length === 1 ? "" : "s"}`].filter(Boolean);
    if (r.rows.has("connections") && r.found.connections.length) showView("pool");
    toast(bits.length ? `Imported ${bits.join(", ")}. Nobody is on the map until you add them.` : "Nothing new to import.", 8000);
  } catch (e) {
    console.error(e);
    toast(`Couldn't read that export: ${e.message}`, 8000);
  }
}

/** Menu: import your LinkedIn export (choose the zip, folder or CSVs, or drop them). */
async function chooseExport() {
  const body = el("div", undefined, { class: "form" });
  const drop = el("div", undefined, { class: "drop-zone onboarding-drop small-drop" });
  let picked = null;
  const done = files => { picked = files; $("dialog").close("picked"); };
  drop.append(el("strong", "Drop your LinkedIn export here"), el("span", "the .zip, the unzipped folder, or CSV files", { class: "muted small" }),
              exportPickers(files => { if (files.length) done([...files]); }));
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("drop", async e => { e.preventDefault(); const files = await filesFromDrop(e.dataTransfer); if (files.length) done(files); });
  body.append(drop, el("p", "On LinkedIn: Me → Settings & Privacy → Data privacy → Get a copy of your data → Download larger data archive.",
                       { class: "muted small" }));
  const v = await ask("Import your LinkedIn export", body, [{ label: "Cancel", value: "" }]);
  if (v === "picked" && picked) await importExport(picked);
}

async function welcome() {
  const choice = await showWelcome();
  if (choice === "start") await startOwn();
  else if (choice === "demo" && state.mode !== "demo") await loadDemo();
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

// ---- export to Excel ------------------------------------------------------------

/** What "This view" means right now: { label, scope } or null. */
function viewScope() {
  const model = state.doc.model;
  if (state.view === "map") {
    if (!state.selected) return { label: `Everyone on the map (${model.people.length})`, scope: { kind: "people", names: model.people.map(p => p.name) } };
    const ids = neighborhood(state.graph, state.selected).nodes;
    const names = model.people.filter(p => ids.has(`p:${personKey(p)}`)).map(p => p.name);
    return names.length ? { label: `The ${names.length} highlighted ${names.length === 1 ? "person" : "people"}`, scope: { kind: "people", names } } : null;
  }
  if (state.view === "people") {
    const names = peopleView.visible();
    return { label: `The ${names.length} people in this table`, scope: { kind: "people", names } };
  }
  if (state.view === "pool") {
    const entries = pool.visible();
    return { label: `${pool.filtered() ? "Filtered" : "All"} LinkedIn connections (${entries.length})`, scope: { kind: "pool", entries } };
  }
  if (state.view === "todo") {
    const tasks = model.tasks.filter(t => !t.done);
    return { label: `Open tasks (${tasks.length})`, scope: { kind: "tasks", tasks } };
  }
  const { from, to, label } = calendar.visibleRange();
  const meetings = model.meetings.filter(m => m.date >= from && m.date <= to);
  return { label: `Meetings in ${label} (${meetings.length})`, scope: { kind: "meetings", meetings } };
}

async function exportOfflineMap() {
  if (state.view !== "map") showView("map");
  toast("Building your offline map…");
  const { offlineMapHtml } = await import("./ui/offlineMap.js");
  const people = Object.fromEntries(state.graph.nodes.filter(n => n.id.startsWith("p:"))
    .map(n => [n.id, { role: n.role, company: n.company, status: n.status }]));
  const html = await offlineMapHtml({ network: map.network, title: $("title").textContent, people, dark: isDark() });
  const name = `Orbit-map-${todayIso()}.html`;
  files.download(new TextEncoder().encode(html), name, "text/html");
  toast(`Saved ${name}. It has ${state.mode === "demo" ? "the fictional demo" : "your"} data in it, so share it only with people you trust.`, 8000);
}

function runExport(scope) {
  closeExportMenu();
  if (scope.kind === "offline") { exportOfflineMap().catch(e => { console.error(e); toast(`Couldn't build the offline map: ${e.message}`, 8000); }); return; }
  try {
    const out = exportWorkbook(state.doc.model, scope);
    files.download(out.bytes, out.name);
    toast(`Exported ${out.what} to ${out.name}${state.mode === "demo" ? " (fictional demo data)" : ""}.`);
  } catch (e) {
    console.error(e);
    toast(`Couldn't export: ${e.message}`, 8000);
  }
}

const exportMenu = $("export-menu"), exportBtn = $("export-btn");
if (!/Mac|iPhone|iPad/.test(navigator.platform)) exportBtn.querySelector("kbd").textContent = "Ctrl+E";
function openExportMenu() {
  const view = viewScope();
  const person = state.selected?.startsWith("p:") ? state.doc.model.people.find(p => `p:${personKey(p)}` === state.selected) : null;
  const item = (title, sub, scope) => {
    const b = el("button", undefined, { role: "menuitem", type: "button", disabled: !scope, onclick: () => runExport(scope) });
    b.append(title, el("small", sub));
    return b;
  };
  exportMenu.replaceChildren(
    item("Everything", "People (tracker columns), Experience, Education, Connections, Targets, Meetings, Tasks", { kind: "all" }),
    item("This view", view?.label ?? "Nothing highlighted", view?.scope),
    item("One person", person ? person.name : "Open someone's details first", person ? { kind: "people", names: [person.name] } : null),
    item("Offline map (.html)", "The map as you see it, in one file that opens anywhere without internet", { kind: "offline" }),
  );
  exportMenu.hidden = false;
  exportBtn.setAttribute("aria-expanded", "true");
  exportMenu.querySelector("button")?.focus();
}
function closeExportMenu() {
  exportMenu.hidden = true;
  exportBtn.setAttribute("aria-expanded", "false");
}
exportBtn.addEventListener("click", e => { e.stopPropagation(); exportMenu.hidden ? openExportMenu() : closeExportMenu(); });
document.addEventListener("click", e => { if (!exportMenu.contains(e.target)) closeExportMenu(); });
exportMenu.addEventListener("keydown", e => {
  const items = [...exportMenu.querySelectorAll("button:not(:disabled)")];
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
  if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  if (e.key === "Escape") { closeExportMenu(); exportBtn.focus(); }
});

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

const ACTIONS = { open: openFile, reopen, new: () => newWorkbook(), template: downloadTemplate, download: downloadCopy,
                  backups: showBackups, settings: openSettings, demo: loadDemo, importPool: () => chooseExport(), save,
                  export: () => setTimeout(openExportMenu, 0), start: startOwn };
// These don't leave the current file (startOwn asks about unsaved changes itself).
const SAFE_ACTIONS = ["download", "backups", "template", "settings", "importPool", "save", "export", "start"];
menu.addEventListener("click", async e => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  closeMenu();
  if (!SAFE_ACTIONS.includes(action) && unsaved()) {
    const choice = await ask("Unsaved changes", `You have unsaved changes to ${state.fileName}.`,
      [{ label: "Cancel", value: "" }, { label: "Continue without saving", value: "go" }]);
    if (choice !== "go") return;
  }
  try { await ACTIONS[action](); } catch (err) { console.error(err); toast(err.message, 8000); }
});

$("save").addEventListener("click", save);
$("add-target").addEventListener("click", () => addTarget());
// Who can introduce you at each target, as a Markdown file you can keep or share.
$("intro-report").addEventListener("click", async () => {
  const model = state.doc.model;
  if (!model.targets.length) return toast("Add a target company first.");
  const { introReport } = await import("./core/intro.js");
  const text = introReport(model.people, model.targets.map(t => t.company), model.me || "You");
  files.download(new TextEncoder().encode(text), `Orbit-intro-report-${todayIso()}.md`, "text/markdown");
  toast(`Saved your intro report for ${model.targets.length} target${model.targets.length === 1 ? "" : "s"}.`);
});
$("add-person").addEventListener("click", () => addPerson());
const typing = t => t.closest?.("input, textarea, select, [contenteditable]");
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && state.mode === "file") { e.preventDefault(); save(); }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e" && !$("dialog").open) {
    e.preventDefault();
    exportMenu.hidden ? openExportMenu() : closeExportMenu();
  }
  if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target) && !$("dialog").open) {
    e.preventDefault();
    addPerson();
  }
  if (e.key === "Escape" && !$("dialog").open) {
    if (!exportMenu.hidden) closeExportMenu();
    else if (!menu.hidden) closeMenu();
    else if (state.selected || details.openId) clearSelection();
  }
});

// Search anything: a short list of matches that says which field matched ("Skills · SQL").
const searchBox = $("search"), results = $("search-results");
function renderSearch() {
  const hits = searchMap(state.graph, state.doc.model.people, searchBox.value);
  results.replaceChildren(...hits.map((h, i) => {
    const li = el("li", undefined, { role: "option", tabIndex: -1, class: i === 0 ? "active" : "",
      onmousedown: ev => { ev.preventDefault(); pickSearch(h); } });
    li.append(el("strong", h.label), el("span", h.value ? ` · ${h.field}: ${h.value}` : ` · ${h.field}`, { class: "muted small" }));
    return li;
  }));
  if (searchBox.value.trim() && !hits.length) results.append(el("li", "No matches on your map.", { class: "muted small empty" }));
  results.hidden = !searchBox.value.trim();
  results.hits = hits;
}
function pickSearch(h) {
  results.hidden = true;
  focus(h.id);
}
searchBox.addEventListener("input", renderSearch);
searchBox.addEventListener("blur", () => setTimeout(() => { results.hidden = true; }, 120));
searchBox.addEventListener("focus", () => { if (searchBox.value.trim()) renderSearch(); });
searchBox.addEventListener("keydown", e => {
  const items = [...results.querySelectorAll("li[role=option]")];
  const i = items.findIndex(li => li.classList.contains("active"));
  const move = d => { items.forEach(li => li.classList.remove("active")); items[(i + d + items.length) % items.length]?.classList.add("active"); };
  if (e.key === "ArrowDown" && items.length) { e.preventDefault(); move(1); }
  else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); move(-1); }
  else if (e.key === "Escape") { results.hidden = true; }
  else if (e.key === "Enter") {
    e.preventDefault();
    if (!searchBox.value.trim()) return;
    if (!results.hits) renderSearch();
    const h = results.hits?.[Math.max(0, i)];
    if (h) pickSearch(h); else toast(`No one on the map matches “${searchBox.value.trim()}”.`);
  }
});

$("show2").addEventListener("change", e => map.set({ showSecond: e.target.checked }));
$("show-alumni").addEventListener("change", e => map.set({ showAlumni: e.target.checked }));

// Drop a LinkedIn profile PDF straight onto the map to add them.
{
  const wrap = $("map-wrap"), overlay = $("drop-overlay");
  const hasFiles = e => [...(e.dataTransfer?.types ?? [])].includes("Files");
  let depth = 0;
  wrap.addEventListener("dragenter", e => { if (hasFiles(e)) { depth++; overlay.hidden = false; } });
  wrap.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  wrap.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; overlay.hidden = true; } });
  wrap.addEventListener("drop", async e => {
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const files = await filesFromDrop(e.dataTransfer);
    const pdf = files.find(isPdf);
    if (pdf && files.length === 1) addPerson({ pdf });
    else if (files.some(isExportFile)) importExport(files);
    else toast("Drop someone's LinkedIn profile PDF (More → Save to PDF), or your LinkedIn data export (.zip or folder).");
  });
}
$("fit").addEventListener("click", () => map.fit());

// Re-arrange: forget dragged positions and lay the map out again.
$("rearrange").addEventListener("click", () => {
  const had = Object.keys(state.doc.model.layout ?? {}).length;
  if (had) edit({ type: "clearLayout" });
  map.rearrange();
  toast(had ? "Re-arranged. Your dragged positions were cleared." : "Re-arranged.");
});

// System / Light / Dark (remembered in this browser). The map redraws with the new colors.
const THEME_LABEL = { system: ["◐", "System"], light: ["☀", "Light"], dark: ["☾", "Dark"] };
function renderThemeButton() {
  const [icon, label] = THEME_LABEL[themeMode()];
  const btn = $("theme-btn");
  btn.textContent = icon;
  btn.setAttribute("aria-label", `Theme: ${label}${themeMode() === "system" ? ` (${isDark() ? "dark" : "light"} now)` : ""}. Click to change.`);
  btn.title = `Theme: ${label}. Click for ${THEME_LABEL[nextThemeMode()][1]}.`;
}
$("theme-btn").addEventListener("click", () => { setTheme(nextThemeMode()); toast(`Theme: ${THEME_LABEL[themeMode()][1]}`); });
onThemeChange(() => { renderThemeButton(); map.refresh(); if (state.doc) renderViews(); });
renderThemeButton();
$("illustrated").addEventListener("change", e => edit({ type: "setAvatarStyle", style: e.target.checked ? "notionists" : "initials" }));

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

let markDemoReady;
const demoReady = new Promise(r => { markDemoReady = r; });

// Welcome intro on the first visit (the app keeps loading behind it). ?intro=2.6 freezes it at 2.6 s.
{
  const freeze = new URLSearchParams(location.search).get("intro");
  if (freeze !== null) playIntro({ freezeAt: Number(freeze) || 0 });
  else {
    // First visit: the intro, then the Welcome card (See the demo / Start your own).
    const intro = introSeen() ? Promise.resolve() : playIntro();
    if (!welcomeSeen()) Promise.all([intro, demoReady]).then(() => welcome());
  }
}

(async () => {
  const layout = pref(PREFS.layout, "ring") === "free" ? "free" : "ring"; // Ring unless you picked Free
  layoutButtons.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.layout === layout)));
  map.set({ layout });
  try {
    await loadDemo();
    markDemoReady();
  } catch (e) {
    console.error(e);
    toast(`Couldn't load the demo: ${e.message}`, 10000);
    return;
  }
  const handle = await kvGet("last-handle");
  if (handle?.getFile) { state.lastHandle = handle; renderChrome(); }
  showView(pref(PREFS.view, "map"));
})();
