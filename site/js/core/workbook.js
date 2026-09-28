// The Excel workbook is the database. This module converts between workbook
// bytes and a plain model, and back. It uses SheetJS, so it runs the same in the
// browser and in Node tests.
//
// Model: { me, people, targets, companies, pool, layout, notices }
//
// Sheets you add yourself (and extra columns on ours) are kept when saving.
// Old files (a "Contacts" sheet, Targets with only Company/Notes) are migrated.

import * as XLSX from "../../vendor/xlsx.mjs";
import { clean } from "./org.js";
import { POOL_COLUMNS, makePerson, parseDate, poolEntry } from "./people.js";

export const SHEETS = { people: "People", targets: "Targets", companies: "Companies",
                        pool: "LinkedIn Pool", layout: "Layout", settings: "Settings" };

// [column header, model field]. Headers are matched case-insensitively.
export const PEOPLE_COLUMNS = [["Name", "name"], ["Company", "company"], ["School", "school"], ["Role", "role"],
  ["Email", "email"], ["LinkedIn URL", "linkedinUrl"], ["Photo", "photo"],
  ["Connected Through", "connectedThrough"], ["Connected On", "connectedOn"], ["Status", "status"],
  ["Tags", "tags"], ["Notes", "notes"]];
const PEOPLE_ALIASES = { "email address": "email", "url": "linkedinUrl", "linkedin": "linkedinUrl",
                         "title": "role", "position": "role" };
export const TARGET_COLUMNS = [["Company", "company"], ["Priority", "priority"], ["Stage", "stage"], ["Notes", "notes"]];
export const COMPANY_COLUMNS = [["Company", "company"], ["Website", "website"], ["Logo", "logo"]];
export const STAGES = ["Researching", "Networking", "Applied", "Interviewing", "Offer"];
export const PRIORITIES = ["1", "2", "3"];

export function emptyModel(me = "") {
  return { me, people: [], targets: [], companies: [], pool: [], layout: {}, notices: [] };
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

  // ---- Settings ----
  for (const rec of findSheet(wb, SHEETS.settings)?.rows ?? []) {
    if (lower(rec.Setting) === "your name") model.me = text(rec.Value);
  }
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
      [22, 24, 24, 24, 28, 36, 14, 22, 14, 14, 20, 40]),
    [SHEETS.targets]: sheetFrom(tableRows(model.targets, TARGET_COLUMNS, t => TARGET_COLUMNS.map(([, f]) => t[f] ?? "")),
      [28, 10, 14, 40]),
    [SHEETS.companies]: sheetFrom(tableRows(model.companies, COMPANY_COLUMNS, c => [c.company, c.website, c.logo ?? ""]),
      [28, 30, 30]),
    [SHEETS.pool]: sheetFrom([POOL_COLUMNS, ...model.pool.map(e =>
      [e.firstName, e.lastName, e.url, e.email, e.company, e.position, dateCell(e.connectedOn)])],
      [14, 16, 40, 28, 28, 30, 14]),
    [SHEETS.settings]: sheetFrom([["Setting", "Value"], ["Your name", model.me ?? ""]], [16, 30]),
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
