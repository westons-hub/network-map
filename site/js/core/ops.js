// Every edit is a small operation. Keeping unsaved edits as a list means that
// if the workbook changed on disk (you edited it in Excel), we can reload the
// file and replay just your pending edits instead of overwriting it.

import { normalizeName, normalizeOrg } from "./org.js";
import { makePerson, personKey } from "./people.js";
import { INTRODUCED, reconcile, withConnection, withoutConnection } from "./connections.js";
import { formatEntries, mergeHistoryRows, parseEntries } from "./history.js";
import { mergePool } from "./pool.js";

const clone = m => structuredClone(m);

/** Apply one operation, returning a new model (the input is not changed). */
export function applyOp(model, op) {
  const m = clone(model);
  switch (op.type) {
    case "setMe":
      m.me = op.name;
      break;
    case "setProfile": // your own profile (the center node); a name change also renames "me"
      m.profile = { ...(m.profile ?? {}), ...op.fields };
      if (op.fields.name !== undefined) { m.me = op.fields.name; delete m.profile.name; }
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
      if (op.key && op.key !== personKey(person)) {
        renameConnector(m, op.key, person.name);
        renameInLogs(m, person.name, op.key);
      }
      break;
    }
    case "patchPerson": { // inline edit: only the fields that changed, so it replays safely after a reload
      const i = m.people.findIndex(p => personKey(p) === op.key);
      if (i < 0) break;
      const person = makePerson({ ...m.people[i], ...op.fields });
      person.extra = m.people[i].extra;
      person.source = m.people[i].source;
      m.people[i] = person;
      if (op.fields.name !== undefined && personKey(person) !== op.key) {
        renameConnector(m, op.key, person.name);
        renameInLogs(m, m.people[i].name, op.key);
      }
      break;
    }
    case "addHistory": // rows from a LinkedIn profile PDF: { experience: [...], education: [...] }; duplicates are skipped
      m.experience = mergeHistoryRows(m.experience ?? [], op.experience ?? [], "experience").rows;
      m.education = mergeHistoryRows(m.education ?? [], op.education ?? [], "education").rows;
      break;
    case "removePerson":
      m.people = m.people.filter(p => personKey(p) !== op.key);
      m.experience = (m.experience ?? []).filter(r => normalizeName(r.person) !== op.key);
      m.education = (m.education ?? []).filter(r => normalizeName(r.person) !== op.key);
      m.connections = (m.connections ?? []).filter(c => normalizeName(c.a) !== op.key && normalizeName(c.b) !== op.key);
      break;
    case "addConnection": { // { a, b, type, notes } — "Introduced me" also sets b's Connected Through
      m.connections = withConnection(m.connections, op.connection);
      if (op.connection.type === INTRODUCED) {
        const p = m.people.find(x => normalizeName(x.name) === normalizeName(op.connection.b));
        if (p) p.connectedThrough = op.connection.a;
      }
      break;
    }
    case "removeConnection": {
      m.connections = withoutConnection(m.connections, op.connection);
      if (op.connection.type === INTRODUCED) {
        const p = m.people.find(x => normalizeName(x.name) === normalizeName(op.connection.b));
        if (p && normalizeName(p.connectedThrough) === normalizeName(op.connection.a)) p.connectedThrough = "";
      }
      break;
    }
    case "upsertMeeting": {
      const i = m.meetings.findIndex(x => x.id === op.meeting.id);
      const meeting = { extra: {}, ...(i >= 0 ? m.meetings[i] : {}), ...op.meeting };
      if (i >= 0) m.meetings[i] = meeting; else m.meetings.push(meeting);
      break;
    }
    case "removeMeeting":
      m.meetings = m.meetings.filter(x => x.id !== op.id);
      break;
    case "upsertTask": {
      const i = m.tasks.findIndex(x => x.id === op.task.id);
      const task = { extra: {}, ...(i >= 0 ? m.tasks[i] : {}), ...op.task };
      if (i >= 0) m.tasks[i] = task; else m.tasks.push(task);
      break;
    }
    case "removeTask":
      m.tasks = m.tasks.filter(x => x.id !== op.id);
      break;
    case "mergePool": // importing Connections.csv into this workbook (no duplicates)
      m.pool = mergePool(m.pool, op.entries).pool;
      break;
    case "setSettings":
      m.settings = { ...m.settings, ...op.settings };
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
    case "upsertCompany": { // a company/school dot's website and picture (the Companies sheet)
      const key = normalizeOrg(op.company.company);
      const i = m.companies.findIndex(c => normalizeOrg(c.company) === key);
      const row = { company: op.company.company, website: op.company.website ?? "", logo: op.company.logo ?? "", extra: {} };
      if (i >= 0) m.companies[i] = { ...m.companies[i], ...row, extra: m.companies[i].extra ?? {} };
      else m.companies.push(row);
      break;
    }
    case "changeOrgKind": // { name, to: "school" | "company" }: move it between people's Schools and Company / Past Companies
      changeOrgKind(m, op.name, op.to);
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
  if ((op.type === "upsertPerson" || op.type === "patchPerson") && (op.person?.connectedThrough !== undefined
      || op.fields?.connectedThrough !== undefined)) {
    syncIntroducer(m, op.type === "upsertPerson" ? op.person.name : (op.fields.name ?? m.people.find(p => personKey(p) === op.key)?.name));
  }
  return m;
}

