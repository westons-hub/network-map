// Chip inputs for fields that hold several values: Schools, Past Companies, Tags, Skills, Languages,
// Certifications. Type and press Enter or comma (or pick a suggestion) to add a chip; × or Backspace removes one;
// click a chip to edit it. The value is stored the same way as before ("A; B" or "a, b" for tags).

import { el } from "./dom.js";
import { attachTypeahead } from "./typeahead.js";

export const CHIP_FIELDS = {
  school: { kind: "school", sep: "; " }, pastCompanies: { kind: "company", sep: "; " }, tags: { kind: "tag", sep: ", " },
  skills: { kind: "skill", sep: "; " }, languages: { kind: "language", sep: "; " }, certifications: { kind: "certification", sep: "; " },
};

export const splitChips = (value, sep) => (Array.isArray(value) ? value : String(value ?? "").split(sep.trim() === "," ? /[,;\n]/ : /[;\n]/))
  .map(v => v.trim()).filter(Boolean);

/**
 * chipInput({ value, field, placeholder, onEnterEmpty, label }) -> { element, input, value(), focus() }.
 * onEnterEmpty: Enter with nothing typed (inline editing uses it to save).
 */
export function chipInput({ value = "", field, placeholder = "Add…", onEnterEmpty, label }) {
  const { kind, sep } = CHIP_FIELDS[field];
  const chips = splitChips(value, sep);
  const box = el("div", undefined, { class: "chips-input field-chips" });
  const input = el("input", undefined, { type: "text", placeholder, "aria-label": label ?? field, autocomplete: "off" });
  attachTypeahead(input, kind);
  let justAdded = false;

  const render = () => {
    box.querySelectorAll(".chip-guest").forEach(c => c.remove());
    chips.forEach((c, i) => {
      const chip = el("span", undefined, { class: "chip-guest", title: "Click to edit" });
      chip.append(el("span", c, { onclick: () => { chips.splice(i, 1); render(); input.value = c; input.focus(); } }),
        el("button", "×", { type: "button", "aria-label": `Remove ${c}`, onclick: () => { chips.splice(i, 1); render(); input.focus(); } }));
      input.before(chip);
    });
    input.placeholder = chips.length ? "" : placeholder;
  };
  const add = text => {
    const parts = splitChips(text, sep);
    for (const p of parts) if (!chips.some(c => c.toLowerCase() === p.toLowerCase())) chips.push(p);
    // A suggestion picked with Enter adds its chip in the same keypress; that Enter shouldn't also save.
    if (parts.length) { render(); justAdded = true; setTimeout(() => { justAdded = false; }, 0); }
    input.value = "";
  };
  input.addEventListener("change", () => { if (input.value.trim()) add(input.value); }); // a picked suggestion, or leaving the field
  input.addEventListener("keydown", e => {
    const was = justAdded;
    justAdded = false;
    if ((e.key === "Enter" || e.key === ",") && input.value.trim()) { e.preventDefault(); add(input.value); }
    else if (e.key === "Enter" && !was) { e.preventDefault(); onEnterEmpty?.(); }
    else if (e.key === "Enter") e.preventDefault();
    else if (e.key === "Backspace" && !input.value && chips.length) { chips.pop(); render(); }
  });
  box.addEventListener("click", e => { if (e.target === box) input.focus(); });
  // Clicking a chip or its × keeps the focus in the box (so an inline edit doesn't save and close mid-edit).
  box.addEventListener("mousedown", e => { if (e.target !== input) e.preventDefault(); });
  box.append(input);
  render();
  return {
    element: box, input,
    value: () => { if (input.value.trim()) add(input.value); return chips.join(sep); },
    set: v => { chips.splice(0, chips.length, ...splitChips(v, sep)); render(); },
    focus: () => input.focus(),
  };
}

/** Read-only chips for the details view. */
export function chipList(value, field) {
  const { sep } = CHIP_FIELDS[field];
  const wrap = el("span", undefined, { class: "chip-list" });
  for (const c of splitChips(value, sep)) wrap.append(el("span", c, { class: "chip-static" }));
  return wrap;
}

/** A chip input that works where a form expects an <input>: `.value` reads the joined string; `.element` goes in the form. */
export function chipField(field, value, opts = {}) {
  const c = chipInput({ value, field, ...opts });
  return { element: c.element, get value() { return c.value(); }, set value(v) { c.set(v); }, input: c.input };
}
