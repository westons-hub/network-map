// Details for whatever you clicked on the map (a person, group, target, or you), shown as a page in the left
// sidebar with a back arrow. Every field is click-to-edit. On phones the sidebar is the bottom sheet.

import { entryNames, sharedWithMe } from "../core/history.js";
import { normalizeName, normalizeOrg } from "../core/org.js";
import { STATUSES, personKey, poolName } from "../core/people.js";
import { meetingDate, meetingsFor, tasksFor, todayIso, toDate } from "../core/schedule.js";
import { STAGES } from "../core/workbook.js";
import { el } from "./dom.js";
import { inlineField } from "./inline.js";
import { statusColor } from "./map.js";

const isWebUrl = u => /^https?:\/\//i.test(u ?? "");
const isEmail = e => /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(e ?? "");
const personId = name => `p:${normalizeName(name)}`;
const unique = list => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));

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

    const companies = unique([...model.people.map(x => x.company), ...model.pool.map(e => e.company)]);
    const schools = unique(model.people.flatMap(x => entryNames(x.school)));
    const names = unique(model.people.map(x => x.name).filter(n => normalizeName(n) !== key));

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
    sub.append(edit("role", { label: "role", placeholder: "Add role" }), el("span", " @ ", { class: "muted" }),
               edit("company", { label: "company", placeholder: "Add company", suggestions: companies }));
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
      row("Schools", edit("school", { suggestions: schools, placeholder: "Add school(s)", label: "schools" })),
      row("Past companies", edit("pastCompanies", { suggestions: companies, placeholder: "e.g. Deloitte (2019–2021)",
                                                     label: "past companies" })),
      row("Connected via", placeholder ? el("span", "—") : inlineField({ value: p.connectedThrough, suggestions: names,
        label: "connected through", placeholder: "You know them directly",
        display: v => v ? el("button", v, { class: "linklike", type: "button", onclick: () => handlers.focus(personId(v)) }) : "",
        onSave: save("connectedThrough") })),
      row("Connected on", edit("connectedOn", { type: "date", placeholder: "Add date", display: v => prettyDate(v, false) || v })),
      row("Meeting date", el("span", md ? `${prettyDate(md.meeting.date)}${md.upcoming ? " (upcoming)" : ""}` : "—")),
      row("LinkedIn", edit("linkedinUrl", { type: "url", placeholder: "Paste profile link",
        display: v => v ? "Profile link" : "" })),
      row("Tags", edit("tags", { placeholder: "Add tags" })),
    );
    card.append(info);

    // Notes: full text, editable in place.
    card.append(section("Notes", placeholder ? el("span", p.notes || "—", { class: "muted" })
      : inlineField({ value: p.notes, multiline: true, label: "notes", placeholder: "Add notes…", onSave: save("notes") })));

    if (!placeholder) {
      const foot = el("div", undefined, { class: "card-foot" });
      foot.append(el("button", "Edit all", { class: "btn small", type: "button", onclick: () => handlers.editAll(key) }),
                  el("button", "Remove person", { class: "btn small danger", type: "button",
                                                  onclick: () => handlers.removePerson(key, p.name) }));
      card.append(foot);
    }
  }

  // ---- you (the center node) ----------------------------------------------------------------

  function meCard(node, ctx) {
    const { model, images, graph } = ctx;
    const prof = model.profile ?? {};
    const save = field => value => handlers.setProfile({ [field]: value });
    const edit = (field, opts = {}) => inlineField({ value: prof[field] ?? "", onSave: save(field), label: opts.label ?? field, ...opts });
    const companies = unique([...model.people.map(x => x.company), ...model.pool.map(e => e.company)]);
    const schools = unique(model.people.flatMap(x => entryNames(x.school)));

    const pic = images.forPerson({ ...node, label: model.me || "You" });
    const photo = el("button", undefined, { class: "card-photo me", type: "button", title: "Change photo",
                                            onclick: () => handlers.editMyPhoto() });
    photo.append(el("img", undefined, { src: pic.image, alt: "", onerror: e => { e.target.src = pic.brokenImage; } }),
                 el("span", "Change", { class: "photo-hint" }));
    const title = el("div", undefined, { class: "card-name" });
    title.append(inlineField({ value: model.me, label: "your name", placeholder: "Your name", onSave: v => handlers.setProfile({ name: v }) }));
    const sub = el("div", undefined, { class: "card-sub" });
    sub.append(edit("role", { placeholder: "Your role (e.g. MBA Candidate)" }));
    sub.append(el("span", " @ ", { class: "muted" }), edit("company", { suggestions: companies, placeholder: "add company" }));
    const extra = el("div", undefined, { class: "headline" });
    extra.append(edit("headline", { placeholder: "Add a headline" }));
    card.append(header(photo, title, sub, extra));
    card.append(el("div", model.me ? "That's you · the center of your map" : "That's you · add your name", { class: "you-tag" }));

    const info = el("div", undefined, { class: "card-info" });
    info.append(
      row("Schools", edit("school", { suggestions: schools, placeholder: "e.g. BYU (2022–2026)", label: "schools" })),
      row("Past companies", edit("pastCompanies", { suggestions: companies, placeholder: "e.g. Deloitte (2019–2021)", label: "past companies" })),
      row("Email", edit("email", { type: "email", placeholder: "Add email" })),
      row("LinkedIn", edit("linkedinUrl", { type: "url", placeholder: "Paste your profile link", display: v => (v ? "Profile link" : "") })),
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
    const sub = el("div", t ? `${kind}${node.kind !== "target" ? " · target" : ""}` : `${kind} · ${node.count} you know directly`,
                   { class: "card-sub" });
    card.append(header(img, el("div", node.label, { class: "card-name static" }), sub));

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

    const people = t ? [...t.direct, ...t.second] : graph.groups[node.id] ?? [];
    const alumni = t?.alumni ?? graph.edges.filter(e => e.from === node.id && e.kind === "alumni")
      .map(e => ({ name: graph.nodes.find(n => n.id === e.to)?.label, years: e.years })).filter(a => a.name);
    if (people.length) {
      const list = el("div", undefined, { class: "people-chips" });
      for (const name of people) {
        const n = graph.nodes.find(x => x.id === personId(name));
        const chip = el("button", undefined, { class: "person-chip", type: "button", onclick: () => handlers.focus(personId(name)) });
        if (n) chip.append(el("img", undefined, { src: images.forPerson(n).image, alt: "" }));
        chip.append(name);
        list.append(chip);
      }
      card.append(section(t ? "People you know there" : "People in this group", list));
    }
    if (alumni.length) {
      const list = el("div", undefined, { class: "people-chips" });
      for (const a of alumni) {
        list.append(el("button", `${a.name}${a.years ? ` (${a.years})` : ""}`, { class: "person-chip alumni", type: "button",
                                                                               onclick: () => handlers.focus(personId(a.name)) }));
      }
      card.append(section("Alumni", list));
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
