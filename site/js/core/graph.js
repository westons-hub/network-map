// Turn a list of people into nodes and edges for the network map.
//
// Rules:
// * You are the center node.
// * Anyone with a blank "Connected Through" is a direct (1st-degree) connection.
// * Anyone whose "Connected Through" names another person hangs off that person
//   (2nd-degree). If the connector isn't in your list yet, a placeholder is added.
// * When minGroupSize or more direct connections share a company or school,
//   they collapse into a group bubble: you -> group -> each member.
//   Someone who belongs to two groups gets a solid line to one and a dashed line
//   to the other.
// * Every target company is its own node (a company group that is a target just
//   becomes that node). Anyone you know directly there attaches to it, even below
//   minGroupSize; 2nd-degree people there get a secondary ("also") link to it.
//   A target with nobody on the map is a "gap" node.

import { parseEntries } from "./history.js";
import { normalizeName, normalizeOrg } from "./org.js";
import { makePerson, personKey } from "./people.js";

export const MIN_GROUP_SIZE = 3;

const asTarget = t => (typeof t === "string" ? { company: t } : t);

/** A person's schools: the Schools cell can hold several ("BYU (2022–2026); Lakeview High"). */
export const schoolsOf = p => parseEntries(p.school).map(e => e.name);
const valuesOf = (p, attr) => (attr === "school" ? schoolsOf(p) : p[attr] ? [p[attr]] : []);

/** Pick the most common original spelling as the label for each normalized org. */
function displayNames(people, attr) {
  const spellings = new Map();
  for (const p of people) {
    for (const value of valuesOf(p, attr)) {
      const key = normalizeOrg(value);
      const counts = spellings.get(key) ?? new Map();
      counts.set(value, (counts.get(value) ?? 0) + 1);
      spellings.set(key, counts);
    }
  }
  const out = {};
  for (const [key, counts] of spellings) {
    out[key] = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  }
  return out;
}

export function graphStats(g) {
  const kinds = {};
  for (const n of g.nodes) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
  const k = x => kinds[x] ?? 0;
  return { people: k("person") + k("second"), direct: k("person"), second_degree: k("second"),
           groups: k("company") + k("school") + k("tag"), targets: g.targets.length,
           gaps: g.targets.filter(t => !t.direct.length && !t.second.length).length };
}

