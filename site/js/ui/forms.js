// Forms shown in the dialog: add/edit a target, and add a photo.

import { normalizeOrg } from "../core/org.js";
import { PRIORITIES, STAGES } from "../core/workbook.js";
import { ask } from "./dialog.js";
import { el } from "./dom.js";

function field(label, input, hint) {
  const wrap = el("label", undefined, { class: "field" });
  wrap.append(el("span", label), input);
  if (hint) wrap.append(el("span", hint, { class: "muted small" }));
  return wrap;
}

function select(name, options, value) {
  const s = el("select", undefined, { name });
  for (const [v, label] of options) s.append(el("option", label, { value: v, selected: v === value }));
  return s;
}

/**
 * Companies worth suggesting as targets: from your people, your LinkedIn pool and your groups,
 * most common spelling first, minus ones that are already targets.
 */
export function companySuggestions(model, graph) {
  const counts = new Map(); // normalized -> Map(spelling -> count)
  const NOT_COMPANIES = /^(independent|self[- ]employed|freelance|freelancer|student|unemployed|retired|none|n\/a)$/i;
  const add = name => {
    if (!name || NOT_COMPANIES.test(name.trim())) return;
    const key = normalizeOrg(name);
    if (!key) return;
    const m = counts.get(key) ?? new Map();
    m.set(name, (m.get(name) ?? 0) + 1);
    counts.set(key, m);
  };
  model.people.forEach(p => add(p.company));
  model.pool.forEach(e => add(e.company));
  graph.nodes.filter(n => n.kind === "company").forEach(n => add(n.label));
  const taken = new Set(model.targets.map(t => normalizeOrg(t.company)));
  return [...counts].filter(([k]) => !taken.has(k))
    .map(([, m]) => { const total = [...m.values()].reduce((a, b) => a + b, 0); return [[...m].sort((a, b) => b[1] - a[1])[0][0], total]; })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/**
 * Add or edit a target. Resolves with { action: "save", target } | { action: "remove" } | null.
 */
export async function targetForm({ target, suggestions, company = "" }) {
  const editing = !!target;
  const body = el("div", undefined, { class: "form" });
  const list = el("datalist", undefined, { id: "company-suggestions" });
  for (const s of suggestions) list.append(el("option", undefined, { value: s }));
  const name = el("input", undefined, { name: "company", required: true, autocomplete: "off",
    value: target?.company ?? company, placeholder: "e.g. Delta Air Lines", maxLength: 120 });
  name.setAttribute("list", "company-suggestions");
  const priority = select("priority", [["", "—"], ...PRIORITIES.map(p => [p, `P${p}`])], target?.priority ?? "");
  const stage = select("stage", [["", "—"], ...STAGES.map(s => [s, s])], target?.stage ?? (editing ? "" : "Researching"));
  const notes = el("textarea", undefined, { name: "notes", rows: 3, value: target?.notes ?? "", maxLength: 2000 });
  const row = el("div", undefined, { class: "row2" });
  row.append(field("Priority", priority), field("Stage", stage));
  body.append(list, field("Company", name, "Pick from your people and LinkedIn pool, or type any company."), row,
              field("Notes", notes));

  const buttons = [{ label: "Cancel", value: "" }, { label: editing ? "Save" : "Add target", value: "save", primary: true }];
  if (editing) buttons.unshift({ label: "Remove target", value: "remove", danger: true, left: true });
  const choice = await ask(editing ? `Edit target: ${target.company}` : "Add a target company", body, buttons);
  if (choice === "remove") return { action: "remove" };
  if (choice !== "save" || !name.value.trim()) return null;
  return { action: "save", target: { company: name.value.trim(), priority: priority.value, stage: stage.value,
                                     notes: notes.value.trim() } };
}

/** Center-crop an image file to a small square JPEG data URI (fits in an Excel cell). */
export async function resizeImage(file, size = 96) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/**
 * Pick a photo file or paste an image URL. Resolves with { photo } ("" = remove) or null if cancelled.
 */
export async function photoForm({ name, current }) {
  const body = el("div", undefined, { class: "form" });
  const file = el("input", undefined, { type: "file", accept: "image/*", name: "file" });
  const url = el("input", undefined, { type: "url", name: "url", placeholder: "https://…/photo.jpg",
                                       value: /^https?:/i.test(current ?? "") ? current : "" });
  body.append(field("Choose an image", file, "It's shrunk to 96×96 in your browser and saved in your workbook."),
              el("div", "or", { class: "muted small center" }), field("Paste an image link", url));
  body.append(el("p", "LinkedIn exports don't include photos, and Network Map never downloads them from LinkedIn.",
                 { class: "muted small" }));
  const buttons = [{ label: "Cancel", value: "" }, { label: "Save photo", value: "save", primary: true }];
  if (current) buttons.unshift({ label: "Remove photo", value: "remove", danger: true, left: true });
  const choice = await ask(`Photo for ${name}`, body, buttons);
  if (choice === "remove") return { photo: "" };
  if (choice !== "save") return null;
  if (file.files[0]) return { photo: await resizeImage(file.files[0]) };
  if (/^https?:\/\//i.test(url.value.trim())) return { photo: url.value.trim() };
  return null;
}
