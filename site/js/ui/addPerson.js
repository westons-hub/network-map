// One "+ Add person" box that accepts whatever you have:
//   • a name → type-ahead over your LinkedIn pool and the people already on your map
//   • a LinkedIn profile link → matched against your imported connections (never fetched)
//   • their LinkedIn "Save to PDF" file (drop it or click Upload PDF) → full history, read on your computer
//   • no match → a blank form with the name filled in
// Every path ends in the same prefilled review card, with the fields only you know highlighted.

import { entryNames } from "../core/history.js";
import { normalizeName } from "../core/org.js";
import { STATUSES, personFromPool, poolName } from "../core/people.js";
import { isLinkedInUrl, matchLinkedInUrl, onMapIndex, searchPool } from "../core/pool.js";
import { ask, toast } from "./dialog.js";
import { el } from "./dom.js";
import { resizeImage } from "./forms.js";
import { isPdf, readProfilePdf } from "./pdf.js";

const TIP = "For full history, open their LinkedIn profile → More → Save to PDF, then drop it here.";

function field(label, input, { hint, needs } = {}) {
  const wrap = el("label", undefined, { class: `field${needs ? " needs" : ""}` });
  wrap.append(el("span", label), input);
  if (hint) wrap.append(el("span", hint, { class: "muted small" }));
  return wrap;
}

let listIds = 0;
function withList(input, values) {
  const id = `add-list-${++listIds}`;
  const list = el("datalist", undefined, { id });
  for (const v of values) list.append(el("option", undefined, { value: v }));
  input.setAttribute("list", id);
  return list;
}

/**
 * Step 1: the one box. Resolves with { draft, source, note } or { open: name } (already on the map) or null.
 * `pdf` can be passed to skip straight to reading a dropped file.
 */
