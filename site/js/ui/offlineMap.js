// "Offline map": one .html file with the map exactly as you see it (positions, colors, logos and photos) that
// opens anywhere, with no internet and no Orbit. The map library and every picture are inlined; pictures that
// another site won't hand over (CORS) fall back to their initials. Nothing is uploaded: the file is built here
// and downloaded.

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A picture as a data: URI, or null if the browser isn't allowed to read it. */
async function dataUri(url) {
  if (!url || url.startsWith("data:")) return url;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}

/**
 * network: the vis Network on screen. people: node id -> { role, company, status } for the side panel.
 * Returns the HTML text.
 */
export async function offlineMapHtml({ network, title, people = {}, dark = false }) {
  const positions = network.getPositions();
  const nodes = network.body.data.nodes.get().map(n => ({ ...n, ...positions[n.id], fixed: true, physics: false }));
  const edges = network.body.data.edges.get().filter(e => !e.hidden);
  // Inline every picture once.
  const urls = [...new Set(nodes.flatMap(n => [n.image, n.brokenImage]).filter(u => u && !u.startsWith("data:")))];
  const inlined = new Map(await Promise.all(urls.map(async u => [u, await dataUri(new URL(u, location.href).href)])));
  for (const n of nodes) {
    const broken = n.brokenImage && (inlined.get(n.brokenImage) ?? n.brokenImage);
    if (n.image) n.image = inlined.get(n.image) ?? (broken?.startsWith("data:") ? broken : undefined);
    if (n.brokenImage) n.brokenImage = broken?.startsWith("data:") ? broken : undefined;
    if (!n.image && n.shape === "circularImage") Object.assign(n, { shape: "dot", size: n.size ?? 16 });
  }
  const lib = await (await fetch(new URL("../../vendor/vis-network.min.js", import.meta.url))).text();
  const data = JSON.stringify({ nodes, edges, people }).replace(/</g, "\\u003c");
  const bg = dark ? "#131A26" : "#fcfdff", fg = dark ? "#F4F6FA" : "#1d2330", muted = dark ? "#A3AEBF" : "#5B6B80";
  const panel = dark ? "#1A2332" : "#ffffff", line = dark ? "#2C3749" : "#e4e7ec";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  html, body { margin: 0; height: 100%; background: ${bg}; color: ${fg}; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  #map { position: fixed; inset: 0; }
  header { position: fixed; top: 12px; left: 12px; z-index: 2; background: ${panel}; border: 1px solid ${line}; border-radius: 10px; padding: 10px 14px; max-width: 320px; }
  header h1 { font-size: 16px; margin: 0 0 2px; } header p { margin: 0; color: ${muted}; font-size: 12px; }
  #info { margin-top: 8px; font-size: 13px; } #info:empty { display: none; }
  input { margin-top: 8px; width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid ${line}; border-radius: 8px; background: ${bg}; color: ${fg}; font: inherit; }
</style></head>
<body>
<header><h1>${esc(title)}</h1><p>Offline copy made with Orbit on ${esc(new Date().toLocaleDateString("en-US", { dateStyle: "long" }))}. Everything is in this file.</p>
<input id="q" type="search" placeholder="Find someone…" aria-label="Find someone"><div id="info"></div></header>
<div id="map"></div>
<script>${lib}</script>
<script>
const D = ${data};
const nodes = new vis.DataSet(D.nodes), edges = new vis.DataSet(D.edges);
const net = new vis.Network(document.getElementById("map"), { nodes, edges },
  { physics: false, interaction: { hover: true, dragNodes: false }, edges: { smooth: { type: "continuous", roundness: 0.35 } } });
const info = document.getElementById("info");
function show(id) {
  const n = nodes.get(id), p = D.people[id];
  info.textContent = n ? [String(n.label || "").replace(/\\n.*/s, ""), p && [p.role, p.company].filter(Boolean).join(" @ "), p && p.status].filter(Boolean).join(" · ") : "";
}
net.on("click", e => { if (e.nodes.length) show(e.nodes[0]); else info.textContent = ""; });
document.getElementById("q").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim().toLowerCase();
  const hit = D.nodes.find(n => String(n.label || "").toLowerCase().includes(q));
  if (hit) { net.selectNodes([hit.id]); net.focus(hit.id, { scale: 1.2, animation: true }); show(hit.id); }
});
</script>
</body></html>`;
}