export function buildGraph(people, { me = "Me", profile = {}, minGroupSize = MIN_GROUP_SIZE,
                                     groupBy = ["company", "school"], targets = [] } = {}) {
  const g = { nodes: [], edges: [], groups: {}, targets: [] };
  const meKey = normalizeName(me);
  const byKey = new Map(people.filter(p => personKey(p) !== meKey).map(p => [personKey(p), p]));

  // Add placeholders for connectors that were named but never listed.
  for (const p of [...byKey.values()]) {
    const ck = normalizeName(p.connectedThrough);
    if (ck && ck !== meKey && !byKey.has(ck)) {
      byKey.set(ck, makePerson({ name: p.connectedThrough, notes: "Added automatically as a connector.",
                                 source: "placeholder" }));
    }
  }

  const isDirect = p => { const ck = normalizeName(p.connectedThrough); return !ck || ck === meKey; };
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const direct = [...byKey.values()].filter(isDirect);
  const second = [...byKey.values()].filter(p => !isDirect(p));

  g.nodes.push({ id: "me", label: me, kind: "me", ...profile });

  // ---- find groups among direct connections ----------------------------
  const labels = { company: displayNames(direct, "company"), school: displayNames(direct, "school") };
  const counts = new Map(); // "kind|key" -> members
  const add = (kind, key, p) => {
    const k = `${kind}|${key}`;
    if (!counts.has(k)) counts.set(k, []);
    counts.get(k).push(p);
  };
  for (const p of direct) {
    if (groupBy.includes("company") && p.company) add("company", normalizeOrg(p.company), p);
    if (groupBy.includes("school")) {
      for (const key of new Set(schoolsOf(p).map(normalizeOrg))) if (key) add("school", key, p);
    }
    if (groupBy.includes("tags")) for (const t of p.tags) add("tag", t.toLowerCase(), p);
  }

  const groupIds = new Map();
  const ordered = [...counts].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [k, members] of ordered) {
    if (members.length < minGroupSize) continue;
    const [kind, key] = k.split(/\|(.*)/s);
    const gid = `${kind}:${key}`;
    const label = labels[kind]?.[key] ?? members[0].tags.find(t => t.toLowerCase() === key);
    groupIds.set(k, gid);
    g.groups[gid] = members.map(m => m.name);
    g.nodes.push({ id: gid, label, kind, key, count: members.length });
    g.edges.push({ from: "me", to: gid, kind: "group" });
  }

  // ---- target companies: always their own node ------------------------------
  const nodesById = new Map(g.nodes.map(n => [n.id, n]));
  const seen = new Set();
  for (const raw of targets) {
    const t = asTarget(raw);
    const key = normalizeOrg(t.company);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const at = [...byKey.values()].filter(p => p.company && normalizeOrg(p.company) === key);
    const directAt = at.filter(isDirect).map(p => p.name).sort();
    const secondAt = at.filter(p => !isDirect(p)).map(p => p.name).sort();
    const meta = { target: true, priority: t.priority ?? "", stage: t.stage ?? "" };
    let id = groupIds.get(`company|${key}`);
    if (id) Object.assign(nodesById.get(id), meta);
    else {
      id = `target:${key}`;
      g.nodes.push({ id, label: t.company, kind: "target", key, count: directAt.length, gap: !at.length, ...meta });
      g.edges.push({ from: "me", to: id, kind: directAt.length ? "group" : "gap" });
      groupIds.set(`company|${key}`, id); // people there attach to the target like a group
      g.groups[id] = directAt;
    }
    // Alumni: people who used to work there (ranked below current employees).
    const alumni = [...byKey.values()].flatMap(p => parseEntries(p.pastCompanies)
      .filter(e => normalizeOrg(e.name) === key && normalizeOrg(p.company) !== key).map(e => ({ name: p.name, years: e.years })))
      .sort((a, b) => a.name.localeCompare(b.name));
    g.targets.push({ label: t.company, key, focus: id, direct: directAt, second: secondAt, alumni,
                     priority: t.priority ?? "", stage: t.stage ?? "", notes: t.notes ?? "" });
  }

  const memberships = p => {
    const out = [];
    for (const [kind, value] of [["company", p.company], ...schoolsOf(p).map(s => ["school", s])]) {
      const gid = value && groupIds.get(`${kind}|${normalizeOrg(value)}`);
      if (gid && !out.includes(gid)) out.push(gid);
    }
    for (const t of p.tags) {
      const gid = groupIds.get(`tag|${t.toLowerCase()}`);
      if (gid) out.push(gid);
    }
    return out;
  };

  const targetKeys = new Set(g.targets.map(t => t.key));
  const personNode = (p, kind) => ({
    id: `p:${personKey(p)}`, label: p.name, kind, company: p.company, school: p.school, role: p.role,
    email: p.email, status: p.status, tags: p.tags, notes: p.notes, url: p.linkedinUrl, photo: p.photo,
    connectedOn: p.connectedOn, via: p.connectedThrough, source: p.source, pastCompanies: p.pastCompanies ?? "",
    atTarget: targetKeys.has(normalizeOrg(p.company)),
  });

  // ---- direct connections ------------------------------------------------
  for (const p of [...direct].sort(byName)) {
    g.nodes.push(personNode(p, "person"));
    const groups = memberships(p);
    if (groups.length) {
      g.edges.push({ from: groups[0], to: `p:${personKey(p)}`, kind: "member" });
      for (const extra of groups.slice(1)) g.edges.push({ from: extra, to: `p:${personKey(p)}`, kind: "also" });
    } else {
      g.edges.push({ from: "me", to: `p:${personKey(p)}`, kind: "direct" });
    }
  }

  // ---- 2nd-degree connections -------------------------------------------
  for (const p of [...second].sort(byName)) {
    g.nodes.push(personNode(p, "second"));
    g.edges.push({ from: `p:${normalizeName(p.connectedThrough)}`, to: `p:${personKey(p)}`, kind: "intro" });
    for (const gid of memberships(p)) g.edges.push({ from: gid, to: `p:${personKey(p)}`, kind: "also" });
  }

  // ---- alumni: past employers link to that company's bubble with a faint dotted line ----------------
  for (const p of byKey.values()) {
    const own = new Set(memberships(p));
    for (const e of parseEntries(p.pastCompanies)) {
      const gid = groupIds.get(`company|${normalizeOrg(e.name)}`);
      if (gid && !own.has(gid)) {
        own.add(gid);
        g.edges.push({ from: gid, to: `p:${personKey(p)}`, kind: "alumni", years: e.years });
      }
    }
  }

  g.stats = graphStats(g);
  return g;
}
