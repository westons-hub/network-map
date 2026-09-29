// Meetings, tasks and invites: pure logic, no DOM. Dates are 'YYYY-MM-DD' strings and
// times 'HH:MM' (local time), the same as in the workbook.
//
// The app never sends anything itself. These helpers only build links and files that
// you open, save or send yourself.

import { normalizeName } from "./org.js";
import { personKey } from "./people.js";

// ---- dates ------------------------------------------------------------------------

const pad = n => String(n).padStart(2, "0");
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = (now = new Date()) => isoDate(now);
export const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 'YYYY-MM-DD' (+ 'HH:MM') -> a local Date. */
export function toDate(date, time = "00:00") {
  const [y, m, d] = String(date).split("-").map(Number);
  const [h, mi] = String(time || "00:00").split(":").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, h || 0, mi || 0);
}

export function addDays(date, n) {
  const d = toDate(date);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86_400_000);

export function addMinutes(time, minutes) {
  const d = toDate("2000-01-01", time);
  d.setMinutes(d.getMinutes() + Number(minutes || 0));
  return hhmm(d);
}

export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");

/** A short unique ID for new meetings and tasks (made in the UI so edits replay exactly). */
export const newId = prefix => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---- meetings ----------------------------------------------------------------------

const samePerson = (a, b) => normalizeName(a) === normalizeName(b);

export function meetingsFor(model, name) {
  return model.meetings.filter(m => samePerson(m.person, name))
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
}

const isUpcoming = (m, now) => {
  const today = todayIso(now);
  return m.date > today || (m.date === today && (m.start || "23:59") >= hhmm(now));
};

/** Meeting Date for a person: the next scheduled meeting, or the most recent one if nothing is scheduled. */
export function meetingDate(model, name, now = new Date()) {
  const list = meetingsFor(model, name).filter(m => isDate(m.date));
  const next = list.find(m => isUpcoming(m, now));
  return next ? { meeting: next, upcoming: true } : list.length ? { meeting: list.at(-1), upcoming: false } : null;
}

/**
 * The edits one meeting causes: save it, update the person's status (Scheduled if it's upcoming,
 * Met once it has happened), and add a "Send thank-you" task for the day after (once per meeting).
 */
export function meetingOps(model, meeting, now = new Date()) {
  const ops = [{ type: "upsertMeeting", meeting }];
  const person = model.people.find(p => samePerson(p.name, meeting.person));
  if (person) {
    const status = isUpcoming(meeting, now) ? "Scheduled" : "Met";
    if (person.status !== status) ops.push({ type: "patchPerson", key: personKey(person), fields: { status } });
  }
  const source = `thanks:${meeting.id}`;
  if (meeting.person && isDate(meeting.date) && !model.tasks.some(t => t.source === source)) {
    ops.push({ type: "upsertTask", task: { id: `t-${meeting.id}`, task: `Send thank-you to ${meeting.person} within 24 hrs`,
      person: meeting.person, company: person?.company ?? "", due: addDays(meeting.date, 1), done: false,
      created: todayIso(now), source } });
  }
  return ops;
}

// ---- tasks ------------------------------------------------------------------------------

/** Overdue / Today / This Week / Later / Done (no due date counts as Later). Sorted by due date. */
export function groupTasks(tasks, today = todayIso()) {
  const weekEnd = addDays(today, 7);
  const groups = { overdue: [], today: [], week: [], later: [], done: [] };
  for (const t of [...tasks].sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.task.localeCompare(b.task))) {
    if (t.done) groups.done.push(t);
    else if (!isDate(t.due)) groups.later.push(t);
    else if (t.due < today) groups.overdue.push(t);
    else if (t.due === today) groups.today.push(t);
    else if (t.due <= weekEnd) groups.week.push(t);
    else groups.later.push(t);
  }
  return groups;
}

/** The To-Do tab badge: overdue + due today. */
export const taskBadge = (tasks, today = todayIso()) =>
  tasks.filter(t => !t.done && isDate(t.due) && t.due <= today).length;

export const tasksFor = (model, name) => model.tasks.filter(t => samePerson(t.person, name));

// ---- calendar -----------------------------------------------------------------------------

/** Everything to show between two dates (inclusive): meetings and task due dates. */
export function calendarItems(model, from, to, today = todayIso()) {
  const items = [];
  for (const m of model.meetings) {
    if (!isDate(m.date) || m.date < from || m.date > to) continue;
    items.push({ kind: "meeting", date: m.date, time: m.start, title: `${m.type || "Meeting"}: ${m.person}`,
                 person: m.person, id: m.id, past: m.date < today });
  }
  for (const t of model.tasks) {
    if (!isDate(t.due) || t.due < from || t.due > to) continue;
    items.push({ kind: t.done ? "done" : t.due < today ? "overdue" : "task", date: t.due, time: "",
                 title: t.task, person: t.person, id: t.id });
  }
  return items.sort((a, b) => `${a.date} ${a.time || "99"}`.localeCompare(`${b.date} ${b.time || "99"}`));
}

