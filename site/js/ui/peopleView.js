// People tab: everyone on your map as a spreadsheet-style table in your tracker's order. Sort by any column, filter
// by status / company / school / target, search, change status and relationship plan in place, and click a name
// to open them on the map.

import { parseEntries } from "../core/history.js";
import { normalizeName, normalizeOrg } from "../core/org.js";
import { STATUSES, personKey } from "../core/people.js";
import { meetingDate } from "../core/schedule.js";
import { RELATIONSHIP_PLANS } from "../core/tracker.js";
import { el } from "./dom.js";
import { inlineField } from "./inline.js";
import { brandFooter } from "./theme.js";

const extraOf = (p, h) => Object.entries(p.extra ?? {}).find(([k]) => k.toLowerCase() === h.toLowerCase())?.[1] ?? "";
// "Oct 4" this year, "Oct 4, 2025" otherwise.
const pretty = d => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d ?? "")) return d ?? "";
  const date = new Date(`${d}T00:00`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
};

export function createPeopleView(root, { getModel, images, onOpen, onPatch, onPatchExtra, onAdd }) {
  const filters = { q: "", status: "", company: "", school: "", target: false };
  let sort = { key: "name", dir: 1 };

  /** One row of values per person (what the table shows and sorts by). */
  function rowsOf(model) {
    const targets = new Set(model.targets.map(t => normalizeOrg(t.company)));
    return model.people.map(p => {
      const md = meetingDate(model, p.name);
      const lastMet = md && !md.upcoming ? md.meeting.date : "";
      const last = [lastMet, extraOf(p, "Last Contacted")].filter(Boolean).sort().at(-1) ?? "";
      const next = (model.tasks ?? []).filter(t => !t.done && t.due && normalizeName(t.person) === normalizeName(p.name)).map(t => t.due).sort()[0] ?? "";
      return { p, name: p.name, company: p.company, role: p.role, status: p.status, schools: parseEntries(p.school).map(e => e.name).join(", "),
               last, next, meeting: md?.upcoming ? md.meeting.date : "", plan: extraOf(p, "Relationship Plan"),
               atTarget: targets.has(normalizeOrg(p.company)) || parseEntries(p.pastCompanies).some(e => targets.has(normalizeOrg(e.name))) };
    });
  }

  /** The rows the filters and search leave, sorted (also used by Export → This view). */
  function visible() {
    const q = filters.q.trim().toLowerCase();
    const rows = rowsOf(getModel()).filter(r =>
      (!filters.status || (r.status || "No status") === filters.status) &&
      (!filters.company || normalizeOrg(r.company) === normalizeOrg(filters.company)) &&
      (!filters.school || parseEntries(r.p.school).some(e => normalizeOrg(e.name) === normalizeOrg(filters.school))) &&
      (!filters.target || r.atTarget) &&
      (!q || [r.name, r.company, r.role, r.schools, r.p.tags.join(" "), r.p.notes, r.p.skills].some(v => String(v ?? "").toLowerCase().includes(q))));
    // Status sorts in outreach order (To Reach Out → … → Referral), everything else alphabetically.
    const val = r => (sort.key === "status" ? (r.status ? String(STATUSES.indexOf(r.status)).padStart(2, "0") : "")
      : String(r[sort.key] ?? "").toLowerCase());
    return rows.sort((a, b) => {
      // Empty values go last whichever way you sort.
      const x = val(a), y = val(b);
      if (!x !== !y) return x ? -1 : 1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.name.localeCompare(b.name);
    });
  }

  function render() {
    const model = getModel();
    const all = rowsOf(model);
    const head = el("div", undefined, { class: "view-head" });
    head.append(el("h2", "People"), el("span", `${all.length} on your map`, { class: "muted small" }),
                el("button", "+ Add person", { class: "btn small", type: "button", style: "margin-left:auto", onclick: onAdd }));

    const bar = el("div", undefined, { class: "pool-filters" });
    const q = el("input", undefined, { type: "search", placeholder: "Search name, company, role, school, tags, notes", value: filters.q, "aria-label": "Search people" });
    q.addEventListener("input", () => { filters.q = q.value; renderTable(); });
    const select = (label, key, values) => {
      const s = el("select", undefined, { "aria-label": label, onchange: e => { filters[key] = e.target.value; renderTable(); } });
      s.append(el("option", `${label}: all`, { value: "" }));
      for (const v of values) s.append(el("option", v, { value: v, selected: v === filters[key] }));
      return s;
    };
    const uniq = list => [...new Map(list.filter(Boolean).map(v => [normalizeOrg(v), v])).values()].sort((a, b) => a.localeCompare(b));
    const target = el("label", undefined, { class: "small inline-check" });
    const tbox = el("input", undefined, { type: "checkbox", checked: filters.target, onchange: e => { filters.target = e.target.checked; renderTable(); } });
    target.append(tbox, " At a target (now or before)");
    bar.append(q, select("Status", "status", [...STATUSES, "No status"]), select("Company", "company", uniq(all.map(r => r.company))),
               select("School", "school", uniq(model.people.flatMap(p => parseEntries(p.school).map(e => e.name)))), target);

    const wrap = el("div", undefined, { class: "table-wrap" });
    const count = el("p", "", { class: "muted small" });
    function renderTable() {
      const rows = visible();
      count.textContent = rows.length === all.length ? "" : `Showing ${rows.length} of ${all.length}.`;
      const table = el("table", undefined, { class: "pool-table people-table" });
      const COLS = [["name", "Name"], ["company", "Company"], ["role", "Role"], ["status", "Status"], ["schools", "Schools"],
                    ["last", "Last contact"], ["meeting", "Next meeting"], ["next", "Follow-up"], ["plan", "Relationship"]];
      const tr = el("tr");
      for (const [key, label] of COLS) {
        const th = el("th", undefined, { "aria-sort": sort.key === key ? (sort.dir > 0 ? "ascending" : "descending") : "none" });
        th.append(el("button", `${label}${sort.key === key ? (sort.dir > 0 ? " ▲" : " ▼") : ""}`, { class: "sort", type: "button",
          onclick: () => { sort = { key, dir: sort.key === key ? -sort.dir : 1 }; renderTable(); } }));
        tr.append(th);
      }
      const thead = el("thead");
      thead.append(tr);
      const tbody = el("tbody");
      for (const r of rows) {
        const row = el("tr");
        const key = personKey(r.p);
        const name = el("button", undefined, { class: "person-cell", type: "button", title: "Open on the map", onclick: () => onOpen(r.name) });
        const img = images.forPerson({ label: r.name, photo: r.p.photo });
        name.append(el("img", undefined, { src: img.image, alt: "", onerror: e => { e.target.src = img.brokenImage; } }), r.name);
        const status = el("select", undefined, { class: "cell-select", "aria-label": `Status for ${r.name}`,
          onchange: e => onPatch(key, { status: e.target.value }) });
        for (const s of ["", ...STATUSES]) status.append(el("option", s || "—", { value: s, selected: s === (r.status ?? "") }));
        const plan = el("select", undefined, { class: "cell-select", "aria-label": `Relationship plan for ${r.name}`,
          onchange: e => onPatchExtra(key, "Relationship Plan", e.target.value) });
        for (const s of ["", ...RELATIONSHIP_PLANS]) plan.append(el("option", s || "—", { value: s, selected: s.toLowerCase() === r.plan.toLowerCase() }));
        const td = (...kids) => { const c = el("td"); c.append(...kids); return c; };
        row.append(td(name),
          td(inlineField({ value: r.company ?? "", kind: "company", label: `company for ${r.name}`, placeholder: "—", onSave: v => onPatch(key, { company: v }) })),
          td(inlineField({ value: r.role ?? "", kind: "role", label: `role for ${r.name}`, placeholder: "—", onSave: v => onPatch(key, { role: v }) })),
          td(status), td(el("span", r.schools, { class: "muted" })), td(pretty(r.last)), td(pretty(r.meeting)),
          td(el("span", pretty(r.next), { class: r.next && r.next < new Date().toISOString().slice(0, 10) ? "due late" : "" })), td(plan));
        tbody.append(row);
      }
      table.append(thead, tbody);
      wrap.replaceChildren(rows.length ? table : el("p", all.length ? "No one matches these filters." : "No one on your map yet.", { class: "muted empty-pool" }));
    }
    renderTable();
    root.replaceChildren(head, bar, count, wrap, brandFooter());
  }

  return { render, visible: () => visible().map(r => r.name) };
}
