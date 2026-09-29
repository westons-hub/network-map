// Calendar view: month and week, showing meetings and task due dates. Click a day to
// schedule a meeting or add a task there; click an item to open it.

import { calendarItems, isoDate, monthGrid, todayIso, toDate, weekDays } from "../core/schedule.js";
import { el } from "./dom.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const prettyTime = t => (t ? toDate("2000-01-01", t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");

export function createCalendar(root, { getModel, onDay, onItem }) {
  let mode = "month";
  let anchor = todayIso(); // any date inside the shown month/week
  let menu;

  function closeMenu() { menu?.remove(); menu = null; }

  function dayMenu(date, cell) {
    closeMenu();
    menu = el("div", undefined, { class: "day-menu", role: "menu" });
    menu.append(el("div", toDate(date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }), { class: "muted small" }),
      el("button", "Schedule a meeting", { type: "button", role: "menuitem", onclick: () => { closeMenu(); onDay(date, "meeting"); } }),
      el("button", "Add a task", { type: "button", role: "menuitem", onclick: () => { closeMenu(); onDay(date, "task"); } }));
    cell.append(menu);
    menu.querySelector("button").focus();
  }

  function chip(item) {
    const b = el("button", undefined, { class: `event ${item.kind}`, type: "button", title: item.title,
      onclick: e => { e.stopPropagation(); onItem(item); } });
    if (item.time) b.append(el("span", prettyTime(item.time), { class: "time" }), " ");
    b.append(item.kind === "meeting" ? item.person || item.title : item.title);
    return b;
  }

  function render() {
    closeMenu();
    const model = getModel();
    const today = todayIso();
    const d = toDate(anchor);
    const days = mode === "month" ? monthGrid(d.getFullYear(), d.getMonth()) : weekDays(anchor);
    const items = calendarItems(model, days[0], days.at(-1), today);
    const byDay = Object.groupBy ? Object.groupBy(items, i => i.date)
      : items.reduce((acc, i) => ((acc[i.date] ??= []).push(i), acc), {});

    const head = el("div", undefined, { class: "view-head" });
    const title = mode === "month"
      ? d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : `${toDate(days[0]).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${toDate(days[6]).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    const nav = el("div", undefined, { class: "nav" });
    const step = n => {
      const x = toDate(anchor);
      if (mode === "month") x.setMonth(x.getMonth() + n, 1); else x.setDate(x.getDate() + 7 * n);
      anchor = isoDate(x);
      render();
    };
    nav.append(el("button", "‹", { class: "btn small", type: "button", title: "Previous", "aria-label": "Previous", onclick: () => step(-1) }),
               el("button", "Today", { class: "btn small", type: "button", onclick: () => { anchor = todayIso(); render(); } }),
               el("button", "›", { class: "btn small", type: "button", title: "Next", "aria-label": "Next", onclick: () => step(1) }));
    const switcher = el("div", undefined, { class: "segmented", role: "group", "aria-label": "Calendar view" });
    for (const m of ["month", "week"]) {
      switcher.append(el("button", m === "month" ? "Month" : "Week", { type: "button", "aria-pressed": String(mode === m),
        onclick: () => { mode = m; render(); } }));
    }
    const legend = el("div", undefined, { class: "cal-legend small muted" });
    legend.append(el("span", "Meeting", { class: "event meeting" }), el("span", "Task", { class: "event task" }),
                  el("span", "Overdue", { class: "event overdue" }), el("span", "Done", { class: "event done" }));
    head.append(el("h2", title), nav, switcher, legend);

    const grid = el("div", undefined, { class: `cal-grid ${mode}` });
    for (const w of WEEKDAYS) grid.append(el("div", w, { class: "cal-dow" }));
    for (const day of days) {
      const cell = el("div", undefined, { class: "cal-day", tabIndex: 0, role: "button",
        "aria-label": `${toDate(day).toDateString()}: ${(byDay[day] ?? []).length} items. Press Enter to add.` });
      if (mode === "month" && toDate(day).getMonth() !== d.getMonth()) cell.classList.add("other");
      if (day === today) cell.classList.add("today");
      cell.append(el("div", String(toDate(day).getDate()), { class: "num" }));
      const list = el("div", undefined, { class: "events" });
      const dayItems = byDay[day] ?? [];
      const max = mode === "month" ? 3 : 20;
      dayItems.slice(0, max).forEach(i => list.append(chip(i)));
      if (dayItems.length > max) {
        list.append(el("button", `+${dayItems.length - max} more`, { class: "more linklike small", type: "button",
          onclick: e => { e.stopPropagation(); mode = "week"; anchor = day; render(); } }));
      }
      cell.append(list);
      cell.addEventListener("click", e => { if (!e.target.closest(".event, .day-menu, .more")) dayMenu(day, cell); });
      cell.addEventListener("keydown", e => { if (e.key === "Enter" && e.target === cell) dayMenu(day, cell); });
      grid.append(cell);
    }
    root.replaceChildren(head, grid);
  }

  document.addEventListener("click", e => { if (menu && !menu.parentElement?.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
  return { render };
}
