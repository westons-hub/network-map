// Answer "who can introduce me to X?" from your people.
//
// X can be a company (matched like group names, so "EY" finds "Ernst & Young")
// or part of a person's name. For each match we walk the "Connected Through"
// chain back to you, so a 3rd-degree contact shows the full path:
// You -> Liam Walsh -> Zoe Adams -> Sam Rivera.

import { normalizeName, normalizeOrg } from "./org.js";
import { makePerson, personKey } from "./people.js";

/** Names from your first contact to the person (inclusive). Stops on cycles. */
function chainTo(p, byKey, meKey) {
  const chain = [p.name];
  const seen = new Set([personKey(p)]);
  let current = p;
  while (current.connectedThrough) {
    const ck = normalizeName(current.connectedThrough);
    if (ck === meKey || seen.has(ck)) break;
    seen.add(ck);
    current = byKey.get(ck) ?? makePerson({ name: current.connectedThrough });
    chain.unshift(current.name);
  }
  return chain;
}

/**
 * Everyone matching `query` (company or name) with the path from you to them,
 * shortest first: [{ person, chain, degree, ask }].
 */
export function whoCanIntro(people, query, me = "Me") {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return [];
  const meKey = normalizeName(me);
  const byKey = new Map(people.filter(p => personKey(p) !== meKey).map(p => [personKey(p), p]));
  const orgKey = normalizeOrg(query);
  const words = q.split(/\s+/);
  // Whole-word name match, so "EY" finds Ernst & Young but not "Casey".
  const matches = [...byKey.values()].filter(p => {
    if (p.company && normalizeOrg(p.company) === orgKey) return true;
    const nameWords = new Set(p.name.toLowerCase().split(/\s+/));
    return words.every(w => nameWords.has(w));
  });
  return matches
    .map(person => {
      const chain = chainTo(person, byKey, meKey);
      return { person, chain, degree: chain.length, ask: chain[0] };
    })
    .sort((a, b) => a.degree - b.degree || (a.person.name < b.person.name ? -1 : a.person.name > b.person.name ? 1 : 0));
}

function describe(path, me, byKey) {
  const p = path.person;
  const who = p.name + (p.role ? `, ${p.role}` : "") + (p.company ? ` at ${p.company}` : "");
  const status = p.status ? ` [${p.status}]` : "";
  if (path.degree === 1) return `- **${who}**${status}: you know them directly.`;
  const route = [me, ...path.chain].join(" → ");
  const first = byKey.get(normalizeName(path.ask));
  const firstStatus = first?.status ? ` (your status with them: ${first.status})` : "";
  return `- **${who}**${status}: ask **${path.ask}**${firstStatus}. Path: ${route}`;
}

/** Markdown report covering each query (usually your target companies). */
export function introReport(people, queries, me = "Me") {
  const byKey = new Map(people.map(p => [personKey(p), p]));
  const lines = [`# Who can intro ${me}?`, ""];
  const gaps = [];
  for (const q of queries) {
    const paths = whoCanIntro(people, q, me);
    lines.push(`## ${q}`);
    if (!paths.length) {
      lines.push("- No one on your map yet. Add a contact there, or ask your groups who they know.");
      gaps.push(q);
    } else {
      const direct = paths.filter(x => x.degree === 1).length;
      lines.push(`_${paths.length} on your map, ${direct} you know directly._`);
      for (const x of paths) lines.push(describe(x, me, byKey));
    }
    lines.push("");
  }
  if (gaps.length) lines.push("## Gaps", `Targets with no one on your map: ${gaps.join(", ")}`, "");
  return lines.join("\n");
}
