// Connections between people: the Connections sheet, keeping Connected Through in sync, links on the map,
// and best paths that use them.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "../site/vendor/xlsx.mjs";
import { connectionsOf, makeConnection } from "../site/js/core/connections.js";
import { buildGraph } from "../site/js/core/graph.js";
import { applyOp, replay } from "../site/js/core/ops.js";
import { bestPath } from "../site/js/core/paths.js";
import { makePerson } from "../site/js/core/people.js";
import { emptyModel, readWorkbook, writeWorkbook } from "../site/js/core/workbook.js";

const P = (name, fields = {}) => makePerson({ name, ...fields });
const edges = g => new Set(g.edges.map(e => `${e.from}>${e.to}>${e.kind}`));
const model = () => ({ ...emptyModel("Me"),
  people: [P("Liam"), P("Zoe", { connectedThrough: "Liam", company: "Qualtrics" }), P("Mia", { company: "Google" }),
           P("Kim", { company: "Nike", connectedThrough: "Owen" }), P("Owen", { connectedThrough: "Ava" }), P("Ava")] });

test("an old file's Connected Through column becomes 'Introduced me' connections", () => {
  const back = readWorkbook(writeWorkbook(model()));
  assert.deepEqual(back.connections.map(c => [c.a, c.b, c.type]),
    [["Liam", "Zoe", "Introduced me"], ["Owen", "Kim", "Introduced me"], ["Ava", "Owen", "Introduced me"]]);
  // And the column is still there, filled in.
  const wb = XLSX.read(writeWorkbook(back), { type: "array" });
  const people = XLSX.utils.sheet_to_json(wb.Sheets.People);
  assert.equal(people.find(p => p.Name === "Zoe")["Connected Through"], "Liam");
  assert.deepEqual(XLSX.utils.sheet_to_json(wb.Sheets.Connections, { header: 1 })[0], ["Person A", "Person B", "Type", "Notes"]);
});

test("typing a new introducer in Excel's Connected Through column imports; a blank cell keeps the sheet's connection", () => {
  const m = readWorkbook(writeWorkbook(model()));
  m.people.find(p => p.name === "Zoe").connectedThrough = "Mia"; // edited in Excel
  m.people.find(p => p.name === "Kim").connectedThrough = "";     // cleared in Excel, but still on the Connections sheet
  const back = readWorkbook(writeWorkbook(m));
  assert.equal(connectionsOf(back.connections, "Zoe").find(c => c.dir === "introducedBy").other, "Mia");
  assert.equal(back.people.find(p => p.name === "Kim").connectedThrough, "Owen");
});

test("adding and removing connections keeps Connected Through in sync, both ways", () => {
  let m = readWorkbook(writeWorkbook(model()));
  m = applyOp(m, { type: "addConnection", connection: { a: "Mia", b: "Zoe", type: "Introduced me" } });
  assert.equal(m.people.find(p => p.name === "Zoe").connectedThrough, "Mia");
  assert.equal(m.connections.filter(c => c.b === "Zoe" && c.type === "Introduced me").length, 1); // replaced, not added
  m = applyOp(m, { type: "addConnection", connection: { a: "Liam", b: "Mia", type: "Coworker", notes: "Adobe" } });
  assert.deepEqual(connectionsOf(m.connections, "Mia").map(c => [c.other, c.type, c.dir]),
    [["Zoe", "Introduced me", "introduced"], ["Liam", "Coworker", "link"]]);
  m = applyOp(m, { type: "removeConnection", connection: { a: "Mia", b: "Zoe", type: "Introduced me" } });
  assert.equal(m.people.find(p => p.name === "Zoe").connectedThrough, "");
  m = applyOp(m, { type: "patchPerson", key: "zoe", fields: { connectedThrough: "Ava" } });
  assert.deepEqual(connectionsOf(m.connections, "Zoe").map(c => [c.other, c.type]), [["Ava", "Introduced me"]]);
  // Renaming someone carries their connections; removing them drops them.
  m = applyOp(m, { type: "patchPerson", key: "liam", fields: { name: "Liam Walsh" } });
  assert.ok(m.connections.some(c => c.a === "Liam Walsh" && c.type === "Coworker"));
  m = applyOp(m, { type: "removePerson", key: "liam walsh" });
  assert.ok(!m.connections.some(c => c.a === "Liam Walsh" || c.b === "Liam Walsh"));
  assert.equal(makeConnection({ a: "A", b: "B", type: "study buddy" }).type, "study buddy"); // "Other" kept as typed
});

test("only 'Introduced me' makes someone 2nd-degree; other types draw person-to-person links", () => {
  const m = replay(readWorkbook(writeWorkbook(model())), [
    { type: "addConnection", connection: { a: "Mia", b: "Ava", type: "Friend" } }]);
  const g = buildGraph(m.people, { me: m.me, connections: m.connections });
  assert.ok(edges(g).has("p:mia>p:ava>link"));
  assert.equal(g.nodes.find(n => n.id === "p:ava").kind, "person"); // still direct
  assert.equal(g.nodes.find(n => n.id === "p:zoe").kind, "second");
});

test("best path uses person-to-person links: a friend of a direct contact beats a long introduction chain", () => {
  let m = readWorkbook(writeWorkbook(model()));
  let g = buildGraph(m.people, { me: m.me, connections: m.connections, targets: ["Nike"] });
  assert.deepEqual(bestPath(g, m.people, g.targets[0], "Me").names, ["Me", "Ava", "Owen", "Kim"]);
  m = applyOp(m, { type: "addConnection", connection: { a: "Mia", b: "Kim", type: "Friend" } });
  g = buildGraph(m.people, { me: m.me, connections: m.connections, targets: ["Nike"] });
  // Kim is still 2nd-degree through Owen, but Mia (direct) is her friend: Me → Mia → Kim.
  const p = bestPath(g, m.people, g.targets[0], "Me");
  assert.deepEqual([p.names, p.ask], [["Me", "Mia", "Kim"], "Mia"]);
  assert.ok(p.edges.includes("p:mia>p:kim>link") || p.edges.includes("p:kim>p:mia>link"));
});
