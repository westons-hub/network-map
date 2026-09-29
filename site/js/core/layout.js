// The "Ring" layout: you in the center, groups and targets evenly around you,
// members fanned around their group, 2nd-degree people just outside whoever
// connects them, and targets with no connections on an outer ring.

const TAU = Math.PI * 2;
const HUB_GAP = 60;       // space between neighboring hubs' fans on the ring
const MEMBER_R = 110;     // members' distance from their group
const CHILD_R = 85;       // 2nd-degree distance from their connector
const OUTER_GAP = 110;    // outer ring (no-connection targets) just beyond the outermost group

/** Primary parent of each node: the edge that places it (member > direct > intro > group/gap from me). */
function parents(graph) {
  const parent = {};
  const rank = { member: 0, direct: 1, intro: 2, group: 3, gap: 3 };
  for (const e of graph.edges) {
    if (!(e.kind in rank)) continue; // "also" links never place a node
    const cur = parent[e.to];
    if (!cur || rank[e.kind] < rank[cur.kind]) parent[e.to] = { id: e.from, kind: e.kind };
  }
  return parent;
}

export function ringLayout(graph) {
  const pos = { me: { x: 0, y: 0 } };
  const parent = parents(graph);
  const children = {};
  for (const [id, p] of Object.entries(parent)) (children[p.id] ??= []).push(id);
  const byId = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
  const order = (a, b) => (byId[a]?.label ?? a).localeCompare(byId[b]?.label ?? b);
  for (const list of Object.values(children)) list.sort(order);

  const isGap = id => byId[id]?.kind === "target" && byId[id].gap;
  const kindRank = { company: 0, target: 0, school: 1, tag: 2, person: 3 };
  const sorted = (children.me ?? []).filter(id => !isGap(id))
    .sort((a, b) => (kindRank[byId[a]?.kind] ?? 4) - (kindRank[byId[b]?.kind] ?? 4)
                    || (byId[b]?.count ?? 0) - (byId[a]?.count ?? 0) || order(a, b));

  // A target you reach only through someone sits right next to that someone's hub,
  // so the path to it stays short instead of crossing the map.
  const hubOf = id => { let cur = id; while (parent[cur] && parent[cur].id !== "me") cur = parent[cur].id; return cur; };
  const anchorOf = {};
  for (const id of sorted) {
    if ((children[id] ?? []).some(k => parent[k].kind === "member")) continue;
    const reached = graph.edges.find(e => e.from === id && e.kind === "also")?.to;
    const anchor = reached && hubOf(reached);
    if (anchor && anchor !== id && sorted.includes(anchor)) anchorOf[id] = anchor;
  }
  // A group whose people all sit under other bubbles (e.g. a school whose alumni are in company groups) floats
  // inside the ring, toward its people, instead of taking a slot on it and sending lines across the map.
  const floating = sorted.filter(id => ["school", "tag"].includes(byId[id]?.kind)
    && !(children[id] ?? []).some(k => parent[k].kind === "member"));
  const hubs = sorted.filter(id => !anchorOf[id] && !floating.includes(id));
  for (const [id, anchor] of Object.entries(anchorOf)) hubs.splice(hubs.indexOf(anchor) + 1, 0, id);

  // How much of the ring each hub needs: its fan of members plus room for their 2nd-degree people.
  const fanWidth = id => {
    const kids = children[id] ?? [];
    if (!kids.length) return 70;
    const grandkids = kids.reduce((n, k) => n + (children[k]?.length ?? 0), 0);
    return Math.max(110, Math.min(kids.length, 10) * 42 + grandkids * 22);
  };
  const need = hubs.map(id => fanWidth(id) + HUB_GAP);
  const total = need.reduce((a, b) => a + b, 0);
  const R1 = Math.max(340, total / TAU);

  const place = (id, x, y) => { pos[id] = { x, y }; };
  const fan = (center, around, angle, radius, spread) => {
    const n = around.length;
    around.forEach((id, i) => {
      const a = n === 1 ? angle : angle + spread * (i / (n - 1) - 0.5);
      place(id, center.x + radius * Math.cos(a), center.y + radius * Math.sin(a));
    });
  };

  // Hubs on the ring; members fanned outward around each hub.
  let at = -Math.PI / 2;
  const boundaries = []; // angles between neighboring hubs: where gap targets go
  hubs.forEach((id, i) => {
    const slice = (need[i] / total) * TAU;
    const angle = at + slice / 2;
    at += slice;
    boundaries.push(at);
    place(id, R1 * Math.cos(angle), R1 * Math.sin(angle));
    const kids = (children[id] ?? []).filter(k => parent[k].kind === "member");
    const radius = MEMBER_R + Math.max(0, kids.length - 6) * 7;
    fan(pos[id], kids, angle, radius, Math.min(Math.PI * 1.25, kids.length * 0.6));
  });

  // 2nd-degree (and deeper) people: just outside their connector, pointing away from its parent.
  const queue = Object.keys(pos);
  while (queue.length) {
    const id = queue.shift();
    const kids = (children[id] ?? []).filter(k => !pos[k] && parent[k].kind === "intro");
    if (!kids.length) continue;
    const from = pos[parent[id]?.id] ?? pos.me;
    const angle = Math.atan2(pos[id].y - from.y, pos[id].x - from.x);
    fan(pos[id], kids, angle, CHILD_R, Math.min(Math.PI * 0.9, kids.length * 0.55));
    queue.push(...kids);
  }

  for (const id of floating) {
    const members = graph.edges.filter(e => e.from === id && pos[e.to]).map(e => pos[e.to]);
    if (!members.length) continue;
    const x = members.reduce((a, p) => a + p.x, 0) / members.length;
    const y = members.reduce((a, p) => a + p.y, 0) / members.length;
    const angle = Math.atan2(y, x);
    place(id, 0.55 * R1 * Math.cos(angle), 0.55 * R1 * Math.sin(angle));
  }

  // Targets with nobody yet: a ring just outside everything else, in the widest open spaces.
  const gaps = (children.me ?? []).filter(isGap);
  Object.assign(pos, outerRing(pos, gaps));
  const R3 = Math.max(R1, ...Object.values(pos).map(p => Math.hypot(p.x, p.y)));

  // Anything left (e.g. a loop of people connected only through each other): park it outside.
  const rest = graph.nodes.filter(n => !pos[n.id]);
  rest.forEach((n, i) => {
    const a = (TAU * i) / Math.max(rest.length, 1);
    place(n.id, (R3 + 120) * Math.cos(a), (R3 + 120) * Math.sin(a));
  });
  return pos;
}

