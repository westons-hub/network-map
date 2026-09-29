// Orbit: app wiring. The demo loads by default; "Use my own data" opens a
// workbook or a LinkedIn CSV. Everything happens in this browser tab.

import { buildGraph } from "./core/graph.js";
import { replay } from "./core/ops.js";
import { normalizeName, normalizeOrg } from "./core/org.js";
import { bestPath } from "./core/paths.js";
import { parseCsv, parseLinkedInCsv, personKey } from "./core/people.js";
import { demoEditsForToday, meetingOps, shiftDemoDates, taskBadge, todayIso } from "./core/schedule.js";
import { saveDoc } from "./core/sync.js";
import { emptyModel, readPeopleCsvRows, readWorkbook, writeWorkbook } from "./core/workbook.js";
import * as files from "./store/files.js";
import { addBackup, kvDelete, kvGet, kvSet, listBackups } from "./store/local.js";
import { createCalendar } from "./ui/calendar.js";
import { createDetails } from "./ui/details.js";
import { ask, toast } from "./ui/dialog.js";
import {
  companySuggestions, inviteDialog, meetingForm, personForm, photoForm, settingsForm, targetForm, taskForm,
} from "./ui/forms.js";
import { createImages } from "./ui/images.js";
import { createMap } from "./ui/map.js";
import { el, renderOverview, renderTargets } from "./ui/panels.js";
import { createTodo } from "./ui/todo.js";
import { buildSuggestions } from "./core/suggest.js";
import { setSuggestionSource } from "./ui/typeahead.js";
import { introSeen, playIntro } from "./ui/intro.js";
import * as calendars from "./store/calendars.js";
import { addPersonFlow, peopleFromPool } from "./ui/addPerson.js";
import { isPdf } from "./ui/pdf.js";
import { createPoolView } from "./ui/poolView.js";

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
});

const details = createDetails({
  sidebar: $("sidebar"),
  getCtx: () => ({ graph: state.graph, model: state.doc.model, paths: state.paths, images, mode: state.mode }),
  handlers: {
    close: clearSelection,
    focus,
    patchPerson: (key, fields) => { edit({ type: "patchPerson", key, fields }); followRename(key, fields); details.saved(); },
    setProfile: fields => { edit({ type: "setProfile", fields }); details.saved(); },
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
    removePerson,
    scheduleMeeting: opts => editMeeting(null, opts),
    editMeeting: m => editMeeting(m),
    inviteMeeting: m => meetingActions(m),
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
      if (m) meetingActions(m);
    } else {
      const t = state.doc.model.tasks.find(x => x.id === item.id);
      if (t) editTask(t);
    }
  },
  onMove: (id, date, start, end) => moveMeeting(id, date, start, end),
});

