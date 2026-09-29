// One type-ahead dropdown for every field that repeats values (company, schools, role, tags, people…).
// ↑/↓ to move, Enter or Tab to pick, Esc to close; typing something new is always allowed ("Add 'X'").
// Multi-entry fields (Schools, Past Companies, Tags) complete the entry you're typing and keep its years:
// "Deloitte (2021–2023)".

import { matchSuggestions } from "../core/suggest.js";
import { el } from "./dom.js";

let source = { suggestions: () => ({}), logo: () => "" };

/** Tell the type-ahead where suggestions come from (called once by main.js). */
export function setSuggestionSource(s) { source = s; }

const SEPARATORS = { school: ";", company: ";", tag: "," };

/**
 * attach(input, kind, { multi }) — kind: company | school | role | tag | person | status | meetingType | method |
 * relationshipPlan | connectionType. multi: the field holds several entries (separated by ";" or "," for tags).
 */
export function attachTypeahead(input, kind, { multi = false } = {}) {
  input.removeAttribute("list"); // replace the browser's plain suggestions
  input.setAttribute("autocomplete", "off");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  const sep = SEPARATORS[kind] ?? ";";
  let menu = null, items = [], active = -1;

  // The part being typed, and (for multi fields) the years to keep: "Deloitte (2021–2023)".
  const current = () => {
    const v = input.value;
    const start = multi ? v.lastIndexOf(sep) + 1 : 0;
    const segment = v.slice(start);
    const years = segment.match(/\s*\([^()]*\)\s*$/)?.[0] ?? "";
    return { start, query: segment.replace(/\s*\([^()]*\)\s*$/, "").trim(), years };
  };

  function close() { menu?.remove(); menu = null; active = -1; input.setAttribute("aria-expanded", "false"); }

  function pick(value) {
    const { start, years } = current();
    const before = input.value.slice(0, start);
    input.value = multi ? `${before}${before ? " " : ""}${value}${years}` : value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  }

  function render() {
    const { query } = current();
    const all = source.suggestions()[kind] ?? [];
    items = matchSuggestions(all, query, { kind });
    const exact = items.some(i => i.value.toLowerCase() === query.toLowerCase());
    if (!items.length && !query) { close(); return; }
    if (!menu) {
      menu = el("ul", undefined, { class: "typeahead", role: "listbox" });
      (input.closest("dialog") ?? document.body).append(menu);
      input.setAttribute("aria-expanded", "true");
    }
    menu.replaceChildren();
    items.forEach((it, i) => {
      const li = el("li", undefined, { role: "option", class: i === active ? "active" : "" });
      const logo = (kind === "company" || kind === "school") && source.logo(it.value, kind);
      if (logo) li.append(el("img", undefined, { src: logo, alt: "" }));
      li.append(el("span", it.value, { class: "value" }));
      const meta = kind === "person" ? it.detail
        : [it.count ? `${it.count} ${it.count === 1 ? "person" : "people"}` : "", it.pool ? `${it.pool} in pool` : ""].filter(Boolean).join(" · ");
      if (meta) li.append(el("span", meta, { class: "meta" }));
      li.addEventListener("mousedown", e => { e.preventDefault(); pick(it.value); }); // before the input blurs
      menu.append(li);
    });
    if (query && !exact) {
      const li = el("li", undefined, { role: "option", class: `add${active === items.length ? " active" : ""}` });
      li.append(el("span", `Add “${query}”`));
      li.addEventListener("mousedown", e => { e.preventDefault(); close(); });
      menu.append(li);
    }
    place();
  }

  function place() {
    if (!menu) return;
    const r = input.getBoundingClientRect();
    const below = window.innerHeight - r.bottom > 220 || r.top < 240;
    Object.assign(menu.style, { left: `${r.left}px`, width: `${Math.max(r.width, 220)}px`,
      top: below ? `${r.bottom + 4}px` : "", bottom: below ? "" : `${window.innerHeight - r.top + 4}px` });
  }

  input.addEventListener("input", () => { active = -1; render(); });
  input.addEventListener("focus", () => render());
  input.addEventListener("blur", () => setTimeout(close, 0));
  // Capture phase: runs before the field's own Enter/Esc handling (inline edits, dialogs).
  input.addEventListener("keydown", e => {
    if (!menu) { if (e.key === "ArrowDown") { render(); e.preventDefault(); } return; }
    const count = menu.children.length;
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % count; render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + count) % count; render(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if ((e.key === "Enter" || e.key === "Tab") && active >= 0 && active < items.length) {
      if (e.key === "Enter") e.preventDefault();
      pick(items[active].value); // the field's own Enter handling (e.g. saving an inline edit) runs next
    } else if (e.key === "Tab" && active < 0 && items.length && current().query) {
      pick(items[0].value);
    } else if (e.key === "Enter") close();
  }, true);
  window.addEventListener("resize", place);
  document.addEventListener("scroll", place, true);
  return { close };
}
