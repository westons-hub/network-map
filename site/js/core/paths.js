// Turn "who can intro me?" answers into things the map can draw: the nodes and
// edges along your best path to a target, and a node's neighborhood for highlighting.

import { parseEntries, sharedWithMe } from "./history.js";
import { normalizeName, normalizeOrg } from "./org.js";

export const edgeId = e => `${e.from}>${e.to}>${e.kind}`;

// Among equally short paths, ask the person you're warmest with first.
const WARMTH = { "met": 0, "referral": 1, "follow up": 2, "contacted": 3, "": 4, "to reach out": 5 };
const warmth = status => WARMTH[String(status ?? "").trim().toLowerCase()] ?? 4;

/**
 * Your best (shortest) way into a target company: a breadth-first search from you over everyone you know directly,
 * "Introduced me" links (introducer → the person they introduced) and person-to-person connections (Coworker,
 * Classmate, Friend, Mentor, Other; both ways). Among equally short paths, the one that starts with the contact you're
 * warmest with wins; sharing a school or an employer with you (from your profile) makes a contact warmer. People who
 * currently work there come first; if none is reachable, someone who used to (alumni).
 * Returns { names: [me, ..., person], ask, person, nodes: [ids], edges: [edge ids], alumni } or null.
 */
export function bestPath(graph, people, target, me, profile = {}) {
  const key = normalizeOrg(target.label ?? target.company ?? target);
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const status = new Map(people.map(p => {
    const s = sharedWithMe(profile, p, normalizeOrg);
    // Half a step warmer for a shared school or former employer: a "Met" contact still beats a stranger classmate.
    return [`p:${normalizeName(p.name)}`, warmth(p.status) - (s.schools.length || s.companies.length ? 0.5 : 0)];
  }));

  // Adjacency between you and people.
  const adj = new Map();
  const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); if (!adj.get(a).includes(b)) adj.get(a).push(b); };
  for (const n of graph.nodes) if (n.kind === "person") link("me", n.id);
  for (const e of graph.edges) {
    if (e.kind === "intro") link(e.from, e.to);
    if (e.kind === "link") { link(e.from, e.to); link(e.to, e.from); }
  }
  // Warmest first, so breadth-first search prefers them among equally short paths.
  const warm = id => status.get(id) ?? 4;
  for (const list of adj.values()) list.sort((a, b) => warm(a) - warm(b) || a.localeCompare(b));

  const parent = new Map([["me", null]]);
  const queue = ["me"];
  while (queue.length) {
    const id = queue.shift();
    for (const next of adj.get(id) ?? []) if (!parent.has(next)) { parent.set(next, id); queue.push(next); }
  }
  const route = id => { const out = []; for (let x = id; x && x !== "me"; x = parent.get(x)) out.unshift(x); return out; };

  const pick = ids => ids.filter(id => parent.has(id)).map(id => ({ id, route: route(id) }))
    .sort((a, b) => a.route.length - b.route.length || warm(a.route[0]) - warm(b.route[0]))[0];
  const current = people.filter(p => p.company && normalizeOrg(p.company) === key).map(p => `p:${normalizeName(p.name)}`);
  const former = people.filter(p => parseEntries(p.pastCompanies).some(e => normalizeOrg(e.name) === key))
    .map(p => `p:${normalizeName(p.name)}`);
  let best = pick(current), alumni = false;
  if (!best) { best = pick(former); alumni = !!best; }
  if (!best) return null;

  const focus = graph.targets.find(t => t.key === key)?.focus;
  const find = (a, b) => graph.edges.find(e => (e.from === a && e.to === b) || (e.from === b && e.to === a));
  const seq = ["me", ...best.route];
  const nodes = ["me"], edges = [];
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    let e = find(a, b);
    if (!e && a === "me") {
      // You know them through a group bubble: me -> group -> person.
      const via = graph.edges.find(x => x.to === b && x.kind === "member");
      const hop = via && find("me", via.from);
      if (hop) { edges.push(edgeId(hop)); nodes.push(via.from); e = via; }
    }
    if (e) edges.push(edgeId(e));
    nodes.push(b);
  }
  if (focus && !nodes.includes(focus)) {
    const e = find(focus, seq.at(-1));
    if (e) edges.push(edgeId(e));
    nodes.push(focus);
  }
  const names = [me, ...best.route.map(id => byId.get(id)?.label ?? id)];
  return { names, ask: names[1], person: names.at(-1), nodes, edges, alumni };
}

/** A node plus everything one edge away (including secondary "also" links). */
export function neighborhood(graph, id) {
  const nodes = new Set([id]);
  const edges = new Set();
  for (const e of graph.edges) {
    if (e.from === id || e.to === id) {
      nodes.add(e.from);
      nodes.add(e.to);
      edges.add(edgeId(e));
    }
  }
  return { nodes, edges };
}