async function findPerson({ model, demo, pdf }) {
  if (pdf) return fromPdf(pdf);
  const body = el("div", undefined, { class: "form add-person" });
  const input = el("input", undefined, { class: "big-input", autocomplete: "off", spellcheck: false,
    placeholder: "Type a name, paste a LinkedIn link, or drop their LinkedIn PDF", "aria-label": "Name, LinkedIn link or PDF" });
  const results = el("ul", undefined, { class: "suggestions", role: "listbox" });
  const drop = el("div", undefined, { class: "drop-zone" });
  const file = el("input", undefined, { type: "file", accept: "application/pdf,.pdf", hidden: true });
  drop.append(el("span", "Drop a LinkedIn profile PDF here, or "),
              el("button", "Upload PDF", { class: "btn small", type: "button", onclick: () => file.click() }));
  if (demo) drop.append(" ", el("button", "Try a sample PDF", { class: "btn small", type: "button", onclick: () => done({ sample: true }) }));
  body.append(input, results, drop, file, el("p", TIP, { class: "muted small tip" }));

  const isOnMap = onMapIndex(model.people);
  let choice = null;
  const dialog = document.getElementById("dialog");
  const done = value => { choice = value; dialog.close("picked"); };

  function render() {
    const q = input.value.trim();
    results.replaceChildren();
    if (!q || isLinkedInUrl(q)) {
      if (isLinkedInUrl(q)) {
        const m = matchLinkedInUrl(model.pool, q);
        results.append(el("li", m.entry ? `Press Enter: ${m.name} · ${m.entry.company || "no company"} (from your LinkedIn connections)`
          : `Press Enter: not in your imported connections. We'll fill in "${m.name}" and the link.`, { class: "hint" }));
      }
      return;
    }
    const onMap = model.people.filter(p => normalizeName(p.name).includes(normalizeName(q))).slice(0, 3);
    const fromPool = searchPool(model.pool, { q }).slice(0, 7);
    for (const p of onMap) {
      const li = el("li", undefined, { role: "option", tabIndex: -1, onclick: () => done({ open: p.name }) });
      li.append(el("strong", p.name), el("span", ` · ${[p.role, p.company].filter(Boolean).join(" @ ")}`, { class: "muted" }),
                el("span", "Already on map", { class: "badge on-map" }));
      results.append(li);
    }
    for (const e of fromPool) {
      if (isOnMap(e) && onMap.some(p => normalizeName(p.name) === normalizeName(poolName(e)))) continue;
      const li = el("li", undefined, { role: "option", tabIndex: -1, onclick: () => done({ entry: e }) });
      li.append(el("strong", poolName(e)), el("span", ` · ${[e.position, e.company].filter(Boolean).join(" @ ")}`, { class: "muted" }));
      if (isOnMap(e)) li.append(el("span", "Already on map", { class: "badge on-map" }));
      results.append(li);
    }
    const li = el("li", undefined, { role: "option", tabIndex: -1, class: "new", onclick: () => done({ name: q }) });
    li.append(el("span", `+ Add "${q}" as someone new`));
    results.append(li);
  }
  input.addEventListener("input", render);
  input.addEventListener("keydown", e => {
    const opts = [...results.querySelectorAll("li[role=option]")];
    if (e.key === "ArrowDown" && opts.length) { e.preventDefault(); opts[0].focus(); }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    if (isLinkedInUrl(q)) done({ url: q });
    else if (opts.length) opts[0].click();
  });
  results.addEventListener("keydown", e => {
    const opts = [...results.querySelectorAll("li[role=option]")];
    const i = opts.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); opts[Math.min(i + 1, opts.length - 1)]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); (i <= 0 ? input : opts[i - 1]).focus(); }
    if (e.key === "Enter") { e.preventDefault(); document.activeElement?.click(); }
  });
  for (const t of [drop, body]) {
    t.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
    t.addEventListener("dragleave", () => drop.classList.remove("over"));
    t.addEventListener("drop", e => {
      e.preventDefault();
      drop.classList.remove("over");
      const f = [...e.dataTransfer.files].find(isPdf);
      if (f) done({ pdf: f }); else toast("That isn't a PDF. On their LinkedIn profile: More → Save to PDF.");
    });
  }
  file.addEventListener("change", () => { if (file.files[0]) done({ pdf: file.files[0] }); });

  const result = await ask("Add a person", body, [{ label: "Cancel", value: "" }]);
  if (result !== "picked" || !choice) return null;
  if (choice.open) return { open: choice.open };
  if (choice.sample) {
    const res = await fetch("demo/sample_linkedin_profile.pdf");
    return fromPdf(new Uint8Array(await res.arrayBuffer()), "sample_linkedin_profile.pdf (fictional)");
  }
  if (choice.pdf) return fromPdf(choice.pdf);
  if (choice.url) {
    const m = matchLinkedInUrl(model.pool, choice.url);
    if (m.entry) {
      return { draft: { ...personFromPool(m.entry), linkedinUrl: m.url }, source: "link",
               note: `Matched ${m.name} in your LinkedIn connections (by ${m.matchedBy === "url" ? "profile link" : "name"}): name, company, title, email and connection date are filled in.` };
    }
    return { draft: { name: m.name, linkedinUrl: m.url }, source: "link",
             note: `${m.name} isn't in your imported LinkedIn connections, so only the name (from the link) and the link are filled in. ` +
                   "Add their company and title, or drop their profile PDF for the full history." };
  }
  if (choice.entry) {
    return { draft: personFromPool(choice.entry), source: "pool",
             note: "Filled in from your LinkedIn connections. Add what only you know below." };
  }
  return { draft: { name: choice.name }, source: "new", note: "Not in your LinkedIn connections. Fill in what you know." };
}

async function fromPdf(fileOrBytes, label) {
  try {
    const { person } = await readProfilePdf(fileOrBytes);
    return { draft: person, source: "pdf",
             note: `Read from ${label ?? fileOrBytes.name ?? "their LinkedIn PDF"} on your computer: current role, past companies, schools and summary.` };
  } catch (e) {
    console.error(e);
    toast(`Couldn't read that PDF: ${e.message}`, 7000);
    return null;
  }
}

