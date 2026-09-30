// The map: vis-network (loaded as a global by index.html) on a graph-paper background.
//
// Readability rules:
// * Three edge styles only: solid dark gray = you know them (direct / group membership),
//   dashed gray = through someone, red = the highlighted best path to a target.
// * People show their picture with a status-colored ring. Only target companies get a red ring.
// * Clicking fades everything except the node and its neighbors (hover = lighter preview).
// * Two layouts: "free" (physics, groups spread apart) and "ring" (computed, see core/layout.js).

import { outerRing, ringLayout } from "../core/layout.js";
import { edgeId, neighborhood } from "../core/paths.js";

const vis = globalThis.vis;
const css = getComputedStyle(document.documentElement);
const c = name => css.getPropertyValue(`--${name}`).trim();

const GROUP_KINDS = ["company", "school", "tag", "target"];
const STATUS_VAR = { "met": "met", "contacted": "contacted", "scheduled": "scheduled", "to reach out": "reach",
                     "follow up": "follow", "referral": "referral" };
export const statusColor = status => { const v = STATUS_VAR[String(status ?? "").trim().toLowerCase()]; return v && c(v); };

const FADE = 0.15;          // opacity of everything outside a clicked node's neighborhood
const PREVIEW_FADE = 0.45;  // ...and while just hovering
const LABEL_MIN_SCALE = 0.55; // hide person names when zoomed out further than this
const ZOOM = { min: 0.12, max: 2.5, wheel: 0.0011, pinch: 0.009, ease: 0.16 };

const rgba = (hex, a) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : hex;
};

/** Graph paper: thin lines every 20 units, darker every 100, in map coordinates (pans/zooms with the map). */
function drawGrid(network, ctx) {
  const { width, height } = ctx.canvas.getBoundingClientRect();
  const tl = network.DOMtoCanvas({ x: 0, y: 0 });
  const br = network.DOMtoCanvas({ x: width, y: height });
  const scale = network.getScale();
  ctx.save();
  ctx.fillStyle = c("paper");
  ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  const lines = (step, color) => {
    ctx.beginPath();
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) { ctx.moveTo(x, tl.y); ctx.lineTo(x, br.y); }
    for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) { ctx.moveTo(tl.x, y); ctx.lineTo(br.x, y); }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / scale; // one screen pixel at any zoom
    ctx.stroke();
  };
  if (20 * scale >= 6) lines(20, c("grid-minor")); // skip the fine grid when zoomed far out
  lines(100, c("grid-major"));
  ctx.restore();
}

