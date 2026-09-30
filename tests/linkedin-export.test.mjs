// Importing the whole LinkedIn data export: folder, zip, single files, a "Profile only" zip and a zip inside a
// folder, using the FICTIONAL sample in examples/linkedin-export-sample/ (scripts/make_export_sample.mjs).

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as fflate from "../site/vendor/fflate.mjs";
import { exportFileKind, exportOps, exportSummary, messageStats, readExport, unzipExport, urlKey } from "../site/js/core/linkedinExport.js";
import { replay } from "../site/js/core/ops.js";
import { INVITE_PENDING, personFromPool } from "../site/js/core/people.js";
import { emptyModel } from "../site/js/core/workbook.js";

const DIR = fileURLToPath(new URL("../examples/linkedin-export-sample/", import.meta.url));
const walk = dir => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
/** Like dropping the folder: every file with its path (the app reads only the ones it uses). */
const folder = (prefix = "Basic_LinkedInDataExport/") => walk(DIR).map(p => ({ path: prefix + relative(DIR, p), bytes: readFileSync(p) }));
const asTexts = files => files.filter(f => !["never", "ignored", null].includes(exportFileKind(f.path)))
  .map(f => ({ path: f.path, text: new TextDecoder().decode(f.bytes) }));
const zipOf = files => fflate.zipSync(Object.fromEntries(files.map(f => [f.path, new Uint8Array(f.bytes)])));

test("the sample has LinkedIn's 23 files, and file names match however they're spelled", () => {
  assert.equal(walk(DIR).length, 23);
  assert.equal(exportFileKind("x/Company Follows.csv"), "follows");
  assert.equal(exportFileKind("Company_Follows.csv"), "follows");
  assert.equal(exportFileKind("PROFILE SUMMARY.CSV"), "profileSummary");
  assert.equal(exportFileKind("Ad_Targeting.csv"), "never");
  assert.equal(exportFileKind("Verifications/Verifications.csv"), "never");
  assert.equal(exportFileKind("learning_role_play_messages.csv"), "never");
  assert.equal(exportFileKind("SavedJobAlerts.csv"), "ignored");
  assert.equal(exportFileKind("notes.txt"), null);
});

test("a dropped folder: everything useful is found, and the never-read files are never read", () => {
  const found = readExport(asTexts(folder()));
  assert.deepEqual([found.connections.length, found.invitations.length, found.positions.length, found.education.length, found.skills.length,
                    found.certifications.length, found.volunteering.length, found.follows.length, found.notes.length],
                   [26, 8, 3, 2, 3, 2, 1, 3, 1]);
  assert.equal(found.profile.name, "Alex Rivera");
  assert.equal(found.profile.location, "Palo Alto, California, United States");
  assert.equal(found.email, "alex.rivera@example.com"); // the primary one
  assert.ok(found.hasMessages);
  const kept = JSON.stringify({ ...found, messageText: "" });
  for (const secret of ["NEVER-READ-SENTINEL", "1 Example Way", "94000", "Jan 1, 2000", "SKYPE", "@alex_example"]) {
    assert.ok(!kept.includes(secret), `${secret} must not be kept`);
  }
});

test("a zip, a zip inside a folder, and single files give the same result; unused files aren't even unzipped", () => {
  const fromFolder = readExport(asTexts(folder()));
  const zip = zipOf(folder());
  const unzipped = unzipExport(fflate, zip);
  assert.ok(unzipped.every(f => !["never", "ignored"].includes(exportFileKind(f.path))), "never-read files are skipped while unzipping");
  assert.ok(!unzipped.some(f => f.text.includes("NEVER-READ-SENTINEL")));
  assert.deepEqual(readExport(unzipped), fromFolder);
  // The zip dropped as part of a folder (or a zip inside the zip).
  const nested = zipOf([{ path: "Downloads/export.zip", bytes: zip }]);
  assert.deepEqual(readExport(unzipExport(fflate, nested)), fromFolder);
  // Just Connections.csv.
  const single = readExport([{ path: "Connections.csv", text: readFileSync(join(DIR, "Connections.csv"), "utf8") }]);
  assert.equal(single.connections.length, 26);
  assert.equal(single.profile, undefined);
});

test("a 'Profile only' zip: the profile is imported, and the summary says the connections are missing", () => {
  const only = folder("").filter(f => f.path === "Profile.csv");
  const found = readExport(unzipExport(fflate, zipOf(only)));
  const summary = exportSummary(found, emptyModel(""));
  assert.equal(summary.noConnections, true);
  assert.deepEqual(summary.rows.map(r => r.key), ["profile"]);
  const { ops } = exportOps(emptyModel(""), found, { rows: new Set(["profile"]) });
  const m = replay(emptyModel(""), ops);
  assert.equal(m.me, "Alex Rivera");
  assert.equal(m.profile.headline, "Stanford MBA '27 · Strategy & product");
  assert.equal(m.pool.length, 0);
});

