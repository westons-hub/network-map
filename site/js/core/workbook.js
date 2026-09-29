// The Excel workbook is the database. This module converts between workbook
// bytes and a plain model, and back. It uses SheetJS, so it runs the same in the
// browser and in Node tests.
//
// Model: { me, profile, avatarStyle, settings, people, connections, targets, companies, pool, meetings, tasks, layout, notices }
//
// Sheets you add yourself (and extra columns on ours) are kept when saving.
// Old files (a "Contacts" sheet, Targets with only Company/Notes) are migrated.

import * as XLSX from "../../vendor/xlsx.mjs";
import { clean } from "./org.js";
import { CONNECTION_TYPES, makeConnection, reconcile } from "./connections.js";
import { DERIVED_COLUMNS, OWN_TRACKER_COLUMNS, REFERRAL, RELATIONSHIP_PLANS, TRACKER_HEADERS, trackerCells } from "./tracker.js";
import { polishXlsx } from "./xlsxPolish.js";
import { POOL_COLUMNS, STATUSES, makePerson, parseDate, poolEntry } from "./people.js";

export const SHEETS = { people: "People", targets: "Targets", companies: "Companies", pool: "LinkedIn Pool",
                        meetings: "Meetings", tasks: "Tasks", connections: "Connections", experience: "Experience",
                        education: "Education", me: "Me", layout: "Layout",
                        settings: "Settings" };
export const CONNECTION_COLUMNS = [["Person A", "a"], ["Person B", "b"], ["Type", "type"], ["Notes", "notes"]];

// The Me sheet: your own profile, one "Field | Value" row each (Name is kept in sync with Settings → Your name).
export const PROFILE_ROWS = [["Photo", "photo"], ["Role", "role"], ["Headline", "headline"], ["Company", "company"],
  ["Schools", "school"], ["Past Companies", "pastCompanies"], ["Email", "email"], ["LinkedIn URL", "linkedinUrl"],
  ["Location", "location"], ["What I'm looking for", "lookingFor"]];
export const emptyProfile = () => Object.fromEntries(PROFILE_ROWS.map(([, f]) => [f, ""]));

// [column header, model field]. Headers are matched case-insensitively.
export const PEOPLE_COLUMNS = [["Name", "name"], ["Company", "company"], ["Schools", "school"], ["Role", "role"],
  ["Email", "email"], ["LinkedIn URL", "linkedinUrl"], ["Photo", "photo"],
  ["Connected Through", "connectedThrough"], ["Connected On", "connectedOn"], ["Status", "status"],
  ["Tags", "tags"], ["Notes", "notes"], ["Past Companies", "pastCompanies"],
  // From a LinkedIn profile PDF:
  ["Headline", "headline"], ["Location", "location"], ["Website", "website"], ["Skills", "skills"], ["Languages", "languages"],
  ["Certifications", "certifications"], ["Honors", "honors"], ["About", "about"]];
// One row per job / school (from LinkedIn profile PDFs); shown as a timeline in the person's details.
export const EXPERIENCE_COLUMNS = [["Person", "person"], ["Company", "company"], ["Title", "title"], ["Start", "start"],
  ["End", "end"], ["Location", "location"], ["Description", "description"]];
export const EDUCATION_COLUMNS = [["Person", "person"], ["School", "school"], ["Degree", "degree"], ["Field", "field"],
  ["Start", "start"], ["End", "end"]];
const PEOPLE_ALIASES = { "email address": "email", "url": "linkedinUrl", "linkedin": "linkedinUrl", "role / background": "role",
                         "title": "role", "position": "role", "school": "school", "past company": "pastCompanies" };
export const TARGET_COLUMNS = [["Company", "company"], ["Priority", "priority"], ["Stage", "stage"], ["Notes", "notes"]];
export const COMPANY_COLUMNS = [["Company", "company"], ["Website", "website"], ["Logo", "logo"]];
export const STAGES = ["Researching", "Networking", "Applied", "Interviewing", "Offer"];
export const PRIORITIES = ["1", "2", "3"];

export const AVATAR_STYLES = ["initials", "notionists"];

