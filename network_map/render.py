"""Write the graph to a single, self-contained HTML file (works offline)."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from .graph import Graph

STATIC = Path(__file__).parent / "static"

PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
  :root {
    --bg: #f6f7f9; --panel: #ffffff; --text: #1d2330; --muted: #667085; --line: #d0d5dd;
    --me: #1f3a5f; --company: #2e6fd8; --school: #1f9d6b; --tag: #8b5cf6;
    --person: #ffffff; --second: #eef0f3;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #11151c; --panel: #1a2029; --text: #e6e9ef; --muted: #98a2b3; --line: #344054;
            --person: #232b36; --second: #1a2029; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
         background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; }
  header { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center;
           padding: 12px 16px; border-bottom: 1px solid var(--line); background: var(--panel); }
  h1 { font-size: 17px; margin: 0; }
  .stats { color: var(--muted); font-size: 13px; }
  .controls { display: flex; gap: 12px; align-items: center; margin-left: auto; flex-wrap: wrap; }
  input[type=search] { padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px;
                       background: var(--bg); color: var(--text); width: 220px; max-width: 60vw; }
  label { color: var(--muted); font-size: 13px; cursor: pointer; }
  main { flex: 1; display: flex; min-height: 0; }
  #map { flex: 1; min-width: 0; }
  aside { width: 300px; border-left: 1px solid var(--line); background: var(--panel);
          padding: 16px; overflow-y: auto; }
  aside h2 { font-size: 16px; margin: 0 0 4px; }
  aside .sub { color: var(--muted); margin-bottom: 12px; }
  aside dl { margin: 0; display: grid; grid-template-columns: 90px 1fr; gap: 6px 8px; font-size: 13px; }
  aside dt { color: var(--muted); }
  aside dd { margin: 0; word-break: break-word; }
  aside ul { padding-left: 18px; margin: 8px 0 0; }
  aside li { cursor: pointer; }
  aside li:hover { text-decoration: underline; }
  .btn { display: inline-block; margin-top: 14px; padding: 7px 12px; border-radius: 8px;
         background: var(--company); color: #fff; text-decoration: none; font-weight: 600; font-size: 13px; }
  .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin-top: 18px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px;
         vertical-align: -1px; border: 1px solid var(--line); }
  @media (max-width: 720px) {
    main { flex-direction: column; }
    aside { width: auto; border-left: 0; border-top: 1px solid var(--line); max-height: 40vh; }
  }
</style>
</head>
<body>
<header>
  <h1>__TITLE__</h1>
  <span class="stats" id="stats"></span>
  <div class="controls">
    <input type="search" id="search" placeholder="Find a person, company or school">
    <label><input type="checkbox" id="show2" checked> 2nd-degree</label>
    <label><input type="checkbox" id="physics" checked> Motion</label>
  </div>
</header>
<main>
  <div id="map"></div>
  <aside id="panel">
    <h2>Your network</h2>
    <div class="sub">Click anyone to see details. Double-click to open their LinkedIn.</div>
    <div class="legend">
      <span><span class="dot" style="background:var(--me)"></span>You</span>
      <span><span class="dot" style="background:var(--company)"></span>Company group</span>
      <span><span class="dot" style="background:var(--school)"></span>School group</span>
      <span><span class="dot" style="background:var(--tag)"></span>Tag group</span>
      <span><span class="dot" style="background:var(--person)"></span>Direct connection</span>
      <span><span class="dot" style="background:var(--second)"></span>2nd-degree</span>
    </div>
    <p class="sub" style="margin-top:18px">Generated __DATE__. Groups form when __MIN__+ people share a company or school.</p>
  </aside>
</main>
<script>__VIS__</script>
<script>
const DATA = __DATA__;
const css = getComputedStyle(document.documentElement);
const c = n => css.getPropertyValue("--" + n).trim();
const text = c("text"), line = c("line");

const STYLE = {
  me:      { shape: "dot", size: 34, color: c("me"), font: { color: text, size: 18, bold: true } },
  company: { shape: "dot", color: c("company") },
  school:  { shape: "dot", color: c("school") },
  tag:     { shape: "dot", color: c("tag") },
  person:  { shape: "dot", size: 11, color: { background: c("person"), border: c("company") } },
  second:  { shape: "dot", size: 8,  color: { background: c("second"), border: c("muted") } },
};

const nodes = new vis.DataSet(DATA.nodes.map(n => {
  const s = STYLE[n.kind] || {};
  const node = { ...n, ...s, font: { color: text, size: 13, ...(s.font || {}) }, borderWidth: 2 };
  if (["company", "school", "tag"].includes(n.kind)) {
    node.size = 16 + Math.min(n.count, 20) * 1.6;
    node.label = n.label + " (" + n.count + ")";
    node.font = { color: text, size: 15, bold: true };
  }
  if (n.kind === "me") { node.fixed = true; node.x = 0; node.y = 0; }
  return node;
}));

const EDGE = {
  group:  { width: 2.5, color: line },
  member: { width: 1.2, color: line },
  direct: { width: 1.2, color: line },
  intro:  { width: 1, color: line, dashes: [2, 4] },
  also:   { width: 1, color: line, dashes: [6, 6] },
};
const edges = new vis.DataSet(DATA.edges.map((e, i) => ({ id: i, ...e, ...EDGE[e.kind] })));

document.getElementById("stats").textContent =
  `${DATA.stats.people} people · ${DATA.stats.direct} direct · ${DATA.stats.second_degree} 2nd-degree · ${DATA.stats.groups} groups`;

const network = new vis.Network(document.getElementById("map"), { nodes, edges }, {
  physics: { solver: "forceAtlas2Based", forceAtlas2Based: { gravitationalConstant: -60, springLength: 90 },
             stabilization: { iterations: 400 } },
  interaction: { hover: true, tooltipDelay: 150 },
  edges: { smooth: { type: "continuous" } },
});

const panel = document.getElementById("panel");
const defaultPanel = panel.innerHTML;

function el(tag, txt, attrs = {}) {
  const e = document.createElement(tag);
  if (txt !== undefined) e.textContent = txt;
  Object.assign(e, attrs);
  return e;
}

function showNode(id) {
  const n = nodes.get(id);
  if (!n) return;
  panel.innerHTML = "";
  if (n.kind === "me") { panel.innerHTML = defaultPanel; return; }
  if (["company", "school", "tag"].includes(n.kind)) {
    panel.append(el("h2", DATA.nodes.find(x => x.id === id).label));
    panel.append(el("div", `${n.kind[0].toUpperCase() + n.kind.slice(1)} group · ${n.count} direct connections`, { className: "sub" }));
    const linked = network.getConnectedNodes(id).map(x => nodes.get(x))
      .sort((a, b) => a.label.localeCompare(b.label));
    const list = (heading, people) => {
      if (!people.length) return;
      panel.append(el("div", heading, { className: "sub", style: "margin:14px 0 0" }));
      const ul = el("ul");
      people.forEach(p => { const li = el("li", p.label); li.onclick = () => focus(p.id); ul.append(li); });
      panel.append(ul);
    };
    list("People you know", linked.filter(x => x.kind === "person"));
    list("Reachable through your connections", linked.filter(x => x.kind === "second"));
    return;
  }
  panel.append(el("h2", n.label));
  panel.append(el("div", [n.role, n.company].filter(Boolean).join(" at ") || (n.kind === "second" ? "2nd-degree connection" : "Direct connection"), { className: "sub" }));
  const dl = el("dl");
  const rows = [["School", n.school], ["Status", n.status], ["Met via", n.via],
                ["Tags", (n.tags || []).join(", ")], ["Notes", n.notes]];
  rows.filter(r => r[1]).forEach(([k, v]) => { dl.append(el("dt", k)); dl.append(el("dd", v)); });
  panel.append(dl);
  if (n.url && /^https?:\\/\\//.test(n.url)) {
    panel.append(el("a", "Open LinkedIn profile", { className: "btn", href: n.url, target: "_blank", rel: "noopener" }));
  }
}

function focus(id) {
  network.selectNodes([id]);
  network.focus(id, { scale: 1.2, animation: { duration: 500 } });
  showNode(id);
}

network.on("click", p => p.nodes.length ? showNode(p.nodes[0]) : (panel.innerHTML = defaultPanel));
network.on("doubleClick", p => {
  const n = p.nodes.length && nodes.get(p.nodes[0]);
  if (n && n.url && /^https?:\\/\\//.test(n.url)) window.open(n.url, "_blank", "noopener");
});

document.getElementById("search").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim().toLowerCase();
  if (!q) return;
  const hit = nodes.get().find(n => [n.label, n.company, n.school].some(v => v && v.toLowerCase().includes(q)));
  if (hit) focus(hit.id);
});

document.getElementById("show2").addEventListener("change", e => {
  nodes.update(nodes.get({ filter: n => n.kind === "second" }).map(n => ({ id: n.id, hidden: !e.target.checked })));
});
document.getElementById("physics").addEventListener("change", e => network.setOptions({ physics: { enabled: e.target.checked } }));
</script>
</body>
</html>
"""


def render_html(graph: Graph, out_path: str | Path, title: str = "My Network Map",
                min_group_size: int = 3) -> Path:
    data = {"nodes": graph.nodes, "edges": graph.edges, "stats": graph.stats()}
    # Escape "</" so names can never close the <script> tag early.
    data_json = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    vis_js = (STATIC / "vis-network.min.js").read_text(encoding="utf-8")
    html = (PAGE.replace("__TITLE__", _escape(title))
                .replace("__DATE__", date.today().strftime("%b %d, %Y"))
                .replace("__MIN__", str(min_group_size))
                .replace("__DATA__", data_json)
                .replace("__VIS__", vis_js))
    out = Path(out_path)
    out.write_text(html, encoding="utf-8")
    return out


def _escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