/** A person's Connected Through was edited directly: make their "Introduced me" connection match (or remove it). */
function syncIntroducer(m, name) {
  const p = m.people.find(x => normalizeName(x.name) === normalizeName(name));
  if (!p) return;
  m.connections = (m.connections ?? []).filter(c => !(c.type === INTRODUCED && normalizeName(c.b) === normalizeName(p.name)));
  reconcile(m);
}

export const replay = (model, ops) => ops.reduce(applyOp, model);

/**
 * A dot changes type. School -> Company: it leaves each person's Schools and becomes their Company, or a Past
 * Company (with the same years) if they already have a company. Company -> School: the reverse, from Company
 * and Past Companies into Schools.
 */
function changeOrgKind(m, name, to) {
  const key = normalizeOrg(name);
  const same = e => normalizeOrg(e.name) === key;
  for (const p of m.people) {
    if (to === "company") {
      const hit = parseEntries(p.school).filter(same);
      if (!hit.length) continue;
      p.school = formatEntries(parseEntries(p.school).filter(e => !same(e)));
      if (!p.company) p.company = name;
      else if (normalizeOrg(p.company) !== key && !parseEntries(p.pastCompanies).some(same)) {
        p.pastCompanies = formatEntries([...parseEntries(p.pastCompanies), { name, years: hit[0].years }]);
      }
    } else {
      const current = normalizeOrg(p.company) === key;
      const past = parseEntries(p.pastCompanies).filter(same);
      if (!current && !past.length) continue;
      if (current) p.company = "";
      p.pastCompanies = formatEntries(parseEntries(p.pastCompanies).filter(e => !same(e)));
      if (!parseEntries(p.school).some(same)) p.school = formatEntries([...parseEntries(p.school), { name, years: past[0]?.years ?? "" }]);
    }
  }
}

/** Someone was renamed: their meetings, tasks and history follow them. */
function renameInLogs(m, newName, oldKey) {
  for (const x of [...m.meetings, ...m.tasks, ...(m.experience ?? []), ...(m.education ?? [])]) if (normalizeName(x.person) === oldKey) x.person = newName;
  for (const c of m.connections ?? []) {
    if (normalizeName(c.a) === oldKey) c.a = newName;
    if (normalizeName(c.b) === oldKey) c.b = newName;
  }
}

/** Someone was renamed: keep people who were "Connected Through" them attached. */
function renameConnector(m, oldKey, newName) {
  for (const p of m.people) {
    if (normalizeName(p.connectedThrough) === oldKey) p.connectedThrough = newName;
  }
}