// Meetings: the spec's columns first, then the meeting link and a stable ID the app uses for edits.
export const MEETING_COLUMNS = [["Person", "person"], ["Date", "date"], ["Start", "start"], ["End", "end"],
  ["Type", "type"], ["Method", "method"], ["Notes", "notes"], ["Next Step", "nextStep"],
  ["Calendar Event ID", "eventId"], ["Link", "link"], ["ID", "id"],
  // From the Google-Calendar-style editor:
  ["Title", "title"], ["Guests", "guests"], ["Location", "location"], ["Description", "description"],
  ["Reminder (min)", "reminder"], ["Time Zone", "timeZone"]];
export const TASK_COLUMNS = [["Task", "task"], ["Person", "person"], ["Company", "company"], ["Due", "due"],
  ["Done", "done"], ["Created", "created"], ["Source", "source"], ["ID", "id"]];
export const MEETING_TYPES = ["Coffee Chat", "Informational", "Networking Event", "Class/Club", "Interview", "Other"];
export const METHODS = ["Zoom", "Google Meet", "Teams", "Phone", "In Person", "Email", "LinkedIn"];

export const DEFAULT_INVITE = "Hi {first name}, looking forward to our chat on {date} at {time}. {link}";
// [row label on the Settings sheet, settings field, default]
const SETTING_ROWS = [["Your email", "email", ""], ["Meeting length (minutes)", "meetingLength", 30],
  ["Zoom link", "zoomLink", ""], ["Check-in every (days)", "checkInDays", 60],
  ["Invite message", "inviteTemplate", DEFAULT_INVITE], ["Group size (people)", "groupSize", 3], ["Group by", "groupBy", "company, school"], ["Demo base date", "demoBaseDate", ""]];

export const defaultSettings = () => Object.fromEntries(SETTING_ROWS.map(([, f, d]) => [f, d]));

export function emptyModel(me = "") {
  return { me, profile: emptyProfile(), avatarStyle: "initials", settings: defaultSettings(), people: [], connections: [], targets: [],
           companies: [], pool: [], experience: [], education: [],
           meetings: [], tasks: [], layout: {}, notices: [] };
}

const lower = s => clean(s).toLowerCase();

function findSheet(wb, name) {
  const real = wb.SheetNames.find(s => lower(s) === lower(name));
  return real ? { name: real, rows: rowsOf(wb.Sheets[real]) } : null;
}

/** Sheet -> array of {header: value}. Dates stay Date objects; blank cells are "". */
function rowsOf(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
  // A cell that shows a label ("Profile") but links to a web page stands for the link itself.
  if (!ws?.["!ref"]) return rows;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c++) headers[c] = ws[XLSX.utils.encode_cell({ r: range.s.r, c })]?.v;
  for (const [addr, cell] of Object.entries(ws)) {
    if (addr[0] === "!" || !/^https?:\/\//i.test(cell?.l?.Target ?? "") || /^https?:\/\//i.test(String(cell.v ?? ""))) continue;
    const { r, c } = XLSX.utils.decode_cell(addr);
    const row = rows[r - range.s.r - 1];
    if (row && headers[c] !== undefined && String(headers[c]) in row) row[headers[c]] = cell.l.Target;
  }
  return rows;
}

/** Split a record into known fields (by column spec) and extra columns to carry along. */
function pick(rec, columns, aliases = {}) {
  const known = {};
  const extra = {};
  const byHeader = Object.fromEntries(columns.map(([h, f]) => [h.toLowerCase(), f]));
  for (const [h, v] of Object.entries(rec)) {
    if (h.startsWith("__EMPTY")) continue; // unnamed columns
    const f = byHeader[lower(h)] ?? aliases[lower(h)];
    if (f) { if (!known[f]) known[f] = v; }
    else if (clean(v)) extra[clean(h)] = v instanceof Date ? parseDate(v) : String(v);
  }
  return { known, extra };
}

const text = v => (v instanceof Date ? parseDate(v) : clean(v));
const isTrue = v => v === true || /^(true|yes|y|x|done|1|✓)$/i.test(clean(v));

