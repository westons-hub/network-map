// LinkedIn pool: import/merge, search, and matching a pasted profile link.

import assert from "node:assert/strict";
import { test } from "node:test";
import { makePerson } from "../site/js/core/people.js";
import {
  isLinkedInUrl, matchLinkedInUrl, mergePool, nameFromSlug, normalizeLinkedInUrl, onMapIndex, searchPool,
} from "../site/js/core/pool.js";

const E = (first, last, extra = {}) => ({ firstName: first, lastName: last, url: "", email: "", company: "", position: "",
                                          connectedOn: "", ...extra });

test("LinkedIn profile links are normalized, whatever form they're pasted in", () => {
  for (const u of ["https://www.linkedin.com/in/Jordan-Lee-12ab34/", "linkedin.com/in/jordan-lee-12ab34?trk=abc",
                   "http://uk.linkedin.com/in/jordan-lee-12ab34#x", "www.linkedin.com/in/jordan-lee-12ab34/details/experience/"]) {
    assert.equal(normalizeLinkedInUrl(u), "linkedin.com/in/jordan-lee-12ab34", u);
  }
  assert.equal(normalizeLinkedInUrl("https://www.linkedin.com/in/ana-mar%C3%ADa-d%C3%ADaz"), "linkedin.com/in/ana-maría-díaz");
  assert.equal(normalizeLinkedInUrl("https://www.linkedin.com/company/deloitte"), "");
  assert.equal(normalizeLinkedInUrl("https://example.com/in/jordan"), "");
  assert.ok(isLinkedInUrl(" linkedin.com/in/x "));
});

test("a readable name from a profile link", () => {
  assert.equal(nameFromSlug("linkedin.com/in/jordan-lee-12ab34"), "Jordan Lee");
  assert.equal(nameFromSlug("https://www.linkedin.com/in/ana-mar%C3%ADa-d%C3%ADaz/"), "Ana María Díaz");
  assert.equal(nameFromSlug("linkedin.com/in/priya-shah-8b2a1b1a3"), "Priya Shah");
  assert.equal(nameFromSlug("linkedin.com/in/sam"), "Sam");
});

test("re-importing merges without duplicates and notices company changes", () => {
  const first = [E("Jordan", "Lee", { url: "https://www.linkedin.com/in/jordan-lee", company: "Deloitte", position: "Consultant" }),
                 E("Kai", "Morgan", { company: "Goldman Sachs" })];
  const again = [E("Jordan", "Lee", { url: "https://linkedin.com/in/jordan-lee/", company: "Google", position: "PM", email: "j@x.com" }),
                 E("Kai", "Morgan", { company: "Goldman Sachs" }), E("New", "Person", { company: "Nike" })];
  const r = mergePool(first, again);
  assert.equal(r.pool.length, 3);
  assert.deepEqual([r.added, r.updated], [1, 1]);
  assert.deepEqual([r.pool[0].company, r.pool[0].email], ["Google", "j@x.com"]);
  assert.deepEqual(r.changedCompany, [{ name: "Jordan Lee", from: "Deloitte", to: "Google", position: "Consultant" }]);
  assert.deepEqual(mergePool(r.pool, again).pool, r.pool); // idempotent
});

test("search by words and filters; newest connections first", () => {
  const pool = [E("Kai", "Morgan", { company: "Goldman Sachs", position: "Analyst", connectedOn: "2026-01-15" }),
                E("Elena", "Rossi", { company: "Goldman Sachs, Inc.", position: "Risk Associate", connectedOn: "2026-05-03" }),
                E("Nora", "Singh", { company: "Adobe", position: "Strategy Manager", connectedOn: "2026-07-30" })];
  assert.deepEqual(searchPool(pool, { q: "goldman" }).map(e => e.firstName), ["Elena", "Kai"]);
  assert.deepEqual(searchPool(pool, { company: "goldman sachs" }).map(e => e.firstName), ["Elena", "Kai"]);
  assert.deepEqual(searchPool(pool, { title: "strategy" }).map(e => e.firstName), ["Nora"]);
  assert.deepEqual(searchPool(pool, { since: "2026-05-01" }).map(e => e.firstName), ["Nora", "Elena"]);
  assert.deepEqual(searchPool(pool, { q: "kai analyst" }).map(e => e.firstName), ["Kai"]);
});

test("pasting a link matches the pool by URL, then by the name in the link", () => {
  const pool = [E("Jordan", "Lee", { url: "https://www.linkedin.com/in/jordan-lee-12ab34", company: "Deloitte" }),
                E("Priya", "Shah", { url: "", company: "Deloitte" })];
  assert.equal(matchLinkedInUrl(pool, "linkedin.com/in/jordan-lee-12ab34/").matchedBy, "url");
  const byName = matchLinkedInUrl(pool, "https://www.linkedin.com/in/priya-shah-99");
  assert.deepEqual([byName.matchedBy, byName.entry.company, byName.url], ["name", "Deloitte", "https://www.linkedin.com/in/priya-shah-99"]);
  const none = matchLinkedInUrl(pool, "https://www.linkedin.com/in/new-person-1a2b");
  assert.deepEqual([none.matchedBy, none.entry, none.name], [null, null, "New Person"]);
  assert.equal(matchLinkedInUrl(pool, "not a link"), null);
});

test("'Already on map' by URL or name", () => {
  const isOn = onMapIndex([makePerson({ name: "Jordan Lee" }), makePerson({ name: "X", linkedinUrl: "https://linkedin.com/in/kai" })]);
  assert.equal(isOn(E("Jordan", "Lee")), true);
  assert.equal(isOn(E("Kai", "Morgan", { url: "https://www.linkedin.com/in/kai/" })), true);
  assert.equal(isOn(E("Nora", "Singh")), false);
});
