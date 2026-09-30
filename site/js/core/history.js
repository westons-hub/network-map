// Multi-entry fields: Schools and Past Companies, written the way you'd type them in Excel:
//   "BYU (2022–2026); Lakeview High"   "Northwind Consulting (2019–2021); Summit Airlines"

import { clean } from "./org.js";

/** 'BYU (2022–2026); Lakeview High' -> [{ name: 'BYU', years: '2022–2026' }, { name: 'Lakeview High', years: '' }]. */
export function parseEntries(text) {
  return String(text ?? "").split(/[;\n]/).map(part => {
    const s = clean(part);
    if (!s) return null;
    const m = s.match(/^(.*?)\s*\(([^()]*\d[^()]*)\)\s*$/);
    return m ? { name: clean(m[1]), years: clean(m[2]).replace(/\s*[-–—]\s*/g, "–") } : { name: s, years: "" };
  }).filter(e => e?.name);
}

export const formatEntries = list => list.filter(e => e?.name).map(e => (e.years ? `${e.name} (${e.years})` : e.name)).join("; ");

export const entryNames = text => parseEntries(text).map(e => e.name);

/**
 * What you have in common with someone, from your profile: schools you both went to, and companies where you
 * both worked (your past/current employers vs theirs). Drives the "Same school" / "Former coworker" badges.
 */
export function sharedWithMe(profile, person, normalize) {
  if (!profile || !person) return { schools: [], companies: [] };
  const mySchools = new Map(parseEntries(profile.school).map(e => [normalize(e.name), e.name]));
  // Volunteering organizations count like past companies.
  const myJobs = new Map([...parseEntries(profile.pastCompanies), ...parseEntries(profile.volunteering),
                          ...(profile.company ? [{ name: profile.company }] : [])]
    .map(e => [normalize(e.name), e.name]));
  const theirJobs = [...parseEntries(person.pastCompanies), ...(person.company ? [{ name: person.company }] : [])];
  return {
    schools: [...new Set(parseEntries(person.school).map(e => mySchools.get(normalize(e.name))).filter(Boolean))],
    companies: [...new Set(theirJobs.map(e => myJobs.get(normalize(e.name))).filter(Boolean))],
  };
}

// ---- Experience and Education sheets (one row per job / school, from a LinkedIn profile PDF) ----

export const rowKey = {
  experience: r => [r.company, r.title, r.start].map(v => clean(v).toLowerCase()).join("|"),
  education: r => [r.school, r.degree, r.start].map(v => clean(v).toLowerCase()).join("|"),
};

/** Add a person's new history rows; rows already there (same company + title + start, or school + degree + start) stay as they are. */
export function mergeHistoryRows(rows, incoming, kind) {
  const key = rowKey[kind];
  const have = new Set(rows.map(r => `${clean(r.person).toLowerCase()}#${key(r)}`));
  const added = incoming.filter(r => !have.has(`${clean(r.person).toLowerCase()}#${key(r)}`));
  return { rows: [...rows, ...added.map(r => ({ extra: {}, ...r }))], added: added.length };
}

/** A person's rows, newest first ("Present" first, then by start). */
export function historyOf(rows = [], name, normalize) {
  const k = normalize(name);
  const rank = v => (v === "Present" ? "9999" : String(v ?? ""));
  return rows.filter(r => normalize(r.person) === k)
    .sort((a, b) => rank(b.end).localeCompare(rank(a.end)) || String(b.start ?? "").localeCompare(String(a.start ?? "")));
}
