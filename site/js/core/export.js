// Export to Excel: everything, just what you're looking at, or one person. The file opens straight in Excel with
// the People sheet in your networking-tracker layout, and it can be opened in Orbit again (it's a full workbook).

import { normalizeName } from "./org.js";
import { todayIso } from "./schedule.js";
import { writeWorkbook } from "./workbook.js";

export const exportFileName = (today = todayIso()) => `Orbit-export-${today}.xlsx`;

// The sheets a people export carries: the people, plus everything about them.
const PEOPLE_SHEETS = ["people", "experience", "education", "connections", "meetings", "tasks"];

/** The model narrowed to some people (and their history, connections, meetings and tasks). */
export function modelForPeople(model, names) {
  const keys = new Set(names.map(normalizeName));
  const mine = x => keys.has(normalizeName(x.person));
  return {
    ...model,
    people: model.people.filter(p => keys.has(normalizeName(p.name))),
    experience: (model.experience ?? []).filter(mine),
    education: (model.education ?? []).filter(mine),
    meetings: (model.meetings ?? []).filter(mine),
    tasks: (model.tasks ?? []).filter(mine),
    connections: (model.connections ?? []).filter(c => keys.has(normalizeName(c.a)) || keys.has(normalizeName(c.b))),
  };
}

/**
 * scope: { kind: "all" } · { kind: "people", names } · { kind: "pool", entries } · { kind: "tasks", tasks } ·
 * { kind: "meetings", meetings }. Returns { bytes, name, count, what }.
 */
export function exportWorkbook(model, scope = { kind: "all" }) {
  const name = exportFileName();
  switch (scope.kind) {
    case "people": {
      const m = modelForPeople(model, scope.names);
      return { bytes: writeWorkbook(m, undefined, { tracker: true, only: PEOPLE_SHEETS }), name, count: m.people.length,
               what: m.people.length === 1 ? m.people[0].name : `${m.people.length} people` };
    }
    case "pool":
      return { bytes: writeWorkbook({ ...model, pool: scope.entries }, undefined, { only: ["pool"] }), name,
               count: scope.entries.length, what: `${scope.entries.length} LinkedIn connections` };
    case "tasks":
      return { bytes: writeWorkbook({ ...model, tasks: scope.tasks }, undefined, { only: ["tasks"] }), name,
               count: scope.tasks.length, what: `${scope.tasks.length} tasks` };
    case "meetings":
      return { bytes: writeWorkbook({ ...model, meetings: scope.meetings }, undefined, { only: ["meetings"] }), name,
               count: scope.meetings.length, what: `${scope.meetings.length} meetings` };
    default:
      return { bytes: writeWorkbook(model, undefined, { tracker: true }), name, count: model.people.length, what: "everything" };
  }
}
