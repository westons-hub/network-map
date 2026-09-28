// Turn "who can intro me?" answers into things the map can draw: the nodes and
// edges along your best path to a target, and a node's neighborhood for highlighting.

import { whoCanIntro } from "./intro.js";
import { normalizeName, normalizeOrg } from "./org.js";

export const edgeId = e => `${e.from}>${e.to}>${e.kind}`;

// Among equally short paths, ask the person you're warmest with first.
const WARMTH = { "met": 0, "referral": 1, "follow up": 2, "contacted": 3, "": 4, "to reach out": 5 };
const warmth = status => WARMTH[String(status ?? "").trim().toLowerCase()] ?? 4;

/**
 * Your best (shortest) way into a target company.
 * Returns { names: [me, ..., person], ask, person, nodes: [ids], edges: [edge ids] }, or null if no one is there.
 */
export function bestPath(graph, people, target, me) {
  const key = normalizeOrg(target.label ?? target.company ?? target);
  const byKey = new Map(people.map(p => [normalizeName(p.name), p]));
  const best = whoCanIntro(people, target.label ?? target.company ?? target, me)
    .filter(p => p.person.company && normalizeOrg(p.person.company) === key)
    .sort((a, b) => a.degree - b.degree
                    || warmth(byKey.get(normalizeName(a.ask))?.status) - warmth(byKey.get(normalizeName(b.ask))?.status))[0];
  if (!best) return null;

  const focus = graph.targets.find(t => t.key === key)?.focus;
  const seq = ["me", ...best.chain.map(n => `p:${normalizeName(n)}`)];
  const edges = [];
  const nodes = ["me"];
  const find = (a, b) => graph.edges.find(e => (e.from === a && e.to === b) || (e.from === b && e.to === a));

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
    const last = seq[seq.length - 1];
    const e = find(focus, last);
    if (e) edges.push(edgeId(e));
    nodes.push(focus);
  }
  return { names: [me, ...best.chain], ask: best.ask, person: best.person.name, nodes, edges };
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
