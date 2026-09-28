// Excel read/write, migration, edits and safe saving.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as XLSX from "../site/vendor/xlsx.mjs";
import { applyOp, replay } from "../site/js/core/ops.js";
import { makePerson } from "../site/js/core/people.js";
import { saveDoc } from "../site/js/core/sync.js";
import { emptyModel, readWorkbook, writeWorkbook } from "../site/js/core/workbook.js";

const read = path => readFileSync(new URL(path, import.meta.url));
const OLD = read("./fixtures/old_format_contacts.xlsx");
const DEMO = read("../site/demo/demo_network.xlsx");
const strip = m => ({ ...m, notices: [], people: m.people.map(p => ({ ...p, source: "" })) });

function fullModel() {
  return {
    ...emptyModel("Weston Jackson"), avatarStyle: "notionists",
    people: [makePerson({ name: "Ana Díaz", company: "Acme", school: "BYU", role: "PM", email: "ana@example.com",
                          linkedinUrl: "https://example.com/in/ana", photo: "data:image/jpeg;base64,AAAA",
                          connectedThrough: "", connectedOn: "2026-03-12", status: "Met", tags: "a, b",
                          notes: "Line one, \"quoted\"", extra: { Birthday: "May 4" } }),
             makePerson({ name: "Bo", connectedThrough: "Ana Díaz" })],
    targets: [{ company: "Acme", priority: "1", stage: "Applied", notes: "", extra: {} }],
    companies: [{ company: "Acme", website: "acme.example", logo: "data:image/svg+xml;charset=utf-8,%3Csvg%3E", extra: {} }],
    pool: [{ firstName: "Cy", lastName: "Z", url: "u", email: "", company: "Acme", position: "Eng", connectedOn: "2025-01-02" }],
    layout: { "me": { x: 0, y: 0 }, "p:ana díaz": { x: 120, y: -40 } },
  };
}

test("workbook round-trip keeps every field", () => {
  const m = fullModel();
  const back = readWorkbook(writeWorkbook(m));
  assert.deepEqual(strip(back), strip(m));
});

test("dates survive a round-trip in any time zone", () => {
  const script = fileURLToPath(new URL("./fixtures/roundtrip_date.mjs", import.meta.url));
  for (const tz of ["America/Denver", "Asia/Tokyo", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
    const out = execFileSync(process.execPath, [script], { env: { ...process.env, TZ: tz } }).toString().trim();
    assert.equal(out, "2026-03-12|2025-01-02", tz);
  }
});

test("Connected On is a real Excel date, and Layout is hidden", () => {
  const wb = XLSX.read(writeWorkbook(fullModel()), { type: "array", cellNF: true });
  const cell = wb.Sheets.People.I2;
  assert.equal(cell.t, "n");
  assert.equal(cell.z, "yyyy-mm-dd");
  assert.deepEqual(wb.Workbook.Sheets.map(s => [s.name, s.Hidden]).find(([n]) => n === "Layout"), ["Layout", 1]);
});

test("an old-format file (Contacts sheet, Targets with Company/Notes) is migrated", () => {
  const m = readWorkbook(OLD);
  assert.equal(m.people.length, 22);
  assert.equal(m.people[0].name, "Jordan Lee");
  assert.equal(m.people[14].connectedThrough, "Jordan Lee");
  assert.deepEqual(m.targets[0], { company: "Northwind Consulting", priority: "", stage: "",
                                   notes: "Strategy practice", extra: {} });
  assert.match(m.notices[0], /"Contacts" sheet is now "People"/);

  // Saving turns Contacts into People and keeps the "How to use" sheet.
  const saved = XLSX.read(writeWorkbook(m, OLD), { type: "array" });
  assert.deepEqual(saved.SheetNames.slice(0, 2), ["People", "Targets"]);
  assert.ok(saved.SheetNames.includes("How to use"));
  assert.ok(!saved.SheetNames.includes("Contacts"));
  assert.equal(readWorkbook(writeWorkbook(m, OLD)).people.length, 22);
});

test("a plain sheet with a Name column is picked up as People", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["name", "Title", "Email Address"], ["Kim", "CFO", "k@x.com"]]), "Sheet1");
  const m = readWorkbook(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  assert.deepEqual([m.people[0].name, m.people[0].role, m.people[0].email], ["Kim", "CFO", "k@x.com"]);
});

test("your own sheets and columns are kept when saving", () => {
  const wb = XLSX.read(DEMO, { type: "array" });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["My notes"], ["keep me"]]), "Scratch");
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.People, { header: 1 });
  rows[0].push("Pronouns"); rows[1].push("she/her");
  wb.Sheets.People = XLSX.utils.aoa_to_sheet(rows);
  const base = XLSX.write(wb, { type: "array", bookType: "xlsx" });

  const m = applyOp(readWorkbook(base), { type: "setMe", name: "Someone Else" });
  assert.equal(m.people[0].extra.Pronouns, "she/her");
  const out = writeWorkbook(m, base);
  const again = XLSX.read(out, { type: "array" });
  assert.deepEqual(XLSX.utils.sheet_to_json(again.Sheets.Scratch, { header: 1 }), [["My notes"], ["keep me"]]);
  assert.equal(readWorkbook(out).people[0].extra.Pronouns, "she/her");
  assert.equal(readWorkbook(out).me, "Someone Else");
});

