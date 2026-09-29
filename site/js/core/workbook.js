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
import { makeConnection, reconcile } from "./connections.js";
import { POOL_COLUMNS, makePerson, parseDate, poolEntry } from "./people.js";

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
const PEOPLE_ALIASES = { "email address": "email", "url": "linkedinUrl", "linkedin": "linkedinUrl",
                         "title": "role", "position": "role", "school": "school", "past company": "pastCompanies" };
export const TARGET_COLUMNS = [["Company", "company"], ["Priority", "priority"], ["Stage", "stage"], ["Notes", "notes"]];
export const COMPANY_COLUMNS = [["Company", "company"], ["Website", "website"], ["Logo", "logo"]];
export const STAGES = ["Researching", "Networking", "Applied", "Interviewing", "Offer"];
export const PRIORITIES = ["1", "2", "3"];

export const AVATAR_STYLES = ["initials", "notionists"];

// Meetings: the spec's columns first, then the meeting link and a stable ID the app uses for edits.
export const MEETING_COLUMNS = [["Person", "person"], ["Date", "date"], ["Start", "start"], ["End", "end"],
  ["Type", "type"], ["Method", "method"], ["Notes", "notes"], ["Next Step", "nextStep"],
  ["Calendar Event ID", "eventId"], ["Link", "link"], ["ID", "id"]];
export const TASK_COLUMNS = [["Task", "task"], ["Person", "person"], ["Company", "company"], ["Due", "due"],
  ["Done", "done"], ["Created", "created"], ["Source", "source"], ["ID", "id"]];
export const MEETING_TYPES = ["Coffee Chat", "Informational", "Networking Event", "Class/Club", "Interview", "Other"];
export const METHODS = ["Zoom", "Google Meet", "Teams", "Phone", "In Person", "Email", "LinkedIn"];

export const DEFAULT_INVITE = "Hi {first name}, looking forward to our chat on {date} at {time}. {link}";
// [row label on the Settings sheet, settings field, default]
const SETTING_ROWS = [["Your email", "email", ""], ["Meeting length (minutes)", "meetingLength", 30],
  ["Zoom link", "zoomLink", ""], ["Check-in every (days)", "checkInDays", 60],
  ["Invite message", "inviteTemplate", DEFAULT_INVITE], ["Demo base date", "demoBaseDate", ""]];

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
  return XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
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
  for (const rec of people?.rows ?? []) {
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
      link: text(known.link), extra });
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
function tableRows(items, columns, toCells) {
  const extraHeaders = [];
  for (const it of items) {
    for (const h of Object.keys(it.extra ?? {})) if (!extraHeaders.includes(h)) extraHeaders.push(h);
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

function sheetFrom(rows, widths) {
  // Dates become numbers with a date format (timezone-safe); cellDates would store UTC instants.
  const ws = XLSX.utils.aoa_to_sheet(rows, { dateNF: "yyyy-mm-dd" });
  ws["!cols"] = rows[0].map((_, i) => ({ wch: widths[i] ?? 16 }));
  return ws;
}

/**
 * Model -> .xlsx bytes (Uint8Array). Pass the bytes you opened as `base` to keep
 * sheets we don't manage (like "How to use") and their order.
 */
export function writeWorkbook(model, base) {
  // cellNF/cellStyles keep number formats and styles on sheets we pass through untouched.
  const wb = base ? XLSX.read(base, { type: "array", cellNF: true, cellStyles: true }) : XLSX.utils.book_new();
  const sheets = {
    [SHEETS.people]: sheetFrom(tableRows(model.people, PEOPLE_COLUMNS, p => PEOPLE_COLUMNS.map(([, f]) =>
      f === "tags" ? p.tags.join(", ") : f === "connectedOn" ? dateCell(p.connectedOn) : p[f] ?? "")),
      [22, 24, 30, 24, 28, 36, 14, 22, 14, 14, 20, 40, 36, 34, 24, 28, 30, 26, 30, 30, 50]),
    [SHEETS.targets]: sheetFrom(tableRows(model.targets, TARGET_COLUMNS, t => TARGET_COLUMNS.map(([, f]) => t[f] ?? "")),
      [28, 10, 14, 40]),
    [SHEETS.companies]: sheetFrom(tableRows(model.companies, COMPANY_COLUMNS, c => [c.company, c.website, c.logo ?? ""]),
      [28, 30, 30]),
    [SHEETS.pool]: sheetFrom([POOL_COLUMNS, ...model.pool.map(e =>
      [e.firstName, e.lastName, e.url, e.email, e.company, e.position, dateCell(e.connectedOn)])],
      [14, 16, 40, 28, 28, 30, 14]),
    [SHEETS.meetings]: sheetFrom(tableRows(model.meetings ?? [], MEETING_COLUMNS, m => MEETING_COLUMNS.map(([, f]) =>
      f === "date" ? dateCell(m.date) : m[f] ?? "")), [22, 12, 8, 8, 16, 12, 40, 30, 22, 30, 16]),
    [SHEETS.tasks]: sheetFrom(tableRows(model.tasks ?? [], TASK_COLUMNS, t => TASK_COLUMNS.map(([, f]) =>
      f === "due" || f === "created" ? dateCell(t[f]) : f === "done" ? (t.done ? "Yes" : "") : t[f] ?? "")),
      [40, 22, 20, 12, 8, 12, 20, 16]),
    [SHEETS.connections]: sheetFrom(tableRows(model.connections ?? [], CONNECTION_COLUMNS,
      c => CONNECTION_COLUMNS.map(([, f]) => c[f] ?? "")), [24, 24, 16, 40]),
    [SHEETS.experience]: sheetFrom(tableRows(model.experience ?? [], EXPERIENCE_COLUMNS,
      r => EXPERIENCE_COLUMNS.map(([, f]) => r[f] ?? "")), [22, 26, 34, 10, 10, 26, 60]),
    [SHEETS.education]: sheetFrom(tableRows(model.education ?? [], EDUCATION_COLUMNS,
      r => EDUCATION_COLUMNS.map(([, f]) => r[f] ?? "")), [22, 30, 34, 26, 10, 10]),
    [SHEETS.me]: sheetFrom([["Field", "Value"], ["Name", model.me ?? ""],
                            ...PROFILE_ROWS.map(([label, f]) => [label, model.profile?.[f] ?? ""])], [22, 70]),
    [SHEETS.settings]: sheetFrom([["Setting", "Value"], ["Your name", model.me ?? ""],
                                  ["Avatar style", model.avatarStyle ?? "initials"],
                                  ...SETTING_ROWS.map(([label, field, fallback]) => [label, model.settings?.[field] ?? fallback])],
                                 [26, 60]),
    [SHEETS.layout]: sheetFrom([["Node", "X", "Y"], ...Object.entries(model.layout ?? {}).map(([id, p]) =>
      [id, Math.round(p.x), Math.round(p.y)])], [36, 8, 8]),
  };

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
  wb.SheetNames = [SHEETS.people, ...wb.SheetNames.filter(s => s !== SHEETS.people)];
  wb.Workbook = { ...(wb.Workbook ?? {}), Sheets: wb.SheetNames.map(name => ({
    name, Hidden: lower(name) === lower(SHEETS.layout) ? 1 : 0 })) };
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }));
}

/** A CSV the user opened: a LinkedIn export, or a people list with a Name column. */
export function readPeopleCsvRows(records) {
  return records.map(rec => {
    const { known, extra } = pick(rec, PEOPLE_COLUMNS, PEOPLE_ALIASES);
    return clean(known.name) ? makePerson({ ...known, extra, source: "excel" }) : null;
  }).filter(Boolean);
}
