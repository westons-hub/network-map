// Sidebar panels: the Targets list and the overview. (Details for a clicked person, group or
// target open in the popover card next to the node; see card.js.)

import { groupTasks, taskBadge, todayIso, toDate } from "../core/schedule.js";
import { el } from "./dom.js";

export { el };

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function badges(t) {
  const wrap = el("span", undefined, { class: "badges" });
  if (t.priority) wrap.append(el("span", `P${t.priority}`, { class: `badge p${t.priority}` }));
  if (t.stage) wrap.append(el("span", t.stage, { class: "badge" }));
  return wrap;
}

/** "Ask Liam Walsh for an intro" / "You know 4 people here" / "No connections yet". */
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
    const summary = pathSummary(t, paths.get(t.key));
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

// ---- overview -------------------------------------------------------------

function nameField(box, model, { onRename }) {
  const label = el("label", undefined, { class: "field" });
  const input = el("input", undefined, { value: model.me, placeholder: "Your name", autocomplete: "name" });
  input.addEventListener("change", () => onRename(input.value.trim()));
  label.append(el("span", "Your name (shown in the center of the map)"), input);
  box.append(label);
}

export function renderOverview(box, { graph, model, mode }, handlers) {
  box.replaceChildren();
  box.append(el("h3", model.me ? `${model.me.split(" ")[0]}'s network` : "Your network"));
  box.append(el("div", mode === "demo" ? "Fictional demo data" : "Click anyone on the map to open their card.", { class: "sub" }));
  const s = graph.stats;
  const stats = el("div", undefined, { class: "stats" });
  for (const [v, label] of [[s.direct, "direct"], [s.second_degree, "2nd-degree"], [s.groups, "groups"],
                            [s.targets - s.gaps, `of ${s.targets} targets reachable`], [model.pool.length, "in LinkedIn pool"],
                            [model.meetings.length, "meetings logged"]]) {
    const d = el("div");
    d.append(el("b", String(v)), el("span", label));
    stats.append(d);
  }
  box.append(stats);
  if (!model.me) nameField(box, model, handlers);

  // Coming up: the next few meetings and what's due.
  const today = todayIso();
  const upcoming = model.meetings.filter(m => m.date >= today)
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`)).slice(0, 3);
  const due = taskBadge(model.tasks, today);
  const g = groupTasks(model.tasks, today);
  if (upcoming.length || due) {
    box.append(el("div", "Coming up", { class: "list-heading" }));
    const ul = el("ul", undefined, { class: "coming-up" });
    for (const m of upcoming) {
      const when = toDate(m.date, m.start).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric",
                                                                      hour: "numeric", minute: "2-digit" });
      const li = el("li");
      li.append(el("button", `${m.person}`, { class: "linklike", type: "button", onclick: () => handlers.onPerson(m.person) }),
                el("span", ` · ${m.type || "Meeting"} · ${when}`, { class: "muted small" }));
      ul.append(li);
    }
    if (due) {
      const li = el("li");
      li.append(el("button", `${plural(g.overdue.length, "task")} overdue, ${g.today.length} due today`,
                   { class: `linklike${g.overdue.length ? " late" : ""}`, type: "button", onclick: () => handlers.onView("todo") }));
      ul.append(li);
    }
    box.append(ul);
  }
  box.append(el("p", "Click anyone for their card; click a target to see your best way in. Esc or empty space closes it.",
                { class: "muted small" }));
}
