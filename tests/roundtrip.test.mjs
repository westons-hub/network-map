// Save -> close -> open is lossless: every kind of data in a workbook comes back identical, through the same
// code path the app uses to save (sync.js), saved twice in a row, and after a re-save by another spreadsheet
// program (a plain SheetJS read/write without our formatting stands in for that here; Excel is checked by hand).

import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "../site/vendor/xlsx.mjs";
import { makeConnection } from "../site/js/core/connections.js";
import { makePerson } from "../site/js/core/people.js";
import { saveDoc } from "../site/js/core/sync.js";
import { emptyModel, readWorkbook, writeWorkbook } from "../site/js/core/workbook.js";

// A small real JPEG, like the 96px photos the app stores (well under Excel's 32,767-character cell limit).
const PHOTO = "data:image/jpeg;base64," + "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/".repeat(40);
const LOGO = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E";

function everything() {
  return {
    ...emptyModel("Alex Rivera"),
    avatarStyle: "notionists",
    profile: { ...emptyModel().profile, photo: PHOTO, role: "MBA Candidate", headline: "Looking for product roles", company: "", school: "Stanford University (2025–2027)",
               pastCompanies: "Delta Air Lines (2020–2022)", email: "alex@example.com", linkedinUrl: "https://www.linkedin.com/in/alex",
               location: "Palo Alto", lookingFor: "Summer internships.\nProduct or strategy.", about: "About me.\nTwo lines.",
               industry: "Higher Education", websites: "https://alex.example", skills: "Strategy; SQL", certifications: "CSPO",
               volunteering: "Food Bank (2019–2021)" },
    settings: { ...emptyModel().settings, email: "alex@example.com", meetingLength: 45, zoomLink: "https://zoom.us/j/123",
                checkInDays: 30, inviteTemplate: "Hi {first name}! {link}", groupSize: 4, groupBy: "company, languages", demoBaseDate: "" },
    people: [
      makePerson({ name: "Ana Díaz", company: "Acme", role: "PM", school: "BYU (2014–2018); Lakeview High", pastCompanies: "Globex (2018–2021)",
                   email: "ana@example.com", linkedinUrl: "https://www.linkedin.com/in/ana", photo: PHOTO, connectedOn: "2026-03-12",
                   status: "Met", tags: "pm, alumni", notes: "Line one, \"quoted\"\nLine two; with a semicolon",
                   headline: "PM at Acme", location: "Provo, Utah", website: "https://acme.example", skills: "SQL; Pricing",
                   languages: "Spanish (Native or Bilingual)", certifications: "CSPO", honors: "Dean's List", about: "Para one.\n\nPara two.",
                   extra: { "Date Reached Out": "2026-04-01", "Relationship Plan": "Keep In Contact", Birthday: "May 4" } }),
      makePerson({ name: "Bo Chen", company: "Globex", status: "To Reach Out", connectedThrough: "Ana Díaz" }),
      makePerson({ name: "Émile Zoë", company: "Initech" }),
    ],
    connections: [makeConnection({ a: "Ana Díaz", b: "Bo Chen" }), makeConnection({ a: "Ana Díaz", b: "Émile Zoë", type: "Mentor", notes: "Weekly" })],
    targets: [{ company: "Acme", priority: "1", stage: "Applied", notes: "Dream job", extra: {} },
              { company: "Nowhere Inc.", priority: "3", stage: "", notes: "", extra: {} }],
    companies: [{ company: "Acme", website: "acme.example", logo: LOGO, extra: {} },
                { company: "Stanford University", website: "stanford.edu", logo: PHOTO, extra: {} }],
    pool: [{ firstName: "Cy", lastName: "Zed", url: "https://www.linkedin.com/in/cy", email: "", company: "Acme", position: "Eng", connectedOn: "2025-01-02" }],
    meetings: [{ id: "m1", person: "Ana Díaz", date: "2026-10-02", start: "10:00", end: "10:45", type: "Coffee Chat", method: "Zoom",
                 notes: "Talk about, the \"APM\" role", nextStep: "Send resume", eventId: "google:abc", link: "https://zoom.us/j/123",
                 title: "Resume chat", guests: "ana@example.com; sam@example.com", location: "Online", description: "Hi Ana!\nSee you.",
                 reminder: "15", timeZone: "America/New_York", extra: {} }],
    tasks: [{ id: "t-m1", task: "Send thank-you to Ana Díaz within 24 hrs", person: "Ana Díaz", company: "Acme", due: "2026-10-03",
              done: false, created: "2026-09-29", source: "thanks:m1", extra: {} },
            { id: "t2", task: "Done thing", person: "", company: "", due: "", done: true, created: "2026-09-01", source: "", extra: {} }],
    experience: [{ person: "Ana Díaz", company: "Acme", title: "Growth: PM", start: "2021-03", end: "Present", location: "Provo",
                   description: "Line one.\nLine two.", extra: {} },
                 { person: "Ana Díaz", company: "Globex", title: "Analyst", start: "2018", end: "2021", location: "", description: "", extra: {} }],
    education: [{ person: "Ana Díaz", school: "BYU", degree: "BS", field: "Economics", start: "2014-08", end: "2018-04", extra: {} }],
    layout: { "p:ana díaz": { x: 120, y: -40 }, "target:nowhere": { x: -300, y: 210 } },
  };
}
const strip = m => ({ ...m, notices: [], people: m.people.map(p => ({ ...p, source: "" })) });

test("save -> open gives back every field: people and profiles, photos, history, connections, targets, companies, meetings, tasks, layout, settings", () => {
  const m = everything();
  assert.deepEqual(strip(readWorkbook(writeWorkbook(m))), strip(m));
});

test("the app's save path (save to the same file twice, then reopen) is lossless", async () => {
  const disk = { bytes: null, lastModified: 1 };
  const io = { read: async () => (disk.bytes ? { ...disk } : null), write: async b => { disk.bytes = b; return ++disk.lastModified; },
               backup: async () => {} };
  let doc = { model: everything(), base: null, lastModified: null, pending: [] };
  doc = await saveDoc(doc, io);
  doc = await saveDoc({ ...doc, pending: [] }, io);
  assert.deepEqual(strip(readWorkbook(disk.bytes)), strip(everything()));
});

test("after another program re-saves the file (no Orbit formatting), it still opens with the same data", () => {
  const wb = XLSX.read(writeWorkbook(everything()), { type: "array", cellDates: true, cellNF: true });
  const resaved = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  assert.deepEqual(strip(readWorkbook(resaved)), strip(everything()));
});

test("photos and logos fit in an Excel cell", () => {
  assert.ok(PHOTO.length < 32767);
});
