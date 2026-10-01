// Export to Excel: the tracker layout, formatting, and the round trip (export -> open again -> same data).

import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "../site/vendor/xlsx.mjs";
import { makeConnection } from "../site/js/core/connections.js";
import { exportFileName, exportWorkbook, modelForPeople } from "../site/js/core/export.js";
import { makePerson } from "../site/js/core/people.js";
import { emptyModel, readWorkbook, writeWorkbook } from "../site/js/core/workbook.js";

const future = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
function model() {
  return {
    ...emptyModel("Alex Rivera"),
    profile: { ...emptyModel().profile, school: "Stanford University", role: "MBA candidate" },
    people: [
      makePerson({ name: "Ana Díaz", company: "Acme", role: "PM", school: "BYU (2014–2018)", email: "ana@example.com",
                   linkedinUrl: "https://www.linkedin.com/in/ana-diaz", status: "Scheduled", tags: "pm, alumni",
                   notes: "Met at the mixer.\nFollow up about the APM program.", connectedOn: "2026-03-12",
                   headline: "PM at Acme", skills: "SQL; Pricing", about: "Two\nparagraphs",
                   extra: { "Date Reached Out": "2026-04-01", "Referral?": "Yes", "Relationship Plan": "Keep In Contact",
                            "Relevant Opportunities": "Acme APM", Birthday: "May 4" } }),
      makePerson({ name: "Bo Chen", company: "Globex", status: "To Reach Out" }),
      makePerson({ name: "Cy Park", connectedThrough: "Ana Díaz" }),
    ],
    connections: [makeConnection({ a: "Ana Díaz", b: "Cy Park" }), makeConnection({ a: "Ana Díaz", b: "Bo Chen", type: "Coworker" })],
    targets: [{ company: "Acme", priority: "1", stage: "Networking", notes: "", extra: {} }],
    meetings: [{ id: "m1", person: "Ana Díaz", date: future, start: "10:00", end: "10:30", type: "Coffee Chat", method: "Zoom",
                 notes: "", nextStep: "Send resume", eventId: "", link: "https://zoom.us/my/alex", extra: {} }],
    tasks: [{ id: "t1", task: "Send thank-you", person: "Ana Díaz", company: "Acme", due: future, done: false, created: "2026-04-02",
              source: "meeting", extra: {} }],
    experience: [{ person: "Ana Díaz", company: "Acme", title: "PM", start: "2021-03", end: "Present", location: "Provo", description: "", extra: {} }],
    education: [{ person: "Ana Díaz", school: "BYU", degree: "BS", field: "Economics", start: "2014", end: "2018", extra: {} }],
    pool: [{ firstName: "Dee", lastName: "Ng", url: "https://www.linkedin.com/in/dee", email: "", company: "Acme", position: "Eng", connectedOn: "2025-01-02" }],
  };
}
const strip = m => ({ ...m, notices: [], people: m.people.map(p => ({ ...p, source: "" })) });

test("file name is Orbit-export-YYYY-MM-DD.xlsx", () => {
  assert.equal(exportFileName("2026-09-29"), "Orbit-export-2026-09-29.xlsx");
});

test("round trip: export everything, open it again, same data", () => {
  const m = model();
  const back = readWorkbook(exportWorkbook(m).bytes);
  assert.deepEqual(strip(back), strip(m));
});

test("People is in the tracker layout with derived columns filled in and a Profile link", () => {
  const wb = XLSX.read(exportWorkbook(model()).bytes, { type: "array", cellDates: true });
  const ws = wb.Sheets.People;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  assert.deepEqual(rows[0].slice(0, 15), ["Name", "Company", "Role / Background", "How We're Connected", "LinkedIn", "Meeting Type",
    "Method", "Status", "Date Reached Out", "Meeting Date", "Follow-Up Date", "Referral?", "Relevant Opportunities", "Next Steps",
    "Relationship Plan"]);
  const ana = Object.fromEntries(rows[0].map((h, i) => [h, rows[1][i]]));
  assert.equal(ana["How We're Connected"], "BYU; Introduced you to Cy Park; Coworker: Bo Chen");
  assert.equal(ana.LinkedIn, "Profile");
  assert.equal(ws.E2.l.Target, "https://www.linkedin.com/in/ana-diaz");
  assert.equal(ana["Meeting Type"], "Coffee Chat");
  assert.equal(ana.Method, "Zoom");
  assert.equal(ana["Next Steps"], "Send thank-you");
  assert.equal(ana["Referral?"], "Yes");
  const email = rows[0].indexOf("Email");
  assert.equal(ws[XLSX.utils.encode_cell({ r: 1, c: email })].l.Target, "mailto:ana@example.com");
  assert.deepEqual(wb.SheetNames.slice(0, 1), ["People"]);
  for (const s of ["Experience", "Education", "Connections", "Targets", "Meetings", "Tasks"]) assert.ok(wb.SheetNames.includes(s), s);
});

