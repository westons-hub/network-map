// Click-to-edit fields. The value shows as text; click (or Enter) to edit, Enter/blur saves,
// Esc cancels. Multi-line fields save on blur or Cmd/Ctrl+Enter.

import { el } from "./dom.js";

let listCounter = 0;

/**
 * opts: { value, placeholder, multiline, type ("text"|"date"|"email"|"url"), suggestions: [..],
 *         display: value -> string|Node, onSave: newValue -> void, label }
 */
export function inlineField(opts) {
  const { value = "", placeholder = "Add…", multiline = false, type = "text", suggestions, display, onSave, label } = opts;
  const wrap = el("span", undefined, { class: `inline${multiline ? " multiline" : ""}` });

  function show() {
    const shown = display ? display(value) : value;
    const view = el("span", undefined, { class: `inline-view${value ? "" : " empty"}`, tabIndex: 0, role: "button",
      title: `Click to edit${label ? ` ${label}` : ""}`, "aria-label": `${label ?? "Field"}: ${value || "empty"}. Click to edit.` });
    if (shown instanceof Node) view.append(shown); else view.textContent = shown || placeholder;
    view.addEventListener("click", e => { if (!e.target.closest("a, button")) edit(); });
    view.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); edit(); } });
    wrap.replaceChildren(view);
  }

  function edit() {
    const input = multiline ? el("textarea", undefined, { rows: Math.min(8, Math.max(3, value.split("\n").length + 1)) })
      : el("input", undefined, { type, autocomplete: "off" });
    input.value = value;
    input.className = "inline-input";
    if (label) input.setAttribute("aria-label", label);
    if (suggestions?.length) {
      const id = `inline-list-${++listCounter}`;
      const list = el("datalist", undefined, { id });
      for (const s of suggestions) list.append(el("option", undefined, { value: s }));
      input.setAttribute("list", id);
      wrap.replaceChildren(input, list);
    } else wrap.replaceChildren(input);
    input.focus();
    if (!multiline && type === "text") input.select();

    let done = false;
    const finish = save => {
      if (done) return;
      done = true;
      const next = multiline ? input.value.trim() : input.value.trim();
      if (save && next !== value) onSave(next);
      else show();
    };
    input.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); finish(true); }
    });
    input.addEventListener("blur", () => finish(true));
  }

  show();
  return wrap;
}
