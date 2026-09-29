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

/** Add an entry unless the same name is already there (case-insensitive). */
export function addEntry(text, entry) {
  const list = parseEntries(text);
  if (!entry?.name || list.some(e => e.name.toLowerCase() === entry.name.toLowerCase())) return formatEntries(list);
  return formatEntries([...list, entry]);
}

/**
 * What you have in common with someone, from your profile: schools you both went to, and companies where you
 * both worked (your past/current employers vs theirs). Drives the "Same school" / "Former coworker" badges.
 */
export function sharedWithMe(profile, person, normalize) {
  if (!profile || !person) return { schools: [], companies: [] };
  const mySchools = new Map(parseEntries(profile.school).map(e => [normalize(e.name), e.name]));
  const myJobs = new Map([...parseEntries(profile.pastCompanies), ...(profile.company ? [{ name: profile.company }] : [])]
    .map(e => [normalize(e.name), e.name]));
  const theirJobs = [...parseEntries(person.pastCompanies), ...(person.company ? [{ name: person.company }] : [])];
  return {
    schools: [...new Set(parseEntries(person.school).map(e => mySchools.get(normalize(e.name))).filter(Boolean))],
    companies: [...new Set(theirJobs.map(e => myJobs.get(normalize(e.name))).filter(Boolean))],
  };
}