test("frozen bold header, wrapped long text, dropdowns and auto widths", () => {
  const bytes = exportWorkbook(model()).bytes;
  const zip = XLSX.CFB.read(bytes, { type: "array" });
  const xml = path => new TextDecoder().decode(zip.FileIndex[zip.FullPaths.findIndex(p => p.endsWith(path))].content);
  const people = xml("xl/worksheets/sheet1.xml");
  assert.match(people, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(people, /<dataValidation type="list"[^>]*sqref="H2:H\d+"><formula1>"To Reach Out,Contacted,Scheduled,Met,Follow Up,Referral"<\/formula1>/);
  assert.match(people, /<formula1>"Coffee Chat,Informational,Networking Event,Class\/Club,Interview,Other"<\/formula1>/);
  assert.match(people, /<formula1>"Keep In Contact,Follow Up Later,One-Time"<\/formula1>/);
  assert.match(people, /<autoFilter ref="A1:/);
  const styles = xml("xl/styles.xml");
  assert.match(styles, /<font><b\/>/);
  assert.match(styles, /<alignment wrapText="1" vertical="top"\/>/);
  const wb = XLSX.read(bytes, { type: "array", cellStyles: true });
  const cols = wb.Sheets.People["!cols"].map(c => c.wch);
  assert.ok(cols.every(w => w >= 8 && w <= 62), "widths fit the content, capped");
});

test("one person: only them and their history, meetings, tasks and connections", () => {
  const { bytes, what } = exportWorkbook(model(), { kind: "people", names: ["Ana Díaz"] });
  assert.equal(what, "Ana Díaz");
  const back = readWorkbook(bytes);
  assert.deepEqual(back.people.map(p => p.name), ["Ana Díaz"]);
  assert.equal(back.meetings.length, 1);
  assert.equal(back.tasks.length, 1);
  assert.equal(back.experience.length, 1);
  assert.equal(back.connections.length, 2);
  assert.equal(back.pool.length, 0);
  assert.equal(modelForPeople(model(), ["Bo Chen"]).meetings.length, 0);
});

test("this view: a filtered LinkedIn pool, or just the tasks", () => {
  const m = model();
  const pool = XLSX.read(exportWorkbook(m, { kind: "pool", entries: m.pool }).bytes, { type: "array" });
  assert.deepEqual(pool.SheetNames, ["LinkedIn Pool"]);
  const tasks = readWorkbook(exportWorkbook(m, { kind: "tasks", tasks: m.tasks }).bytes);
  assert.equal(tasks.tasks.length, 1);
});

test("opening a tracker you already keep: meetings, follow-ups and how you're connected come in", () => {
  const rows = [["Name", "Company", "Role / Background", "How We're Connected", "LinkedIn", "Meeting Type", "Method", "Status",
                 "Date Reached Out", "Meeting Date", "Follow-Up Date", "Referral?", "Relevant Opportunities", "Next Steps", "Relationship Plan"],
    ["Jamie Ortega", "Northwind / Contoso", "Strategy Analyst at Northwind", "BYU; 11 mutual connections (Casey, Morgan)", "Profile", "Coffee Chat", "Phone",
     "met", "", new Date(2026, 8, 3), new Date(2026, 9, 5), "No", "Contoso APM; Northwind", "Send thank-you within 24 hrs; ask for resume review", "Keep In contact"],
    ["Casey Park", "Acme", "", "", "", "", "", "contacted", "", "", "", "", "", "", ""]];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws.E2.l = { Target: "https://www.linkedin.com/in/jamie-ortega" };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Networking");
  const m = readWorkbook(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })));
  const d = m.people[0];
  assert.deepEqual([d.name, d.role, d.status, d.linkedinUrl, m.people[1].status], ["Jamie Ortega", "Strategy Analyst at Northwind", "Met",
    "https://www.linkedin.com/in/jamie-ortega", "Contacted"]);
  assert.deepEqual(m.meetings.map(x => [x.person, x.date, x.type, x.method]), [["Jamie Ortega", "2026-09-03", "Coffee Chat", "Phone"]]);
  assert.deepEqual(m.tasks.map(t => [t.task, t.due]), [["Send thank-you within 24 hrs; ask for resume review", "2026-10-05"]]);
  assert.equal(d.connectedThrough, "Casey Park"); // "Casey" is the only Casey on the map
  assert.equal(d.extra["Connection Notes"], "BYU; 11 mutual connections (Casey, Morgan)");
  assert.deepEqual([d.extra["Referral?"], d.extra["Relevant Opportunities"], d.extra["Relationship Plan"]], ["No", "Contoso APM; Northwind", "Keep In contact"]);
  assert.ok(!("Meeting Date" in d.extra) && !("How We're Connected" in d.extra));
  assert.match(m.notices.join(" "), /1 meeting and 1 follow-up/);
  // Saving it writes the tracker layout again, with nothing duplicated.
  const back = readWorkbook(writeWorkbook(m));
  assert.deepEqual(back.people.map(p => p.extra), m.people.map(p => p.extra));
  assert.equal(back.meetings.length, 1);
});
