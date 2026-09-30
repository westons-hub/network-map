// People records, merging, and parsing LinkedIn's Connections.csv.

import { formatEntries, parseEntries } from "./history.js";
import { clean, normalizeName } from "./org.js";

/** What a LinkedIn profile PDF adds (skills, languages, certifications and honors are "; "-separated lists). */
export const PDF_FIELDS = ["headline", "location", "website", "skills", "languages", "certifications", "honors", "about"];

/** Every field a person can have. Blank "connectedThrough" = you know them directly. */
export const PERSON_FIELDS = ["name", "company", "school", "pastCompanies", "role", "email", "linkedinUrl", "photo",
                              "connectedThrough", "connectedOn", "status", "tags", "notes", ...PDF_FIELDS];

export const STATUSES = ["To Reach Out", "Contacted", "Scheduled", "Met", "Follow Up", "Referral"];

export function makePerson(fields = {}) {
  // school holds one or more schools ("BYU (2022–2026); Lakeview High"); pastCompanies works the same way.
  const p = { name: "", company: "", school: "", pastCompanies: "", role: "", email: "", linkedinUrl: "", photo: "",
              connectedThrough: "", connectedOn: "", status: "", tags: [], notes: "", source: "", extra: {},
              headline: "", location: "", website: "", skills: "", languages: "", certifications: "", honors: "", about: "" };
  for (const [k, v] of Object.entries(fields)) {
    if (k === "tags") p.tags = Array.isArray(v) ? v.map(clean).filter(Boolean) : splitTags(v);
    else if (k === "extra") p.extra = { ...v };
    else if (k === "connectedOn") p.connectedOn = parseDate(v);
    else if (k === "notes" || k === "about") p[k] = String(v ?? "").replace(/\r\n?/g, "\n").split("\n").map(clean).join("\n").trim();
    else if (k in p) p[k] = k === "photo" ? String(v ?? "").trim() : clean(v);
  }
  return p;
}

export const personKey = p => normalizeName(p.name);

export function splitTags(value) {
  return clean(value).replaceAll(";", ",").split(",").map(t => t.trim()).filter(Boolean);
}

/** 'Delta, Google; Bain' (or one per line) -> ['Delta', 'Google', 'Bain']. */
export function parseList(text) {
  return String(text ?? "").replace(/[;\n]/g, ",").split(",").map(t => t.trim()).filter(Boolean);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, m, d) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Dates as 'YYYY-MM-DD'. Accepts Date objects, LinkedIn's '12 Mar 2026', ISO, and US 'M/D/YYYY'.
 * Anything else is returned cleaned but unchanged, so nothing you typed is lost.
 */
