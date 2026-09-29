// Search the map by anything: names (people, companies, schools, groups) and every field of a person, with the
// field that matched ("Skills: SQL") so the result explains itself.

import { normalizeOrg } from "./org.js";
import { personKey } from "./people.js";

const FIELDS = [["company", "Company"], ["pastCompanies", "Past companies"], ["school", "Schools"], ["role", "Role"],
  ["headline", "Headline"], ["skills", "Skills"], ["languages", "Languages"], ["certifications", "Certifications"],
  ["tags", "Tags"], ["location", "Location"], ["notes", "Notes"], ["about", "About"], ["email", "Email"]];

/** The part of a long value around the match, so the label stays short. */
function snippet(text, q) {
  const parts = String(text).split(/[;,\n]/).map(s => s.trim()).filter(Boolean);
  const hit = parts.find(p => p.toLowerCase().includes(q)) ?? String(text);
  return hit.length > 48 ? `${hit.slice(0, 45)}…` : hit;
}

/** -> [{ id, label, field, value }], best first, at most `limit`. */
export function searchMap(graph, people, query, limit = 8) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return [];
  const onMap = new Set(graph.nodes.map(n => n.id));
  const out = [], seen = new Set();
  const push = r => { if (!seen.has(r.id) && onMap.has(r.id)) { seen.add(r.id); out.push(r); } };
  const orgQ = normalizeOrg(q);
  // 1) Names: people, then groups and targets (a name that starts with the query first).
  const byName = graph.nodes.filter(n => n.kind !== "me" && String(n.label ?? "").toLowerCase().includes(q)
                                         || (n.key && normalizeOrg(n.label ?? "") === orgQ))
    .sort((a, b) => Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)) ||
                    Number(!a.id.startsWith("p:")) - Number(!b.id.startsWith("p:")));
  for (const n of byName) push({ id: n.id, label: n.label, field: n.id.startsWith("p:") ? "Name" : n.field ?? n.kind, value: "" });
  // 2) Any field of a person.
  for (const [f, name] of FIELDS) {
    for (const p of people) {
      const v = f === "tags" ? (p.tags ?? []).join(", ") : p[f];
      if (!v) continue;
      const text = String(v).toLowerCase();
      const hit = text.includes(q) || ((f === "company" || f === "school" || f === "pastCompanies") && normalizeOrg(String(v)) === orgQ);
      if (hit) push({ id: `p:${personKey(p)}`, label: p.name, field: name, value: snippet(v, q) });
    }
  }
  return out.slice(0, limit);
}