const pool = createPoolView($("pool-view"), {
  getModel: () => state.doc.model,
  onImport: () => importPool(),
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

function meetingActions(m) {
  const provider = calendars.status().provider;
  const synced = m.eventId && provider && m.eventId.startsWith(`${provider}:`)
    ? `On your ${provider === "google" ? "Google Calendar" : "Outlook calendar"} (synced).` : "";
  return inviteDialog({ model: state.doc.model, meeting: m, download: files.download, synced,
                        onOpen: personOnMap(m.person) ? () => openPerson(m.person) : undefined,
                        onEdit: () => editMeeting(m) });
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

async function addPerson({ pdf, entry } = {}) {
  const result = await addPersonFlow({ model: state.doc.model, demo: state.mode === "demo", pdf, entry });
  if (!result) return;
  if (result.open) return openPerson(result.open);
  const { person: { links = [], ...person }, existingKey } = result;
  const people = state.doc.model.people;
  const known = name => people.find(p => normalizeName(p.name) === normalizeName(name))?.name ?? name;
  edit([{ type: "upsertPerson", key: existingKey, person: { ...person, connectedThrough: person.connectedThrough ? known(person.connectedThrough) : "",
                                                             source: person.source || "excel" } },
        ...links.map(l => ({ type: "addConnection", connection: { a: person.name, b: known(l.other), type: l.type } }))]);
  focus(`p:${normalizeName(person.name)}`, { follow: !existingKey });
  toast(existingKey ? `Updated ${person.name}.` : `Added ${person.name} to your map.`);
}

function addMany(entries) {
  const people = peopleFromPool(state.doc.model, entries);
  if (!people.length) return toast("Everyone selected is already on your map.");
  edit(people.map(person => ({ type: "upsertPerson", person })));
  toast(`Added ${people.length} ${people.length === 1 ? "person" : "people"} to your map.`);
}

async function importPool() {
  const picked = await files.pickFile();
  if (!picked) return;
  if (!/\.csv$/i.test(picked.name)) return toast("Choose the Connections.csv from your LinkedIn data export.");
  try {
    const { mergePool } = await import("./core/pool.js");
    const entries = parseLinkedInCsv(new TextDecoder().decode(picked.bytes), picked.name);
    const { added, updated } = mergePool(state.doc.model.pool, entries);
    edit({ type: "mergePool", entries });
    showView("pool");
    toast(`Imported ${entries.length} connections: ${added} new, ${updated} updated, no duplicates. They stay off the map until you add them.`, 7000);
  } catch (e) {
    toast(e.message, 8000);
  }
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
  const me = model.me || "You";
  state.graph = buildGraph(model.people, { me, profile: model.profile, connections: model.connections, targets: model.targets });
  state.paths = new Map(state.graph.targets.map(t => [t.key, bestPath(state.graph, model.people, t, me)]));
  if (state.selected && !state.graph.nodes.some(n => n.id === state.selected)) { state.selected = null; details.close(); }
  images.configure({ companies: model.companies, guessDomains: state.mode !== "demo", avatarStyle: model.avatarStyle });
  map.render(state.graph, model.layout);
  renderSidebar();
  renderChrome();
  renderViews();
  details.render();
}

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
}

// Map | Calendar | To-Do tabs (the choice is remembered in this browser).
const tabs = [...document.querySelectorAll(".view-tabs [data-view]")];
function showView(view) {
  state.view = ["map", "calendar", "todo", "pool"].includes(view) ? view : "map";
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
  } else banner.hidden = true;

  const reopenItem = document.querySelector('[data-action="reopen"]');
  reopenItem.hidden = !state.lastHandle || state.mode === "file";
  reopenItem.textContent = state.lastHandle ? `Reopen ${state.lastHandle.name}` : "";
  document.querySelector('[data-action="demo"]').hidden = state.mode === "demo";
}

// ---- edits -------------------------------------------------------------------

/** Apply one edit (or several at once, e.g. a meeting plus its status change and task). */
function edit(opOrOps) {
  const ops = Array.isArray(opOrOps) ? opOrOps : [opOrOps];
  if (!ops.length) return;
  const doc = state.doc;
  state.doc = { ...doc, model: replay(doc.model, ops), pending: [...doc.pending, ...ops] };
  persistDraft();
  render();
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
  const result = await meetingForm({ model, meeting, ...opts });
  if (!result) return;
  if (result.action === "delete") {
    edit({ type: "removeMeeting", id: meeting.id });
    toast("Meeting deleted.");
    if (meeting.eventId && calendars.status().provider && state.mode !== "demo") {
      calendars.cancelMeeting(meeting).then(() => toast("Canceled on your calendar; they get a cancellation."))
        .catch(e => toast(`Couldn't cancel on your calendar: ${e.message}`, 8000));
    }
    return;
  }
  const ops = [];
  const person = model.people.find(p => normalizeName(p.name) === normalizeName(result.meeting.person));
  if (result.email && person) ops.push({ type: "patchPerson", key: personKey(person), fields: { email: result.email } });
  ops.push(...meetingOps(model, result.meeting));
  edit(ops);
  const upcoming = result.meeting.date >= todayIso();
  // Connected calendar: create/update the event there (it sends the invite). Otherwise offer the links.
  if (upcoming && (await syncToCalendar(result.meeting))) return;
  if (upcoming && !meeting) {
    const choice = await ask("Meeting saved", `Add it to your calendar and invite ${result.meeting.person}?`,
      [{ label: "Not now", value: "" }, { label: "Add to calendar & invite…", value: "invite", primary: true }]);
    if (choice === "invite") await meetingActions(state.doc.model.meetings.find(x => x.id === result.meeting.id) ?? result.meeting);
  } else toast(meeting ? "Meeting updated." : "Meeting logged.");
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
                                     onProfile: () => focus("me"), onReplayIntro: () => playIntro() });
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
                  backups: showBackups, settings: openSettings, demo: loadDemo, importPool };
const SAFE_ACTIONS = ["download", "backups", "template", "settings", "importPool"]; // don't leave the current file
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
$("add-person").addEventListener("click", () => addPerson());
const typing = t => t.closest?.("input, textarea, select, [contenteditable]");
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && state.mode === "file") { e.preventDefault(); save(); }
  if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target) && !$("dialog").open) {
    e.preventDefault();
    addPerson();
  }
  if (e.key === "Escape" && !$("dialog").open) {
    if (!menu.hidden) closeMenu();
    else if (state.selected || details.openId) clearSelection();
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
$("show-alumni").addEventListener("change", e => map.set({ showAlumni: e.target.checked }));

// Drop a LinkedIn profile PDF straight onto the map to add them.
{
  const wrap = $("map-wrap"), overlay = $("drop-overlay");
  const hasFiles = e => [...(e.dataTransfer?.types ?? [])].includes("Files");
  let depth = 0;
  wrap.addEventListener("dragenter", e => { if (hasFiles(e)) { depth++; overlay.hidden = false; } });
  wrap.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  wrap.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; overlay.hidden = true; } });
  wrap.addEventListener("drop", e => {
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const file = [...e.dataTransfer.files].find(isPdf);
    if (file) addPerson({ pdf: file });
    else toast("Drop a PDF of their LinkedIn profile (on their profile: More → Save to PDF).");
  });
}
$("fit").addEventListener("click", () => map.fit());
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

// Welcome intro on the first visit (the app keeps loading behind it). ?intro=2.6 freezes it at 2.6 s.
{
  const freeze = new URLSearchParams(location.search).get("intro");
  if (freeze !== null) playIntro({ freezeAt: Number(freeze) || 0 });
  else if (!introSeen()) playIntro();
}

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
  showView(pref(PREFS.view, "map"));
})();
