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
// * Target companies: groups and people at a target are flagged. A target with
//   nobody on the map becomes a hollow "gap" node linked to you.

import { normalizeName, normalizeOrg } from "./org.js";
import { makePerson, personKey } from "./people.js";

export const MIN_GROUP_SIZE = 3;

const targetLabel = t => (typeof t === "string" ? t : t.company);

/** Pick the most common original spelling as the label for each normalized org. */
function displayNames(people, attr) {
  const spellings = new Map();
  for (const p of people) {
    if (!p[attr]) continue;
    const key = normalizeOrg(p[attr]);
    const counts = spellings.get(key) ?? new Map();
    counts.set(p[attr], (counts.get(p[attr]) ?? 0) + 1);
    spellings.set(key, counts);
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
           groups: k("company") + k("school") + k("tag"), targets: g.targets.length, gaps: k("gap") };
}

export function buildGraph(people, { me = "Me", minGroupSize = MIN_GROUP_SIZE,
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

  g.nodes.push({ id: "me", label: me, kind: "me" });

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
    if (groupBy.includes("school") && p.school) add("school", normalizeOrg(p.school), p);
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
    g.nodes.push({ id: gid, label, kind, count: members.length });
    g.edges.push({ from: "me", to: gid, kind: "group" });
  }

  const memberships = p => {
    const out = [];
    for (const [kind, value] of [["company", p.company], ["school", p.school]]) {
      const gid = value && groupIds.get(`${kind}|${normalizeOrg(value)}`);
      if (gid) out.push(gid);
    }
    for (const t of p.tags) {
      const gid = groupIds.get(`tag|${t.toLowerCase()}`);
      if (gid) out.push(gid);
    }
    return out;
  };

  const personNode = (p, kind) => ({
    id: `p:${personKey(p)}`, label: p.name, kind, company: p.company, school: p.school, role: p.role,
    email: p.email, status: p.status, tags: p.tags, notes: p.notes, url: p.linkedinUrl, photo: p.photo,
    connectedOn: p.connectedOn, via: p.connectedThrough, source: p.source,
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

  // ---- target companies ---------------------------------------------------
  const nodesById = new Map(g.nodes.map(n => [n.id, n]));
  const seen = new Set();
  for (const t of targets) {
    const label = targetLabel(t);
    const key = normalizeOrg(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const at = [...byKey.values()].filter(p => p.company && normalizeOrg(p.company) === key);
    const directAt = at.filter(isDirect).map(p => p.name).sort();
    const secondAt = at.filter(p => !isDirect(p)).map(p => p.name).sort();
    for (const p of at) nodesById.get(`p:${personKey(p)}`).target = true;
    let focus;
    const gid = groupIds.get(`company|${key}`);
    if (gid) {
      nodesById.get(gid).target = true;
      focus = gid;
    } else if (at.length) {
      const first = [...at].sort((a, b) => (isDirect(b) - isDirect(a)) || byName(a, b))[0];
      focus = `p:${personKey(first)}`;
    } else {
      focus = `target:${key}`;
      g.nodes.push({ id: focus, label, kind: "gap", target: true });
      g.edges.push({ from: "me", to: focus, kind: "gap" });
    }
    g.targets.push({ label, focus, direct: directAt, second: secondAt });
  }

  g.stats = graphStats(g);
  return g;
}