export function createMap(container, { images, onSelect, onDeselect, pathFor, onAfterDraw = () => {}, onMoved = () => {} }) {
  const nodes = new vis.DataSet();
  const edges = new vis.DataSet();
  let graph = { nodes: [], edges: [] };
  let options = { showSecond: true, showAlumni: true, layout: "ring" };
  const pinned = new Set(); // dots you've dragged (or that have a saved spot): the automatic layout leaves them alone
  let selected = null;   // clicked node id
  let hovered = null;    // hovered node id (preview only when nothing is selected)
  let smallLabels = false;

  const network = new vis.Network(container, { nodes, edges }, {
    physics: {
      solver: "barnesHut",
      barnesHut: { gravitationalConstant: -9000, centralGravity: 0.12, springConstant: 0.045, damping: 0.35,
                   avoidOverlap: 0.6 },
      stabilization: { iterations: 500, fit: true },
      minVelocity: 0.9,
    },
    interaction: { hover: true, tooltipDelay: 200, keyboard: false, zoomView: false, selectConnectedEdges: false,
                   hoverConnectedEdges: false },
    edges: { smooth: { type: "continuous", roundness: 0.35 } },
    nodes: { shapeProperties: { interpolation: true } },
  });

  // ---- look ------------------------------------------------------------------

  function focusSet() {
    const id = selected ?? hovered;
    if (!id || !nodes.get(id)) return null;
    const hood = neighborhood(graph, id);
    const path = pathFor(id);
    if (path) { path.nodes.forEach(n => hood.nodes.add(n)); path.edges.forEach(e => hood.edges.add(e)); }
    return { ...hood, path: new Set(path?.edges ?? []), fade: selected ? FADE : PREVIEW_FADE };
  }

  function nodeStyle(n, focus) {
    const faded = focus && !focus.nodes.has(n.id);
    const alpha = faded ? focus.fade : 1;
    const person = n.kind === "person" || n.kind === "second";
    const showLabel = !(person && smallLabels) || (focus && !faded);
    const font = { color: rgba(c("text"), showLabel ? alpha : 0), size: person ? 14 : 16, bold: !person,
                   face: "DM Sans, system-ui, -apple-system, Segoe UI, sans-serif",
                   strokeWidth: showLabel ? 4 : 0, strokeColor: rgba(c("paper"), alpha * 0.95) }; // a halo in the map color keeps labels readable
    const base = { id: n.id, label: n.label, opacity: alpha, font, hidden: n.kind === "second" && !options.showSecond };

    if (n.kind === "me") {
      const ring = { border: c("me"), background: "#ffffff", highlight: { border: c("me"), background: "#ffffff" },
                     hover: { border: c("me"), background: "#ffffff" } };
      return n.photo
        ? { ...base, ...images.forPerson(n), shape: "circularImage", size: 30, borderWidth: 5, borderWidthSelected: 6, color: ring,
            shapeProperties: { useBorderWithImage: true, interpolation: true }, font: { ...font, size: 18 }, mass: 6 }
        : { ...base, shape: "dot", size: 26, color: { background: c("me"), border: c("me") }, borderWidth: 3,
            font: { ...font, size: 18 }, mass: 6 };
    }
    if (GROUP_KINDS.includes(n.kind)) {
      const target = n.target;
      const ring = target ? c("target") : c(n.kind === "target" ? "company" : n.kind);
      const count = n.count ?? 0;
      const label = n.kind === "target" && n.gap ? `${n.label}\n(no one yet)` : count ? `${n.label} (${count})` : n.label;
      return { ...base, ...images.forOrg(n), shape: "circularImage", label,
               size: (target ? 26 : 20) + Math.min(count, 20) * 1.3,
               borderWidth: target ? 5 : 3, borderWidthSelected: target ? 6 : 4,
               color: { border: ring, background: "#ffffff", highlight: { border: ring, background: "#ffffff" },
                        hover: { border: ring, background: "#ffffff" } },
               shapeProperties: { useBorderWithImage: true, interpolation: true, borderDashes: n.gap ? [6, 5] : false },
               font: { ...font, size: 16, color: n.gap ? rgba(c("target"), alpha) : font.color },
               mass: 2 + Math.min(count, 12) * 0.35,
               // No-connection targets sit on a ring outside the network (placed by placeGaps), not in the physics.
               physics: !n.gap };
    }
    // A person: picture, with a ring in their status color.
    const ring = statusColor(n.status) || c("no-status");
    return { ...base, ...images.forPerson(n), shape: "circularImage", size: n.kind === "second" ? 14 : 18,
             borderWidth: 4, borderWidthSelected: 5,
             color: { border: ring, background: "#ffffff", highlight: { border: ring, background: "#ffffff" },
                      hover: { border: ring, background: "#ffffff" } },
             shapeProperties: { useBorderWithImage: true, interpolation: true }, mass: 1 };
  }

  const byId = () => new Map(graph.nodes.map(n => [n.id, n]));

  function edgeStyle(e, focus, nodeIndex) {
    const to = nodeIndex.get(e.to), from = nodeIndex.get(e.from);
    const viaSomeone = e.kind === "intro" || e.kind === "gap" || (e.kind === "also" && to?.kind === "second");
    const alumni = e.kind === "alumni";
    const personLink = e.kind === "link"; // Coworker / Classmate / Friend / Mentor / Other
    const toTarget = from?.target || from?.kind === "target";
    const onPath = focus?.path.has(edgeId(e));
    // Tag-group links stay hidden unless highlighted; alumni links follow the "Show alumni links" toggle.
    const hidden = (e.kind === "also" && from?.kind === "tag" && !(focus && focus.edges.has(edgeId(e))))
      || (alumni && !options.showAlumni && !onPath);
    const faded = focus && !focus.edges.has(edgeId(e));
    const alpha = faded ? focus.fade * 0.8 : alumni && !onPath ? 0.75 : 1;
    const color = onPath ? c("target") : viaSomeone || alumni ? c("edge-dashed") : personLink ? c("link") : c("edge");
    const length = { group: 210 + Math.min(to?.count ?? 0, 12) * 10, gap: to?.gap ? 400 : 260, member: 85,
                     direct: 190, intro: 85 }[e.kind];
    return {
      id: edgeId(e), from: e.from, to: e.to, kind: e.kind, hidden,
      title: alumni ? `Used to work here${e.years ? ` (${e.years})` : ""}` : personLink ? `${e.type}${e.notes ? `: ${e.notes}` : ""}` : undefined,
      width: onPath ? 4.5 : e.kind === "group" ? 2.2 : alumni || personLink ? 1.3 : viaSomeone ? 1.5 : 1.7,
      dashes: onPath ? false : alumni ? [1.5, 5] : viaSomeone ? [6, 6] : false,
      color: { color, highlight: color, hover: color, opacity: alpha },
      // School links pull gently (long springs) so a school settles near its people without tearing company
      // clusters apart; tag and alumni links never pull.
      physics: e.kind !== "gap" && !alumni && !personLink && (e.kind !== "also" || from?.kind !== "tag"),
      length: e.kind === "also" ? (toTarget ? 90 : 240) : length,
      smooth: e.kind === "also" || alumni ? { type: "curvedCW", roundness: 0.12 }
        : personLink ? { type: "curvedCCW", roundness: 0.2 } : undefined,
    };
  }

  function restyle() {
    const focus = focusSet();
    const index = byId();
    nodes.update(graph.nodes.map(n => nodeStyle(n, focus)));
    edges.update(graph.edges.map(e => edgeStyle(e, focus, index)));
  }

  // ---- layouts -----------------------------------------------------------------

  /** Free layout: put no-connection targets on a ring just outside the settled network. */
  function placeGaps(animate = true) {
    const ids = graph.nodes.filter(n => n.kind === "target" && n.gap && !pinned.has(n.id)).map(n => n.id);
    if (!ids.length || options.layout !== "free") return;
    const ring = outerRing(network.getPositions(), ids);
    if (animate) animateTo(ring, 500); else nodes.update(Object.entries(ring).map(([id, p]) => ({ id, ...p })));
  }

  let animation;
  function animateTo(targets, ms = 750) {
    cancelAnimationFrame(animation);
    const start = network.getPositions();
    const ids = Object.keys(targets).filter(id => nodes.get(id));
    const t0 = performance.now();
    const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const step = now => {
      const t = Math.min(1, (now - t0) / ms);
      const k = ease(t);
      nodes.update(ids.map(id => {
        const a = start[id] ?? targets[id], b = targets[id];
        return { id, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }));
      if (t < 1) animation = requestAnimationFrame(step);
      else network.fit({ animation: { duration: 500, easingFunction: "easeInOutQuad" } });
    };
    animation = requestAnimationFrame(step);
  }

  function applyLayout(animate = true) {
    if (options.layout === "ring") {
      network.setOptions({ physics: { enabled: false } });
      const target = ringLayout(graph);
      if (animate) animateTo(target);
      else { nodes.update(Object.entries(target).map(([id, p]) => ({ id, ...p }))); network.fit(); }
    } else {
      cancelAnimationFrame(animation);
      network.setOptions({ physics: { enabled: true } });
      network.once("stabilized", () => placeGaps(true)); // animateTo fits the view when it's done
      network.startSimulation();
    }
  }

  // ---- smooth zoom -----------------------------------------------------------------
  // vis-network's own wheel zoom jumps in steps; this eases toward the target scale and
  // keeps the point under the cursor still.

  let zoomTarget = null, zoomAnchor = null, zoomFrame = 0;
  function zoomStep() {
    const scale = network.getScale();
    const next = scale + (zoomTarget - scale) * ZOOM.ease;
    const { x: ax, y: ay } = zoomAnchor;
    const under = network.DOMtoCanvas(zoomAnchor);
    const { width, height } = container.getBoundingClientRect();
    network.moveTo({ scale: next, position: { x: under.x - (ax - width / 2) / next, y: under.y - (ay - height / 2) / next },
                     animation: false });
    checkLabels();
    if (Math.abs(zoomTarget - next) / zoomTarget > 0.002) zoomFrame = requestAnimationFrame(zoomStep);
    else zoomFrame = 0;
  }
  container.addEventListener("wheel", e => {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * rect.height : e.deltaY;
    const factor = Math.exp(-dy * (e.ctrlKey ? ZOOM.pinch : ZOOM.wheel)); // ctrlKey = trackpad pinch
    zoomTarget = Math.min(ZOOM.max, Math.max(ZOOM.min, (zoomFrame ? zoomTarget : network.getScale()) * factor));
    zoomAnchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (!zoomFrame) zoomFrame = requestAnimationFrame(zoomStep);
  }, { passive: false });

  function checkLabels() {
    const small = network.getScale() < LABEL_MIN_SCALE;
    if (small !== smallLabels) { smallLabels = small; restyle(); }
  }
  network.on("zoom", checkLabels);
  network.on("animationFinished", checkLabels);

  // ---- events --------------------------------------------------------------------

  network.on("beforeDrawing", ctx => drawGrid(network, ctx));
  network.on("afterDrawing", () => onAfterDraw());
  network.on("click", p => {
    if (p.nodes.length) { selected = p.nodes[0]; restyle(); onSelect(selected); }
    else if (!p.edges.length) { clear(); onDeselect(); }
  });
  network.on("doubleClick", p => {
    const n = p.nodes.length && graph.nodes.find(x => x.id === p.nodes[0]);
    if (n?.url && /^https?:\/\//.test(n.url)) window.open(n.url, "_blank", "noopener");
  });
  network.on("hoverNode", p => { if (!selected) { hovered = p.node; restyle(); } });
  network.on("blurNode", () => { if (hovered) { hovered = null; restyle(); } });
  network.on("dragStart", p => { if (p.nodes.length) container.classList.add("dragging"); });
  network.on("dragEnd", p => {
    container.classList.remove("dragging");
    // Free layout: remember where you put it (and pin it there) so it's in the same spot next time.
    const moved = p.nodes.filter(id => id !== "me");
    if (!moved.length || options.layout !== "free") return;
    const pos = network.getPositions(moved);
    moved.forEach(id => pinned.add(id));
    nodes.update(moved.map(id => ({ id, fixed: true })));
    onMoved(Object.fromEntries(moved.map(id => [id, { x: Math.round(pos[id].x), y: Math.round(pos[id].y) }])));
  });

  function clear() {
    selected = null;
    hovered = null;
    network.unselectAll();
    restyle();
  }

  return {
    network,
    /** Show a new graph, keeping positions of nodes that are still there. */
    render(next, layout = {}) {
      const first = nodes.length === 0;
      const previous = network.getPositions();
      graph = next;
      if (selected && !next.nodes.some(n => n.id === selected)) selected = null;
      const keepNodes = new Set(next.nodes.map(n => n.id));
      nodes.remove(nodes.getIds().filter(id => !keepNodes.has(id)));
      const keepEdges = new Set(next.edges.map(edgeId));
      edges.remove(edges.getIds().filter(id => !keepEdges.has(id)));
      // New nodes start next to their parent so they grow out of the map instead of flying in.
      const parentOf = Object.fromEntries(next.edges.filter(e => e.kind !== "also").map(e => [e.to, e.from]));
      nodes.add(next.nodes.filter(n => !nodes.get(n.id)).map(n => {
        // A position you dragged it to (saved in the Layout sheet) is kept exactly and pinned there.
        if (n.kind !== "me" && layout[n.id]) { pinned.add(n.id); return { id: n.id, ...layout[n.id], fixed: true }; }
        const at = n.kind === "me" ? { x: 0, y: 0 } : previous[parentOf[n.id]];
        const jitter = () => (Math.random() - 0.5) * 40;
        return { id: n.id, ...(at ? { x: at.x + (n.kind === "me" ? 0 : jitter()), y: at.y + (n.kind === "me" ? 0 : jitter()) } : {}),
                 ...(n.kind === "me" ? { fixed: true } : {}) };
      }));
      restyle();
      if (first) {
        if (options.layout === "ring") applyLayout(false);
        else {
          network.once("stabilizationIterationsDone", () => { placeGaps(false); network.fit({ animation: false }); });
          network.once("stabilized", () => placeGaps(true));
        }
      } else if (options.layout === "ring") applyLayout(true);
      else if (next.nodes.some(n => n.gap && !previous[n.id])) {
        placeGaps(true);
        network.once("stabilized", () => placeGaps(true));
      }
    },
    set(opts) { options = { ...options, ...opts }; restyle(); },
    setLayout(mode, animate = true) { options.layout = mode; applyLayout(animate); },
    /** Forget dragged positions and let the physics lay the map out again. */
    rearrange() {
      nodes.update(nodes.getIds().filter(id => id !== "me").map(id => ({ id, fixed: false })));
      pinned.clear();
      if (options.layout === "free") {
        network.setOptions({ physics: { enabled: true } });
        network.once("stabilized", () => { placeGaps(true); network.fit({ animation: { duration: 600, easingFunction: "easeInOutQuad" } }); });
        network.stabilize(300);
      } else applyLayout(true);
    },
    /** Refresh pictures after logos/avatars finish loading. */
    refresh: restyle,
    /** follow: a just-added node is still settling, so re-center on it once the layout comes to rest. */
    select(id, { follow = false } = {}) {
      if (!nodes.get(id)) return;
      if (follow && options.layout === "free") {
        network.once("stabilized", () => {
          if (selected === id) network.focus(id, { scale: 1.1, animation: { duration: 600, easingFunction: "easeInOutQuad" } });
        });
      }
      selected = id;
      network.selectNodes([id]);
      restyle();
      const path = pathFor(id);
      if (path?.nodes.length > 1) {
        network.fit({ nodes: path.nodes, animation: { duration: 700, easingFunction: "easeInOutQuad" } });
      } else network.focus(id, { scale: 1.1, animation: { duration: 700, easingFunction: "easeInOutQuad" } });
    },
    clear,
    fit() { network.fit({ animation: { duration: 600, easingFunction: "easeInOutQuad" } }); },
    /** Where a node is on screen (relative to the map), and its radius in screen pixels. */
    nodeBox(id) {
      const pos = network.getPositions([id])[id];
      if (!pos) return null;
      const { x, y } = network.canvasToDOM(pos);
      const node = nodes.get(id);
      return { x, y, r: ((node?.size ?? 16) + (node?.borderWidth ?? 2)) * network.getScale() };
    },
  };
}
