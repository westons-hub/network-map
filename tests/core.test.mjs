// Names, people, LinkedIn parsing, graph building and intro paths.
// Run: node --test tests/

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildGraph } from "../site/js/core/graph.js";
import { introReport, whoCanIntro } from "../site/js/core/intro.js";
import { normalizeOrg } from "../site/js/core/org.js";
import { makePerson, mergePeople, parseCsv, parseDate, parseLinkedInCsv, parseList } from "../site/js/core/people.js";
import { readWorkbook } from "../site/js/core/workbook.js";

const P = (name, fields = {}) => makePerson({ name, ...fields });
const ids = (g, kind) => new Set(g.nodes.filter(n => n.kind === kind).map(n => n.id));
const edges = g => new Set(g.edges.map(e => `${e.from}>${e.to}>${e.kind}`));
const DEMO = new URL("../site/demo/", import.meta.url);
const demo = () => readWorkbook(readFileSync(new URL("demo_network.xlsx", DEMO)));

// ---- names -------------------------------------------------------------------

test("normalizeOrg handles suffixes, punctuation and aliases", () => {
  assert.equal(normalizeOrg("Delta Air Lines, Inc."), "delta air lines");
  assert.equal(normalizeOrg("BYU"), normalizeOrg("Brigham Young University"));
  assert.equal(normalizeOrg("Ernst & Young"), normalizeOrg("EY"));
  assert.equal(normalizeOrg("Société Générale"), "société générale");
});

test("parseList splits on commas, semicolons and newlines", () => {
  assert.deepEqual(parseList("Delta, Bain;\nGoogle,,"), ["Delta", "Bain", "Google"]);
});

// ---- LinkedIn export -----------------------------------------------------------

test("LinkedIn export skips the Notes header and keeps every column", () => {
  const pool = parseLinkedInCsv(readFileSync(new URL("sample_linkedin_connections.csv", DEMO), "utf8"));
  assert.equal(pool.length, 26);
  assert.deepEqual(pool[0], { firstName: "Jordan", lastName: "Lee", url: "https://www.linkedin.com/in/jordan-lee-3f9a21",
    email: "", company: "Deloitte", position: "Senior Consultant", connectedOn: "2026-03-12" });
});

test("LinkedIn export with quotes, commas, CRLF and a BOM", () => {
  const csv = '﻿Notes:\r\n"a, b"\r\n\r\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\r\n' +
              'Ana,"O\'Neil, Jr.",u,ana@x.com,"Acme, Inc.","VP ""Ops""",01 Feb 2025\r\n';
  const [e] = parseLinkedInCsv(csv);
  assert.equal(e.lastName, "O'Neil, Jr.");
  assert.equal(e.company, "Acme, Inc.");
  assert.equal(e.position, 'VP "Ops"');
  assert.equal(e.email, "ana@x.com");
  assert.equal(e.connectedOn, "2025-02-01");
});

test("a file that isn't a LinkedIn export names the file in the error", () => {
  assert.throws(() => parseLinkedInCsv("hello\n", "oops.csv"), /oops\.csv/);
});

test("parseCsv handles newlines inside quotes", () => {
  assert.deepEqual(parseCsv('a,"x\ny"\n1,2'), [["a", "x\ny"], ["1", "2"]]);
});

test("parseDate understands common formats and keeps anything else", () => {
  assert.equal(parseDate("12 Mar 2026"), "2026-03-12");
  assert.equal(parseDate("Mar 12, 2026"), "2026-03-12");
  assert.equal(parseDate("2026-3-12"), "2026-03-12");
  assert.equal(parseDate("3/12/2026"), "2026-03-12");
  assert.equal(parseDate(new Date(2026, 2, 12)), "2026-03-12");
  assert.equal(parseDate("sometime in spring"), "sometime in spring");
  assert.equal(parseDate(""), "");
});

// ---- merging -------------------------------------------------------------------

test("your edits override LinkedIn on merge; LinkedIn fills gaps", () => {
  const merged = mergePeople(
    [P("Jordan Lee", { company: "Old Co", linkedinUrl: "https://x", email: "j@x.com", source: "linkedin" })],
    [P("jordan  lee", { company: "New Co", school: "State U", source: "excel" })],
  );
  assert.equal(merged.length, 1);
  const p = merged[0];
  assert.deepEqual([p.company, p.school, p.linkedinUrl, p.email, p.source],
                   ["New Co", "State U", "https://x", "j@x.com", "linkedin+excel"]);
});

// ---- graph ---------------------------------------------------------------------

test("three people form a group, two do not", () => {
  const g = buildGraph([P("A", { company: "Acme" }), P("B", { company: "Acme" }), P("C", { company: "ACME Inc." }),
                        P("D", { company: "Solo Co" }), P("E", { company: "Solo Co" })]);
  assert.deepEqual(ids(g, "company"), new Set(["company:acme"]));
  assert.ok(edges(g).has("company:acme>p:a>member"));
  assert.ok(edges(g).has("me>p:d>direct"));
});

