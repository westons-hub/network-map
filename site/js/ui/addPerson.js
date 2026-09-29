// One "+ Add person" box that accepts whatever you have:
//   • a name → type-ahead over your LinkedIn pool and the people already on your map
//   • a LinkedIn profile link → matched against your imported connections (never fetched)
//   • their LinkedIn "Save to PDF" file (drop it or click Upload PDF) → full history, read on your computer
//   • no match → a blank form with the name filled in
// Every path ends in the same prefilled review card, with the fields only you know highlighted.

import { CONNECTION_TYPES, INTRODUCED } from "../core/connections.js";
import { entryNames, rowKey } from "../core/history.js";
import { normalizeName } from "../core/org.js";
import { profileToPerson } from "../core/linkedinPdf.js";
import { PDF_FIELDS, STATUSES, fillPerson, personFromPool, poolName } from "../core/people.js";
import { isLinkedInUrl, matchLinkedInUrl, onMapIndex, searchPool } from "../core/pool.js";
import { ask, toast } from "./dialog.js";
import { el } from "./dom.js";
import { resizeImage } from "./forms.js";
import { attachTypeahead } from "./typeahead.js";
import { chipField } from "./chips.js";
import { isPdf, readProfilePdf } from "./pdf.js";

const TIP = "For full history, open their LinkedIn profile → More → Save to PDF, then drop it here.";

function field(label, input, { hint, needs } = {}) {
  input = input.element ?? input; // chip fields
  // A group of inputs (connections, history rows) sits in a div: a <label> would send clicks to its first input.
  const wrap = el(input.tagName === "DIV" ? "div" : "label", undefined, { class: `field${needs ? " needs" : ""}` });
  wrap.append(el("span", label), input);
  if (hint) wrap.append(el("span", hint, { class: "muted small" }));
  return wrap;
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
    const pdf = await readProfilePdf(fileOrBytes);
    return { draft: pdf.person, source: "pdf", pdf,
             note: `Read from ${label ?? fileOrBytes.name ?? "their LinkedIn PDF"} on your computer: ${pdf.experience.length} ` +
                   `${pdf.experience.length === 1 ? "role" : "roles"}, ${pdf.education.length} ${pdf.education.length === 1 ? "school" : "schools"}` +
                   `${pdf.person.skills ? ", skills" : ""}${pdf.person.about ? ", About" : ""}. Check anything highlighted.` };
  } catch (e) {
    console.error(e);
    toast(`Couldn't read that PDF: ${e.message}`, 7000);
    return null;
  }
}

/** Editable rows for the Experience / Education parsed from a PDF. Each row has a checkbox to leave it out. */
function historyRows(rows, columns, { onFile = () => false, newTag = "" } = {}) {
  const box = el("div", undefined, { class: "history-rows" });
  for (const r of rows) {
    const have = onFile(r);
    const row = el("div", undefined, { class: `history-row${have ? " have" : ""}`, title: have ? "Already on file" : "" });
    const keep = el("input", undefined, { type: "checkbox", checked: true, "aria-label": "Include this row", title: "Include" });
    const inputs = columns.map(([f, label, width]) => el("input", undefined, { value: r[f] ?? "", placeholder: label,
      "aria-label": label, title: label, style: `flex:${width}` }));
    row.append(keep, ...inputs, el("span", have ? "on file" : newTag, { class: "row-tag" }));
    keep.addEventListener("change", () => row.classList.toggle("off", !keep.checked));
    row.read = () => (keep.checked ? { ...r, ...Object.fromEntries(columns.map(([f], i) => [f, inputs[i].value.trim()])) } : null);
    box.append(row);
  }
  box.read = () => [...box.children].map(r => r.read()).filter(Boolean);
  return box;
}

const EXPERIENCE_FIELDS = [["company", "Company", 3], ["title", "Title", 4], ["start", "Start", 1.6], ["end", "End", 1.6], ["location", "Location", 2.6]];
const EDUCATION_FIELDS = [["school", "School", 4], ["degree", "Degree", 3], ["field", "Field", 3], ["start", "Start", 1.6], ["end", "End", 1.6]];

