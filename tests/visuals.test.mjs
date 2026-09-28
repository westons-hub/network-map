// Best paths, the Ring layout, generated pictures and logo domains.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { demoFace, demoLogo, hash, initials, initialsAvatar, initialsLogo } from "../site/js/core/avatars.js";
import { buildGraph } from "../site/js/core/graph.js";
import { ringLayout } from "../site/js/core/layout.js";
import { domainFrom, guessDomain, isRealLogo, logoUrl } from "../site/js/core/logos.js";
import { bestPath, neighborhood } from "../site/js/core/paths.js";
import { readWorkbook } from "../site/js/core/workbook.js";

const demo = readWorkbook(readFileSync(new URL("../site/demo/demo_network.xlsx", import.meta.url)));
const graph = buildGraph(demo.people, { me: demo.me, targets: demo.targets });
const target = name => graph.targets.find(t => t.label === name);

// ---- best path ----------------------------------------------------------------

test("best path to a target reachable only through a chain", () => {
  const p = bestPath(graph, demo.people, target("Pinecrest Labs"), demo.me);
  assert.deepEqual(p.names, ["Alex Rivera", "Liam Walsh", "Zoe Adams"]);
  assert.equal(p.ask, "Liam Walsh");
  assert.deepEqual(p.nodes, ["me", "p:liam walsh", "p:zoe adams", "target:pinecrest labs"]);
  assert.deepEqual(p.edges, ["me>p:liam walsh>direct", "p:liam walsh>p:zoe adams>intro", "target:pinecrest labs>p:zoe adams>also"]);
});

test("best path through a group bubble goes me -> group -> person", () => {
  const p = bestPath(graph, demo.people, target("Brightline Bank"), demo.me);
  assert.deepEqual(p.names, ["Alex Rivera", "Daniel Ortiz"]);
  assert.deepEqual(p.nodes, ["me", "target:brightline bank", "p:daniel ortiz"]);
  assert.deepEqual(p.edges, ["me>target:brightline bank>group", "target:brightline bank>p:daniel ortiz>member"]);
});

test("among equally short paths, the warmest contact wins", () => {
  const g2 = buildGraph(demo.people, { me: demo.me, targets: [...demo.targets, { company: "Contoso Games" }] });
  const p = bestPath(g2, demo.people, g2.targets.find(t => t.label === "Contoso Games"), demo.me);
  assert.equal(p.ask, "Sofia Alvarez"); // Met beats Ethan Brooks (Follow Up) and Lena Novak (To Reach Out)
});

test("a target reached through someone sits next to them in the ring", () => {
  const pos = ringLayout(graph);
  const d = (a, b) => Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y);
  assert.ok(d("target:pinecrest labs", "p:liam walsh") < d("target:pinecrest labs", "target:summit airlines"));
});

test("no path to a target with no one there", () => {
  assert.equal(bestPath(graph, demo.people, target("Harborview Media"), demo.me), null);
});

test("neighborhood includes secondary links", () => {
  const n = neighborhood(graph, "school:riverbend university");
  for (const id of ["me", "p:jordan lee", "p:noah carter", "p:sofia alvarez"]) assert.ok(n.nodes.has(id), id);
});

// ---- ring layout ----------------------------------------------------------------

test("ring layout: you at the center, everyone placed, gap targets outermost, members near their group", () => {
  const pos = ringLayout(graph);
  assert.deepEqual(pos.me, { x: 0, y: 0 });
  for (const n of graph.nodes) assert.ok(Number.isFinite(pos[n.id]?.x) && Number.isFinite(pos[n.id]?.y), n.id);
  const r = id => Math.hypot(pos[id].x, pos[id].y);
  const gaps = ["target:granite peak partners", "target:harborview media"];
  const inner = graph.nodes.filter(n => !gaps.includes(n.id)).map(n => r(n.id));
  for (const g of gaps) assert.ok(r(g) > Math.max(...inner), g);
  const d = (a, b) => Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y);
  assert.ok(d("company:northwind consulting", "p:jordan lee") < 120);
  assert.ok(d("p:sofia alvarez", "p:tom nguyen") < 90); // 2nd-degree next to their connector
  // Hubs sit on one circle.
  const hubs = graph.edges.filter(e => e.from === "me" && e.kind !== "gap").map(e => r(e.to));
  assert.ok(Math.max(...hubs) - Math.min(...hubs) < 1);
});

test("ring layout handles an empty map and a loop of introductions", () => {
  assert.deepEqual(ringLayout(buildGraph([], { me: "Me" })), { me: { x: 0, y: 0 } });
  const g = buildGraph([{ name: "A", connectedThrough: "B", tags: [], company: "" }, { name: "B", connectedThrough: "A", tags: [], company: "" }]
    .map(p => ({ school: "", role: "", email: "", linkedinUrl: "", photo: "", connectedOn: "", status: "", notes: "", source: "", extra: {}, ...p })));
  const pos = ringLayout(g);
  for (const n of g.nodes) assert.ok(Number.isFinite(pos[n.id].x), n.id);
});

// ---- pictures ---------------------------------------------------------------------

test("initials", () => {
  assert.equal(initials("Jordan Lee"), "JL");
  assert.equal(initials("University of Utah", 3), "UU");
  assert.equal(initials("Delta"), "DE");
  assert.equal(initials("  "), "?");
  assert.equal(initials("Ana María de la Cruz"), "AM");
});

test("generated pictures are deterministic SVG data URIs and escape names", () => {
  for (const make of [initialsAvatar, initialsLogo, demoLogo, demoFace]) {
    const a = make("Jordan Lee");
    assert.equal(a, make("Jordan Lee"));
    assert.match(a, /^data:image\/svg\+xml;charset=utf-8,/);
    const svg = decodeURIComponent(a.split(",")[1]);
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="96" height="96"/);
  }
  assert.notEqual(demoFace("Jordan Lee"), demoFace("Priya Shah"));
  const evil = decodeURIComponent(initialsLogo("<script>&").split(",")[1]);
  assert.ok(!evil.includes("<script>"));
  assert.equal(hash("x"), hash("x"));
});

// ---- logos --------------------------------------------------------------------------

test("guessDomain uses known domains, aliases, school patterns and overrides", () => {
  assert.equal(guessDomain("BYU"), "byu.edu");
  assert.equal(guessDomain("Brigham Young University"), "byu.edu");
  assert.equal(guessDomain("Delta Air Lines, Inc."), "delta.com");
  assert.equal(guessDomain("EY"), "ey.com");
  assert.equal(guessDomain("Stanford University"), "stanford.edu");
  assert.equal(guessDomain("University of Oregon"), "oregon.edu");
  assert.equal(guessDomain("Acme Corp"), "acme.com");
  assert.equal(guessDomain("Acme Corp", "https://www.acme-widgets.io/about"), "acme-widgets.io");
  assert.equal(guessDomain(""), "");
});

test("domainFrom and logo URLs", () => {
  assert.equal(domainFrom("HTTPS://WWW.BYU.EDU/"), "byu.edu");
  assert.equal(domainFrom("not a url"), "");
  assert.equal(logoUrl("byu.edu"), "https://www.google.com/s2/favicons?domain=byu.edu&sz=128");
  assert.equal(logoUrl(""), "");
  assert.equal(isRealLogo(16), false);
  assert.equal(isRealLogo(64), true);
});