export function parseDate(value) {
  if (value instanceof Date && !isNaN(value)) {
    // SheetJS gives local-midnight dates; read the local parts so the day doesn't shift.
    return iso(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  const text = clean(value);
  let m;
  if ((m = text.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -,]*(\d{4})$/)) && MONTHS[m[2].toLowerCase()]) {
    return iso(m[3], MONTHS[m[2].toLowerCase()], m[1]);
  }
  if ((m = text.match(/^([A-Za-z]{3})[a-z]* (\d{1,2}),? (\d{4})$/)) && MONTHS[m[1].toLowerCase()]) {
    return iso(m[3], MONTHS[m[1].toLowerCase()], m[2]);
  }
  if ((m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(m[1], m[2], m[3]);
  if ((m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return iso(m[3], m[1], m[2]);
  return text;
}

/**
 * Merge a newly read profile into someone already on your map without overwriting your edits: empty fields are
 * filled in, new schools / past companies / tags are added, and everything you already have stays.
 * Returns { person, filled: [field names that changed] }.
 */
export function fillPerson(existing, incoming) {
  const person = makePerson({ ...existing });
  person.extra = { ...existing.extra };
  person.source = existing.source;
  const filled = [];
  const incomingP = makePerson(incoming);
  for (const f of PERSON_FIELDS) {
    if (f === "name") continue;
    if (f === "tags") {
      const tags = [...new Set([...person.tags, ...incomingP.tags])];
      if (tags.length !== person.tags.length) { person.tags = tags; filled.push(f); }
    } else if ((f === "school" || f === "pastCompanies") && person[f] && incomingP[f]) {
      const merged = mergeEntryLists(person[f], incomingP[f]);
      if (merged !== person[f]) { person[f] = merged; filled.push(f); }
    } else if (!person[f] && incomingP[f]) { person[f] = incomingP[f]; filled.push(f); }
  }
  return { person, filled };
}

/** "A (2019–2021); B" + "B (2018–2020); C" -> "A (2019–2021); B (2018–2020); C": new names are added, and years fill in. */
function mergeEntryLists(mine, theirs) {
  const list = parseEntries(mine);
  for (const e of parseEntries(theirs)) {
    const same = list.find(x => normalizeName(x.name) === normalizeName(e.name));
    if (!same) list.push(e);
    else if (!same.years && e.years) same.years = e.years;
  }
  return formatEntries(list);
}

/**
 * Combine sources by name. Earlier sources fill gaps; later sources win on conflicts.
 * Pass LinkedIn first and your own sheet second so your edits take priority.
 */
export function mergePeople(...sources) {
  const merged = new Map();
  for (const people of sources) {
    for (const p of people) {
      const key = personKey(p);
      const existing = merged.get(key);
      if (!existing) { merged.set(key, { ...p, tags: [...p.tags], extra: { ...p.extra } }); continue; }
      for (const f of PERSON_FIELDS) {
        if (f !== "name" && f !== "tags" && p[f]) existing[f] = p[f];
      }
      existing.tags = [...new Set([...existing.tags, ...p.tags])].sort();
      Object.assign(existing.extra, p.extra);
      if (p.source && !existing.source.split("+").includes(p.source)) {
        existing.source = existing.source ? `${existing.source}+${p.source}` : p.source;
      }
    }
  }
  return [...merged.values()];
}

/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF. Returns rows of strings. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** CSV text -> array of {header: value} objects, starting at the first row whose first cell matches. */
export function csvRecords(text, firstHeader) {
  const rows = parseCsv(text);
  const start = rows.findIndex(r => clean(r[0]).toLowerCase() === firstHeader);
  if (start < 0) return null;
  const headers = rows[start].map(clean);
  return rows.slice(start + 1)
    .filter(r => r.some(v => clean(v)))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

export const POOL_COLUMNS = ["First Name", "Last Name", "URL", "Email Address", "Company", "Position", "Connected On"];
// From the rest of your LinkedIn export (Invitations.csv, Notes.csv and, only if you opt in, messages.csv).
export const POOL_EXTRA_COLUMNS = [["Reached Out", "reachedOut"], ["Invited On", "invitedOn"], ["Invite Note", "inviteNote"],
  ["LinkedIn Note", "note"], ["Messages", "messages"], ["Last Contacted", "lastContacted"]];
export const INVITE_PENDING = "Invite pending";

/**
 * Parse LinkedIn's Connections.csv (Settings > Data privacy > Get a copy of your data).
 * The export starts with a few "Notes:" lines before the real header, so we skip ahead
 * to the line that begins with "First Name". Every column is kept.
 */
export function parseLinkedInCsv(text, fileName = "Connections.csv") {
  const records = csvRecords(text, "first name");
  if (!records) throw new Error(`${fileName} doesn't look like a LinkedIn Connections export.`);
  return records.map(poolEntry).filter(e => e.firstName || e.lastName);
}

/** One LinkedIn Pool row from a {column: value} record (CSV or the Pool sheet). */
export function poolEntry(rec) {
  const get = col => {
    const k = Object.keys(rec).find(h => clean(h).toLowerCase() === col.toLowerCase());
    return k === undefined ? "" : rec[k];
  };
  return {
    firstName: clean(get("First Name")), lastName: clean(get("Last Name")), url: clean(get("URL")),
    email: clean(get("Email Address")), company: clean(get("Company")), position: clean(get("Position")),
    connectedOn: parseDate(get("Connected On")),
    // Only when set, so a plain Connections.csv row stays exactly as before.
    ...Object.fromEntries(POOL_EXTRA_COLUMNS.map(([h, f]) => [f, f === "invitedOn" || f === "lastContacted" ? parseDate(get(h)) : f === "inviteNote" || f === "note" ? String(get(h) ?? "").trim() : clean(get(h))])
      .filter(([, v]) => v !== "" && v !== undefined)),
  };
}

export const poolName = e => clean(`${e.firstName} ${e.lastName}`);

/** A pool entry as a person you could add to the map. */
export function personFromPool(e) {
  // What your LinkedIn export knows about them comes along: who reached out first, when, and your LinkedIn note.
  const extra = {};
  if (e.reachedOut === "You" && e.invitedOn) extra["Date Reached Out"] = e.invitedOn;
  if (e.lastContacted) extra["Last Contacted"] = e.lastContacted;
  if (e.messages) extra.Messages = String(e.messages);
  const notes = [e.note ? `From LinkedIn: ${e.note}` : "", e.inviteNote ? `Invite note: ${e.inviteNote}` : ""].filter(Boolean).join("\n");
  return makePerson({ name: poolName(e), company: e.company, role: e.position, email: e.email,
                      linkedinUrl: e.url, connectedOn: e.connectedOn, source: "linkedin", extra, notes,
                      status: e.reachedOut === INVITE_PENDING ? "To Reach Out" : "" });
}