/** The 6-week grid (Monday first) that contains a month. */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return isoDate(d); });
}

export function weekDays(date) {
  const d = toDate(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return isoDate(x); });
}

// ---- invites ------------------------------------------------------------------------------

const firstName = name => String(name ?? "").trim().split(/\s+/)[0] ?? "";

export function meetingTitle(meeting, me) {
  return `${meeting.type || "Meeting"}: ${firstName(me) || "Me"} & ${firstName(meeting.person)}`;
}

function prettyDate(date) {
  return toDate(date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
function prettyTime(time) {
  return toDate("2000-01-01", time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Fill the editable invite message: {first name}, {name}, {date}, {time}, {link}, {my name}. */
export function fillTemplate(template, { meeting, me }) {
  const values = { "first name": firstName(meeting.person), name: meeting.person, date: prettyDate(meeting.date),
                   time: prettyTime(meeting.start), link: meeting.link || "", "my name": me || "" };
  return String(template).replace(/\{([a-z ]+)\}/gi, (whole, key) => values[key.toLowerCase()] ?? whole).trim();
}

const utcStamp = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const startEnd = m => [toDate(m.date, m.start), toDate(m.date, m.end || addMinutes(m.start, 30))];
const location = m => m.link || m.method || "";

/** Google Calendar "create event" link. Saving it there adds the event and emails the guest. */
export function googleCalendarUrl(meeting, { me, email, message }) {
  const [start, end] = startEnd(meeting);
  const q = new URLSearchParams({ action: "TEMPLATE", text: meetingTitle(meeting, me),
    dates: `${utcStamp(start)}/${utcStamp(end)}`, details: message, location: location(meeting) });
  if (email) q.set("add", email);
  return `https://calendar.google.com/calendar/render?${q}`;
}

/** Outlook compose-event deeplink: "live" = Outlook.com, "office" = work/school Microsoft 365. */
export function outlookUrl(meeting, { me, email, message }, kind = "live") {
  const [start, end] = startEnd(meeting);
  const q = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: meetingTitle(meeting, me),
    startdt: start.toISOString(), enddt: end.toISOString(), body: message, location: location(meeting) });
  if (email) q.set("to", email);
  return `https://outlook.${kind === "office" ? "office" : "live"}.com/calendar/0/deeplink/compose?${q}`;
}

export function gmailUrl(meeting, { me, email, message }) {
  const q = new URLSearchParams({ view: "cm", fs: "1", to: email || "", su: meetingTitle(meeting, me), body: message });
  return `https://mail.google.com/mail/?${q}`;
}

export function mailtoUrl(meeting, { me, email, message }) {
  const enc = encodeURIComponent;
  return `mailto:${enc(email || "")}?subject=${enc(meetingTitle(meeting, me))}&body=${enc(message)}`;
}

const icsText = s => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** RFC 5545 line folding: 75 octets max, continuation lines start with a space. */
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = "";
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ""; }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** A calendar file (.ics) with you as organizer and them as attendee. */
export function icsFile(meeting, { me, myEmail, email, message }, now = new Date()) {
  const [start, end] = startEnd(meeting);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Network Map//EN", "CALSCALE:GREGORIAN", "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${meeting.id}@network-map`, `DTSTAMP:${utcStamp(now)}`, `DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`,
    `SUMMARY:${icsText(meetingTitle(meeting, me))}`, `DESCRIPTION:${icsText(message)}`, `LOCATION:${icsText(location(meeting))}`,
    ...(myEmail ? [`ORGANIZER;CN=${icsText(me || myEmail)}:mailto:${myEmail}`] : []),
    ...(email ? [`ATTENDEE;CN=${icsText(meeting.person)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`] : []),
    "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ---- demo ------------------------------------------------------------------------------------

/** Keep the demo's meetings and tasks around today: shift every date by (today - base date). */
export function shiftDemoDates(model, today = todayIso()) {
  const base = model.settings?.demoBaseDate;
  if (!isDate(base)) return model;
  const days = daysBetween(base, today);
  if (!days) return model;
  const shift = d => (isDate(d) ? addDays(d, days) : d);
  return {
    ...model,
    settings: { ...model.settings, demoBaseDate: today },
    meetings: model.meetings.map(m => ({ ...m, date: shift(m.date) })),
    tasks: model.tasks.map(t => ({ ...t, due: shift(t.due), created: shift(t.created) })),
  };
}
