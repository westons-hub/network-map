// Sidebar panels. Everything is built with textContent (never innerHTML) so names
// and notes from a spreadsheet can't inject markup.

import { normalizeName } from "../core/org.js";

export function el(tag, text, attrs = {}) {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = text;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  return e;
}

const isWebUrl = u => /^https?:\/\//i.test(u ?? "");
const isEmail = e => /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(e ?? "");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---- targets --------------------------------------------------------------

export function renderTargets(box, { graph, model }, { onFocus }) {
  box.replaceChildren();
  if (!graph.targets.length) {
    box.append(el("p", "No target companies yet. Add them on the Targets sheet of your workbook.", { class: "muted small" }));
    return;
  }
  const meta = new Map(model.targets.map(t => [t.company, t]));
  const ul = el("ul", undefined, { class: "target-list" });
  for (const t of graph.targets) {
    const info = meta.get(t.label) ?? {};
    const n = t.direct.length + t.second.length;
    const li = el("li", undefined, { tabIndex: 0, onclick: () => onFocus(t.focus),
                                     onkeydown: e => e.key === "Enter" && onFocus(t.focus) });
    const row = el("div", undefined, { class: "row" });
    row.append(el("span", t.label, { class: "name" }));
    row.append(n ? el("span", `${t.direct.length} direct · ${t.second.length} via`, { class: "count" })
                 : el("span", "No connections yet", { class: "none" }));
    li.append(row);
    if (info.priority || info.stage) {
      const badges = el("div");
      if (info.priority) badges.append(el("span", `P${info.priority}`, { class: "badge" }));
      if (info.stage) badges.append(el("span", info.stage, { class: "badge" }));
      li.append(badges);
    }
    ul.append(li);
  }
  box.append(ul);
}

// ---- details --------------------------------------------------------------

function overview(box, { graph, model, mode }, handlers) {
  const me = model.me || "You";
  box.append(el("h3", model.me ? `${model.me.split(" ")[0]}'s network` : "Your network"));
  box.append(el("div", mode === "demo" ? "Fictional demo data" : "Click anyone on the map for details.", { class: "sub" }));
  const s = graph.stats;
  const stats = el("div", undefined, { class: "stats" });
  for (const [v, label] of [[s.direct, "direct"], [s.second_degree, "2nd-degree"], [s.groups, "groups"],
                            [s.targets - s.gaps, `of ${s.targets} targets covered`], [model.pool.length, "in LinkedIn pool"]]) {
    const d = el("div");
    d.append(el("b", String(v)), el("span", label));
    stats.append(d);
  }
  box.append(stats);
  if (!model.me) nameField(box, model, handlers);
  else box.append(el("p", `${me} is in the center. Click a group to see who's in it, or a target to see your way in.`,
                     { class: "muted small" }));
}

function nameField(box, model, { onRename }) {
  const label = el("label", undefined, { class: "field" });
  const input = el("input", undefined, { value: model.me, placeholder: "Your name", autocomplete: "name" });
  input.addEventListener("change", () => onRename(input.value.trim()));
  label.append(el("span", "Your name (shown in the center of the map)"), input);
  box.append(label);
}

export function renderDetails(box, ctx, handlers) {
  const { graph, model, selected, connected } = ctx;
  box.replaceChildren();
  const n = selected && graph.nodes.find(x => x.id === selected);
  if (!n) return overview(box, ctx, handlers);

  if (n.kind === "me") {
    box.append(el("h3", model.me || "You"), el("div", "That's you", { class: "sub" }));
    nameField(box, model, handlers);
    return;
  }
  if (n.kind === "gap") {
    box.append(el("h3", n.label), el("div", "Target company · no connections yet", { class: "sub" }));
    box.append(el("p", "No one on your map works here yet. Add a contact (even a 2nd-degree one), " +
                       "or ask the people in your biggest groups who they know."));
    return;
  }
  if (["company", "school", "tag"].includes(n.kind)) {
    const kind = n.kind[0].toUpperCase() + n.kind.slice(1);
    box.append(el("h3", n.label));
    box.append(el("div", `${kind} group · ${plural(n.count, "direct connection")}${n.target ? " · Target" : ""}`,
                  { class: "sub" }));
    const linked = connected(n.id).map(id => graph.nodes.find(x => x.id === id)).filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label));
    const list = (heading, people) => {
      if (!people.length) return;
      box.append(el("div", heading, { class: "sub", style: "margin:12px 0 0" }));
      const ul = el("ul");
      for (const p of people) ul.append(el("li", p.label, { onclick: () => handlers.onFocus(p.id) }));
      box.append(ul);
    };
    list("People you know", linked.filter(x => x.kind === "person"));
    list("Reachable through your connections", linked.filter(x => x.kind === "second"));
    return;
  }

  // A person.
  box.append(el("h3", n.label));
  box.append(el("div", [n.role, n.company].filter(Boolean).join(" at ")
                       || (n.kind === "second" ? "2nd-degree connection" : "Direct connection"), { class: "sub" }));
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
    wrap.append(" ", el("button", "Copy", { class: "btn small", type: "button", onclick: async e => {
      try { await navigator.clipboard.writeText(n.email); e.target.textContent = "Copied"; }
      catch { e.target.textContent = "Couldn't copy"; }
      setTimeout(() => { e.target.textContent = "Copy"; }, 1500);
    } }));
    row("Email", wrap);
  }
  row("Company", n.company);
  row("School", n.school);
  row("Status", n.status);
  row("Connected on", n.connectedOn);
  if (n.via) {
    row("Met via", el("button", n.via, { class: "linklike", type: "button",
                                         onclick: () => handlers.onFocus(`p:${normalizeName(n.via)}`) }));
  }
  row("Tags", (n.tags ?? []).join(", "));
  row("Notes", n.notes);
  row("Target", n.target ? "Works at a target company" : "");
  box.append(dl);
  if (isWebUrl(n.url)) {
    box.append(el("p", undefined, { style: "margin:12px 0 0" }));
    box.lastChild.append(el("a", "Open LinkedIn profile ↗", { class: "btn", href: n.url, target: "_blank", rel: "noopener" }));
  }
}
