// The networking-tracker layout of the People sheet (spec section E), used by Export:
//   Name | Company | Role / Background | How We're Connected | LinkedIn | Meeting Type | Method | Status |
//   Date Reached Out | Meeting Date | Follow-Up Date | Referral? | Relevant Opportunities | Next Steps | Relationship Plan
// then the rest of the person's fields.
//
// Some columns are filled in from the rest of the workbook (DERIVED): How We're Connected (schools + connections),
// Meeting Type / Method / Meeting Date (the next meeting, or the latest), Follow-Up Date and Next Steps (the next
// open task). When an Orbit export is opened again those come back from the Meetings, Tasks and Connections
// sheets, so the derived copies are skipped. The others (Date Reached Out, Referral?, Relevant Opportunities,
// Relationship Plan) are kept as the person's own columns.

import { INTRODUCED, connectionsOf } from "./connections.js";
import { parseEntries } from "./history.js";
import { normalizeName } from "./org.js";
import { meetingDate, meetingsFor } from "./schedule.js";

export const OWN_TRACKER_COLUMNS = ["Date Reached Out", "Referral?", "Relevant Opportunities", "Relationship Plan"];
export const DERIVED_COLUMNS = ["How We're Connected", "Meeting Type", "Method", "Meeting Date", "Follow-Up Date", "Next Steps"];
export const REFERRAL = ["Yes", "No"];
export const RELATIONSHIP_PLANS = ["Keep In Contact", "Follow Up Later", "One-Time"];

const extraValue = (p, header) => {
  const k = Object.keys(p.extra ?? {}).find(h => h.toLowerCase() === header.toLowerCase());
  return k === undefined ? "" : p.extra[k];
};

/** "BYU; Introduced by Liam Walsh; Friend: Mia Chen". */
export function howConnected(model, p) {
  const parts = parseEntries(p.school).map(e => e.name);
  for (const c of connectionsOf(model.connections, p.name)) {
    if (c.dir === "introducedBy") parts.push(`Introduced by ${c.other}`);
    else if (c.dir === "introduced") parts.push(`Introduced you to ${c.other}`);
    else parts.push(`${c.type === INTRODUCED ? "Introduced" : c.type}: ${c.other}`);
  }
  const notes = extraValue(p, "Connection Notes"); // what your own tracker said, kept as you wrote it
  if (notes && !parts.includes(notes)) parts.push(notes);
  return parts.join("; ");
}

/**
 * Tracker cells for one person: { header: value }. `link` values are { text, url } so the writer can make a
 * hyperlink ("Profile" -> their LinkedIn).
 */
export function trackerCells(model, p) {
  const md = meetingDate(model, p.name);
  const open = (model.tasks ?? []).filter(t => !t.done && normalizeName(t.person) === normalizeName(p.name))
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const latest = meetingsFor(model, p.name).filter(m => m.nextStep).at(-1);
  return {
    "Name": p.name,
    "Company": p.company,
    "Role / Background": p.role,
    "How We're Connected": howConnected(model, p),
    "LinkedIn": p.linkedinUrl ? { text: "Profile", url: p.linkedinUrl } : "",
    "Meeting Type": md?.meeting.type ?? "",
    "Method": md?.meeting.method ?? "",
    "Status": p.status,
    "Date Reached Out": extraValue(p, "Date Reached Out"),
    "Meeting Date": md?.meeting.date ?? "",
    "Follow-Up Date": open[0]?.due ?? "",
    "Referral?": extraValue(p, "Referral?"),
    "Relevant Opportunities": extraValue(p, "Relevant Opportunities"),
    "Next Steps": open[0]?.task || latest?.nextStep || "",
    "Relationship Plan": extraValue(p, "Relationship Plan"),
  };
}

export const TRACKER_HEADERS = ["Name", "Company", "Role / Background", "How We're Connected", "LinkedIn", "Meeting Type",
  "Method", "Status", "Date Reached Out", "Meeting Date", "Follow-Up Date", "Referral?", "Relevant Opportunities",
  "Next Steps", "Relationship Plan"];
