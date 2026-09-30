// Details for whatever you clicked on the map (a person, group, target, or you), shown as a page in the left
// sidebar with a back arrow. Every field is click-to-edit. On phones the sidebar is the bottom sheet.

import { CONNECTION_TYPES, INTRODUCED, connectionsOf } from "../core/connections.js";
import { historyOf, sharedWithMe } from "../core/history.js";
import { normalizeName, normalizeOrg } from "../core/org.js";
import { STATUSES, personKey, poolName } from "../core/people.js";
import { meetingDate, meetingsFor, tasksFor, todayIso, toDate } from "../core/schedule.js";
import { STAGES } from "../core/workbook.js";
import { el } from "./dom.js";
import { inlineField } from "./inline.js";
import { attachTypeahead } from "./typeahead.js";
import { statusColor } from "./map.js";

const isWebUrl = u => /^https?:\/\//i.test(u ?? "");
const isEmail = e => /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(e ?? "");
const personId = name => `p:${normalizeName(name)}`;

/** "2022-03" -> "Mar 2022", "2019" -> "2019", "Present" stays. */
function prettyMonth(v) {
  const m = /^(\d{4})-(\d{2})$/.exec(v ?? "");
  return m ? `${new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString("en-US", { month: "short" })} ${m[1]}` : v ?? "";
}
const span = r => [prettyMonth(r.start), prettyMonth(r.end)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" – ");

/** Jobs grouped by company (several roles at one company sit together), then schools. */
function timeline(experience, education) {
  const box = el("div", undefined, { class: "timeline" });
  const groups = [];
  for (const r of experience) {
    const last = groups.at(-1);
    if (last && normalizeOrg(last.company) === normalizeOrg(r.company)) last.roles.push(r);
    else groups.push({ company: r.company, roles: [r] });
  }
  for (const g of groups) {
    const item = el("div", undefined, { class: `tl-item${g.roles.some(r => r.end === "Present") ? " now" : ""}` });
    item.append(el("div", g.company, { class: "tl-org" }));
    for (const r of g.roles) {
      const role = el("div", undefined, { class: "tl-role" });
      role.append(el("div", r.title || "Role", { class: "tl-title" }),
                  el("div", [span(r), r.location].filter(Boolean).join(" · "), { class: "muted small" }));
      if (r.description) {
        const d = el("details", undefined, { class: "tl-desc" });
        d.append(el("summary", "Description"), el("div", r.description, { class: "small pre" }));
        role.append(d);
      }
      item.append(role);
    }
    box.append(item);
  }
  for (const e of education) {
    const item = el("div", undefined, { class: "tl-item school" });
    item.append(el("div", e.school, { class: "tl-org" }),
                el("div", [e.degree, e.field].filter(Boolean).join(", "), { class: "tl-title" }),
                el("div", span(e), { class: "muted small" }));
    box.append(item);
  }
  return box;
}