/** Step 2: the review card. Resolves with person fields (+ photo) or null. */
async function reviewPerson({ model, draft, note, existing }) {
  const body = el("div", undefined, { class: "form review" });
  const val = k => draft[k] ?? "";
  const input = (name, attrs = {}) => el("input", undefined, { name, value: val(name), autocomplete: "off", ...attrs });
  const f = {
    name: input("name", { required: true }), role: input("role"), company: input("company"),
    school: input("school", { placeholder: "e.g. BYU (2022–2026); Lakeview High" }),
    pastCompanies: input("pastCompanies", { placeholder: "e.g. Deloitte (2019–2021)" }),
    email: input("email", { type: "email" }), linkedinUrl: input("linkedinUrl", { type: "url" }),
    connectedThrough: input("connectedThrough", { placeholder: "Blank = you know them directly" }),
    connectedOn: input("connectedOn", { type: "date" }),
    status: el("select", undefined, { name: "status" }),
    tags: input("tags", { placeholder: "Comma-separated" }),
    notes: el("textarea", undefined, { name: "notes", rows: 3, value: val("notes") }),
  };
  for (const s of ["", ...STATUSES]) f.status.append(el("option", s || "Choose…", { value: s, selected: s === (draft.status ?? "") }));
  const companies = [...new Set([...model.people.map(p => p.company), ...model.pool.map(e => e.company)].filter(Boolean))].sort();
  const schools = [...new Set(model.people.flatMap(p => entryNames(p.school)))].sort();
  const lists = [withList(f.company, companies), withList(f.school, schools), withList(f.pastCompanies, companies),
                 withList(f.connectedThrough, model.people.map(p => p.name).sort())];
  const photoFile = el("input", undefined, { type: "file", accept: "image/*" });
  const photoUrl = el("input", undefined, { type: "url", placeholder: "or paste an image link" });
  const photo = el("div", undefined, { class: "row2" });
  photo.append(photoFile, photoUrl);

  const needs = k => !val(k); // the fields only you know are highlighted while empty
  const two = (a, b) => { const r = el("div", undefined, { class: "row2" }); r.append(a, b); return r; };
  body.append(...lists, el("p", note, { class: `source-note ${draft.company || draft.role ? "ok" : ""}` }));
  if (existing) body.append(el("p", `${existing.name} is already on your map. Saving updates their row.`, { class: "warn" }));
  body.append(
    field("Name", f.name), two(field("Role", f.role), field("Company", f.company)),
    two(field("Email", f.email), field("LinkedIn", f.linkedinUrl)),
    el("div", "What only you know", { class: "form-section" }),
    two(field("Connected through", f.connectedThrough, { needs: true, hint: "Who introduced you? Blank = direct." }),
        field("Status", f.status, { needs: needs("status") })),
    field("Schools", f.school, { needs: needs("school") }), field("Past companies", f.pastCompanies),
    two(field("Connected on", f.connectedOn), field("Tags", f.tags)),
    field("Notes", f.notes, { needs: needs("notes") }),
    field("Photo (optional)", photo, { needs: true, hint: "LinkedIn doesn't share photos; upload one or paste a link." }),
  );
  // Highlights fade once you fill a field in.
  body.addEventListener("input", e => e.target.closest(".field.needs")?.classList.toggle("filled", !!e.target.value));

  const choice = await ask(existing ? `Update ${existing.name}` : "Review and add", body,
    [{ label: "Cancel", value: "" }, { label: existing ? "Save" : "Add to map", value: "save", primary: true }]);
  if (choice !== "save" || !f.name.value.trim()) return null;
  const out = {};
  for (const [k, input] of Object.entries(f)) out[k] = input.value.trim();
  if (photoFile.files[0]) out.photo = await resizeImage(photoFile.files[0]);
  else if (/^https?:\/\//i.test(photoUrl.value.trim())) out.photo = photoUrl.value.trim();
  else if (draft.photo) out.photo = draft.photo;
  if (draft.source) out.source = draft.source;
  return out;
}

/**
 * The whole flow. Resolves with { person, existingKey } to save, { open: name } to open someone
 * already on the map, or null.
 */
export async function addPersonFlow({ model, demo, pdf, entry }) {
  const found = entry ? { draft: personFromPool(entry), source: "pool", note: "Filled in from your LinkedIn connections." }
    : await findPerson({ model, demo, pdf });
  if (!found) return null;
  if (found.open) return found;
  const existing = model.people.find(p => normalizeName(p.name) === normalizeName(found.draft.name));
  const person = await reviewPerson({ model, draft: { ...(existing ?? {}), ...found.draft,
    notes: existing?.notes || found.draft.notes || "" }, note: found.note, existing });
  return person ? { person, existingKey: existing ? normalizeName(existing.name) : undefined } : null;
}

/** Add several pool entries at once (no review): "Add selected" / "Add everyone at X". */
export function peopleFromPool(model, entries) {
  const isOnMap = onMapIndex(model.people);
  return entries.filter(e => !isOnMap(e)).map(personFromPool);
}
