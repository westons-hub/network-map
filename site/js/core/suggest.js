// Type-ahead suggestions built from everything already entered anywhere: people on the map, their past
// companies and schools, the LinkedIn pool, targets, the Companies sheet and your own profile.
// Organizations match through the aliases in org.js, so "U of U" finds "University of Utah".

import { CONNECTION_TYPES } from "./connections.js";
import { entryNames } from "./history.js";
import { clean, normalizeName, normalizeOrg } from "./org.js";
import { STATUSES } from "./people.js";
import { MEETING_TYPES, METHODS } from "./workbook.js";

export const RELATIONSHIP_PLANS = ["Keep In Contact", "Follow Up Later", "One-Time"];
const ORG_KINDS = new Set(["company", "school"]);

/** Tally spellings per key; the label is the most common spelling (or a preferred one). */
function tally(kind) {
  const map = new Map(); // key -> { spellings: Map, count, pool, preferred }
  const keyOf = v => (ORG_KINDS.has(kind) ? normalizeOrg(v) : clean(v).toLowerCase());
  const add = (value, { count = 0, pool = 0, preferred = false } = {}) => {
    const v = clean(value);
    const key = v && keyOf(v);
    if (!key) return;
    const e = map.get(key) ?? { spellings: new Map(), count: 0, pool: 0, preferred: "" };
    e.spellings.set(v, (e.spellings.get(v) ?? 0) + 1);
    e.count += count;
    e.pool += pool;
    if (preferred && !e.preferred) e.preferred = v;
    map.set(key, e);
  };
  const list = () => [...map].map(([key, e]) => ({
    key, value: e.preferred || [...e.spellings].sort((a, b) => b[1] - a[1])[0][0], count: e.count, pool: e.pool }));
  return { add, list };
}

/** Everything to suggest, per kind: [{ value, key, count (people on the map), pool (people in the LinkedIn pool) }]. */
export function buildSuggestions(model) {
  const company = tally("company"), school = tally("school"), role = tally("role"), tag = tally("tag");
  for (const p of model.people) {
    const orgs = new Set([p.company, ...entryNames(p.pastCompanies)].filter(Boolean).map(normalizeOrg));
    if (p.company) company.add(p.company, { count: 1 });
    for (const name of entryNames(p.pastCompanies)) company.add(name, { count: orgs.has(normalizeOrg(p.company)) ? 0 : 1 });
    for (const name of entryNames(p.school)) school.add(name, { count: 1 });
    if (p.role) role.add(p.role, { count: 1 });
    for (const t of p.tags ?? []) tag.add(t, { count: 1 });
  }
  for (const e of model.pool ?? []) {
    if (e.company) company.add(e.company, { pool: 1 });
    if (e.position) role.add(e.position, { pool: 1 });
  }
  for (const t of model.targets ?? []) company.add(t.company, { preferred: true });
  for (const c of model.companies ?? []) company.add(c.company, { preferred: true });
  const prof = model.profile ?? {};
  if (prof.company) company.add(prof.company);
  for (const name of entryNames(prof.pastCompanies)) company.add(name);
  for (const name of entryNames(prof.school)) school.add(name);
  if (prof.role) role.add(prof.role);

  const fixed = values => values.map(v => ({ value: v, key: v.toLowerCase(), count: 0, pool: 0 }));
  return {
    company: company.list(), school: school.list(), role: role.list(), tag: tag.list(),
    person: model.people.map(p => ({ value: p.name, key: normalizeName(p.name), count: 0, pool: 0, detail: [p.role, p.company].filter(Boolean).join(" @ ") })),
    status: fixed(STATUSES), meetingType: fixed(MEETING_TYPES), method: fixed(METHODS),
    relationshipPlan: fixed(RELATIONSHIP_PLANS), connectionType: fixed(CONNECTION_TYPES),
  };
}

/**
 * Rank suggestions for what's typed: exact or alias match first, then prefix, then word start, then anywhere;
 * ties go to the most-used. An empty query lists the most-used.
 */
export function matchSuggestions(items, query, { kind, limit = 8 } = {}) {
  const q = clean(query).toLowerCase();
  if (!q) return [...items].sort((a, b) => (b.count + b.pool) - (a.count + a.pool) || a.value.localeCompare(b.value)).slice(0, limit);
  const qOrg = ORG_KINDS.has(kind) ? normalizeOrg(query) : "";
  const scored = [];
  for (const it of items) {
    const v = it.value.toLowerCase();
    let score = -1;
    if (v === q || (qOrg && it.key === qOrg)) score = 0;
    else if (v.startsWith(q)) score = 1;
    else if (v.split(/[\s\-&,/]+/).some(w => w.startsWith(q))) score = 2;
    else if (v.includes(q) || (qOrg && it.key.includes(qOrg))) score = 3;
    if (score >= 0) scored.push({ it, score });
  }
  return scored.sort((a, b) => a.score - b.score || (b.it.count + b.it.pool) - (a.it.count + a.it.pool) || a.it.value.localeCompare(b.it.value))
    .slice(0, limit).map(s => s.it);
}
