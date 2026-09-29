// The "Schedule meeting" editor, laid out like Google Calendar's event editor: title, date and time, time zone,
// guests (email chips with autocomplete from your contacts), "Add video call", location, description and a
// reminder.
//
// Sending: with no calendar connected (the default), "Send invite → Google Calendar" opens a prefilled Google
// Calendar event with your Zoom link and the guests; you click Save there and Google emails the invites.
// Outlook, a Gmail draft, your email app and a .ics file are one click away. With Google Calendar or Outlook
// connected in Settings (optional), "Send invite" creates the event and sends the invites directly.

import { normalizeName } from "../core/org.js";
import {
  addMinutes, fillTemplate, gmailUrl, googleCalendarUrl, guestList, icsFile, isDate, localZone, mailtoUrl, meetingTitle,
  newId, outlookUrl, todayIso,
} from "../core/schedule.js";
import { MEETING_TYPES } from "../core/workbook.js";
import { ask, toast } from "./dialog.js";
import { el } from "./dom.js";
import { attachTypeahead } from "./typeahead.js";

const ZONES = ["America/Los_Angeles", "America/Denver", "America/Phoenix", "America/Chicago", "America/New_York",
  "Europe/London", "Europe/Paris", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "UTC"];
const REMINDERS = [["", "No reminder"], ["5", "5 minutes before"], ["10", "10 minutes before"], ["15", "15 minutes before"],
  ["30", "30 minutes before"], ["60", "1 hour before"], ["1440", "1 day before"]];
const VIDEO = { "Zoom": "Zoom", "Google Meet": "Google Meet", "Teams": "Microsoft Teams" };
const isEmail = s => /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(s ?? "");
const minutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function field(label, input, hint) {
  const wrap = el(input.tagName === "DIV" ? "div" : "label", undefined, { class: "field" });
  wrap.append(el("span", label), input);
  if (hint) wrap.append(typeof hint === "string" ? el("span", hint, { class: "muted small" }) : hint);
  return wrap;
}
function select(options, value, attrs = {}) {
  const s = el("select", undefined, attrs);
  for (const [v, label] of options) s.append(el("option", label, { value: v, selected: v === value }));
  return s;
}
const zoneLabel = z => {
  try {
    const off = new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "short" }).formatToParts(new Date())
      .find(p => p.type === "timeZoneName")?.value;
    return `${z.replace(/_/g, " ").replace(/^.*\//, "")} (${off})`;
  } catch { return z; }
};

/** Email chips: type, pick from your contacts, Enter/comma/Tab to add, × or Backspace to remove. */
function guestChips(model, initial) {
  const box = el("div", undefined, { class: "chips-input" });
  const input = el("input", undefined, { type: "email", placeholder: "Add guests", autocomplete: "off", "aria-label": "Add guests" });
  const list = el("ul", undefined, { class: "chip-suggest", role: "listbox", hidden: true });
  const emails = [];
  const nameOf = email => model.people.find(p => p.email?.toLowerCase() === email.toLowerCase())?.name;
  const render = () => {
    box.querySelectorAll(".chip-guest").forEach(c => c.remove());
    for (const e of emails) {
      const chip = el("span", undefined, { class: "chip-guest", title: e });
      chip.append(el("span", nameOf(e) ? `${nameOf(e)}` : e),
        el("button", "×", { type: "button", "aria-label": `Remove ${e}`, onclick: () => remove(e) }));
      input.before(chip);
    }
  };
  const add = value => {
    const e = value.trim().replace(/^.*<(.+)>$/, "$1");
    if (!isEmail(e) || emails.some(x => x.toLowerCase() === e.toLowerCase())) return false;
    emails.push(e);
    render();
    box.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  const remove = e => { emails.splice(emails.indexOf(e), 1); render(); box.dispatchEvent(new Event("change", { bubbles: true })); };
  const suggest = () => {
    const q = input.value.trim().toLowerCase();
    list.replaceChildren();
    if (!q) { list.hidden = true; return; }
    const hits = model.people.filter(p => p.email && !emails.includes(p.email) &&
      (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))).slice(0, 6);
    for (const p of hits) {
      const li = el("li", undefined, { role: "option", tabIndex: -1, onmousedown: e => { e.preventDefault(); add(p.email); input.value = ""; suggest(); } });
      li.append(el("strong", p.name), el("span", ` ${p.email}`, { class: "muted" }));
      list.append(li);
    }
    list.hidden = !hits.length;
  };
  input.addEventListener("input", suggest);
  input.addEventListener("keydown", e => {
    const first = list.querySelector("li");
    if ((e.key === "Enter" || e.key === "Tab" || e.key === ",") && input.value.trim()) {
      if (!isEmail(input.value.trim()) && first && !list.hidden) { e.preventDefault(); first.dispatchEvent(new MouseEvent("mousedown")); return; }
      if (add(input.value)) { e.preventDefault(); input.value = ""; suggest(); } else if (e.key !== "Tab") e.preventDefault();
    } else if (e.key === "Backspace" && !input.value && emails.length) remove(emails.at(-1));
  });
  input.addEventListener("blur", () => { if (add(input.value)) input.value = ""; list.hidden = true; });
  box.addEventListener("click", e => { if (e.target === box) input.focus(); });
  box.append(input, list);
  for (const e of initial) add(e);
  return { box, emails, add, remove };
}

