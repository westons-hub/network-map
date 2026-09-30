// The LinkedIn pool: everyone from your Connections.csv, searchable, and added to the map only when you
// choose (one at a time with a review, or several at once).

import { normalizeOrg } from "../core/org.js";
import { poolName } from "../core/people.js";
import { onMapIndex, searchPool } from "../core/pool.js";
import { toDate } from "../core/schedule.js";
import { el } from "./dom.js";
import { brandFooter } from "./theme.js";

const pretty = d => (d ? toDate(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export function createPoolView(root, { getModel, onImport, onAdd, onAddMany, onOpen }) {
  const filters = { q: "", company: "", title: "", since: "" };
  const selected = new Set(); // pool entry keys
  const keyOf = e => e.url || poolName(e);

  function render() {
    const model = getModel();
    const pool = model.pool;
    const head = el("div", undefined, { class: "view-head" });
    head.append(el("h2", "LinkedIn pool"),
      el("span", pool.length ? `${pool.length} connections · only the ones you add go on the map` : "", { class: "muted small" }),
      el("button", pool.length ? "Import a newer LinkedIn export…" : "Import your LinkedIn export…", { class: `btn small${pool.length ? "" : " primary"}`,
        type: "button", onclick: onImport, style: "margin-left:auto" }));
    if (!pool.length) {
      const empty = el("div", undefined, { class: "empty-pool" });
      empty.append(el("p", "Import your LinkedIn connections to search them here and add the ones that matter."),
        el("ol", undefined));
      for (const step of ["On LinkedIn: Settings → Data privacy → Get a copy of your data.", "Choose “Connections” and request the archive (it arrives by email, usually within minutes).",
                          "Import the Connections.csv here. It stays in your browser and your workbook."]) {
        empty.lastChild.append(el("li", step));
      }
      root.replaceChildren(head, empty, brandFooter());
      return;
    }

    // Filters.
    const bar = el("div", undefined, { class: "pool-filters" });
    const q = el("input", undefined, { type: "search", placeholder: "Search name, company or title", value: filters.q, "aria-label": "Search the pool" });
    const companies = [...new Map(pool.filter(e => e.company).map(e => [normalizeOrg(e.company), e.company])).values()].sort((a, b) => a.localeCompare(b));
    const company = el("select", undefined, { "aria-label": "Company" });
    company.append(el("option", "All companies", { value: "" }));
    for (const c of companies) company.append(el("option", c, { value: c, selected: normalizeOrg(c) === normalizeOrg(filters.company) }));
    const title = el("input", undefined, { placeholder: "Title contains…", value: filters.title, "aria-label": "Title" });
    const since = el("input", undefined, { type: "date", value: filters.since, "aria-label": "Connected since", title: "Connected since" });
    const apply = () => { Object.assign(filters, { q: q.value, company: company.value, title: title.value, since: since.value }); render(); };
    q.addEventListener("input", () => { filters.q = q.value; renderRows(); });
    title.addEventListener("input", () => { filters.title = title.value; renderRows(); });
    company.addEventListener("change", apply);
    since.addEventListener("change", apply);
    bar.append(q, company, title, el("label", undefined, { class: "since" }));
    bar.lastChild.append(el("span", "Connected since", { class: "muted small" }), since);

    const actions = el("div", undefined, { class: "pool-actions" });
    const table = el("table", undefined, { class: "pool-table" });
    root.replaceChildren(head, bar, actions, el("div", undefined, { class: "table-wrap" }), brandFooter());
    root.querySelector(".table-wrap").append(table);

    function renderRows() {
      const isOnMap = onMapIndex(getModel().people);
      const rows = searchPool(pool, filters);
      const addable = rows.filter(e => !isOnMap(e));
      actions.replaceChildren(el("span", `${rows.length} shown`, { class: "muted small" }));
      const picked = rows.filter(e => selected.has(keyOf(e)) && !isOnMap(e));
      actions.append(el("button", `Add selected (${picked.length})`, { class: "btn small primary", type: "button", disabled: !picked.length,
        onclick: () => { onAddMany(picked); selected.clear(); } }));
      if (filters.company) {
        const atCompany = addable.filter(e => normalizeOrg(e.company) === normalizeOrg(filters.company));
        actions.append(el("button", `Add everyone at ${filters.company} (${atCompany.length})`, { class: "btn small", type: "button",
          disabled: !atCompany.length, onclick: () => onAddMany(atCompany) }));
      }
      const headRow = el("tr");
      const all = el("input", undefined, { type: "checkbox", "aria-label": "Select all shown", checked: addable.length > 0 && addable.every(e => selected.has(keyOf(e))),
        onchange: e => { for (const r of addable) e.target.checked ? selected.add(keyOf(r)) : selected.delete(keyOf(r)); renderRows(); } });
      headRow.append(el("th"), el("th", "Name"), el("th", "Company"), el("th", "Title"), el("th", "Connected"), el("th"));
      headRow.firstChild.append(all);
      const tbody = el("tbody");
      for (const e of rows.slice(0, 500)) {
        const on = isOnMap(e);
        const tr = el("tr", undefined, { class: on ? "on-map" : "" });
        const box = el("input", undefined, { type: "checkbox", disabled: on, checked: selected.has(keyOf(e)), "aria-label": `Select ${poolName(e)}`,
          onchange: ev => { ev.target.checked ? selected.add(keyOf(e)) : selected.delete(keyOf(e)); renderRows(); } });
        const name = el("td");
        name.append(on ? el("button", poolName(e), { class: "linklike", type: "button", onclick: () => onOpen(poolName(e)) }) : el("strong", poolName(e)));
        if (on) name.append(" ", el("span", "Already on map", { class: "badge on-map" }));
        const act = el("td", undefined, { class: "right" });
        act.append(on ? el("button", "Open", { class: "btn tiny", type: "button", onclick: () => onOpen(poolName(e)) })
                      : el("button", "Add to map", { class: "btn tiny", type: "button", onclick: () => onAdd(e) }));
        const check = el("td");
        check.append(box);
        tr.append(check, name, el("td", e.company), el("td", e.position), el("td", pretty(e.connectedOn), { class: "muted" }), act);
        tbody.append(tr);
      }
      table.replaceChildren(el("thead"), tbody);
      table.firstChild.append(headRow);
      if (!rows.length) actions.append(el("span", "No one matches.", { class: "muted small" }));
    }
    renderRows();
  }

  /** The rows the current filters show (for "Export this view"). */
  const visible = () => searchPool(getModel().pool, filters);
  return { render, visible, filtered: () => Object.values(filters).some(Boolean) };
}