function prettyDate(date, withWeekday = true) {
  if (!date) return "";
  return toDate(date).toLocaleDateString("en-US", { ...(withWeekday ? { weekday: "short" } : {}), month: "short", day: "numeric" });
}
function prettyTime(time) {
  return time ? toDate("2000-01-01", time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
}

/**
 * sidebar: the <aside>; the details page replaces its scrolling body (Targets, overview…) while open.
 * handlers.close() goes back to the default sidebar.
 */
export function createDetails({ sidebar, getCtx, handlers }) {
  const body = sidebar.querySelector(".sidebar-scroll");
  const pane = el("section", undefined, { class: "details-pane", hidden: true, "aria-label": "Details" });
  const back = el("button", "← Back", { class: "details-back linklike", type: "button", title: "Back (Esc)",
                                        onclick: () => handlers.close() });
  const card = el("div", undefined, { class: "card" });
  pane.append(back, card);
  body.after(pane);
  let openId = null;
  let savedTimer;

  // ---- pieces ----------------------------------------------------------------------

  function header(img, title, sub, extra) {
    const head = el("div", undefined, { class: "card-head" });
    head.append(img);
    const titles = el("div", undefined, { class: "card-titles" });
    titles.append(title);
    if (sub) titles.append(sub);
    if (extra) titles.append(extra);
    head.append(titles, el("button", "×", { class: "card-close", type: "button", title: "Close (Esc)",
                                              "aria-label": "Close", onclick: () => handlers.close() }));
    return head;
  }

  function section(title, ...children) {
    const s = el("div", undefined, { class: "card-section" });
    if (title) s.append(el("div", title, { class: "card-label" }));
    s.append(...children.filter(Boolean));
    return s;
  }

  function row(label, content) {
    const r = el("div", undefined, { class: "card-row" });
    r.append(el("span", label, { class: "card-key" }), content);
    return r;
  }

  function statusPill(person) {
    const wrap = el("span", undefined, { class: "status-wrap" });
    const pill = el("button", person.status || "Set status", { class: `status-pill${person.status ? "" : " empty"}`,
      type: "button", title: "Change status", "aria-haspopup": "listbox" });
    const color = statusColor(person.status);
    if (color) pill.style.setProperty("--pill", color);
    const menu = el("div", undefined, { class: "status-menu", role: "listbox", hidden: true });
    for (const s of [...STATUSES, ""]) {
      const item = el("button", s || "No status", { type: "button", role: "option",
        class: s === person.status ? "current" : "", onclick: () => {
          menu.hidden = true;
          if (s !== person.status) handlers.patchPerson(personKey(person), { status: s });
        } });
      const c = statusColor(s);
      if (c) item.style.setProperty("--pill", c);
      menu.append(item);
    }
    pill.addEventListener("click", e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    wrap.append(pill, menu);
    return wrap;
  }

  // ---- person card ---------------------------------------------------------------------

  function personCard(node, ctx) {
    const { model, images } = ctx;
    const person = model.people.find(p => personKey(p) === node.id.slice(2));
    const placeholder = !person;
    const p = person ?? { name: node.label, company: "", school: "", role: "", email: "", linkedinUrl: "", photo: "",
                          connectedThrough: "", connectedOn: "", status: "", tags: [], notes: "" };
    const key = node.id.slice(2);
    const save = field => value => handlers.patchPerson(key, { [field]: value });
    const edit = (field, opts = {}) => placeholder ? el("span", p[field] || "", { class: "muted" })
      : inlineField({ value: Array.isArray(p[field]) ? p[field].join(", ") : p[field] ?? "", onSave: save(field),
                      label: opts.label ?? field, ...opts });


    // Header: photo, name, role @ company, status pill.
    const pic = images.forPerson(node);
    const photo = el("button", undefined, { class: "card-photo", type: "button", title: placeholder ? "" : "Change photo",
      disabled: placeholder, onclick: () => handlers.editPhoto(node) });
    photo.append(el("img", undefined, { src: pic.image, alt: "", onerror: e => { e.target.src = pic.brokenImage; } }));
    if (!placeholder) photo.append(el("span", "Change", { class: "photo-hint" }));
    const ring = statusColor(p.status);
    if (ring) photo.style.setProperty("--ring", ring);

    const title = el("div", undefined, { class: "card-name" });
    title.append(edit("name", { label: "name", placeholder: "Name" }));
    const sub = el("div", undefined, { class: "card-sub" });
    sub.append(edit("role", { label: "role", placeholder: "Add role", kind: "role" }), el("span", " @ ", { class: "muted" }),
               edit("company", { label: "company", placeholder: "Add company", kind: "company" }));
    if (p.headline && normalizeName(p.headline) !== normalizeName(`${p.role} at ${p.company}`)) {
      sub.append(el("div", p.headline, { class: "card-headline muted small" }));
    }
    if (p.location) sub.append(el("div", `📍 ${p.location}`, { class: "muted small" }));
    const extra = placeholder ? el("div", "Added automatically because someone was connected through them.", { class: "muted small" })
      : statusPill(p);
    card.append(header(photo, title, sub, extra));
    const shared = sharedWithMe(model.profile, p, normalizeOrg);
    if (shared.schools.length || shared.companies.length) {
      const b = el("div", undefined, { class: "shared-badges" });
      for (const sname of shared.schools) b.append(el("span", `Same school · ${sname}`, { class: "badge shared" }));
      for (const c of shared.companies) b.append(el("span", `Former coworker · ${c}`, { class: "badge shared" }));
      card.append(b);
    }

    // Quick links.
    const links = el("div", undefined, { class: "quick-links" });
    if (isWebUrl(p.linkedinUrl)) links.append(el("a", "LinkedIn", { class: "chip", href: p.linkedinUrl, target: "_blank", rel: "noopener" }));
    if (p.email) {
      if (isEmail(p.email)) links.append(el("a", "Email", { class: "chip", href: `mailto:${p.email}` }));
      links.append(el("button", "Copy email", { class: "chip", type: "button", onclick: async e => {
        try { await navigator.clipboard.writeText(p.email); e.target.textContent = "Copied"; }
        catch { e.target.textContent = "Couldn't copy"; }
        setTimeout(() => { e.target.textContent = "Copy email"; }, 1400);
      } }));
    }
    if (!placeholder) {
      links.append(el("button", "Schedule meeting", { class: "chip primary", type: "button",
                                                      onclick: () => handlers.scheduleMeeting({ person: p.name }) }));
      links.append(el("button", "Add task", { class: "chip", type: "button", onclick: () => handlers.addTask({ person: p.name }) }));
      links.append(el("button", "Export", { class: "chip", type: "button", title: "Export this person to Excel",
                                            onclick: () => handlers.exportPerson(p.name) }));
    }
    card.append(links);

    // Upcoming / latest.
    const today = todayIso();
    const meetings = meetingsFor(model, p.name);
    const upcoming = meetings.filter(m => m.date >= today);
    const latest = [...meetings].reverse().find(m => m.date < today);
    const openTasks = tasksFor(model, p.name).filter(t => !t.done).sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
    if (upcoming.length || openTasks.length) {
      const list = el("ul", undefined, { class: "card-list" });
      for (const m of upcoming) {
        const li = el("li", undefined, { class: "meeting" });
        li.append(el("span", `📅 ${prettyDate(m.date)} ${prettyTime(m.start)}`, { class: "when" }),
                  el("span", ` ${m.type || "Meeting"} · ${m.method || ""}`));
        const acts = el("span", undefined, { class: "row-actions" });
        acts.append(el("button", "Invite", { class: "linklike", type: "button", onclick: () => handlers.inviteMeeting(m) }),
                    el("button", "Edit", { class: "linklike", type: "button", onclick: () => handlers.editMeeting(m) }));
        li.append(acts);
        list.append(li);
      }
      for (const t of openTasks) {
        const li = el("li", undefined, { class: `task${t.due && t.due < today ? " overdue" : ""}` });
        const box = el("input", undefined, { type: "checkbox", "aria-label": `Done: ${t.task}`,
                                              onchange: () => handlers.toggleTask(t) });
        li.append(box, el("span", ` ${t.task}`), el("span", t.due ? ` · ${prettyDate(t.due, false)}` : "", { class: "muted" }));
        list.append(li);
      }
      card.append(section("Next up", list));
    }
    if (latest) {
      const s = el("div", undefined, { class: "latest" });
      s.append(el("div", `${prettyDate(latest.date)} · ${latest.type || "Meeting"}${latest.method ? ` · ${latest.method}` : ""}`,
                  { class: "muted small" }));
      if (latest.notes) s.append(el("div", latest.notes));
      if (latest.nextStep) s.append(el("div", `Next step: ${latest.nextStep}`, { class: "next-step" }));
      s.append(el("button", "Edit", { class: "linklike small", type: "button", onclick: () => handlers.editMeeting(latest) }));
      card.append(section("Latest meeting", s));
    }

    // Info.
    const info = el("div", undefined, { class: "card-info" });
    const md = meetingDate(model, p.name);
    info.append(
      row("Email", edit("email", { type: "email", placeholder: "Add email" })),
      row("Schools", edit("school", { chips: "school", placeholder: "Add a school", label: "schools" })),
      row("Past companies", edit("pastCompanies", { chips: "pastCompanies", placeholder: "e.g. Deloitte (2019–2021)",
                                                     label: "past companies" })),
      row("Connected on", edit("connectedOn", { type: "date", placeholder: "Add date", display: v => prettyDate(v, false) || v })),
      row("Meeting date", el("span", md ? `${prettyDate(md.meeting.date)}${md.upcoming ? " (upcoming)" : ""}` : "—")),
      row("LinkedIn", edit("linkedinUrl", { type: "url", placeholder: "Paste profile link",
        display: v => v ? "Profile link" : "" })),
      row("Tags", edit("tags", { placeholder: "Add a tag", chips: "tags", label: "tags" })),
    );
    // From a LinkedIn profile PDF (shown once there's something to show).
    for (const [label, f] of [["Location", "location"], ["Website", "website"], ["Honors", "honors"]]) {
      if (p[f]) info.append(row(label, edit(f, { label: label.toLowerCase(), type: f === "website" ? "url" : "text" })));
    }
    // Skills, languages and certifications are always there to add to (chips, with suggestions).
    info.append(row("Skills", edit("skills", { chips: "skills", placeholder: "Add a skill", label: "skills" })),
                row("Languages", edit("languages", { chips: "languages", placeholder: "Add a language", label: "languages" })),
                row("Certifications", edit("certifications", { chips: "certifications", placeholder: "Add a certification", label: "certifications" })));
    card.append(info);
    if (p.about) {
      card.append(section("About", placeholder ? el("div", p.about, { class: "pre" })
        : inlineField({ value: p.about, multiline: true, label: "about", onSave: save("about") })));
    }
    const jobs = historyOf(model.experience, p.name, normalizeName), schools = historyOf(model.education, p.name, normalizeName);
    if (jobs.length || schools.length) card.append(section("Timeline", timeline(jobs, schools)));

    // Connections: who introduced you, and coworker / classmate / friend / mentor links. Shown on both people.
    if (!placeholder) card.append(connectionsSection(p, model));

    // Notes: full text, editable in place.
    card.append(section("Notes", placeholder ? el("span", p.notes || "—", { class: "muted" })
      : inlineField({ value: p.notes, multiline: true, label: "notes", placeholder: "Add notes…", onSave: save("notes") })));

    // Their LinkedIn PDF fills in everything (merged: your edits are never overwritten).
    if (!placeholder) {
      const drop = el("div", undefined, { class: "drop-zone pdf-drop", tabIndex: 0, role: "button",
        "aria-label": `Add ${p.name}'s LinkedIn PDF` });
      const file = el("input", undefined, { type: "file", accept: "application/pdf,.pdf", hidden: true,
        onchange: () => { if (file.files[0]) handlers.importPdfFor(p.name, file.files[0]); } });
      drop.append(el("strong", "Add their LinkedIn PDF to fill in everything"),
        el("span", "Drop it here or click to choose. On their LinkedIn profile: More → Save to PDF. It's read on your computer, " +
                   "and nothing you've entered is overwritten.", { class: "muted small" }), file);
      drop.addEventListener("click", () => file.click());
      drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
      drop.addEventListener("dragover", e => { e.preventDefault(); e.stopPropagation(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", e => {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.remove("over");
        const f = [...e.dataTransfer.files].find(x => /\.pdf$/i.test(x.name) || x.type === "application/pdf");
        if (f) handlers.importPdfFor(p.name, f);
      });
      card.append(drop);
    }

    if (!placeholder) {
      const foot = el("div", undefined, { class: "card-foot" });
      foot.append(el("button", "Edit all", { class: "btn small", type: "button", onclick: () => handlers.editAll(key) }),
                  el("button", "Remove person", { class: "btn small danger", type: "button",
                                                  onclick: () => handlers.removePerson(key, p.name) }));
      card.append(foot);
    }
  }

  function connectionsSection(p, model) {
    const list = el("ul", undefined, { class: "conn-list" });
    for (const c of connectionsOf(model.connections, p.name)) {
      const li = el("li");
      const label = c.dir === "introducedBy" ? "Introduced you" : c.dir === "introduced" ? "Introduced you to" : c.type;
      li.append(el("span", c.dir === "introducedBy" ? "Introduced by" : label, { class: `conn-type${c.type === INTRODUCED ? " introduced" : ""}` }),
        el("button", c.other, { class: "linklike", type: "button", onclick: () => handlers.focus(personId(c.other)) }));
      if (c.notes) li.append(el("span", `· ${c.notes}`, { class: "muted small" }));
      li.append(el("button", "×", { class: "conn-remove", type: "button", title: "Remove this connection",
        "aria-label": `Remove connection with ${c.other}`, onclick: () => handlers.removeConnection(c.conn) }));
      list.append(li);
    }
    const box = section("Connections", list);
    if (!list.children.length) list.append(el("li", "No connections yet. Who introduced you, or who do they know?", { class: "muted small" }));

    // Add one: pick a person (type-ahead) and how they know each other.
    const toggle = el("button", "+ Connect to someone", { class: "linklike small", type: "button" });
    const form = el("div", undefined, { class: "conn-add", hidden: true });
    const who = el("input", undefined, { placeholder: "Person", autocomplete: "off", "aria-label": "Person" });
    attachTypeahead(who, "person");
    const type = el("select", undefined, { "aria-label": "How they're connected" });
    for (const t of CONNECTION_TYPES) type.append(el("option", t === INTRODUCED ? `Introduced me to ${p.name.split(" ")[0]}` : t, { value: t }));
    const other = el("input", undefined, { class: "other", placeholder: "How do they know each other?", hidden: true });
    type.addEventListener("change", () => { other.hidden = type.value !== "Other"; });
    const add = el("button", "Add", { class: "btn small primary", type: "button", onclick: () => {
      const name = model.people.find(x => normalizeName(x.name) === normalizeName(who.value))?.name ?? who.value.trim();
      if (!name) return who.focus();
      const t = type.value === "Other" ? other.value.trim() || "Other" : type.value;
      // "Introduced me": the person you picked introduced you to this person.
      handlers.addConnection(t === INTRODUCED ? { a: name, b: p.name, type: t } : { a: p.name, b: name, type: t });
    } });
    form.append(who, type, other, add);
    toggle.addEventListener("click", () => { form.hidden = !form.hidden; toggle.hidden = true; who.focus(); });
    box.append(toggle, form);
    return box;
  }

  // ---- you (the center node) ----------------------------------------------------------------

  function meCard(node, ctx) {
    const { model, images, graph } = ctx;
    const prof = model.profile ?? {};
    const save = field => value => handlers.setProfile({ [field]: value });
    const edit = (field, opts = {}) => inlineField({ value: prof[field] ?? "", onSave: save(field), label: opts.label ?? field, ...opts });

    const pic = images.forPerson({ ...node, label: model.me || "You" });
    const photo = el("button", undefined, { class: "card-photo me", type: "button", title: "Change photo",
                                            onclick: () => handlers.editMyPhoto() });
    photo.append(el("img", undefined, { src: pic.image, alt: "", onerror: e => { e.target.src = pic.brokenImage; } }),
                 el("span", "Change", { class: "photo-hint" }));
    const title = el("div", undefined, { class: "card-name" });
    title.append(inlineField({ value: model.me, label: "your name", placeholder: "Your name", onSave: v => handlers.setProfile({ name: v }) }));
    const sub = el("div", undefined, { class: "card-sub" });
    sub.append(edit("role", { placeholder: "Your role (e.g. MBA Candidate)", kind: "role" }));
    sub.append(el("span", " @ ", { class: "muted" }), edit("company", { kind: "company", placeholder: "add company" }));
    const extra = el("div", undefined, { class: "headline" });
    extra.append(edit("headline", { placeholder: "Add a headline" }));
    card.append(header(photo, title, sub, extra));
    card.append(el("div", model.me ? "That's you · the center of your map" : "That's you · add your name", { class: "you-tag" }));

    const info = el("div", undefined, { class: "card-info" });
    info.append(
      row("Schools", edit("school", { chips: "school", placeholder: "e.g. BYU (2022–2026)", label: "schools" })),
      row("Past companies", edit("pastCompanies", { chips: "pastCompanies", placeholder: "e.g. Deloitte (2019–2021)", label: "past companies" })),
      row("Email", edit("email", { type: "email", placeholder: "Add email" })),
      row("LinkedIn", edit("linkedinUrl", { type: "url", placeholder: "Paste your profile link", display: v => (v ? "Profile link" : "") })),
      // The same Zoom link as in Settings: it goes into every invite.
      row("My Zoom link", inlineField({ value: model.settings?.zoomLink ?? "", type: "url", label: "my Zoom link",
        placeholder: "Your personal room link", display: v => (v ? v.replace(/^https?:\/\//, "") : ""),
        onSave: v => handlers.setZoomLink(v) })),
      row("Location", edit("location", { placeholder: "Add location" })),
    );
    card.append(info);
    card.append(section("What I'm looking for", inlineField({ value: prof.lookingFor ?? "", multiline: true,
      label: "what you're looking for", placeholder: "Roles, companies, timing…", onSave: save("lookingFor") })));

    // People you share a school or an employer with (from your profile).
    const sameSchool = [], coworkers = [];
    for (const p of model.people) {
      const s = sharedWithMe(prof, p, normalizeOrg);
      if (s.schools.length) sameSchool.push(p.name);
      if (s.companies.length) coworkers.push(p.name);
    }
    const chips = (title2, names) => {
      if (!names.length) return;
      const list = el("div", undefined, { class: "people-chips" });
      for (const name of names) {
        const n = graph.nodes.find(x => x.id === personId(name));
        const chip = el("button", undefined, { class: "person-chip", type: "button", onclick: () => handlers.focus(personId(name)) });
        if (n) chip.append(el("img", undefined, { src: images.forPerson(n).image, alt: "" }));
        chip.append(name);
        list.append(chip);
      }
      card.append(section(`${title2} (${names.length})`, list));
    };
    chips("Same school", sameSchool);
    chips("Former coworkers", coworkers);
    if (!prof.school && !prof.pastCompanies) {
      card.append(el("p", "Add your schools and past companies to see who you share them with (\"Same school\" and \"Former coworker\" badges).",
                     { class: "muted small" }));
    }
  }

  // ---- group / target card ------------------------------------------------------------

  function orgCard(node, ctx) {
    const { graph, model, images, paths } = ctx;
    const logo = images.forOrg(node);
    const img = el("span", undefined, { class: "card-photo org" });
    img.append(el("img", undefined, { src: logo.image, alt: "", onerror: e => { e.target.src = logo.brokenImage; } }));
    const t = graph.targets.find(x => x.focus === node.id);
    const kind = node.kind === "target" ? "Target company" : `${node.kind[0].toUpperCase()}${node.kind.slice(1)} group`;
    const kindLabel = node.field ? `${node.field[0].toUpperCase()}${node.field.slice(1)} group` : kind;
    const sub = el("div", `${kindLabel}${t && node.kind !== "target" ? " · target" : ""} · ${node.count} ${node.count === 1 ? "person" : "people"}`,
                   { class: "card-sub" });
    const name = el("div", undefined, { class: "card-name static" });
    name.append(node.label, " ", el("button", "Edit", { class: "chip small-chip", type: "button", title: "Type, website and logo",
                                                          onclick: () => handlers.editOrg(node) }));
    card.append(header(img, name, sub));

    if (t) {
      const target = model.targets.find(x => normalizeOrg(x.company) === t.key) ?? {};
      const stage = el("select", undefined, { class: "stage-select", "aria-label": "Stage",
        onchange: e => handlers.setTargetStage(t.key, e.target.value) });
      for (const s of ["", ...STAGES]) stage.append(el("option", s || "No stage", { value: s, selected: s === (target.stage ?? "") }));
      const meta = el("div", undefined, { class: "quick-links" });
      if (target.priority) meta.append(el("span", `P${target.priority}`, { class: `badge p${target.priority}` }));
      meta.append(stage, el("button", "Edit target", { class: "chip", type: "button", onclick: () => handlers.editTarget(t.key) }));
      card.append(meta);
      const path = paths.get(t.key);
      if (path) {
        const chain = el("div", undefined, { class: "path" });
        path.names.forEach((name, i) => {
          if (i) chain.append(el("span", "→", { class: "arrow" }));
          chain.append(i === 0 ? el("span", name, { class: "step me" })
            : el("button", name, { class: "step", type: "button", onclick: () => handlers.focus(personId(name)) }));
        });
        const how = path.alumni ? `${path.person} used to work here${path.names.length === 2 ? "" : `; ask ${path.ask} for an intro`}.`
          : path.names.length === 2 ? `You know ${path.person} directly.` : `Ask ${path.ask} for an intro.`;
        card.append(section("Your best way in", chain, el("div", how, { class: "small" })));
      } else {
        card.append(section(null, el("p", "No connections yet. Add a contact here, or ask your groups who they know.",
                                      { class: "empty-state" })));
      }
      if (target.notes) card.append(section("Notes", el("div", target.notes)));
    }

    // The same people as the lines on the map (and the count on the dot): current members, then alumni.
    const people = graph.groups[node.id] ?? [];
    const years = new Map(graph.edges.filter(e => e.from === node.id && e.kind === "alumni").map(e => [e.to, e.years]));
    const alumni = (graph.alumni?.[node.id] ?? []).map(name => ({ name, years: years.get(personId(name)) ?? "" }));
    if (people.length) {
      const list = el("div", undefined, { class: "people-chips" });
      for (const name of people) {
        const n = graph.nodes.find(x => x.id === personId(name));
        const chip = el("button", undefined, { class: "person-chip", type: "button", onclick: () => handlers.focus(personId(name)) });
        if (n) chip.append(el("img", undefined, { src: images.forPerson(n).image, alt: "" }));
        chip.append(name);
        list.append(chip);
      }
      card.append(section(`${t ? "People you know there" : "People in this group"} (${people.length})`, list));
    }
    if (alumni.length) {
      const list = el("div", undefined, { class: "people-chips" });
      for (const a of alumni) {
        list.append(el("button", `${a.name}${a.years ? ` (${a.years})` : ""}`, { class: "person-chip alumni", type: "button",
                                                                               onclick: () => handlers.focus(personId(a.name)) }));
      }
      card.append(section(`Alumni (${alumni.length})`, list));
    }
    if (t) {
      const onMap = new Set(model.people.map(p => normalizeName(p.name)));
      const inPool = model.pool.filter(e => normalizeOrg(e.company) === t.key && !onMap.has(normalizeName(poolName(e))));
      if (inPool.length) {
        card.append(section(`In your LinkedIn pool (${inPool.length})`,
          el("div", inPool.map(e => poolName(e)).join(", "), { class: "muted small" })));
      }
    } else if (node.kind === "company") {
      const foot = el("div", undefined, { class: "card-foot" });
      foot.append(el("button", "Make this a target", { class: "btn small", type: "button",
                                                       onclick: () => handlers.makeTarget(node.label) }));
      card.append(foot);
    }
  }

  // ---- public ---------------------------------------------------------------------------

  function render() {
    if (!openId) return;
    const ctx = getCtx();
    const node = ctx.graph.nodes.find(n => n.id === openId);
    if (!node) { close(); return; }
    const scroll = pane.scrollTop;
    card.replaceChildren();
    card.classList.toggle("org", !["person", "second", "me"].includes(node.kind));
    if (node.kind === "me") meCard(node, ctx);
    else if (node.kind === "person" || node.kind === "second") personCard(node, ctx);
    else orgCard(node, ctx);
    if (!openId) return;
    body.hidden = true;
    pane.hidden = false;
    pane.scrollTop = scroll;
  }

  function close() {
    openId = null;
    pane.hidden = true;
    body.hidden = false;
  }

  document.addEventListener("click", e => {
    for (const m of card.querySelectorAll(".status-menu")) if (!m.parentElement.contains(e.target)) m.hidden = true;
  });

  return {
    open(id) { openId = id; pane.scrollTop = 0; render(); },
    close,
    render,
    get openId() { return openId; },
    /** A small "Saved" confirmation after an inline edit. */
    saved() {
      let tag = pane.querySelector(".saved-flash");
      if (!tag) { tag = el("span", "Saved ✓", { class: "saved-flash" }); pane.append(tag); }
      tag.classList.add("show");
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => tag.classList.remove("show"), 1300);
    },
  };
}