/**
 * Schedule (or edit, or log) a meeting. Resolves with
 * { action: "save", meeting, email, zoomLink, sent: "google"|"outlook"|"outlook-office"|"gmail"|"mailto"|"ics"|"connected"|"" }
 * | { action: "delete" } | { action: "open" } | null.
 * calendar: { provider: "google"|"outlook"|null } from store/calendars.js.
 */
export async function meetingForm({ model, meeting, person = "", date = "", start: startAt = "", calendar = {}, demo = false,
                                    download, canOpen = false }) {
  const editing = !!meeting;
  const s = model.settings;
  const me = model.me || "";
  const length = Number(s.meetingLength) || 30;
  const m = meeting ?? { id: newId("m"), person, date: date || todayIso(), start: startAt || "10:00",
    end: addMinutes(startAt || "10:00", length), type: "Coffee Chat", method: "Zoom", link: s.zoomLink || "", notes: "",
    nextStep: "", eventId: "", reminder: "10", timeZone: localZone() };
  const findPerson = name => model.people.find(p => normalizeName(p.name) === normalizeName(name));
  const body = el("div", undefined, { class: "form event-editor" });

  // ---- title ----
  const title = el("input", undefined, { class: "event-title", value: m.title ?? "", placeholder: "Add title", "aria-label": "Title" });
  let titleTyped = !!m.title;
  title.addEventListener("input", () => { titleTyped = !!title.value.trim(); });

  // ---- who (the person this meeting is with: drives their status and tasks) ----
  const who = el("input", undefined, { required: true, value: m.person, autocomplete: "off", placeholder: "Who are you meeting?",
                                        "aria-label": "Who" });
  attachTypeahead(who, "person");
  const type = select(MEETING_TYPES.map(t => [t, t]), m.type || "Coffee Chat", { "aria-label": "Type" });

  // ---- when ----
  const day = el("input", undefined, { type: "date", required: true, value: m.date, "aria-label": "Date" });
  const start = el("input", undefined, { type: "time", required: true, value: m.start || "10:00", "aria-label": "Start" });
  const end = el("input", undefined, { type: "time", required: true, value: m.end || addMinutes(m.start || "10:00", length), "aria-label": "End" });
  let duration = Math.max(5, minutes(end.value) - minutes(start.value)) || length;
  start.addEventListener("change", () => { end.value = addMinutes(start.value, duration); });
  end.addEventListener("change", () => { duration = Math.max(5, minutes(end.value) - minutes(start.value)); });
  const here = localZone();
  const zone = select([...new Set([m.timeZone || here, here, ...ZONES])].map(z => [z, zoneLabel(z)]), m.timeZone || here,
                      { "aria-label": "Time zone" });

  // ---- guests ----
  const firstEmail = findPerson(m.person)?.email;
  const guests = guestChips(model, [...new Set([...(firstEmail ? [firstEmail] : []), ...guestList(m)])]);
  const emailWarn = el("div", undefined, { class: "warn", hidden: true });
  const theirEmail = el("input", undefined, { type: "email", placeholder: "their@email.com", "aria-label": "Their email" });
  emailWarn.append(el("span", "No email on file for them. Add one to invite them (it's saved to their row):"), theirEmail);
  let lastWho = normalizeName(m.person);
  const onWho = () => {
    const p = findPerson(who.value);
    if (normalizeName(who.value) !== lastWho) {
      const prev = findPerson(lastWho);
      if (prev?.email && guests.emails.includes(prev.email)) guests.remove(prev.email);
      if (p?.email) guests.add(p.email);
      lastWho = normalizeName(who.value);
    }
    emailWarn.hidden = !p || !!p.email;
    refresh();
  };
  who.addEventListener("input", onWho);
  who.addEventListener("change", onWho);

  // ---- video call / place ----
  let method = m.method || "Zoom";
  let link = m.link || "";
  const callBox = el("div", undefined, { class: "call-box" });
  const zoomInput = el("input", undefined, { type: "url", placeholder: "https://zoom.us/my/your-name", "aria-label": "Your Zoom link" });
  const saveZoom = el("input", undefined, { type: "checkbox", checked: true });
  const pick = el("div", undefined, { class: "menu-list call-menu", role: "menu", hidden: true });
  const addCall = el("button", "📹 Add video call ▾", { class: "btn small", type: "button", "aria-haspopup": "true",
    onclick: e => { e.stopPropagation(); pick.hidden = !pick.hidden; } });
  const choose = v => {
    pick.hidden = true;
    if (v === "Zoom") link = s.zoomLink || (method === "Zoom" ? link : "");
    else if (VIDEO[method] && link === s.zoomLink) link = "";
    if (v === "Phone" || v === "In Person") link = /^https?:/.test(link) ? "" : link;
    method = v;
    renderCall();
    refresh();
  };
  for (const [v, label] of [["Zoom", "Zoom (your link)"], ["Google Meet", "Google Meet"], ["Teams", "Microsoft Teams"],
                            ["Phone", "📞 Phone call"], ["In Person", "📍 In person"]]) {
    pick.append(el("button", label, { type: "button", role: "menuitem", onclick: () => choose(v) }));
  }
  body.addEventListener("click", () => { pick.hidden = true; });
  function renderCall() {
    callBox.replaceChildren();
    const wrap = el("div", undefined, { class: "menu" });
    wrap.append(addCall, pick);
    if (!VIDEO[method]) { callBox.append(wrap, el("span", method === "Phone" ? "📞 Phone call" : method === "In Person" ? "📍 In person" : "", { class: "muted small" })); return; }
    const chip = el("div", undefined, { class: "call-chip" });
    chip.append(el("strong", `📹 ${VIDEO[method]}`));
    const remove = el("button", "×", { type: "button", class: "conn-remove", "aria-label": "Remove video call",
      onclick: () => { method = "Phone"; link = ""; renderCall(); refresh(); } });
    if (method === "Zoom") {
      if (s.zoomLink || link) chip.append(el("span", link || s.zoomLink, { class: "muted small call-link" }));
      else {
        zoomInput.value = link;
        zoomInput.oninput = () => { link = zoomInput.value.trim(); refresh(); };
        const save = el("label", undefined, { class: "small inline-check" });
        save.append(saveZoom, " Save as my Zoom link");
        chip.append(zoomInput, save);
      }
    } else if (method === "Google Meet") {
      chip.append(el("span", calendar.provider === "google" ? "A Meet link is created when you send."
        : link || "In Google Calendar, click \"Add Google Meet video conferencing\" before you save.", { class: "muted small" }));
    } else {
      chip.append(el("span", calendar.provider === "outlook" ? "A Teams link is created when you send."
        : link || "Paste a Teams link in Location, or connect Outlook in Settings to create one.", { class: "muted small" }));
    }
    chip.append(remove);
    callBox.append(chip);
  }
  renderCall();

  const place = el("input", undefined, { value: m.location ?? "", placeholder: "Add location (address, phone number…)", "aria-label": "Location" });

  // ---- description (your invite template, editable) ----
  const describe = () => fillTemplate(s.inviteTemplate, { meeting: current(), me });
  const description = el("textarea", undefined, { rows: 4, "aria-label": "Description" });
  let descTyped = !!m.description;
  description.value = m.description || "";
  description.addEventListener("input", () => { descTyped = true; });
  const reminder = select(REMINDERS, String(m.reminder ?? "10"), { "aria-label": "Reminder" });

  // ---- private notes ----
  const notes = el("textarea", undefined, { rows: 2, value: m.notes ?? "" });
  const next = el("input", undefined, { value: m.nextStep ?? "", placeholder: "e.g. Send resume" });
  const privateBox = el("details", undefined, { class: "event-private", open: !!(m.notes || m.nextStep) });
  privateBox.append(el("summary", "Your notes (not sent)"), field("Notes", notes), field("Next step", next));

  function current() {
    const p = findPerson(who.value);
    return { ...m, person: p?.name ?? who.value.trim(), date: day.value, start: start.value, end: end.value, type: type.value,
             method, link: method === "Zoom" && !link ? s.zoomLink || "" : link, title: titleTyped ? title.value.trim() : "",
             guests: guests.emails.join("; "), location: place.value.trim(), description: description.value.trim(),
             reminder: reminder.value, timeZone: zone.value === here ? "" : zone.value, notes: notes.value.trim(),
             nextStep: next.value.trim() };
  }
  function refresh() {
    const c = current();
    if (!titleTyped) title.placeholder = c.person ? meetingTitle({ ...c, title: "" }, me) : "Add title";
    if (!descTyped) description.value = describe();
    const future = c.date >= todayIso();
    sendBtn.hidden = !future;
    others.hidden = !future;
  }
  for (const x of [type, day, start, end, zone]) x.addEventListener("change", refresh);

  // ---- sending ----
  const ctx = () => {
    const c = current();
    return { me, myEmail: s.email, message: c.description, email: "", guests: [],
             names: model.people.filter(p => p.email).map(p => [p.email, p.name]) };
  };
  const dialog = document.getElementById("dialog");
  const ready = () => {
    if (!who.value.trim() || !isDate(day.value)) { toast("Add who you're meeting and the date first."); who.focus(); return false; }
    if (!emailWarn.hidden && isEmail(theirEmail.value.trim())) guests.add(theirEmail.value.trim());
    if (!guests.emails.length) toast("No guests yet, so the invite won't reach anyone. You can add them in the calendar too.", 6000);
    return true;
  };
  const open = url => window.open(url, "_blank", "noopener");
  const SENDERS = {
    google: ["Google Calendar", c => open(googleCalendarUrl(c, ctx()))],
    outlook: ["Outlook.com", c => open(outlookUrl(c, ctx(), "live"))],
    "outlook-office": ["Outlook (work/school)", c => open(outlookUrl(c, ctx(), "office"))],
    gmail: ["Gmail draft", c => open(gmailUrl(c, ctx()))],
    mailto: ["Email app", c => { window.location.href = mailtoUrl(c, ctx()); }],
    ics: [".ics file", c => download(new TextEncoder().encode(icsFile(c, ctx())),
      `${meetingTitle(c, me)}.ics`.replace(/[^\w.-]+/g, "-").toLowerCase(), "text/calendar")],
  };
  let sent = "";
  const send = how => {
    if (!ready()) return;
    if (how !== "connected") SENDERS[how][1](current());
    sent = how;
    dialog.close("save");
  };
  const connected = calendar.provider && !demo;
  const sendBtn = el("button", connected ? `Send invite · ${calendar.provider === "google" ? "Google Calendar" : "Outlook"}`
    : "Send invite → Google Calendar", { class: "btn primary send-invite", type: "button", onclick: () => send(connected ? "connected" : "google") });
  const others = el("div", undefined, { class: "send-others" });
  others.append(el("span", connected ? "Or open it in:" : "Or send with:", { class: "muted small" }));
  for (const key of [...(connected ? ["google"] : []), "outlook", "outlook-office", "gmail", "mailto", "ics"]) {
    others.append(el("button", SENDERS[key][0], { class: "linklike small", type: "button", onclick: () => send(key) }));
  }
  const sendRow = el("div", undefined, { class: "send-row" });
  sendRow.append(sendBtn, others);

  // ---- layout ----
  const row = (...xs) => { const r = el("div", undefined, { class: "row-flex" }); r.append(...xs); return r; };
  body.append(
    title,
    row(field("Who", who), field("Type", type)),
    row(field("Date", day), field("Start", start), field("End", end), field("Time zone", zone)),
    field("Guests", guests.box, "Their email is added for you. Add anyone else who should come."), emailWarn,
    field("Video call", callBox),
    field("Location", place),
    field("Description", description, "Your invite message from Settings, with the date, time and link filled in. Edit freely."),
    field("Reminder", reminder, "Used by .ics files and connected calendars (Google's prefilled link uses your calendar's default)."),
    privateBox, sendRow,
    el("p", connected ? "Send invite creates the event on your calendar and emails the guests."
      : "Send invite opens Google Calendar with everything filled in. Click Save there and Google emails the invites. " +
        "Orbit never sends anything by itself.", { class: "muted small" }),
  );
  onWho();
  refresh();

  const buttons = [{ label: "Cancel", value: "" }, { label: editing ? "Save" : "Save without sending", value: "save" }];
  if (editing) buttons.unshift({ label: "Delete", value: "delete", danger: true, left: true });
  if (canOpen) buttons.unshift({ label: "Open their details", value: "open", left: true });
  const choice = await ask(editing ? "Edit meeting" : "Schedule meeting", body, buttons);
  if (choice === "delete") return { action: "delete" };
  if (choice === "open") return { action: "open" };
  if (choice !== "save" || !who.value.trim() || !isDate(day.value)) return null;
  const saved = current();
  return { action: "save", meeting: saved, sent, email: !emailWarn.hidden && isEmail(theirEmail.value.trim()) ? theirEmail.value.trim() : "",
           zoomLink: method === "Zoom" && !s.zoomLink && saveZoom.checked && /^https?:\/\//.test(link) ? link : "" };
}
