// Calendar view: a month grid, and a week view with a time axis. Shows meetings, task due dates
// and (muted) events from a connected Google/Outlook calendar. Click a day or an empty time slot to
// add something there; click an item to open it; drag a meeting in the week view to move it.

import { addMinutes, calendarItems, isoDate, monthGrid, todayIso, toDate, weekDays } from "../core/schedule.js";
import { el } from "./dom.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR = 48;          // px per hour in the week view
const SNAP = 15;          // minutes: dragging snaps to this
const prettyTime = t => (t ? toDate("2000-01-01", t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");
const minutesOf = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const hhmm = min => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Side-by-side lanes for overlapping timed items in one day. */
function lanes(items) {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out = [];
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const ends = [];
    for (const it of cluster) {
      let lane = ends.findIndex(end => end <= it.startMin);
      if (lane < 0) { lane = ends.length; ends.push(0); }
      ends[lane] = it.endMin;
      it.lane = lane;
    }
    for (const it of cluster) it.lanes = ends.length;
    out.push(...cluster);
  };
  for (const it of sorted) {
    if (cluster.length && it.startMin >= clusterEnd) { flush(); cluster = []; clusterEnd = -1; }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  if (cluster.length) flush();
  return out;
}

export function createCalendar(root, { getModel, getExternal = () => [], onDay, onSlot, onItem, onMove }) {
  let mode = "month";
  let anchor = todayIso(); // any date inside the shown month/week
  let menu;
  let weekScroll = null;   // keep the week's scroll position across re-renders

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
    if (item.kind === "external") {
      const s = el("span", undefined, { class: "event external", title: `${item.title} (from your calendar)` });
      if (item.time) s.append(el("span", prettyTime(item.time), { class: "time" }), " ");
      s.append(item.title);
      return s;
    }
    const b = el("button", undefined, { class: `event ${item.kind}`, type: "button", title: item.title,
      onclick: e => { e.stopPropagation(); onItem(item); } });
    if (item.time) b.append(el("span", prettyTime(item.time), { class: "time" }), " ");
    b.append(item.kind === "meeting" ? item.person || item.title : item.title);
    return b;
  }

  function header(d, days) {
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
        onclick: () => { if (mode !== m) { mode = m; weekScroll = null; render(); } } }));
    }
    const legend = el("div", undefined, { class: "cal-legend small muted" });
    legend.append(el("span", "Meeting", { class: "event meeting" }), el("span", "Task", { class: "event task" }),
                  el("span", "Overdue", { class: "event overdue" }), el("span", "Done", { class: "event done" }));
    if (getExternal(days[0], days.at(-1)).length) legend.append(el("span", "Your calendar", { class: "event external" }));
    head.append(el("h2", title), nav, switcher, legend);
    return head;
  }

  function allItems(from, to, today) {
    const model = getModel();
    const external = getExternal(from, to).map(x => ({ kind: "external", date: x.date, time: x.start, end: x.end, title: x.title }));
    return [...calendarItems(model, from, to, today), ...external];
  }

  // ---- month -----------------------------------------------------------------------------

  function renderMonth(d, today) {
    const days = monthGrid(d.getFullYear(), d.getMonth());
    const items = allItems(days[0], days.at(-1), today);
    const byDay = items.reduce((acc, i) => ((acc[i.date] ??= []).push(i), acc), {});
    const grid = el("div", undefined, { class: "cal-grid month" });
    for (const w of WEEKDAYS) grid.append(el("div", w, { class: "cal-dow" }));
    for (const day of days) {
      const cell = el("div", undefined, { class: "cal-day", tabIndex: 0, role: "button",
        "aria-label": `${toDate(day).toDateString()}: ${(byDay[day] ?? []).length} items. Press Enter to add.` });
      if (toDate(day).getMonth() !== d.getMonth()) cell.classList.add("other");
      if (day === today) cell.classList.add("today");
      cell.append(el("div", String(toDate(day).getDate()), { class: "num" }));
      const list = el("div", undefined, { class: "events" });
      const dayItems = (byDay[day] ?? []).sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
      dayItems.slice(0, 3).forEach(i => list.append(chip(i)));
      if (dayItems.length > 3) {
        list.append(el("button", `+${dayItems.length - 3} more`, { class: "more linklike small", type: "button",
          onclick: e => { e.stopPropagation(); mode = "week"; anchor = day; weekScroll = null; render(); } }));
      }
      cell.append(list);
      cell.addEventListener("click", e => { if (!e.target.closest(".event, .day-menu, .more")) dayMenu(day, cell); });
      cell.addEventListener("keydown", e => { if (e.key === "Enter" && e.target === cell) dayMenu(day, cell); });
      grid.append(cell);
    }
    return { days, body: grid };
  }

  // ---- week (time axis) -------------------------------------------------------------------

  function renderWeek(today) {
    const days = weekDays(anchor);
    const model = getModel();
    const items = allItems(days[0], days[6], today);
    const wrap = el("div", undefined, { class: "week" });

    // Day headers + the "All day / Due" row (tasks, and anything without a time).
    const heads = el("div", undefined, { class: "week-row week-heads" });
    const allDay = el("div", undefined, { class: "week-row week-allday" });
    heads.append(el("div", "", { class: "gutter" }));
    allDay.append(el("div", "All day / Due", { class: "gutter small muted" }));
    for (const day of days) {
      const d = toDate(day);
      const h = el("div", undefined, { class: `week-head${day === today ? " today" : ""}` });
      h.append(el("span", WEEKDAYS[(d.getDay() + 6) % 7], { class: "dow" }), el("span", String(d.getDate()), { class: "num" }));
      heads.append(h);
      const cell = el("div", undefined, { class: "allday-cell" });
      items.filter(i => i.date === day && (i.kind !== "meeting" && i.kind !== "external" || !i.time)).forEach(i => cell.append(chip(i)));
      allDay.append(cell);
    }

    // Scrollable hours.
    const scroller = el("div", undefined, { class: "week-scroll" });
    const grid = el("div", undefined, { class: "week-grid", style: `height:${24 * HOUR}px` });
    const gutter = el("div", undefined, { class: "gutter hours" });
    for (let h = 0; h < 24; h++) {
      gutter.append(el("div", h === 0 ? "" : toDate("2000-01-01", `${h}:00`).toLocaleTimeString("en-US", { hour: "numeric" }),
                       { class: "hour-label", style: `top:${h * HOUR}px` }));
    }
    grid.append(gutter);
    const columns = [];
    for (const day of days) {
      const col = el("div", undefined, { class: `day-col${day === today ? " today" : ""}`, "aria-label": toDate(day).toDateString() });
      col.dataset.date = day;
      for (let h = 0; h < 24; h++) col.append(el("div", undefined, { class: "hour-line", style: `top:${h * HOUR}px` }));
      // Timed items: meetings (draggable) and connected-calendar events (muted).
      const timed = items.filter(i => i.date === day && (i.kind === "meeting" || i.kind === "external") && i.time).map(i => {
        const m = i.kind === "meeting" ? model.meetings.find(x => x.id === i.id) : null;
        const startMin = minutesOf(i.time);
        const endMin = Math.max(startMin + 15, minutesOf(m?.end || i.end || addMinutes(i.time, 30)));
        return { ...i, meeting: m, startMin, endMin };
      });
      for (const it of lanes(timed)) {
        const short = it.endMin - it.startMin < 45; // one line: time + name
        const block = el(it.kind === "meeting" ? "button" : "div", undefined, {
          class: `block ${it.kind === "meeting" ? (it.past ? "meeting past" : "meeting") : "external"}${short ? " short" : ""}`,
          type: it.kind === "meeting" ? "button" : undefined,
          title: `${prettyTime(it.time)} ${it.title}`,
          style: `top:${(it.startMin * HOUR) / 60}px;height:${Math.max(18, ((it.endMin - it.startMin) * HOUR) / 60 - 2)}px;` +
                 `left:calc(${(100 / it.lanes) * it.lane}% + 2px);width:calc(${100 / it.lanes}% - 4px)` });
        block.append(el("span", `${prettyTime(it.time)}`, { class: "time" }),
                     el("span", it.kind === "meeting" ? ` ${it.person}` : ` ${it.title}`, { class: "who" }));
        if (it.kind === "meeting" && it.meeting) {
          block.append(el("span", `${it.meeting.type || ""}${it.meeting.method ? ` · ${it.meeting.method}` : ""}`, { class: "what" }));
          enableDrag(block, it, columns);
        }
        col.append(block);
      }
      if (day === today) {
        const now = new Date();
        col.append(el("div", undefined, { class: "now-line", style: `top:${((now.getHours() * 60 + now.getMinutes()) * HOUR) / 60}px` }));
      }
      // Click an empty slot → schedule a meeting then (rounded to the half hour).
      col.addEventListener("click", e => {
        if (e.target.closest(".block")) return;
        const y = e.clientY - col.getBoundingClientRect().top;
        const min = Math.min(23 * 60 + 30, Math.max(0, Math.round(((y / HOUR) * 60) / 30) * 30));
        onSlot(day, hhmm(min));
      });
      columns.push(col);
      grid.append(col);
    }
    scroller.append(grid);
    wrap.append(heads, allDay, scroller);
    // Start at 8 AM the first time; afterwards keep where you were.
    requestAnimationFrame(() => {
      scroller.scrollTop = weekScroll ?? 8 * HOUR;
      scroller.addEventListener("scroll", () => { weekScroll = scroller.scrollTop; });
    });
    return { days, body: wrap };
  }

  /** Drag a meeting to another time or day (snaps to 15 minutes). A click without moving opens it. */
  function enableDrag(block, it, columns) {
    block.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startY = e.clientY, startX = e.clientX;
      const duration = it.endMin - it.startMin;
      let moved = false, target = { date: it.date, min: it.startMin };
      // Listen on the window: moving the block into another day's column would drop pointer capture.
      const move = ev => {
        const dy = ev.clientY - startY, dx = ev.clientX - startX;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        block.classList.add("dragging");
        const col = columns.find(c => { const r = c.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX < r.right; })
          ?? columns.find(c => c.dataset.date === it.date);
        const min = Math.max(0, Math.min(24 * 60 - duration,
          Math.round((it.startMin + (dy / HOUR) * 60) / SNAP) * SNAP));
        target = { date: col.dataset.date, min };
        if (block.parentElement !== col) col.append(block);
        block.style.top = `${(min * HOUR) / 60}px`;
        block.style.left = "2px";
        block.style.width = "calc(100% - 4px)";
        block.querySelector(".time").textContent = prettyTime(hhmm(min));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        block.classList.remove("dragging");
        if (!moved) { onItem(it); return; }
        if (target.date !== it.date || target.min !== it.startMin) onMove(it.id, target.date, hhmm(target.min), hhmm(target.min + duration));
        else render();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
  }

  function render() {
    closeMenu();
    const today = todayIso();
    const d = toDate(anchor);
    const { days, body } = mode === "month" ? renderMonth(d, today) : renderWeek(today);
    root.classList.toggle("week-mode", mode === "week");
    root.replaceChildren(header(d, days), body);
  }

  document.addEventListener("click", e => { if (menu && !menu.parentElement?.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
  /** The dates on screen (the month, or the week) for "Export this view". */
  function visibleRange() {
    const d = toDate(anchor);
    if (mode === "week") { const days = weekDays(anchor); return { from: days[0], to: days.at(-1), label: "this week" }; }
    const from = isoDate(new Date(d.getFullYear(), d.getMonth(), 1)), to = isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    return { from, to, label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
  }

  return { render, visibleRange, showWeek(date) { mode = "week"; anchor = date; weekScroll = null; render(); } };
}