test("min group size is configurable", () => {
  const g = buildGraph([P("A", { company: "Acme" }), P("B", { company: "Acme" })], { minGroupSize: 2 });
  assert.deepEqual(ids(g, "company"), new Set(["company:acme"]));
});

test("someone in two groups gets one solid and one dashed link", () => {
  const g = buildGraph(["A", "B", "C"].map(n => P(n, { company: "Acme", school: "State U" })));
  assert.deepEqual(new Set(g.edges.filter(e => e.to === "p:a").map(e => e.kind)), new Set(["member", "also"]));
});

test("2nd-degree hangs off the connector, and unknown connectors get a placeholder", () => {
  const g = buildGraph([P("Jordan"), P("Rachel", { connectedThrough: "Jordan" }),
                        P("Zed", { connectedThrough: "Unknown Person" })]);
  assert.ok(edges(g).has("p:jordan>p:rachel>intro"));
  assert.ok(ids(g, "person").has("p:unknown person"));
  assert.deepEqual(ids(g, "second"), new Set(["p:rachel", "p:zed"]));
});

test("you aren't duplicated, and 'Connected Through: me' counts as direct", () => {
  const g = buildGraph([P("Me"), P("A", { connectedThrough: "me" })], { me: "Me" });
  assert.equal(g.nodes.filter(n => n.id === "me").length, 1);
  assert.ok(ids(g, "person").has("p:a"));
});

test("group by tags", () => {
  const g = buildGraph(["A", "B", "C"].map(n => P(n, { tags: "Gaming" })), { groupBy: ["tags"] });
  assert.deepEqual([...ids(g, "tag")], ["tag:gaming"]);
  assert.equal(g.nodes.find(n => n.id === "tag:gaming").label, "Gaming");
});

test("demo workbook builds: only the people you added are on the map", () => {
  const m = demo();
  assert.equal(m.me, "Alex Rivera");
  const g = buildGraph(m.people, { me: m.me, targets: m.targets });
  assert.deepEqual({ ...g.stats }, { people: 22, direct: 14, second_degree: 8, groups: 4, targets: 6, gaps: 2 });
  // Deloitte is a group; the other five targets are their own nodes.
  assert.deepEqual(g.nodes.filter(n => n.target).map(n => n.id).sort(),
    ["company:deloitte", "target:apple", "target:delta air lines", "target:goldman sachs", "target:nike", "target:qualtrics"]);
  assert.equal(m.avatarStyle, "notionists");
  assert.equal(g.nodes.find(n => n.id === "school:stanford").label, "Stanford University");
  assert.equal(m.pool.length, 26); // LinkedIn connections stay in the pool, off the map
});

// ---- targets -------------------------------------------------------------------

test("a target with no connections is a gap node linked to you", () => {
  const g = buildGraph([P("A", { company: "Acme" })], { targets: ["Nowhere Inc."] });
  const node = g.nodes.find(n => n.id === "target:nowhere");
  assert.deepEqual([node.kind, node.label, node.gap, node.target], ["target", "Nowhere Inc.", true, true]);
  assert.ok(edges(g).has("me>target:nowhere>gap"));
  assert.equal(g.stats.gaps, 1);
});

test("target groups are flagged, aliases match, duplicates ignored, people never get the target ring", () => {
  const people = ["A", "B", "C"].map(n => P(n, { company: "Ernst & Young" }))
    .concat(P("D", { company: "EY", connectedThrough: "A" }));
  const g = buildGraph(people, { targets: ["EY", { company: "ey", priority: "1" }] });
  const byId = Object.fromEntries(g.nodes.map(n => [n.id, n]));
  assert.equal(byId["company:ernst young"].target, true);
  assert.equal(byId["p:d"].target, undefined);
  assert.equal(byId["p:d"].atTarget, true);
  assert.deepEqual(g.targets, [{ label: "EY", key: "ernst young", focus: "company:ernst young", direct: ["A", "B", "C"],
                                 second: ["D"], alumni: [], priority: "", stage: "", notes: "" }]);
  assert.ok(!g.nodes.some(n => n.kind === "target"));
});

test("a target below the group size is still its own node, and people there attach to it", () => {
  const g = buildGraph([P("Solo", { company: "Tiny Co", school: "State" }), P("Via", { company: "Tiny Co", connectedThrough: "Solo" })],
                       { targets: [{ company: "Tiny Co", priority: "2", stage: "Applied" }] });
  const t = g.nodes.find(n => n.id === "target:tiny");
  assert.deepEqual([t.kind, t.count, t.gap, t.priority, t.stage], ["target", 1, false, "2", "Applied"]);
  assert.equal(g.targets[0].focus, "target:tiny");
  assert.ok(edges(g).has("me>target:tiny>group"));
  assert.ok(edges(g).has("target:tiny>p:solo>member"));
  assert.ok(edges(g).has("target:tiny>p:via>also"));
  assert.ok(!edges(g).has("me>p:solo>direct"));
  assert.deepEqual(g.groups["target:tiny"], ["Solo"]);
});

