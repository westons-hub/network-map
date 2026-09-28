// Every edit is a small operation. Keeping unsaved edits as a list means that
// if the workbook changed on disk (you edited it in Excel), we can reload the
// file and replay just your pending edits instead of overwriting it.

import { normalizeName, normalizeOrg } from "./org.js";
import { makePerson, personKey } from "./people.js";

const clone = m => structuredClone(m);

/** Apply one operation, returning a new model (the input is not changed). */
export function applyOp(model, op) {
  const m = clone(model);
  switch (op.type) {
    case "setMe":
      m.me = op.name;
      break;
    case "setAvatarStyle":
      m.avatarStyle = op.style;
      break;
    case "upsertPerson": { // op.key = the person's key before the edit (absent when adding)
      const person = makePerson(op.person);
      const key = op.key ?? personKey(person);
      const i = m.people.findIndex(p => personKey(p) === key);
      if (i >= 0) {
        person.extra = { ...m.people[i].extra, ...person.extra };
        m.people[i] = person;
      } else m.people.push(person);
      if (op.key && op.key !== personKey(person)) renameConnector(m, op.key, person.name);
      break;
    }
    case "removePerson":
      m.people = m.people.filter(p => personKey(p) !== op.key);
      break;
    case "upsertTarget": { // op.key = normalized company before the edit (absent when adding)
      const t = { company: "", priority: "", stage: "", notes: "", extra: {}, ...op.target };
      const key = op.key ?? normalizeOrg(t.company);
      const i = m.targets.findIndex(x => normalizeOrg(x.company) === key);
      if (i >= 0) m.targets[i] = { ...m.targets[i], ...t };
      else m.targets.push(t);
      break;
    }
    case "removeTarget":
      m.targets = m.targets.filter(t => normalizeOrg(t.company) !== op.key);
      break;
    case "setLayout":
      m.layout = { ...m.layout, ...op.positions };
      break;
    case "clearLayout":
      m.layout = {};
      break;
    case "replaceModel": // restoring a backup
      return clone(op.model);
    default:
      throw new Error(`Unknown edit: ${op.type}`);
  }
  return m;
}

export const replay = (model, ops) => ops.reduce(applyOp, model);

/** Someone was renamed: keep people who were "Connected Through" them attached. */
function renameConnector(m, oldKey, newName) {
  for (const p of m.people) {
    if (normalizeName(p.connectedThrough) === oldKey) p.connectedThrough = newName;
  }
}