/**
 * Where to put targets you have no connections at yet: evenly spread on a ring just outside the outermost
 * node (so "Fit" keeps the network big), each in one of the widest angular gaps between everything else.
 * Used by both layouts. positions: { id: {x,y} } for the rest of the map (you at 0,0).
 */
export function outerRing(positions, gapIds, margin = OUTER_GAP) {
  if (!gapIds.length) return {};
  const others = Object.entries(positions).filter(([id]) => id !== "me" && !gapIds.includes(id)).map(([, p]) => p);
  const radius = Math.max(260, ...others.map(p => Math.hypot(p.x, p.y))) + margin;
  const angles = others.map(p => Math.atan2(p.y, p.x)).sort((a, b) => a - b);
  let spots;
  if (angles.length < 2) {
    spots = gapIds.map((_, i) => -Math.PI / 2 + (TAU * (i + 0.5)) / gapIds.length);
  } else {
    // Greedy: each target goes to the gap between neighboring angles that has the most room per target.
    const gaps = angles.map((a, i) => ({ from: a, width: (i + 1 < angles.length ? angles[i + 1] : angles[0] + TAU) - a, n: 0 }));
    for (let k = 0; k < gapIds.length; k++) {
      gaps.reduce((best, g) => (g.width / (g.n + 1) > best.width / (best.n + 1) ? g : best)).n += 1;
    }
    spots = gaps.flatMap(g => Array.from({ length: g.n }, (_, i) => g.from + (g.width * (i + 1)) / (g.n + 1)));
  }
  spots.sort((a, b) => a - b);
  return Object.fromEntries(gapIds.map((id, i) => [id, { x: radius * Math.cos(spots[i]), y: radius * Math.sin(spots[i]) }]));
}