test("a target reachable only through someone links to you with a dashed (gap) edge", () => {
  const g = buildGraph([P("Liam"), P("Zoe", { company: "Pinecrest", connectedThrough: "Liam" })], { targets: ["Pinecrest"] });
  assert.ok(edges(g).has("me>target:pinecrest>gap"));
  assert.equal(g.nodes.find(n => n.id === "target:pinecrest").gap, false);
  assert.equal(g.stats.gaps, 0);
});

// ---- intro paths ---------------------------------------------------------------

test("whoCanIntro walks the chain and sorts shortest first", () => {
  const m = demo();
  const paths = whoCanIntro(m.people, "Qualtrics", m.me);
  assert.deepEqual(paths.map(p => [p.person.name, p.chain]), [
    ["Zoe Adams", ["Liam Walsh", "Zoe Adams"]],
    ["Sam Rivera", ["Liam Walsh", "Zoe Adams", "Sam Rivera"]],
  ]);
  assert.equal(paths[0].ask, "Liam Walsh");
});

test("whoCanIntro matches names by whole word", () => {
  const people = [P("Casey Stone"), P("Pat Ey", { company: "Other" })];
  assert.deepEqual(whoCanIntro(people, "Casey").map(p => p.person.name), ["Casey Stone"]);
  assert.deepEqual(whoCanIntro(people, "ey").map(p => p.person.name), ["Pat Ey"]);
});

test("whoCanIntro survives cycles", () => {
  const people = [P("A", { company: "X", connectedThrough: "B" }), P("B", { connectedThrough: "A" })];
  assert.deepEqual(whoCanIntro(people, "X")[0].chain, ["B", "A"]);
});

test("intro report lists who to ask and the gaps", () => {
  const m = demo();
  const text = introReport(m.people, ["Delta Air Lines", "Nike"], m.me);
  assert.match(text, /ask \*\*Noah Carter\*\* \(your status with them: Met\)/);
  assert.match(text, /Noah Carter, Commercial Strategy Analyst at Delta Air Lines\*\* \[Met\]: you know them directly\./);
  assert.match(text, /Targets with no one on your map: Nike/);
});

// ---- schools & past companies ------------------------------------------------------

test("Schools can hold several entries with years, and everyone sharing one joins its group", async () => {
  const { parseEntries, formatEntries, addEntry } = await import("../site/js/core/history.js");
  assert.deepEqual(parseEntries("BYU (2022 - 2026); Lakeview High\nStanford (2027)"),
    [{ name: "BYU", years: "2022–2026" }, { name: "Lakeview High", years: "" }, { name: "Stanford", years: "2027" }]);
  assert.equal(formatEntries(parseEntries("A (2019–2021);B")), "A (2019–2021); B");
  assert.equal(addEntry("A (2019–2021)", { name: "a", years: "" }), "A (2019–2021)");
  const g = buildGraph([P("A", { school: "BYU (2020–2024); Lakeview High" }), P("B", { school: "Brigham Young University" }),
                        P("C", { school: "Lakeview High; BYU" }), P("D", { school: "Lakeview High" })]);
  assert.deepEqual([...ids(g, "school")].sort(), ["school:brigham young university", "school:lakeview high"]);
  assert.equal(g.nodes.find(n => n.id === "school:brigham young university").count, 3);
});

test("past employers get a dotted alumni link, count on targets, and give a path when nobody works there now", async () => {
  const { bestPath } = await import("../site/js/core/paths.js");
  const people = [P("Liam", { company: "Startup", pastCompanies: "Delta (2019–2021); Other Co" }), P("Kim", { company: "Delta" }),
                  P("Ann", { pastCompanies: "Nike (2018–2020)" })];
  const g = buildGraph(people, { targets: ["Delta", "Nike"] });
  assert.ok(edges(g).has("target:delta>p:liam>alumni"));
  assert.ok(edges(g).has("target:nike>p:ann>alumni"));
  assert.deepEqual(g.targets.find(t => t.label === "Delta").alumni, [{ name: "Liam", years: "2019–2021" }]);
  assert.equal(bestPath(g, people, g.targets.find(t => t.label === "Delta"), "Me").person, "Kim"); // current beats alumni
  const viaAlumni = bestPath(g, people, g.targets.find(t => t.label === "Nike"), "Me");
  assert.deepEqual([viaAlumni.person, viaAlumni.alumni], ["Ann", true]);
  assert.ok(viaAlumni.edges.includes("target:nike>p:ann>alumni"));
});

test("notes keep their line breaks (other fields are tidied to one line)", () => {
  const p = P("  Ana  ", { notes: "Line one  \r\n  Line   two\n\n", role: "PM\nLead" });
  assert.deepEqual([p.name, p.notes, p.role], ["Ana", "Line one\nLine two", "PM Lead"]);
});