test("importing: pool with who reached out first and pending invites, profile, jobs, schools, targets; messages only if you opt in", () => {
  const found = readExport(asTexts(folder()));
  const summary = exportSummary(found, emptyModel(""));
  assert.deepEqual(summary.rows.map(r => [r.key, r.on]), [["connections", true], ["invitations", true], ["profile", true], ["positions", true],
    ["education", true], ["skills", true], ["certifications", true], ["volunteering", true], ["email", true], ["notes", true], ["follows", true],
    ["messages", false]]);
  const rows = new Set(summary.rows.filter(r => r.on).map(r => r.key));
  const { ops, pool } = exportOps(emptyModel(""), found, { rows, targets: ["Google"] });
  const m = replay(emptyModel(""), ops);
  assert.equal(m.pool.length, 28); // 26 connections + 2 invites not accepted yet
  assert.equal(pool.pending, 2);
  assert.deepEqual(m.pool.filter(e => e.reachedOut === INVITE_PENDING).map(e => `${e.firstName} ${e.lastName}`), ["Casey Morgan", "Devon Park"]);
  const first = m.pool[0];
  assert.deepEqual([first.reachedOut, first.invitedOn, first.inviteNote], ["You", "2026-08-03", "Hi! Loved your talk at the info session."]);
  assert.equal(m.pool[1].reachedOut, "Them");
  assert.ok(m.pool.every(e => !e.messages && !e.lastContacted), "no message data unless you opt in");
  assert.equal(m.pool[2].note, "Met at the product club mixer.");
  assert.equal(m.me, "Alex Rivera");
  assert.deepEqual([m.profile.company, m.profile.role], ["Northwind Outfitters", "Strategy Intern"]);
  assert.equal(m.profile.pastCompanies, "Harbor Airlines (2020–2022); Adobe (2022–2025)");
  assert.equal(m.profile.school, "Stanford University (2025–2027); University of Washington (2016–2020)");
  assert.equal(m.profile.volunteering, "Riverbend Food Bank (2019–2021)");
  assert.equal(m.profile.skills, "Market Sizing; SQL; Pricing Strategy");
  assert.equal(m.profile.about, "MBA student looking for strategy and product roles.\nFormer airline analyst.");
  assert.equal(m.settings.email, "alex.rivera@example.com");
  assert.deepEqual(m.targets.map(t => t.company), ["Google"]);

  // With message history: counts and last-contacted dates, never the text.
  const withMsgs = replay(emptyModel(""), exportOps(emptyModel(""), found, { rows: new Set([...rows, "messages"]) }).ops);
  assert.deepEqual([withMsgs.pool[0].messages, withMsgs.pool[0].lastContacted], ["3", "2026-09-12"]);
  assert.ok(!JSON.stringify(withMsgs).includes("fictional message text"));
});

test("people you add from the pool bring what the export knew: reached out, last contacted, notes; pending -> To Reach Out", () => {
  const found = readExport(asTexts(folder()));
  const m = replay(emptyModel("Alex Rivera"), exportOps(emptyModel("Alex Rivera"), found,
    { rows: new Set(["connections", "invitations", "notes", "messages"]) }).ops);
  const jordan = personFromPool(m.pool[0]);
  assert.equal(jordan.extra["Date Reached Out"], "2026-08-03");
  assert.equal(jordan.extra["Last Contacted"], "2026-09-12");
  assert.match(jordan.notes, /Invite note: Hi! Loved your talk/);
  assert.match(personFromPool(m.pool[2]).notes, /^From LinkedIn: Met at the product club mixer\./);
  assert.equal(personFromPool(m.pool.find(e => e.reachedOut === INVITE_PENDING)).status, "To Reach Out");
});

test("re-importing a newer export merges without duplicates and never overwrites your edits", () => {
  const found = readExport(asTexts(folder()));
  const rows = new Set(["connections", "invitations", "profile", "positions", "education", "skills", "notes"]);
  let m = replay(emptyModel(""), exportOps(emptyModel(""), found, { rows }).ops);
  m = replay(m, [{ type: "setProfile", fields: { headline: "My own headline", skills: "Market Sizing; Negotiation" } },
                 { type: "upsertPerson", person: { ...personFromPool(m.pool[2]), notes: "My own note" } }]);
  const again = exportOps(m, found, { rows });
  m = replay(m, again.ops);
  assert.equal(m.pool.length, 28);
  assert.equal(m.profile.headline, "My own headline");
  assert.equal(m.profile.skills, "Market Sizing; Negotiation; SQL; Pricing Strategy"); // new skills added, mine kept
  assert.equal(m.people[0].notes, "My own note\nFrom LinkedIn: Met at the product club mixer.");
  assert.equal(replay(m, exportOps(m, found, { rows }).ops).people[0].notes, m.people[0].notes, "the note isn't added twice");
});

test("message stats read only participants and dates", () => {
  const stats = messageStats(readFileSync(join(DIR, "messages.csv"), "utf8"));
  assert.deepEqual([...stats.values()].map(s => s.count).sort(), [1, 3]);
  assert.equal(urlKey("https://www.linkedin.com/in/Jane-Doe/?x=1"), "linkedin.com/in/jane-doe");
});
