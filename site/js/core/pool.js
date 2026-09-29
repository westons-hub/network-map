// Your LinkedIn pool: the people from Connections.csv. They stay off the map until you add them.
// Also: matching a pasted LinkedIn profile link to someone in the pool. (The app never contacts
// linkedin.com; it only compares the link's text with the export you imported.)

import { clean, normalizeName, normalizeOrg } from "./org.js";
import { poolName } from "./people.js";

/** 'https://www.linkedin.com/in/Jordan-Lee-12ab34/?trk=x' -> 'linkedin.com/in/jordan-lee-12ab34' ('' if not a profile link). */
export function normalizeLinkedInUrl(url) {
  const t = String(url ?? "").trim();
  const m = t.match(/^(?:https?:\/\/)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/(in|pub)\/([^/?#\s]+)/i);
  if (!m) return "";
  let slug = m[2];
  try { slug = decodeURIComponent(slug); } catch { /* keep as is */ }
  return `linkedin.com/in/${slug.toLowerCase().replace(/\/+$/, "")}`;
}

export const isLinkedInUrl = text => !!normalizeLinkedInUrl(text);

/** A readable name from a profile slug: 'jordan-lee-12ab34' -> 'Jordan Lee', 'ana-maría-díaz' -> 'Ana María Díaz'. */
export function nameFromSlug(urlOrSlug) {
  const slug = (normalizeLinkedInUrl(urlOrSlug) || String(urlOrSlug)).split("/").pop();
  const words = slug.split(/[-_]+/).filter(Boolean);
  // LinkedIn adds a random suffix (digits, or a mix of letters and digits) to many slugs; drop it.
  while (words.length > 1 && /\d/.test(words.at(-1))) words.pop();
  return words.map(w => w[0].toLocaleUpperCase() + w.slice(1)).join(" ");
}

const entryKey = e => normalizeLinkedInUrl(e.url) || `name:${normalizeName(poolName(e))}`;

/**
 * Merge a new import into the pool without duplicates (same profile URL, else same name).
 * Newer non-blank values win. Returns { pool, added, updated, changedCompany: [{ name, from, to, position }] }.
 */
export function mergePool(existing, incoming) {
  const pool = existing.map(e => ({ ...e }));
  const index = new Map();
  pool.forEach((e, i) => { index.set(entryKey(e), i); index.set(`name:${normalizeName(poolName(e))}`, i); });
  let added = 0, updated = 0;
  const changedCompany = [];
  for (const e of incoming) {
    const i = index.get(entryKey(e)) ?? index.get(`name:${normalizeName(poolName(e))}`);
    if (i === undefined) {
      index.set(entryKey(e), pool.length);
      index.set(`name:${normalizeName(poolName(e))}`, pool.length);
      pool.push({ ...e });
      added++;
      continue;
    }
    const before = pool[i];
    const after = { ...before };
    for (const [k, v] of Object.entries(e)) if (clean(v)) after[k] = v;
    if (before.company && after.company && normalizeOrg(before.company) !== normalizeOrg(after.company)) {
      changedCompany.push({ name: poolName(after), from: before.company, to: after.company, position: before.position });
    }
    if (JSON.stringify(after) !== JSON.stringify(before)) { pool[i] = after; updated++; }
  }
  return { pool, added, updated, changedCompany };
}

/** Search the pool: words match name, company or title; optional filters. Newest connections first. */
export function searchPool(pool, { q = "", company = "", title = "", since = "", until = "" } = {}) {
  const words = clean(q).toLowerCase().split(" ").filter(Boolean);
  const co = normalizeOrg(company), ti = clean(title).toLowerCase();
  return pool.filter(e => {
    const hay = `${poolName(e)} ${e.company} ${e.position}`.toLowerCase();
    if (!words.every(w => hay.includes(w))) return false;
    if (co && normalizeOrg(e.company) !== co) return false;
    if (ti && !e.position.toLowerCase().includes(ti)) return false;
    if (since && (!e.connectedOn || e.connectedOn < since)) return false;
    if (until && (!e.connectedOn || e.connectedOn > until)) return false;
    return true;
  }).sort((a, b) => (b.connectedOn || "").localeCompare(a.connectedOn || "") || poolName(a).localeCompare(poolName(b)));
}

/** Is this pool entry already on the map? (by LinkedIn URL, then by name) */
export function onMapIndex(people) {
  const urls = new Set(people.map(p => normalizeLinkedInUrl(p.linkedinUrl)).filter(Boolean));
  const names = new Set(people.map(p => normalizeName(p.name)));
  return e => urls.has(normalizeLinkedInUrl(e.url)) || names.has(normalizeName(poolName(e)));
}

/**
 * A pasted profile link -> what we know. { url, entry (pool match or null), name, matchedBy: "url"|"name"|null }.
 * Matching is by URL first, then by the name in the link's slug.
 */
export function matchLinkedInUrl(pool, url) {
  const norm = normalizeLinkedInUrl(url);
  if (!norm) return null;
  const name = nameFromSlug(norm);
  const byUrl = pool.find(e => normalizeLinkedInUrl(e.url) === norm);
  if (byUrl) return { url: `https://www.${norm}`, entry: byUrl, name: poolName(byUrl), matchedBy: "url" };
  const byName = pool.filter(e => normalizeName(poolName(e)) === normalizeName(name));
  if (byName.length === 1) return { url: `https://www.${norm}`, entry: byName[0], name: poolName(byName[0]), matchedBy: "name" };
  return { url: `https://www.${norm}`, entry: null, name, matchedBy: null };
}