/** Workbook bytes (ArrayBuffer / Uint8Array) -> model. */
export function readWorkbook(bytes) {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const model = emptyModel();

  // ---- People (migrates old "Contacts" sheets) ----
  let people = findSheet(wb, SHEETS.people);
  if (!people) {
    people = findSheet(wb, "Contacts")
      ?? wb.SheetNames.map(n => ({ name: n, rows: rowsOf(wb.Sheets[n]) }))
           .find(s => !Object.values(SHEETS).some(x => lower(x) === lower(s.name))
                      && lower(s.name) !== "how to use"
                      && XLSX.utils.sheet_to_json(wb.Sheets[s.name], { header: 1 })[0]?.some(h => lower(h) === "name"));
    if (people) model.notices.push(`Updated an older file: the "${people.name}" sheet is now "People".`);
  }
  // In an Orbit export, the tracker's derived columns (Meeting Date, Next Steps…) come back from the Meetings,
  // Tasks and Connections sheets, so their copies on People are skipped.
  const isExport = !!findSheet(wb, SHEETS.meetings) && (people?.rows[0] ? DERIVED_COLUMNS.some(h => h in people.rows[0]) : false);
  for (const rec of people?.rows ?? []) {
    if (isExport) for (const h of DERIVED_COLUMNS) delete rec[h];
    const { known, extra } = pick(rec, PEOPLE_COLUMNS, PEOPLE_ALIASES);
    if (!clean(known.name)) continue;
    model.people.push(makePerson({ ...known, extra, source: "excel" }));
  }

  // ---- Targets ----
  const targets = findSheet(wb, SHEETS.targets);
  for (const rec of targets?.rows ?? []) {
    const { known, extra } = pick(rec, TARGET_COLUMNS);
    // Old files may name the first column something else; fall back to it.
    const company = text(known.company || Object.values(rec)[0]);
    if (!company) continue;
    model.targets.push({ company, priority: text(known.priority), stage: text(known.stage),
                         notes: text(known.notes), extra });
  }

  // ---- Companies ----
  for (const rec of findSheet(wb, SHEETS.companies)?.rows ?? []) {
    const { known, extra } = pick(rec, COMPANY_COLUMNS);
    if (text(known.company)) {
      model.companies.push({ company: text(known.company), website: text(known.website),
                             logo: String(known.logo ?? "").trim(), extra });
    }
  }

  // ---- LinkedIn Pool ----
  for (const rec of findSheet(wb, SHEETS.pool)?.rows ?? []) {
    const e = poolEntry(rec);
    if (e.firstName || e.lastName) model.pool.push(e);
  }

  // ---- Layout ----
  for (const rec of findSheet(wb, SHEETS.layout)?.rows ?? []) {
    const id = clean(rec.Node), x = Number(rec.X), y = Number(rec.Y);
    if (id && Number.isFinite(x) && Number.isFinite(y)) model.layout[id] = { x, y };
  }

  // ---- Meetings & Tasks ----
  const time = v => (v instanceof Date ? `${String(v.getHours()).padStart(2, "0")}:${String(v.getMinutes()).padStart(2, "0")}`
    : clean(v).replace(/^(\d):/, "0$1:"));
  findSheet(wb, SHEETS.meetings)?.rows.forEach((rec, i) => {
    const { known, extra } = pick(rec, MEETING_COLUMNS);
    if (!text(known.person) && !text(known.date)) return;
    model.meetings.push({ id: text(known.id) || `m-row${i + 2}`, person: text(known.person), date: text(known.date),
      start: time(known.start), end: time(known.end), type: text(known.type), method: text(known.method),
      notes: String(known.notes ?? "").trim(), nextStep: text(known.nextStep), eventId: text(known.eventId),
      link: text(known.link), extra,
      // The editor's optional fields, only when set (older files don't have them).
      ...Object.fromEntries(["title", "guests", "location", "description", "reminder", "timeZone"]
        .map(f => [f, f === "description" ? String(known[f] ?? "").trim() : text(known[f])]).filter(([, v]) => v)) });
  });
  findSheet(wb, SHEETS.tasks)?.rows.forEach((rec, i) => {
    const { known, extra } = pick(rec, TASK_COLUMNS);
    if (!text(known.task)) return;
    model.tasks.push({ id: text(known.id) || `t-row${i + 2}`, task: text(known.task), person: text(known.person),
      company: text(known.company), due: text(known.due), done: isTrue(known.done), created: text(known.created),
      source: text(known.source), extra });
  });

  // ---- Connections (the old Connected Through column migrates in; see core/connections.js) ----
  for (const rec of findSheet(wb, SHEETS.connections)?.rows ?? []) {
    const { known, extra } = pick(rec, CONNECTION_COLUMNS);
    if (text(known.a) && text(known.b)) model.connections.push(makeConnection({ ...known, extra }));
  }
  reconcile(model);

  // ---- Experience & Education ----
  // Start/End stay text ("2021-03", "2019", "Present"); Excel may turn "2021-03" into a date, so read those back.
  const monthText = v => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}` : text(v));
  for (const [sheet, columns, list, required] of [[SHEETS.experience, EXPERIENCE_COLUMNS, model.experience, "company"],
                                                  [SHEETS.education, EDUCATION_COLUMNS, model.education, "school"]]) {
    for (const rec of findSheet(wb, sheet)?.rows ?? []) {
      const { known, extra } = pick(rec, columns);
      if (!text(known.person) || !text(known[required])) continue;
      const row = { extra };
      for (const [, f] of columns) row[f] = f === "start" || f === "end" ? monthText(known[f]) : f === "description" ? String(known[f] ?? "").trim() : text(known[f]);
      list.push(row);
    }
  }

  // ---- Me (your profile) ----
  for (const rec of findSheet(wb, SHEETS.me)?.rows ?? []) {
    const label = lower(rec.Field);
    const row = PROFILE_ROWS.find(([l]) => lower(l) === label);
    if (row) model.profile[row[1]] = row[1] === "lookingFor" ? String(rec.Value ?? "").trim() : text(rec.Value);
    if (label === "name" && text(rec.Value)) model.meFromProfile = text(rec.Value);
  }

  // ---- Settings ----
  for (const rec of findSheet(wb, SHEETS.settings)?.rows ?? []) {
    const row = SETTING_ROWS.find(([label]) => lower(label) === lower(rec.Setting));
    if (row) {
      const [, field, fallback] = row;
      model.settings[field] = typeof fallback === "number"
        ? (Number(rec.Value) > 0 ? Number(rec.Value) : fallback)
        : field === "inviteTemplate" ? String(rec.Value ?? "").trim() || fallback : text(rec.Value);
    }
    if (lower(rec.Setting) === "your name") model.me = text(rec.Value);
    if (lower(rec.Setting) === "avatar style" && AVATAR_STYLES.includes(lower(rec.Value))) model.avatarStyle = lower(rec.Value);
  }
  // A name typed on the Me sheet wins over Settings (it's where you'd look for it in Excel).
  if (model.meFromProfile) model.me = model.meFromProfile;
  delete model.meFromProfile;
  return model;
}

/** Items -> sheet rows: header row + one row per item, extra columns appended. */
function tableRows(items, columns, toCells, skipExtra = []) {
  const extraHeaders = [];
  const skip = new Set(skipExtra.map(h => h.toLowerCase()));
  for (const it of items) {
    for (const h of Object.keys(it.extra ?? {})) if (!extraHeaders.includes(h) && !skip.has(h.toLowerCase())) extraHeaders.push(h);
  }
  return [
    [...columns.map(([h]) => h), ...extraHeaders],
    ...items.map(it => [...toCells(it), ...extraHeaders.map(h => it.extra?.[h] ?? "")]),
  ];
}

/** 'YYYY-MM-DD' -> a Date so Excel shows a real date; anything else stays text. */
function dateCell(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : (v ?? "");
}

/** Column widths from the content: at least the header, at most 60 characters (photos count as short). */
function autoWidths(rows) {
  const widths = [];
  for (const row of rows) {
    row.forEach((v, i) => {
      const text = v instanceof Date ? "2026-01-01" : typeof v === "object" && v ? v.text ?? "" : String(v ?? "");
      const len = text.startsWith("data:") ? 10 : Math.max(...text.split("\n").map(l => l.length));
      widths[i] = Math.max(widths[i] ?? 8, Math.min(len + 2, 60));
    });
  }
  return widths;
}

function sheetFrom(rows, { links = true, filter = false } = {}) {
  // Link cells are { text, url }: shown as the text, clickable. Emails link to mailto:.
  const plain = rows.map(r => r.map(v => (v && typeof v === "object" && !(v instanceof Date) ? v.text : v)));
  // Dates become numbers with a date format (timezone-safe); cellDates would store UTC instants.
  const ws = XLSX.utils.aoa_to_sheet(plain, { dateNF: "yyyy-mm-dd" });
  ws["!cols"] = autoWidths(rows).map(wch => ({ wch }));
  if (links) {
    rows.forEach((r, ri) => r.forEach((v, ci) => {
      const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
      if (!cell || ri === 0) return;
      if (v && typeof v === "object" && v.url) cell.l = { Target: v.url, Tooltip: v.url };
      else if (typeof v === "string" && /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(v) && rows[0][ci] === "Email") cell.l = { Target: `mailto:${v}` };
    }));
  }
  if (filter && rows.length > 1) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
  return ws;
}

// The rest of a person's columns after the tracker's fifteen, in the tracker layout.
const TRACKER_REST = ["email", "photo", "pastCompanies", "school", "tags", "connectedOn", "connectedThrough", "notes",
  "headline", "location", "website", "skills", "languages", "certifications", "honors", "about"];

function peopleRows(model, tracker) {
  const cell = (p, f) => (f === "tags" ? p.tags.join(", ") : f === "connectedOn" ? dateCell(p.connectedOn) : p[f] ?? "");
  if (!tracker) return tableRows(model.people, PEOPLE_COLUMNS, p => PEOPLE_COLUMNS.map(([, f]) => cell(p, f)));
  const rest = TRACKER_REST.map(f => PEOPLE_COLUMNS.find(([, x]) => x === f));
  return tableRows(model.people, [...TRACKER_HEADERS.map(h => [h]), ...rest], p => {
    const t = trackerCells(model, p);
    return [...TRACKER_HEADERS.map(h => (/Date/.test(h) ? dateCell(t[h]) : t[h])), ...rest.map(([, f]) => cell(p, f))];
  }, OWN_TRACKER_COLUMNS);
}

// Dropdowns and wrapped columns per sheet (see xlsxPolish.js).
const POLISH = {
  [SHEETS.people]: { wrap: ["Notes", "About", "Role / Background", "How We're Connected", "Next Steps", "Relevant Opportunities",
                            "Past Companies", "Schools", "Headline"],
                     lists: { Status: STATUSES, "Meeting Type": MEETING_TYPES, Method: METHODS, "Referral?": REFERRAL,
                              "Relationship Plan": RELATIONSHIP_PLANS } },
  [SHEETS.targets]: { wrap: ["Notes"], lists: { Priority: PRIORITIES, Stage: STAGES } },
  [SHEETS.meetings]: { wrap: ["Notes", "Next Step", "Description"], lists: { Type: MEETING_TYPES, Method: METHODS } },
  [SHEETS.tasks]: { wrap: ["Task"], lists: { Done: ["Yes"] } },
  [SHEETS.connections]: { wrap: ["Notes"], lists: { Type: CONNECTION_TYPES } },
  [SHEETS.experience]: { wrap: ["Description", "Title"] },
  [SHEETS.education]: { wrap: ["Degree", "Field"] },
  [SHEETS.companies]: {}, [SHEETS.pool]: {},
  [SHEETS.me]: { wrap: ["Value"] }, [SHEETS.settings]: { wrap: ["Value"] },
};

/**
 * Model -> .xlsx bytes (Uint8Array). Pass the bytes you opened as `base` to keep
 * sheets we don't manage (like "How to use") and their order.
 * Options: tracker (People in the networking-tracker layout, for Export), only (just these sheet keys).
 */
export function writeWorkbook(model, base, { tracker = false, only = null } = {}) {
  // cellNF/cellStyles keep number formats and styles on sheets we pass through untouched.
  const wb = base ? XLSX.read(base, { type: "array", cellNF: true, cellStyles: true }) : XLSX.utils.book_new();
  const rows = {
    [SHEETS.people]: peopleRows(model, tracker),
    [SHEETS.targets]: tableRows(model.targets, TARGET_COLUMNS, t => TARGET_COLUMNS.map(([, f]) => t[f] ?? "")),
    [SHEETS.companies]: tableRows(model.companies, COMPANY_COLUMNS, c => [c.company, c.website, c.logo ?? ""]),
    [SHEETS.pool]: [POOL_COLUMNS, ...model.pool.map(e =>
      [e.firstName, e.lastName, e.url ? { text: e.url, url: e.url } : "", e.email, e.company, e.position, dateCell(e.connectedOn)])],
    [SHEETS.meetings]: tableRows(model.meetings ?? [], MEETING_COLUMNS, m => MEETING_COLUMNS.map(([, f]) =>
      f === "date" ? dateCell(m.date) : m[f] ?? "")),
    [SHEETS.tasks]: tableRows(model.tasks ?? [], TASK_COLUMNS, t => TASK_COLUMNS.map(([, f]) =>
      f === "due" || f === "created" ? dateCell(t[f]) : f === "done" ? (t.done ? "Yes" : "") : t[f] ?? "")),
    [SHEETS.connections]: tableRows(model.connections ?? [], CONNECTION_COLUMNS, c => CONNECTION_COLUMNS.map(([, f]) => c[f] ?? "")),
    [SHEETS.experience]: tableRows(model.experience ?? [], EXPERIENCE_COLUMNS, r => EXPERIENCE_COLUMNS.map(([, f]) => r[f] ?? "")),
    [SHEETS.education]: tableRows(model.education ?? [], EDUCATION_COLUMNS, r => EDUCATION_COLUMNS.map(([, f]) => r[f] ?? "")),
    [SHEETS.me]: [["Field", "Value"], ["Name", model.me ?? ""], ...PROFILE_ROWS.map(([label, f]) => [label, model.profile?.[f] ?? ""])],
    [SHEETS.settings]: [["Setting", "Value"], ["Your name", model.me ?? ""], ["Avatar style", model.avatarStyle ?? "initials"],
                        ...SETTING_ROWS.map(([label, field, fallback]) => [label, model.settings?.[field] ?? fallback])],
    [SHEETS.layout]: [["Node", "X", "Y"], ...Object.entries(model.layout ?? {}).map(([id, p]) => [id, Math.round(p.x), Math.round(p.y)])],
  };
  const keep = only ? new Set(only.map(k => SHEETS[k] ?? k)) : null;
  const sheets = Object.fromEntries(Object.entries(rows).filter(([name]) => !keep || keep.has(name)).map(([name, r]) =>
    [name, sheetFrom(r, { filter: name === SHEETS.people || name === SHEETS.pool })]));

  // Migrated files: the old "Contacts" sheet is replaced by People.
  const legacy = wb.SheetNames.find(s => lower(s) === "contacts");
  if (legacy && !findSheet(wb, SHEETS.people)) {
    wb.SheetNames = wb.SheetNames.map(s => (s === legacy ? SHEETS.people : s));
    delete wb.Sheets[legacy];
  }
  for (const [name, ws] of Object.entries(sheets)) {
    const real = wb.SheetNames.find(s => lower(s) === lower(name));
    if (real) wb.Sheets[real] = ws;
    else XLSX.utils.book_append_sheet(wb, ws, name);
  }
  // People first; Layout hidden (it's for the app, not for you).
  // An export lists what matters most first.
  const first = tracker ? [SHEETS.people, SHEETS.experience, SHEETS.education, SHEETS.connections, SHEETS.targets, SHEETS.meetings,
                           SHEETS.tasks].filter(n => wb.SheetNames.includes(n)) : wb.SheetNames.includes(SHEETS.people) ? [SHEETS.people] : [];
  wb.SheetNames = [...first, ...wb.SheetNames.filter(s => !first.includes(s))];
  wb.Workbook = { ...(wb.Workbook ?? {}), Sheets: wb.SheetNames.map(name => ({
    name, Hidden: lower(name) === lower(SHEETS.layout) ? 1 : 0 })) };
  const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }));
  const spec = Object.fromEntries(Object.keys(sheets).filter(n => POLISH[n]).map(n => [n, { headers: rows[n][0], ...POLISH[n] }]));
  return polishXlsx(bytes, spec);
}

/** A CSV the user opened: a LinkedIn export, or a people list with a Name column. */
export function readPeopleCsvRows(records) {
  return records.map(rec => {
    const { known, extra } = pick(rec, PEOPLE_COLUMNS, PEOPLE_ALIASES);
    return clean(known.name) ? makePerson({ ...known, extra, source: "excel" }) : null;
  }).filter(Boolean);
}