/** Step 2: the review card. Resolves with person fields (+ photo, + history from a PDF) or null. */
async function reviewPerson({ model, draft, note, existing, pdf, filled = [] }) {
  const body = el("div", undefined, { class: "form review" });
  const val = k => draft[k] ?? "";
  const input = (name, attrs = {}) => el("input", undefined, { name, value: val(name), autocomplete: "off", ...attrs });
  const f = {
    name: input("name", { required: true }), role: input("role"), company: input("company"),
    school: chipField("school", val("school"), { placeholder: "e.g. BYU (2022–2026)" }),
    pastCompanies: chipField("pastCompanies", val("pastCompanies"), { placeholder: "e.g. Deloitte (2019–2021)" }),
    email: input("email", { type: "email" }), linkedinUrl: input("linkedinUrl", { type: "url" }),
    connectedOn: input("connectedOn", { type: "date" }),
    status: el("select", undefined, { name: "status" }),
    tags: chipField("tags", draft.tags ?? "", { placeholder: "Add a tag" }),
    notes: el("textarea", undefined, { name: "notes", rows: 3, value: val("notes") }),
  };
  // From a profile PDF: the rest of what LinkedIn shows.
  if (pdf || PDF_FIELDS.some(k => val(k))) {
    Object.assign(f, { headline: input("headline"), location: input("location"), website: input("website", { type: "url" }),
      skills: chipField("skills", val("skills"), { placeholder: "Add a skill" }), languages: chipField("languages", val("languages")),
      certifications: chipField("certifications", val("certifications")),
      honors: input("honors"), about: el("textarea", undefined, { name: "about", rows: 3, value: val("about") }) });
  }
  for (const s of ["", ...STATUSES]) f.status.append(el("option", s || "Choose…", { value: s, selected: s === (draft.status ?? "") }));
  attachTypeahead(f.company, "company");
  attachTypeahead(f.role, "role");
  const lists = [];

  // Connections: who introduced you, and who they know (coworker, classmate, friend, mentor, other).
  const rows = el("div", undefined, { class: "conn-rows" });
  const addRow = (person = "", type = INTRODUCED) => {
    const row = el("div", undefined, { class: "conn-row" });
    const who = el("input", undefined, { placeholder: "Person on your map", autocomplete: "off", value: person, "aria-label": "Person" });
    attachTypeahead(who, "person");
    const kind = el("select", undefined, { "aria-label": "How you're connected" });
    for (const t of CONNECTION_TYPES) kind.append(el("option", t === INTRODUCED ? "Introduced me" : t, { value: t, selected: t === type }));
    if (!CONNECTION_TYPES.includes(type)) kind.append(el("option", type, { value: type, selected: true }));
    const other = el("input", undefined, { placeholder: "How?", hidden: kind.value !== "Other", "aria-label": "Other connection" });
    kind.addEventListener("change", () => { other.hidden = kind.value !== "Other"; });
    row.append(who, kind, el("button", "×", { class: "conn-remove", type: "button", title: "Remove", onclick: () => row.remove() }), other);
    row.read = () => ({ other: who.value.trim(), type: kind.value === "Other" ? other.value.trim() || "Other" : kind.value });
    rows.append(row);
  };
  if (draft.connectedThrough) addRow(draft.connectedThrough, INTRODUCED);
  else addRow();
  const connBox = el("div");
  connBox.append(rows, el("button", "+ Add another", { class: "linklike small", type: "button", onclick: () => addRow("", "Coworker") }));
  const photoFile = el("input", undefined, { type: "file", accept: "image/*" });
  const photoUrl = el("input", undefined, { type: "url", placeholder: "or paste an image link" });
  const photo = el("div", undefined, { class: "row2" });
  photo.append(photoFile, photoUrl);

  const needs = k => !val(k); // the fields only you know are highlighted while empty
  const two = (a, b) => { const r = el("div", undefined, { class: "row2" }); r.append(a, b); return r; };
  // Anything the PDF reader had to guess is highlighted, with why.
  const unsure = pdf?.unsure ?? [];
  const doubt = k => unsure.filter(u => u.field === k).map(u => u.message).join(" ");
  const pdfField = (label, key, input) => {
    const w = field(label, input, { hint: doubt(key) || undefined });
    if (doubt(key)) w.classList.add("unsure");
    if (filled.includes(key)) w.classList.add("new");
    return w;
  };
  body.append(...lists, el("p", note, { class: `source-note ${draft.company || draft.role ? "ok" : ""}` }));
  if (existing) {
    body.append(el("p", pdf
      ? `${existing.name} is already on your map. Saving merges: empty fields are filled in and new jobs and schools are added ` +
        `(marked "new"); nothing you've entered is overwritten.`
      : `${existing.name} is already on your map. Saving updates their row.`, { class: "warn" }));
  }
  if (unsure.length) {
    const list = el("ul", undefined, { class: "unsure-list" });
    for (const u of unsure) list.append(el("li", u.message));
    body.append(el("div", "Double-check", { class: "form-section" }), list);
  }

  // Several current roles: pick the main one; the others stay linked as current employers.
  const options = pdf?.currentOptions ?? [];
  let picker = null;
  if (options.length > 1 && !existing?.company) {
    picker = el("div", undefined, { class: "role-picker", role: "radiogroup", "aria-label": "Main current role" });
    options.forEach((o, i) => {
      const id = `cur-${i}`;
      const radio = el("input", undefined, { type: "radio", name: "current-role", id, checked: i === 0 });
      radio.addEventListener("change", () => {
        const next = profileToPerson(pdf.profile, { current: i }).person;
        f.company.value = next.company; f.role.value = next.role; f.pastCompanies.value = next.pastCompanies;
      });
      const lab = el("label", undefined, { for: id });
      lab.append(radio, el("strong", o.role || o.title), el("span", ` · ${o.company} · since ${o.start.slice(0, 4)}`, { class: "muted" }));
      picker.append(lab);
    });
  }
  const onFile = kind => {
    const keys = new Set((model[kind] ?? []).filter(r => normalizeName(r.person) === normalizeName(existing?.name ?? "")).map(rowKey[kind]));
    return r => keys.has(rowKey[kind](r));
  };
  const exp = pdf ? historyRows(pdf.experience, EXPERIENCE_FIELDS, { onFile: onFile("experience"), newTag: existing ? "new" : "" }) : null;
  const edu = pdf ? historyRows(pdf.education, EDUCATION_FIELDS, { onFile: onFile("education"), newTag: existing ? "new" : "" }) : null;

  body.append(
    pdfField("Name", "name", f.name),
    ...(f.headline ? [pdfField("Headline", "headline", f.headline)] : []),
    ...(picker ? [field("Main current role", picker, { hint: "They list several current roles. The others are kept as current employers." })] : []),
    two(pdfField("Role", "role", f.role), pdfField("Company", "company", f.company)),
    two(pdfField("Email", "email", f.email), pdfField("LinkedIn", "linkedinUrl", f.linkedinUrl)),
    ...(f.location ? [two(pdfField("Location", "location", f.location), pdfField("Company website", "website", f.website))] : []),
  );
  if (pdf) {
    body.append(el("div", "History", { class: "form-section" }),
      pdfField(`Experience (${pdf.experience.length})`, "experience", exp),
      pdfField(`Education (${pdf.education.length})`, "education", edu),
      two(pdfField("Past companies", "pastCompanies", f.pastCompanies), pdfField("Schools", "school", f.school)),
      el("div", "Skills and more", { class: "form-section" }),
      two(pdfField("Skills", "skills", f.skills), pdfField("Languages", "languages", f.languages)),
      two(pdfField("Certifications", "certifications", f.certifications), pdfField("Honors, publications, patents", "honors", f.honors)),
      pdfField("About", "about", f.about));
  }
  body.append(
    el("div", "What only you know", { class: "form-section" }),
    field("Connections", connBox, { needs: true, hint: "\"Introduced me\" makes them 2nd-degree through that person; " +
      "coworker / classmate / friend / mentor just links them. Leave the name blank if you know them directly." }),
    field("Status", f.status, { needs: needs("status") }),
    ...(pdf ? [] : [field("Schools", f.school, { needs: needs("school") }), field("Past companies", f.pastCompanies)]),
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
  if (pdf) {
    const name = out.name;
    out.history = { experience: exp.read().map(r => ({ ...r, person: name })), education: edu.read().map(r => ({ ...r, person: name })) };
  }
  if (photoFile.files[0]) out.photo = await resizeImage(photoFile.files[0]);
  else if (/^https?:\/\//i.test(photoUrl.value.trim())) out.photo = photoUrl.value.trim();
  else if (draft.photo) out.photo = draft.photo;
  if (draft.source) out.source = draft.source;
  const conns = [...rows.children].map(r => r.read()).filter(c => c.other);
  out.connectedThrough = conns.find(c => c.type === INTRODUCED)?.other ?? "";
  out.links = conns.filter(c => c.type !== INTRODUCED);
  return out;
}

/**
 * The whole flow. Resolves with { person, existingKey } to save, { open: name } to open someone
 * already on the map, or null.
 */
export async function addPersonFlow({ model, demo, pdf, entry, into }) {
  const found = entry ? { draft: personFromPool(entry), source: "pool", note: "Filled in from your LinkedIn connections." }
    : await findPerson({ model, demo, pdf });
  if (!found) return null;
  if (found.open) return found;
  // From someone's details (into): merge into them, even if the PDF spells their name differently.
  const existing = model.people.find(p => normalizeName(p.name) === normalizeName(into ?? found.draft.name));
  if (existing && into) found.draft = { ...found.draft, name: existing.name };
  // Someone already on the map: fill their empty fields from what we found, never overwrite what's there.
  const merged = existing ? fillPerson(existing, found.draft) : { person: found.draft, filled: [] };
  const person = await reviewPerson({ model, draft: merged.person, note: found.note, existing, pdf: found.pdf,
                                      filled: existing ? merged.filled : [] });
  return person ? { person, existingKey: existing ? normalizeName(existing.name) : undefined } : null;
}

/** Add several pool entries at once (no review): "Add selected" / "Add everyone at X". */
export function peopleFromPool(model, entries) {
  const isOnMap = onMapIndex(model.people);
  return entries.filter(e => !isOnMap(e)).map(personFromPool);
}
