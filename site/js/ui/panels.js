// Sidebar panels: the Targets list and the details view.

import { normalizeName, normalizeOrg } from "../core/org.js";
import { poolName } from "../core/people.js";
import { el } from "./dom.js";

export { el };

const isWebUrl = u => /^https?:\/\//i.test(u ?? "");
const isEmail = e => /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(e ?? "");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const personId = name => `p:${normalizeName(name)}`;

function badges(t) {
  const wrap = el("span", undefined, { class: "badges" });
  if (t.priority) wrap.append(el("span", `P${t.priority}`, { class: `badge p${t.priority}` }));
  if (t.stage) wrap.append(el("span", t.stage, { class: "badge" }));
  return wrap;
}

/** "Ask Liam Walsh" / "You know 4 people here" / "No connections yet". */
function pathSummary(t, path) {
  if (!path) return { text: "No connections yet", cls: "none" };
  if (path.names.length === 2) {
    return { text: `You know ${t.direct.length === 1 ? "1 person" : `${t.direct.length} people`} here`, cls: "ok" };
  }
  return { text: `Ask ${path.ask} for an intro`, cls: "via" };
}

// ---- targets --------------------------------------------------------------

export function renderTargets(box, { graph, paths }, { onFocus, onEditTarget }) {
  box.replaceChildren();
  if (!graph.targets.length) {
    box.append(el("p", "No target companies yet. Add the companies you want to work at, and the map shows " +
                       "who you know there and your best way in.", { class: "muted small" }));
    return;
  }
  const ul = el("ul", undefined, { class: "target-list" });
  const order = [...graph.targets].sort((a, b) => (a.priority || "9").localeCompare(b.priority || "9"));
  for (const t of order) {
    const path = paths.get(t.key);
    const summary = pathSummary(t, path);
    const li = el("li", undefined, { tabIndex: 0, onclick: () => onFocus(t.focus),
                                     onkeydown: e => e.key === "Enter" && onFocus(t.focus) });
    const row = el("div", undefined, { class: "row" });
    row.append(el("span", t.label, { class: "name" }));
    row.append(el("button", "Edit", { class: "btn tiny", type: "button", title: `Edit ${t.label}`,
                                      onclick: e => { e.stopPropagation(); onEditTarget(t.key); } }));
    const meta = el("div", undefined, { class: "row meta" });
    meta.append(el("span", summary.text, { class: `path-summary ${summary.cls}` }), badges(t));
    li.append(row, meta);
    ul.append(li);
  }
  box.append(ul);
}

// ---- details --------------------------------------------------------------

function overview(box, { graph, model, mode }, handlers) {
  box.append(el("h3", model.me ? `${model.me.split(" ")[0]}'s network` : "Your network"));
  box.append(el("div", mode === "demo" ? "Fictional demo data" : "Click anyone on the map for details.", { class: "sub" }));
  const s = graph.stats;
  const stats = el("div", undefined, { class: "stats" });
  for (const [v, label] of [[s.direct, "direct"], [s.second_degree, "2nd-degree"], [s.groups, "groups"],
                            [s.targets - s.gaps, `of ${s.targets} targets reachable`], [model.pool.length, "in LinkedIn pool"]]) {
    const d = el("div");
    d.append(el("b", String(v)), el("span", label));
    stats.append(d);
  }
  box.append(stats);
  if (!model.me) nameField(box, model, handlers);
  else box.append(el("p", "Click a target to see your best way in. Click anyone to highlight their connections; " +
                          "click empty space or press Esc to clear.", { class: "muted small" }));
}

function nameField(box, model, { onRename }) {
  const label = el("label", undefined, { class: "field" });
  const input = el("input", undefined, { value: model.me, placeholder: "Your name", autocomplete: "name" });
  input.addEventListener("change", () => onRename(input.value.trim()));
  label.append(el("span", "Your name (shown in the center of the map)"), input);
  box.append(label);
}

function nameList(box, heading, names, onFocus) {
  if (!names.length) return;
  box.append(el("div", heading, { class: "list-heading" }));
  const ul = el("ul", undefined, { class: "names" });
  for (const n of names) {
    const li = el("li");
    li.append(el("button", n, { class: "linklike", type: "button", onclick: () => onFocus(personId(n)) }));
    ul.append(li);
  }
  box.append(ul);
}

function pathView(box, path, onFocus) {
  box.append(el("div", "Your best way in", { class: "list-heading" }));
  const wrap = el("div", undefined, { class: "path" });
  path.names.forEach((name, i) => {
    if (i) wrap.append(el("span", "→", { class: "arrow" }));
    wrap.append(i === 0 ? el("span", name, { class: "step me" })
      : el("button", name, { class: "step", type: "button", onclick: () => onFocus(personId(name)) }));
  });
  box.append(wrap);
  box.append(el("p", path.names.length === 2 ? `You know ${path.person} directly. Reach out!`
    : `Ask ${path.ask} for an intro${path.names.length > 3 ? ` (the chain continues to ${path.person})` : ` to ${path.person}`}.`,
  { class: "small" }));
}

