// To-Do view: tasks grouped Overdue / Today / This Week / Later / Done, checked off in place.

import { normalizeName } from "../core/org.js";
import { groupTasks, newId, todayIso, toDate } from "../core/schedule.js";
import { el } from "./dom.js";
import { brandFooter } from "./theme.js";
import { attachTypeahead } from "./typeahead.js";

const GROUPS = [["overdue", "Overdue"], ["today", "Today"], ["week", "This week"], ["later", "Later"], ["done", "Done"]];
const prettyDate = d => (d ? toDate(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "No due date");

export function createTodo(root, { getModel, onAdd, onToggle, onEdit, onPerson }) {
  let showDone = false;

  function render() {
    const model = getModel();
    const today = todayIso();
    const groups = groupTasks(model.tasks, today);

    const head = el("div", undefined, { class: "view-head" });
    head.append(el("h2", "To-Do"));
    // Quick add: task, person, due date.
    const form = el("form", undefined, { class: "quick-add" });
    const text = el("input", undefined, { placeholder: "Add a task…", "aria-label": "New task", required: true });
    const who = el("input", undefined, { placeholder: "Person (optional)", "aria-label": "Person", autocomplete: "off" });
    attachTypeahead(who, "person");
    const due = el("input", undefined, { type: "date", value: today, "aria-label": "Due date" });
    form.append(text, who, due, el("button", "Add", { class: "btn primary small", type: "submit" }));
    form.addEventListener("submit", e => {
      e.preventDefault();
      if (!text.value.trim()) return;
      const person = model.people.find(p => normalizeName(p.name) === normalizeName(who.value));
      onAdd({ id: newId("t"), task: text.value.trim(), person: person?.name ?? who.value.trim(), company: person?.company ?? "",
              due: due.value, done: false, created: today, source: "" });
    });
    head.append(form);

    const body = el("div", undefined, { class: "todo-groups" });
    for (const [key, label] of GROUPS) {
      const tasks = groups[key];
      if (key === "done" && !tasks.length) continue;
      const section = el("section", undefined, { class: `todo-group ${key}` });
      const h = el("h3", undefined);
      h.append(label, el("span", String(tasks.length), { class: "count" }));
      if (key === "done") {
        h.append(el("button", showDone ? "Hide" : "Show", { class: "linklike small", type: "button",
                                                             onclick: () => { showDone = !showDone; render(); } }));
      }
      section.append(h);
      if (!tasks.length) section.append(el("p", key === "overdue" ? "Nothing overdue. 🎉" : "Nothing here.", { class: "muted small empty" }));
      if (key !== "done" || showDone) {
        const ul = el("ul", undefined, { class: "todo-list" });
        for (const t of tasks) {
          const li = el("li", undefined, { class: t.done ? "done" : "" });
          const box = el("input", undefined, { type: "checkbox", checked: t.done, "aria-label": `Done: ${t.task}`,
                                                onchange: () => onToggle(t) });
          const main = el("button", t.task, { class: "task-text", type: "button", title: "Edit task", onclick: () => onEdit(t) });
          const meta = el("span", undefined, { class: "task-meta" });
          if (t.person) meta.append(el("button", t.person, { class: "person-link", type: "button", onclick: () => onPerson(t.person) }));
          if (t.company) meta.append(el("span", t.company, { class: "badge" }));
          meta.append(el("span", prettyDate(t.due), { class: `due${!t.done && t.due && t.due < today ? " late" : ""}` }));
          li.append(box, main, meta);
          ul.append(li);
        }
        section.append(ul);
      }
      body.append(section);
    }
    root.replaceChildren(head, body, brandFooter());
  }

  return { render };
}
