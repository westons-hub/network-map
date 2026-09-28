// The map: vis-network (loaded as a global by index.html) on a graph-paper background.

const vis = globalThis.vis;

const css = getComputedStyle(document.documentElement);
const c = name => css.getPropertyValue(`--${name}`).trim();

const GROUP_KINDS = ["company", "school", "tag"];
const STATUS_VAR = { "met": "met", "contacted": "contacted", "to reach out": "reach", "follow up": "follow",
                     "referral": "referral" };
export const statusColor = status => { const v = STATUS_VAR[String(status ?? "").trim().toLowerCase()]; return v && c(v); };

const EDGE = () => ({
  group:  { width: 2.5, color: c("edge") },
  member: { width: 1.2, color: c("edge") },
  direct: { width: 1.2, color: c("edge") },
  intro:  { width: 1, color: c("edge"), dashes: [2, 4] },
  also:   { width: 1, color: c("edge"), dashes: [6, 6] },
  gap:    { width: 1.5, color: c("target"), dashes: [4, 6] },
});

/** vis-network node options for one graph node. */
function styleNode(n, { statusColors }) {
  const font = { color: c("text"), size: 13, face: "system-ui, -apple-system, Segoe UI, sans-serif" };
  const base = { id: n.id, label: n.label, kind: n.kind, borderWidth: 2, font };
  if (n.kind === "me") {
    return { ...base, shape: "dot", size: 30, color: c("me"), font: { ...font, size: 17, bold: true } };
  }
  if (GROUP_KINDS.includes(n.kind)) {
    return { ...base, shape: "dot", size: 16 + Math.min(n.count, 20) * 1.6, label: `${n.label} (${n.count})`,
             color: { background: c(n.kind), border: n.target ? c("target") : c(n.kind) },
             borderWidth: n.target ? 5 : 2, font: { ...font, size: 15, bold: true } };
  }
  if (n.kind === "gap") {
    return { ...base, shape: "dot", size: 18, borderWidth: 3, shapeProperties: { borderDashes: [5, 4] },
             color: { background: c("paper"), border: c("target") },
             font: { ...font, color: c("target"), size: 14, bold: true }, title: "Target company: no connections yet" };
  }
  const second = n.kind === "second";
  const fill = (statusColors && statusColor(n.status)) || (second ? c("second") : c("person"));
  return { ...base, shape: "dot", size: second ? 8 : 11, borderWidth: n.target ? 4 : 2,
           color: { background: fill, border: n.target ? c("target") : second ? c("muted") : c("company") } };
}

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

export function createMap(container, { onSelect, onDeselect }) {
  const nodes = new vis.DataSet();
  const edges = new vis.DataSet();
  let options = { statusColors: true, showSecond: true };
  let graph = { nodes: [], edges: [] };

  const network = new vis.Network(container, { nodes, edges }, {
    physics: { solver: "forceAtlas2Based", forceAtlas2Based: { gravitationalConstant: -60, springLength: 90 },
               stabilization: { iterations: 400 } },
    interaction: { hover: true, tooltipDelay: 150, navigationButtons: false, keyboard: false },
    edges: { smooth: { type: "continuous" } },
  });
  network.on("beforeDrawing", ctx => drawGrid(network, ctx));
  network.on("click", p => (p.nodes.length ? onSelect(p.nodes[0]) : onDeselect()));
  network.on("doubleClick", p => {
    const n = p.nodes.length && graph.nodes.find(x => x.id === p.nodes[0]);
    if (n?.url && /^https?:\/\//.test(n.url)) window.open(n.url, "_blank", "noopener");
  });

  function restyle() {
    nodes.update(graph.nodes.map(n => ({ ...styleNode(n, options), hidden: n.kind === "second" && !options.showSecond })));
  }

  return {
    network,
    /** Show a new graph, keeping positions of nodes that are still there. */
    render(next, layout = {}) {
      const first = nodes.length === 0;
      graph = next;
      const keep = new Set(next.nodes.map(n => n.id));
      nodes.remove(nodes.getIds().filter(id => !keep.has(id)));
      const placed = network.getPositions();
      nodes.update(next.nodes.map(n => {
        const s = { ...styleNode(n, options), hidden: n.kind === "second" && !options.showSecond };
        const pos = placed[n.id] ?? layout[n.id];
        if (n.kind === "me") Object.assign(s, { x: 0, y: 0, fixed: true });
        else if (pos && !nodes.get(n.id)) Object.assign(s, pos);
        return s;
      }));
      const edgeKey = e => `${e.from}>${e.to}>${e.kind}`;
      const style = EDGE();
      edges.clear();
      edges.add(next.edges.map(e => ({ id: edgeKey(e), ...e, ...style[e.kind] })));
      if (first) network.once("stabilizationIterationsDone", () => network.fit({ animation: false }));
    },
    set(opts) {
      options = { ...options, ...opts };
      restyle();
    },
    setPhysics(on) { network.setOptions({ physics: { enabled: on } }); },
    focus(id) {
      if (!nodes.get(id)) return;
      network.selectNodes([id]);
      network.focus(id, { scale: 1.2, animation: { duration: 500, easingFunction: "easeInOutQuad" } });
    },
    fit() { network.fit({ animation: { duration: 400 } }); },
    unselect() { network.unselectAll(); },
    connected(id) { return network.getConnectedNodes(id); },
  };
}