// ---- edits ----------------------------------------------------------------------

test("edits: add, rename (keeps connections), remove, targets and layout", () => {
  let m = fullModel();
  m = applyOp(m, { type: "upsertPerson", person: { name: "New Person", company: "Acme" } });
  assert.equal(m.people.length, 3);
  m = applyOp(m, { type: "upsertPerson", key: "ana díaz", person: { ...m.people[0], name: "Ana Diaz-Lopez" } });
  assert.equal(m.people[0].name, "Ana Diaz-Lopez");
  assert.equal(m.people[0].extra.Birthday, "May 4");
  assert.equal(m.people[1].connectedThrough, "Ana Diaz-Lopez");
  m = applyOp(m, { type: "removePerson", key: "new person" });
  assert.equal(m.people.length, 2);
  m = applyOp(m, { type: "upsertTarget", target: { company: "Globex" } });
  m = applyOp(m, { type: "upsertTarget", key: "acme", target: { company: "Acme", stage: "Interviewing" } });
  assert.deepEqual(m.targets.map(t => [t.company, t.stage]), [["Acme", "Interviewing"], ["Globex", ""]]);
  m = applyOp(m, { type: "removeTarget", key: "globex" });
  m = applyOp(m, { type: "setLayout", positions: { "p:bo": { x: 5, y: 6 } } });
  assert.deepEqual(Object.keys(m.layout), ["me", "p:ana díaz", "p:bo"]);
  assert.deepEqual(applyOp(m, { type: "clearLayout" }).layout, {});
  const restored = applyOp(m, { type: "replaceModel", model: fullModel() }); // restoring a backup
  assert.deepEqual(restored.people.map(p => p.name), ["Ana Díaz", "Bo"]);
  assert.throws(() => applyOp(m, { type: "nope" }), /Unknown edit/);
});

test("applyOp doesn't change the model it was given", () => {
  const m = fullModel();
  const before = JSON.stringify(m);
  applyOp(m, { type: "removePerson", key: "bo" });
  assert.equal(JSON.stringify(m), before);
});

// ---- saving -----------------------------------------------------------------------

function fakeDisk(bytes, lastModified = 1) {
  const disk = { bytes, lastModified, backups: [] };
  disk.io = {
    read: async () => ({ bytes: disk.bytes, lastModified: disk.lastModified }),
    write: async b => { disk.bytes = b; disk.lastModified += 1; return disk.lastModified; },
    backup: async b => { disk.backups.push(b); },
  };
  return disk;
}

test("saving backs up the previous version and writes your edits", async () => {
  const disk = fakeDisk(DEMO);
  const pending = [{ type: "setMe", name: "Weston Jackson" }];
  const doc = { model: replay(readWorkbook(DEMO), pending), base: DEMO, lastModified: 1, pending };
  const saved = await saveDoc(doc, disk.io);
  assert.equal(saved.reloaded, false);
  assert.deepEqual(saved.pending, []);
  assert.equal(saved.lastModified, 2);
  assert.equal(disk.backups[0], DEMO);
  assert.equal(readWorkbook(disk.bytes).me, "Weston Jackson");
});

test("if the file changed in Excel, saving reloads it and replays only your edits", async () => {
  const disk = fakeDisk(DEMO);
  const opened = readWorkbook(DEMO);
  const pending = [{ type: "upsertPerson", person: { name: "Added In App" } }];
  const doc = { model: replay(opened, pending), base: DEMO, lastModified: 1, pending };

  // Meanwhile, in Excel: a new target is added and the file is saved.
  const edited = applyOp(opened, { type: "upsertTarget", target: { company: "Edited In Excel" } });
  disk.bytes = writeWorkbook(edited, DEMO);
  disk.lastModified = 50;
  const excelVersion = disk.bytes;

  const saved = await saveDoc(doc, disk.io);
  assert.equal(saved.reloaded, true);
  const result = readWorkbook(disk.bytes);
  assert.ok(result.targets.some(t => t.company === "Edited In Excel"));
  assert.ok(result.people.some(p => p.name === "Added In App"));
  assert.equal(disk.backups[0], excelVersion);
});

test("download mode (no way to re-read the file) still saves", async () => {
  let written;
  const io = { read: async () => null, write: async b => { written = b; return null; }, backup: async () => {} };
  const doc = { model: emptyModel("Me"), base: null, lastModified: null, pending: [] };
  const saved = await saveDoc(doc, io);
  assert.equal(readWorkbook(written).me, "Me");
  assert.equal(saved.lastModified, null);
});