function targetView(box, n, ctx, handlers) {
  const t = ctx.graph.targets.find(x => x.focus === n.id);
  const path = ctx.paths.get(t.key);
  const head = el("div", undefined, { class: "detail-head" });
  head.append(el("img", undefined, { class: "logo", alt: "", src: ctx.images.forOrg(n).image }));
  const titles = el("div");
  titles.append(el("h3", t.label), el("div", "Target company", { class: "sub" }));
  head.append(titles);
  box.append(head, badges(t));
  if (t.notes) box.append(el("p", t.notes, { class: "notes" }));
  if (path) pathView(box, path, handlers.onFocus);
  else {
    box.append(el("p", "No connections yet. No one on your map works here. Add a contact (even a 2nd-degree one), " +
                       "or ask the people in your biggest groups who they know.", { class: "empty-state" }));
  }
  nameList(box, "People you know there", t.direct, handlers.onFocus);
  nameList(box, "Reachable through someone", t.second, handlers.onFocus);
  const onMap = new Set(ctx.model.people.map(p => normalizeName(p.name)));
  const inPool = ctx.model.pool.filter(e => normalizeOrg(e.company) === t.key && !onMap.has(normalizeName(poolName(e))));
  if (inPool.length) {
    box.append(el("div", `In your LinkedIn pool, not on the map (${inPool.length})`, { class: "list-heading" }));
    const ul = el("ul", undefined, { class: "names plain" });
    for (const e of inPool) ul.append(el("li", `${poolName(e)}${e.position ? ` · ${e.position}` : ""}`));
    box.append(ul);
  }
  const actions = el("div", undefined, { class: "actions-row" });
  actions.append(el("button", "Edit target", { class: "btn", type: "button", onclick: () => handlers.onEditTarget(t.key) }));
  box.append(actions);
}

export function renderDetails(box, ctx, handlers) {
  const { graph, model, selected } = ctx;
  box.replaceChildren();
  const n = selected && graph.nodes.find(x => x.id === selected);
  if (!n) return overview(box, ctx, handlers);

  if (n.kind === "me") {
    box.append(el("h3", model.me || "You"), el("div", "That's you", { class: "sub" }));
    nameField(box, model, handlers);
    return;
  }
  if (n.target) {
    targetView(box, n, ctx, handlers);
    if (n.kind !== "company") return;
  }
  if (["company", "school", "tag"].includes(n.kind)) {
    const kind = n.kind[0].toUpperCase() + n.kind.slice(1);
    if (!n.target) {
      const head = el("div", undefined, { class: "detail-head" });
      head.append(el("img", undefined, { class: "logo", alt: "", src: ctx.images.forOrg(n).image }));
      const titles = el("div");
      titles.append(el("h3", n.label), el("div", `${kind} group · ${plural(n.count, "direct connection")}`, { class: "sub" }));
      head.append(titles);
      box.append(head);
    }
    nameList(box, n.target ? "Everyone in this group" : "People you know", graph.groups[n.id] ?? [], handlers.onFocus);
    const introduced = graph.edges.filter(e => e.from === n.id && e.kind === "also")
      .map(e => graph.nodes.find(x => x.id === e.to)).filter(x => x?.kind === "second").map(x => x.label);
    nameList(box, "Reachable through your connections", introduced, handlers.onFocus);
    if (n.kind === "company" && !n.target) {
      const actions = el("div", undefined, { class: "actions-row" });
      actions.append(el("button", "Make this a target", { class: "btn", type: "button",
                                                           onclick: () => handlers.onMakeTarget(n.label) }));
      box.append(actions);
    }
    return;
  }

  // A person.
  const head = el("div", undefined, { class: "detail-head" });
  head.append(el("img", undefined, { class: "avatar", alt: "", src: ctx.images.forPerson(n).image,
                                     onerror: e => { e.target.src = ctx.images.forPerson({ ...n, photo: "" }).image; } }));
  const titles = el("div");
  titles.append(el("h3", n.label));
  titles.append(el("div", [n.role, n.company].filter(Boolean).join(" at ")
                          || (n.kind === "second" ? "2nd-degree connection" : "Direct connection"), { class: "sub" }));
  head.append(titles);
  box.append(head);
  const dl = el("dl");
  const row = (label, value) => {
    if (!value) return;
    dl.append(el("dt", label));
    const dd = el("dd");
    if (value instanceof Node) dd.append(value); else dd.textContent = value;
    dl.append(dd);
  };
  if (n.email) {
    const wrap = el("span");
    wrap.append(isEmail(n.email) ? el("a", n.email, { href: `mailto:${n.email}` }) : el("span", n.email));
    wrap.append(" ", el("button", "Copy", { class: "btn tiny", type: "button", onclick: async e => {
      try { await navigator.clipboard.writeText(n.email); e.target.textContent = "Copied"; }
      catch { e.target.textContent = "Couldn't copy"; }
      setTimeout(() => { e.target.textContent = "Copy"; }, 1500);
    } }));
    row("Email", wrap);
  }
  row("Company", n.company);
  row("School", n.school);
  if (n.status) {
    const s = el("span");
    s.append(el("i", undefined, { class: `dot status-${n.status.toLowerCase().replace(/\s+/g, "-")}` }), n.status);
    row("Status", s);
  }
  row("Connected on", n.connectedOn);
  if (n.via) {
    row("Met via", el("button", n.via, { class: "linklike", type: "button", onclick: () => handlers.onFocus(personId(n.via)) }));
  }
  row("Tags", (n.tags ?? []).join(", "));
  row("Notes", n.notes);
  if (n.atTarget) row("Target", "Works at one of your target companies");
  box.append(dl);
  const actions = el("div", undefined, { class: "actions-row" });
  if (n.source !== "placeholder") {
    actions.append(el("button", n.photo ? "Change photo" : "Add photo", { class: "btn", type: "button",
                                                                          onclick: () => handlers.onPhoto(n) }));
  }
  if (isWebUrl(n.url)) actions.append(el("a", "LinkedIn ↗", { class: "btn", href: n.url, target: "_blank", rel: "noopener" }));
  if (actions.children.length) box.append(actions);
}
