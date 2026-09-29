// The popover card that opens next to a clicked node. It follows the node when the map pans
// or zooms, flips sides to stay on screen, and never covers the node. On phones it's a bottom sheet.

import { entryNames } from "../core/history.js";
import { normalizeName, normalizeOrg } from "../core/org.js";
import { STATUSES, personKey, poolName } from "../core/people.js";
import { meetingDate, meetingsFor, tasksFor, todayIso, toDate } from "../core/schedule.js";
import { STAGES } from "../core/workbook.js";
import { el } from "./dom.js";
import { inlineField } from "./inline.js";
import { statusColor } from "./map.js";

const GAP = 14;          // space between the node and the card
const MARGIN = 10;       // keep this far from the map's edges
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

export function createCard({ container, map, getCtx, handlers, avoid = () => [] }) {
  const card = el("div", undefined, { class: "card", role: "dialog", "aria-modal": "false", hidden: true });
  container.append(card);
  let openId = null;
  let savedTimer;

  // ---- positioning ----------------------------------------------------------------

  const mobile = () => window.matchMedia("(max-width: 760px)").matches;

  function reposition() {
    if (!openId || card.hidden) return;
    if (mobile()) { card.style.left = card.style.top = ""; card.style.visibility = ""; return; }
    const box = map.nodeBox(openId);
    const W = container.clientWidth, H = container.clientHeight;
    if (!box || box.x < -box.r || box.y < -box.r || box.x > W + box.r || box.y > H + box.r) {
      card.style.visibility = "hidden"; // node scrolled off the map; the card comes back with it
      return;
    }
    card.style.visibility = "";
    const w = card.offsetWidth, h = card.offsetHeight;
    // Prefer the side away from anything we shouldn't cover (e.g. a target's highlighted best path).
    const others = avoid(openId).map(id => map.nodeBox(id)).filter(Boolean);
    const preferLeft = others.length > 0 && others.reduce((s, b) => s + b.x, 0) / others.length > box.x;
    const right = box.x + box.r + GAP + w <= W - MARGIN ? box.x + box.r + GAP : undefined;
    const leftSide = box.x - box.r - GAP - w >= MARGIN ? box.x - box.r - GAP - w : undefined;
    let left = preferLeft ? leftSide ?? right : right ?? leftSide;
    let top;
    if (left !== undefined) {
      top = Math.min(Math.max(box.y - Math.min(h / 2, 90), MARGIN), H - h - MARGIN);
    } else {                                                                           // no room at the sides
      left = Math.min(Math.max(box.x - w / 2, MARGIN), W - w - MARGIN);
      top = box.y + box.r + GAP + h <= H - MARGIN ? box.y + box.r + GAP : Math.max(MARGIN, box.y - box.r - GAP - h);
    }
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  }

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
    if (!node || node.kind === "me") { close(); return; }
    const scroll = card.scrollTop;
    card.replaceChildren();
    card.classList.toggle("org", node.kind !== "person" && node.kind !== "second");
    if (node.kind === "person" || node.kind === "second") personCard(node, ctx); else orgCard(node, ctx);
    card.hidden = false;
    card.scrollTop = scroll;
    reposition();
  }

  function close() {
    openId = null;
    card.hidden = true;
  }

  document.addEventListener("click", e => {
    for (const m of card.querySelectorAll(".status-menu")) if (!m.parentElement.contains(e.target)) m.hidden = true;
  });

  return {
    open(id) { openId = id; card.scrollTop = 0; render(); },
    close,
    render,
    reposition,
    get openId() { return openId; },
    /** A small "Saved" confirmation after an inline edit. */
    saved() {
      let tag = card.querySelector(".saved-flash");
      if (!tag) { tag = el("span", "Saved ✓", { class: "saved-flash" }); card.append(tag); }
      tag.classList.add("show");
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => tag.classList.remove("show"), 1300);
    },
  };
}
