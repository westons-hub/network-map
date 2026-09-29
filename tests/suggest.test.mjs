// Type-ahead suggestions from everything entered, matched through org aliases.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildSuggestions, matchSuggestions } from "../site/js/core/suggest.js";
import { readWorkbook } from "../site/js/core/workbook.js";

const demo = readWorkbook(readFileSync(new URL("../site/demo/demo_network.xlsx", import.meta.url)));
const s = buildSuggestions(demo);
const values = list => list.map(x => x.value);

test("companies come from people, past companies, the pool, targets and the Companies sheet, with counts", () => {
  const deloitte = s.company.find(x => x.key === "deloitte");
  assert.equal(deloitte.value, "Deloitte");          // the Companies sheet / target spelling wins over "Deloitte LLP"
  assert.equal(deloitte.count, 5);                   // Jordan, Priya, Marcus, Hana, Rachel
  assert.ok(deloitte.pool >= 3);
  assert.ok(s.company.some(x => x.value === "Nike" && x.count === 0)); // a target nobody works at yet
  assert.ok(s.company.some(x => x.value === "Adobe")); // from your profile's past companies too
});

test("aliases: 'U of U' finds University of Utah, 'stanford' finds Stanford University", () => {
  assert.equal(values(matchSuggestions(s.school, "U of U", { kind: "school" }))[0], "University of Utah");
  assert.equal(values(matchSuggestions(s.school, "stanford", { kind: "school" }))[0], "Stanford University");
  assert.deepEqual(values(matchSuggestions(s.company, "del", { kind: "company" })).slice(0, 2).sort(), ["Deloitte", "Delta Air Lines"]);
});

test("ranking: exact, then prefix, then word start, then anywhere; empty shows the most used", () => {
  const items = [{ value: "Product Manager", key: "product manager", count: 3, pool: 0 },
                 { value: "Senior Product Manager", key: "senior product manager", count: 5, pool: 0 },
                 { value: "Associate PM", key: "associate pm", count: 1, pool: 0 },
                 { value: "Manager", key: "manager", count: 0, pool: 0 }];
  assert.deepEqual(values(matchSuggestions(items, "manager")), ["Manager", "Senior Product Manager", "Product Manager"]);
  assert.deepEqual(values(matchSuggestions(items, "prod")), ["Product Manager", "Senior Product Manager"]);
  assert.deepEqual(values(matchSuggestions(items, "")).slice(0, 2), ["Senior Product Manager", "Product Manager"]);
  assert.deepEqual(values(matchSuggestions(items, "zzz")), []);
});

test("fixed lists: statuses, meeting types, methods, relationship plans, connection types; people with details", () => {
  assert.ok(values(s.status).includes("Scheduled"));
  assert.ok(values(s.meetingType).includes("Coffee Chat"));
  assert.ok(values(s.relationshipPlan).includes("Keep In Contact"));
  assert.ok(values(s.connectionType).includes("Mentor"));
  assert.equal(s.person.find(p => p.value === "Jordan Lee").detail, "Senior Consultant @ Deloitte");
  assert.ok(values(s.role).includes("Risk Associate")); // from the pool
});
