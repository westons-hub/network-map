// Forms shown in the dialog: add/edit a target, and add a photo.

import { normalizeName, normalizeOrg } from "../core/org.js";
import { STATUSES } from "../core/people.js";
import {
  addMinutes, fillTemplate, gmailUrl, googleCalendarUrl, icsFile, isDate, mailtoUrl, newId, outlookUrl, todayIso,
} from "../core/schedule.js";
import { MEETING_TYPES, METHODS, PRIORITIES, STAGES } from "../core/workbook.js";
import { ask, toast } from "./dialog.js";
import { attachTypeahead } from "./typeahead.js";
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
  const name = el("input", undefined, { name: "company", required: true, autocomplete: "off",
    value: target?.company ?? company, placeholder: "e.g. Delta Air Lines", maxLength: 120 });
  attachTypeahead(name, "company");
  const priority = select("priority", [["", "—"], ...PRIORITIES.map(p => [p, `P${p}`])], target?.priority ?? "");
  const stage = select("stage", [["", "—"], ...STAGES.map(s => [s, s])], target?.stage ?? (editing ? "" : "Researching"));
  const notes = el("textarea", undefined, { name: "notes", rows: 3, value: target?.notes ?? "", maxLength: 2000 });
  const row = el("div", undefined, { class: "row2" });
  row.append(field("Priority", priority), field("Stage", stage));
  body.append(field("Company", name, "Pick from your people and LinkedIn pool, or type any company."), row,
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
  body.append(el("p", "LinkedIn exports don't include photos, and Orbit never downloads them from LinkedIn.",
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

// ---- meetings ---------------------------------------------------------------------------


const findPerson = (model, name) => model.people.find(p => normalizeName(p.name) === normalizeName(name));

/**
 * Schedule a meeting (or log one that already happened: a past date counts as "Met").
 * Resolves with { action: "save", meeting, email? } | { action: "delete" } | null.
 */
export async function meetingForm({ model, meeting, person = "", date = "", start: startAt = "" }) {
  const editing = !!meeting;
  const s = model.settings;
  const m = meeting ?? { id: newId("m"), person, date: date || todayIso(), start: startAt || "10:00", end: "", type: "Coffee Chat",
                         method: "Zoom", link: s.zoomLink || "", notes: "", nextStep: "", eventId: "" };
  const body = el("div", undefined, { class: "form" });
  const who = el("input", undefined, { name: "person", required: true, value: m.person, autocomplete: "off",
                                        placeholder: "Start typing a name" });
  attachTypeahead(who, "person");
  const emailWarn = el("div", undefined, { class: "warn", hidden: true });
  const email = el("input", undefined, { type: "email", name: "email", placeholder: "their@email.com" });
  emailWarn.append(el("span", "No email on file for this person. Add one so the invite can reach them:"), email);
  const checkEmail = () => {
    const p = findPerson(model, who.value);
    emailWarn.hidden = !p || !!p.email;
  };
  who.addEventListener("input", checkEmail);
  who.addEventListener("change", checkEmail);

  const day = el("input", undefined, { type: "date", name: "date", required: true, value: m.date });
  const start = el("input", undefined, { type: "time", name: "start", required: true, value: m.start || "10:00" });
  const minutesNow = m.end && m.start ? Math.max(5, (Number(m.end.slice(0, 2)) * 60 + Number(m.end.slice(3))) -
    (Number(m.start.slice(0, 2)) * 60 + Number(m.start.slice(3)))) : Number(s.meetingLength) || 30;
  const length = select("length", [15, 20, 30, 45, 60, 90].map(n => [String(n), `${n} min`]), String(minutesNow));
  if (![...length.options].some(o => o.selected)) length.append(el("option", `${minutesNow} min`, { value: String(minutesNow), selected: true }));
  const type = select("type", MEETING_TYPES.map(t => [t, t]), m.type || "Coffee Chat");
  const method = select("method", ["Zoom", "Google Meet", "Teams", "Phone", "In Person"].map(t => [t, t]), m.method || "Zoom");
  const link = el("input", undefined, { type: "url", name: "link", value: m.link, placeholder: "Meeting link" });
  const linkHint = el("span", "", { class: "muted small" });
  const syncMethod = () => {
    const v = method.value;
    if (v === "Zoom" && !link.value) link.value = s.zoomLink || "";
    if (v === "Phone" || v === "In Person") link.value = link.value.startsWith("http") ? "" : link.value;
    link.placeholder = v === "Zoom" ? "Your Zoom link" : v === "Google Meet" ? "Paste a Meet link (optional)"
      : v === "Teams" ? "Paste a Teams link (optional)" : v === "Phone" ? "Phone number (optional)" : "Place (optional)";
    linkHint.textContent = v === "Zoom" && !s.zoomLink ? "Tip: save your Zoom link in Settings to fill this in automatically." : "";
  };
  method.addEventListener("change", () => { if (method.value !== "Zoom" && link.value === s.zoomLink) link.value = ""; syncMethod(); });
  syncMethod();
  const notes = el("textarea", undefined, { name: "notes", rows: 2, value: m.notes });
  const next = el("input", undefined, { name: "nextStep", value: m.nextStep, placeholder: "e.g. Send resume" });

  const row = (...fields) => { const r = el("div", undefined, { class: "row3" }); r.append(...fields); return r; };
  body.append(field("Who", who), emailWarn, row(field("Date", day), field("Time", start), field("Length", length)),
              row(field("Type", type), field("How", method)), field("Link / place", link, ""), linkHint,
              field("Notes", notes), field("Next step", next));
  body.append(el("p", "A past date logs a meeting that happened (status becomes Met). A future date schedules one (status becomes Scheduled). Either way, a \"Send thank-you\" task is added for the next day.",
                 { class: "muted small" }));
  checkEmail();

  const buttons = [{ label: "Cancel", value: "" }, { label: editing ? "Save" : "Save meeting", value: "save", primary: true }];
  if (editing) buttons.unshift({ label: "Delete", value: "delete", danger: true, left: true });
  const choice = await ask(editing ? "Edit meeting" : "Schedule or log a meeting", body, buttons);
  if (choice === "delete") return { action: "delete" };
  if (choice !== "save" || !who.value.trim() || !isDate(day.value)) return null;
  const saved = { ...m, person: findPerson(model, who.value)?.name ?? who.value.trim(), date: day.value, start: start.value,
                  end: addMinutes(start.value, Number(length.value)), type: type.value, method: method.value,
                  link: link.value.trim(), notes: notes.value.trim(), nextStep: next.value.trim() };
  return { action: "save", meeting: saved, email: !emailWarn.hidden && email.value.trim() ? email.value.trim() : "" };
}

/**
 * The "Send invite" options. Nothing is sent by Orbit: each button opens a prefilled page or file
 * that you review and send or save yourself.
 */
export async function inviteDialog({ model, meeting, download, onOpen, onEdit, synced = "" }) {
  const person = findPerson(model, meeting.person);
  const me = model.me || "";
  const body = el("div", undefined, { class: "form" });
  const message = el("textarea", undefined, { rows: 3, value: fillTemplate(model.settings.inviteTemplate, { meeting, me }) });
  const to = person?.email || "";
  const when = new Date(`${meeting.date}T${meeting.start || "00:00"}`)
    .toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  body.append(el("p", `${meeting.type || "Meeting"} with ${meeting.person} · ${when}${meeting.method ? ` · ${meeting.method}` : ""}`,
                 { class: "meeting-summary" }));
  if (meeting.notes) body.append(el("p", meeting.notes, { class: "muted small" }));
  if (synced) body.append(el("p", synced, { class: "source-note ok" }));
  if (!to) body.append(el("p", `${meeting.person} has no email yet, so the invite won't include them. Add it in their details.`, { class: "warn" }));
  body.append(field("Message", message, "Edit it here; {first name}, {date}, {time} and {link} were filled in from your Settings template."));
  const ctx = () => ({ me, email: to, myEmail: model.settings.email, message: message.value });
  const open = url => window.open(url, "_blank", "noopener");
  const grid = el("div", undefined, { class: "invite-grid" });
  const button = (label, hint, onclick) => {
    const b = el("button", undefined, { class: "invite-option", type: "button", onclick });
    b.append(el("strong", label), el("span", hint, { class: "muted small" }));
    grid.append(b);
  };
  button("Add to Google Calendar", "Opens a prefilled event with them as a guest. Save it to send the invite.", () => open(googleCalendarUrl(meeting, ctx())));
  button("Add to Outlook", "Outlook.com (personal) calendar, prefilled.", () => open(outlookUrl(meeting, ctx(), "live")));
  button("Add to Outlook (work/school)", "Microsoft 365 calendar, prefilled.", () => open(outlookUrl(meeting, ctx(), "office")));
  button("Gmail draft", "A new email with your message.", () => open(gmailUrl(meeting, ctx())));
  button("Email app", "Your default mail app (mailto).", () => { window.location.href = mailtoUrl(meeting, ctx()); });
  button("Download .ics", "A calendar file for any calendar app.", () =>
    download(new TextEncoder().encode(icsFile(meeting, ctx())), `${meeting.type || "meeting"}-${meeting.person}.ics`
      .replace(/[^\w.-]+/g, "-").toLowerCase(), "text/calendar"));
  body.append(grid, el("p", "Orbit never sends anything itself. You'll always review and click send or save.",
                        { class: "muted small" }));
  const buttons = [{ label: "Copy message", value: "copy" }, { label: "Done", value: "", primary: true }];
  if (onEdit) buttons.unshift({ label: "Edit meeting", value: "edit", left: true });
  if (onOpen) buttons.unshift({ label: "Open their details", value: "open", left: true });
  const v = await ask("Add to calendar & invite", body, buttons);
  if (v === "copy") {
    try { await navigator.clipboard.writeText(message.value); toast("Message copied."); } catch { toast("Couldn't copy."); }
  } else if (v === "open") onOpen();
  else if (v === "edit") onEdit();
}

// ---- tasks --------------------------------------------------------------------------------

/** Add or edit a task. Resolves with { action: "save", task } | { action: "delete" } | null. */
export async function taskForm({ model, task, person = "", date = "" }) {
  const editing = !!task;
  const t = task ?? { id: newId("t"), task: "", person, company: "", due: date, done: false, created: todayIso(), source: "" };
  const body = el("div", undefined, { class: "form" });
  const text = el("input", undefined, { name: "task", required: true, value: t.task, placeholder: "e.g. Send resume to Jordan" });
  const who = el("input", undefined, { name: "person", value: t.person, autocomplete: "off", placeholder: "Optional" });
  attachTypeahead(who, "person");
  const company = el("input", undefined, { name: "company", value: t.company, autocomplete: "off", placeholder: "Optional" });
  attachTypeahead(company, "company");
  who.addEventListener("change", () => { if (!company.value) company.value = findPerson(model, who.value)?.company ?? ""; });
  const due = el("input", undefined, { type: "date", name: "due", value: t.due });
  const row = el("div", undefined, { class: "row2" });
  row.append(field("Person", who), field("Company", company));
  body.append(field("Task", text), row, field("Due", due));
  const buttons = [{ label: "Cancel", value: "" }, { label: editing ? "Save" : "Add task", value: "save", primary: true }];
  if (editing) buttons.unshift({ label: "Delete", value: "delete", danger: true, left: true });
  const choice = await ask(editing ? "Edit task" : "Add a task", body, buttons);
  if (choice === "delete") return { action: "delete" };
  if (choice !== "save" || !text.value.trim()) return null;
  return { action: "save", task: { ...t, task: text.value.trim(), person: findPerson(model, who.value)?.name ?? who.value.trim(),
                                    company: company.value.trim(), due: due.value } };
}

// ---- people -------------------------------------------------------------------------------

/** "Edit all": every field in one form. Resolves with the changed fields, or null. */
export async function personForm({ model, person }) {
  const body = el("div", undefined, { class: "form" });
  const input = (name, value, attrs = {}) => el("input", undefined, { name, value: value ?? "", autocomplete: "off", ...attrs });
  const fields = {
    name: input("name", person.name, { required: true }),
    role: input("role", person.role),
    company: input("company", person.company),
    school: input("school", person.school, { placeholder: "e.g. BYU (2022–2026); Lakeview High" }),
    pastCompanies: input("pastCompanies", person.pastCompanies, { placeholder: "e.g. Deloitte (2019–2021)" }),
    email: input("email", person.email, { type: "email" }),
    linkedinUrl: input("linkedinUrl", person.linkedinUrl, { type: "url", placeholder: "https://www.linkedin.com/in/…" }),
    connectedThrough: input("connectedThrough", person.connectedThrough, { placeholder: "Blank = you know them directly" }),
    // (Other connections — coworker, classmate, friend, mentor — are added in the Connections section.)
    connectedOn: input("connectedOn", person.connectedOn, { type: "date" }),
    status: select("status", [["", "No status"], ...STATUSES.map(x => [x, x])], person.status),
    tags: input("tags", person.tags.join(", "), { placeholder: "Comma-separated" }),
    notes: el("textarea", undefined, { name: "notes", rows: 4, value: person.notes }),
  };
  attachTypeahead(fields.connectedThrough, "person");
  attachTypeahead(fields.company, "company");
  attachTypeahead(fields.role, "role");
  attachTypeahead(fields.school, "school", { multi: true });
  attachTypeahead(fields.pastCompanies, "company", { multi: true });
  attachTypeahead(fields.tags, "tag", { multi: true });
  const two = (a, b) => { const r = el("div", undefined, { class: "row2" }); r.append(a, b); return r; };
  body.append(
    el("div", "Basics", { class: "form-section" }), field("Name", fields.name), two(field("Role", fields.role), field("Company", fields.company)),
    two(field("Email", fields.email), field("LinkedIn", fields.linkedinUrl)),
    el("div", "Connection", { class: "form-section" }), two(field("Schools", fields.school), field("Past companies", fields.pastCompanies)),
    field("Introduced by", fields.connectedThrough, "Who introduced you? Coworker/classmate/friend/mentor links are in Connections."),
    two(field("Connected on", fields.connectedOn), field("Status", fields.status)),
    el("div", "Notes", { class: "form-section" }), field("Tags", fields.tags), field("Notes", fields.notes));
  const choice = await ask(`Edit ${person.name}`, body, [{ label: "Cancel", value: "" }, { label: "Save", value: "save", primary: true }]);
  if (choice !== "save" || !fields.name.value.trim()) return null;
  const out = {};
  for (const [k, f] of Object.entries(fields)) {
    const v = f.value.trim();
    const before = k === "tags" ? person.tags.join(", ") : person[k] ?? "";
    if (v !== before) out[k] = v;
  }
  return out;
}

// ---- settings -----------------------------------------------------------------------------

/** Resolves with { me, avatarStyle, settings } or null. */
export async function settingsForm({ model, demo, calendar, onProfile, onReplayIntro }) {
  const s = model.settings;
  const body = el("div", undefined, { class: "form" });
  const me = el("input", undefined, { value: model.me, autocomplete: "name" });
  const email = el("input", undefined, { type: "email", value: s.email, autocomplete: "email" });
  const length = el("input", undefined, { type: "number", min: 5, max: 240, step: 5, value: s.meetingLength });
  const zoom = el("input", undefined, { type: "url", value: s.zoomLink, placeholder: "https://zoom.us/my/your-name" });
  const template = el("textarea", undefined, { rows: 3, value: s.inviteTemplate });
  const avatars = el("input", undefined, { type: "checkbox", checked: model.avatarStyle === "notionists" });
  const avatarLabel = el("label", undefined, { class: "check" });
  avatarLabel.append(avatars, " Illustrated avatars (DiceBear) for people without a photo");
  const two = (a, b) => { const r = el("div", undefined, { class: "row2" }); r.append(a, b); return r; };
  if (demo) body.append(el("p", "You're in the demo, so these only change the in-browser demo copy.", { class: "muted small" }));
  if (onProfile) {
    const row = el("div", undefined, { class: "quick-links" });
    row.append(el("button", "Edit my profile…", { class: "btn small", type: "button", onclick: () => {
      document.getElementById("dialog").close(""); onProfile(); } }),
      el("span", "Your photo, schools, past jobs and what you're looking for.", { class: "muted small" }));
    if (onReplayIntro) row.append(el("button", "Replay intro", { class: "btn small", type: "button", style: "margin-left:auto",
      onclick: () => { document.getElementById("dialog").close(""); onReplayIntro(); } }));
    body.append(row);
  }
  body.append(two(field("Your name", me), field("Your email", email, "Used as the organizer in .ics invites.")),
              two(field("Default meeting length (min)", length), field("Zoom link", zoom, "Your personal room or scheduling link.")),
              field("Invite message", template, "Placeholders: {first name}, {name}, {date}, {time}, {link}, {my name}"),
              avatarLabel);

  // Calendar connection (optional): sync meetings and show your events.
  if (calendar) {
    const box = el("div", undefined, { class: "calendar-connect" });
    box.append(el("div", "Calendar", { class: "form-section" }));
    const st = calendar.status();
    if (demo) {
      box.append(el("p", "In the demo, use the Add to Google Calendar / Outlook / .ics buttons on any meeting. " +
                         "With your own data you can connect your calendar here.", { class: "muted small" }));
      const row = el("div", undefined, { class: "quick-links" });
      row.append(el("button", "Connect your own calendar", { class: "btn small", type: "button", disabled: true,
                                                              title: "Open your own workbook to connect a calendar" }));
      box.append(row);
    } else if (st.provider) {
      box.append(el("p", `Connected: ${st.provider === "google" ? "Google Calendar" : "Outlook"} (${st.account}). ` +
                         "New and edited meetings sync there and invites are sent; your events show in the Calendar tab.",
                    { class: "source-note ok" }));
      box.append(el("button", "Disconnect", { class: "btn small danger", type: "button", onclick: async () => {
        await calendar.disconnect(); toast("Calendar disconnected."); document.getElementById("dialog").close("");
      } }));
    } else {
      box.append(el("p", "Optional: connect to create/update/cancel events and send invites automatically, and see your own events. " +
                         "Sign-in stays in this browser tab.", { class: "muted small" }));
      const row = el("div", undefined, { class: "quick-links" });
      for (const [id, label, fn] of [["google", "Connect Google Calendar", calendar.connectGoogle], ["outlook", "Connect Outlook", calendar.connectOutlook]]) {
        row.append(el("button", label, { class: "btn small", type: "button", disabled: !st.configured[id],
          title: st.configured[id] ? "" : "Needs a client ID in site/config.js (see docs/CALENDAR_SETUP.md)",
          onclick: async () => {
            try { await fn(); toast(`${label.replace("Connect ", "")} connected.`); document.getElementById("dialog").close(""); }
            catch (e) { toast(e.message, 8000); }
          } }));
      }
      box.append(row);
      if (!st.configured.google && !st.configured.outlook) {
        box.append(el("p", "Not set up on this site yet: add a Google or Microsoft client ID to site/config.js (docs/CALENDAR_SETUP.md).",
                      { class: "muted small" }));
      }
    }
    body.append(box);
  }
  const choice = await ask("Settings", body, [{ label: "Cancel", value: "" }, { label: "Save", value: "save", primary: true }]);
  if (choice !== "save") return null;
  return { me: me.value.trim(), avatarStyle: avatars.checked ? "notionists" : "initials",
           settings: { email: email.value.trim(), meetingLength: Number(length.value) || 30, zoomLink: zoom.value.trim(),
                       inviteTemplate: template.value.trim() || s.inviteTemplate } };
}
