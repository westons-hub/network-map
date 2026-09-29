// Connections between people, beyond "who connects me to whom":
//   { a, b, type, notes }  — for "Introduced me", a introduced b to you (b hangs off a as 2nd-degree);
//   other types (Coworker, Classmate, Friend, Mentor, Other) are links between two people you know.
// Stored on the Connections sheet. People's "Connected Through" column is kept in sync with the
// "Introduced me" connections, so it still reads well in Excel (and edits typed there still import).

import { clean, normalizeName } from "./org.js";

export const INTRODUCED = "Introduced me";
export const CONNECTION_TYPES = [INTRODUCED, "Coworker", "Classmate", "Friend", "Mentor", "Other"];

const same = (x, y) => normalizeName(x) === normalizeName(y);
const samePair = (c, a, b) => (same(c.a, a) && same(c.b, b)) || (c.type !== INTRODUCED && same(c.a, b) && same(c.b, a));

/** A tidy connection record; unknown types are kept as typed (that's "Other: …"). */
export function makeConnection({ a = "", b = "", type = INTRODUCED, notes = "", extra = {} } = {}) {
  const t = CONNECTION_TYPES.find(x => x.toLowerCase() === clean(type).toLowerCase()) ?? (clean(type) || "Other");
  return { a: clean(a), b: clean(b), type: t, notes: String(notes ?? "").trim(), extra };
}

/** Everyone's connections that involve `name`, as { other, type, notes, dir: "introducedBy"|"introduced"|"link", conn }. */
export function connectionsOf(connections, name) {
  const out = [];
  for (const c of connections ?? []) {
    if (same(c.b, name) && c.type === INTRODUCED) out.push({ other: c.a, type: c.type, notes: c.notes, dir: "introducedBy", conn: c });
    else if (same(c.a, name) && c.type === INTRODUCED) out.push({ other: c.b, type: c.type, notes: c.notes, dir: "introduced", conn: c });
    else if (same(c.a, name)) out.push({ other: c.b, type: c.type, notes: c.notes, dir: "link", conn: c });
    else if (same(c.b, name)) out.push({ other: c.a, type: c.type, notes: c.notes, dir: "link", conn: c });
  }
  return out;
}

/**
 * Bring connections and the Connected Through column into agreement (mutates model). The column wins when it names
 * someone (so typing in Excel works); a blank column never deletes a connection from the sheet.
 */
export function reconcile(model) {
  model.connections ??= [];
  for (const p of model.people) {
    const intro = model.connections.find(c => c.type === INTRODUCED && same(c.b, p.name));
    if (p.connectedThrough) {
      if (!intro) model.connections.push(makeConnection({ a: p.connectedThrough, b: p.name }));
      else if (!same(intro.a, p.connectedThrough)) intro.a = p.connectedThrough;
    } else if (intro) p.connectedThrough = intro.a;
  }
  return model;
}

/** Add (or update) a connection; returns the new list. Introduced-me replaces any earlier introducer for b. */
export function withConnection(list, conn) {
  const c = makeConnection(conn);
  let next = (list ?? []).filter(x => !(samePair(x, c.a, c.b) && x.type === c.type));
  if (c.type === INTRODUCED) next = next.filter(x => !(x.type === INTRODUCED && same(x.b, c.b)));
  return [...next, c];
}

export function withoutConnection(list, { a, b, type }) {
  return (list ?? []).filter(x => !(x.type === type && samePair(x, a, b)));
}
