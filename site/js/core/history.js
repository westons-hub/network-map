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
