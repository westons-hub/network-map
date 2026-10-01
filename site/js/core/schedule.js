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
 * "Keep In Contact" people get a check-in task every N days (Settings: Check-in every), counted from your last
 * contact: their latest past meeting, Last Contacted, Date Reached Out, or the last check-in you finished. One open
 * check-in per person at a time. Returns the upsertTask ops to add (none if everything's already there).
 */
export function checkInOps(model, today = todayIso()) {
  const days = Number(model.settings?.checkInDays) || 60;
  const ops = [];
  for (const p of model.people) {
    const plan = Object.entries(p.extra ?? {}).find(([k]) => k.toLowerCase() === "relationship plan")?.[1];
    if (String(plan ?? "").trim().toLowerCase() !== "keep in contact") continue;
    const source = `checkin:${personKey(p)}`;
    const mine = (model.tasks ?? []).filter(t => t.source === source);
    if (mine.some(t => !t.done)) continue;
    const extra = k => Object.entries(p.extra ?? {}).find(([h]) => h.toLowerCase() === k)?.[1] ?? "";
    const dates = [...meetingsFor(model, p.name).map(m => m.date).filter(d => isDate(d) && d <= today),
                   extra("last contacted"), extra("date reached out"), ...mine.map(t => t.due)].filter(isDate).sort();
    const last = dates.at(-1) ?? today;
    ops.push({ type: "upsertTask", task: { id: `t-checkin-${personKey(p).replace(/\W+/g, "-")}-${last}`, task: `Check in with ${firstName(p.name)}`,
      person: p.name, company: p.company, due: addDays(last, days), done: false, created: today, source, extra: {} } });
  }
  return ops;
}

/** The automatic tasks' wording (a task still worded like this hasn't been edited). */
export const thankYouText = person => `Send thank-you to ${person} within 24 hrs`;
export const prepText = meeting => `Prepare questions for ${(meeting.type || "meeting").toLowerCase()} with ${firstName(meeting.person)}`;

/**
 * The not-done tasks made for a meeting (source "thanks:<meeting id>" or "prep:<meeting id>"), split into ones you
 * haven't touched (still the automatic wording and date) and ones you've edited. Deleting the meeting removes the
 * first kind and asks about the second.
 */
export function meetingTasks(model, meeting) {
  const linked = (model.tasks ?? []).filter(t => !t.done && /^(thanks|prep):/.test(t.source ?? "") && t.source.slice(t.source.indexOf(":") + 1) === meeting.id);
  const untouched = t => (t.source.startsWith("thanks:") ? t.task === thankYouText(meeting.person) && t.due === addDays(meeting.date, 1)
                                                          : t.task === prepText(meeting));
  return { untouched: linked.filter(untouched), edited: linked.filter(t => !untouched(t)) };
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
    ops.push({ type: "upsertTask", task: { id: `t-${meeting.id}`, task: thankYouText(meeting.person),
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

/** "Coffee Chat" -> "Coffee chat: Alex Rivera ↔ Priya Shah" (a title you typed wins). */
export function meetingTitle(meeting, me) {
  if (meeting.title) return meeting.title;
  const type = meeting.type ? meeting.type.charAt(0) + meeting.type.slice(1).toLowerCase() : "Meeting";
  return `${type}: ${me || "Me"} ↔ ${meeting.person}`;
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

// ---- time zones ---------------------------------------------------------------------------

export const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

/** A wall-clock date + time in a time zone -> the real instant (a Date). Without a zone, this computer's zone. */
export function zonedDate(date, time, zone) {
  const local = toDate(date, time);
  if (!zone || zone === localZone()) return local;
  // Guess the instant as if the wall clock were UTC, then correct by the zone's offset at that instant (twice, for DST edges).
  const [y, mo, d] = date.split("-").map(Number), [h, mi] = (time || "00:00").split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall;
  for (let i = 0; i < 2; i++) t = wall - zoneOffset(zone, new Date(t));
  return new Date(t);
}
function zoneOffset(zone, at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at).map(p => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// ---- invites ------------------------------------------------------------------------------

const utcStamp = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export const meetingInstants = m => [zonedDate(m.date, m.start, m.timeZone), zonedDate(m.date, m.end || addMinutes(m.start, 30), m.timeZone)];
const startEnd = meetingInstants;
const location = m => m.location || m.link || m.method || "";

/** Everyone to invite: the guests list ("a@x.com; b@y.com"), or the email passed in. */
export function guestList(meeting, ctx = {}) {
  const fromMeeting = String(meeting.guests ?? "").split(/[;,\s]+/).filter(e => e.includes("@"));
  const extra = [ctx.email, ...(ctx.guests ?? [])].filter(e => e && e.includes("@"));
  return [...new Set([...fromMeeting, ...extra].map(e => e.trim()))];
}

/** Google Calendar "create event" link. Saving it there adds the event and emails the guests. */
export function googleCalendarUrl(meeting, ctx) {
  const [start, end] = startEnd(meeting);
  const q = new URLSearchParams({ action: "TEMPLATE", text: meetingTitle(meeting, ctx.me),
    dates: `${utcStamp(start)}/${utcStamp(end)}`, details: ctx.message, location: location(meeting) });
  if (meeting.timeZone) q.set("ctz", meeting.timeZone);
  const guests = guestList(meeting, ctx);
  if (guests.length) q.set("add", guests.join(","));
  return `https://calendar.google.com/calendar/render?${q}`;
}

/** Outlook compose-event deeplink: "live" = Outlook.com, "office" = work/school Microsoft 365. */
export function outlookUrl(meeting, ctx, kind = "live") {
  const [start, end] = startEnd(meeting);
  const q = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: meetingTitle(meeting, ctx.me),
    startdt: start.toISOString(), enddt: end.toISOString(), body: ctx.message, location: location(meeting) });
  const guests = guestList(meeting, ctx);
  if (guests.length) q.set("to", guests.join(","));
  return `https://outlook.${kind === "office" ? "office" : "live"}.com/calendar/0/deeplink/compose?${q}`;
}

export function gmailUrl(meeting, ctx) {
  const q = new URLSearchParams({ view: "cm", fs: "1", to: guestList(meeting, ctx).join(","), su: meetingTitle(meeting, ctx.me), body: ctx.message });
  return `https://mail.google.com/mail/?${q}`;
}

export function mailtoUrl(meeting, ctx) {
  const enc = encodeURIComponent;
  return `mailto:${guestList(meeting, ctx).map(enc).join(",")}?subject=${enc(meetingTitle(meeting, ctx.me))}&body=${enc(ctx.message)}`;
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

/** A calendar file (.ics) with you as organizer, the guests as attendees, and the reminder. */
export function icsFile(meeting, ctx, now = new Date()) {
  const { me, myEmail, message } = ctx;
  const [start, end] = startEnd(meeting);
  const people = new Map((ctx.names ?? []).map(([email, name]) => [email.toLowerCase(), name]));
  const guests = guestList(meeting, ctx);
  const reminder = Number(meeting.reminder);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Orbit//EN", "CALSCALE:GREGORIAN", "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${meeting.id}@network-map`, `DTSTAMP:${utcStamp(now)}`, `DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`,
    `SUMMARY:${icsText(meetingTitle(meeting, me))}`, `DESCRIPTION:${icsText(message)}`, `LOCATION:${icsText(location(meeting))}`,
    ...(myEmail ? [`ORGANIZER;CN=${icsText(me || myEmail)}:mailto:${myEmail}`] : []),
    ...guests.map((email, i) => `ATTENDEE;CN=${icsText(people.get(email.toLowerCase()) ?? (i === 0 && ctx.email === email ? meeting.person : email))};` +
                                `ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`),
    "STATUS:CONFIRMED",
    ...(reminder > 0 ? ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(meetingTitle(meeting, me))}`, `TRIGGER:-PT${reminder}M`, "END:VALARM"] : []),
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ---- demo ------------------------------------------------------------------------------------

/**
 * Keep the demo current: every date in it is stored relative to its "Demo base date", so shift them all by
 * (today - base date) — meetings, tasks, Connected On and other dates for people and the LinkedIn pool.
 */
export function shiftDemoDates(model, today = todayIso()) {
  const base = model.settings?.demoBaseDate;
  if (!isDate(base)) return model;
  const days = daysBetween(base, today);
  if (!days) return model;
  const shift = d => (isDate(d) ? addDays(d, days) : d);
  return {
    ...model,
    settings: { ...model.settings, demoBaseDate: today },
    // Dates in people's own columns (Date Reached Out, Last Contacted…) move too.
    people: model.people.map(p => ({ ...p, connectedOn: shift(p.connectedOn),
      extra: Object.fromEntries(Object.entries(p.extra ?? {}).map(([k, v]) => [k, shift(v)])) })),
    pool: model.pool.map(e => Object.fromEntries(Object.entries(e).map(([k, v]) =>
      [k, k === "connectedOn" || k === "invitedOn" || k === "lastContacted" ? shift(v) : v]))),
    meetings: model.meetings.map(m => ({ ...m, date: shift(m.date) })),
    tasks: model.tasks.map(t => ({ ...t, due: shift(t.due), created: shift(t.created) })),
  };
}

/**
 * Saved demo edits carry real dates (a meeting you added "tomorrow"). When you come back days later, shift every
 * date inside them by the days since they were saved, so they keep the same place relative to today.
 */
export function shiftOps(ops, days) {
  if (!days) return ops;
  const shift = d => (isDate(d) ? addDays(d, days) : d);
  return ops.map(op => {
    switch (op.type) {
      case "upsertMeeting": return { ...op, meeting: { ...op.meeting, date: shift(op.meeting.date) } };
      case "upsertTask": return { ...op, task: { ...op.task, due: shift(op.task.due), created: shift(op.task.created) } };
      case "upsertPerson": return { ...op, person: { ...op.person, connectedOn: shift(op.person.connectedOn) } };
      case "patchPerson": return "connectedOn" in (op.fields ?? {}) ? { ...op, fields: { ...op.fields, connectedOn: shift(op.fields.connectedOn) } } : op;
      default: return op;
    }
  });
}

/** Demo edits as saved in the browser: { savedOn, ops } (older saves were a bare array). Returns ops for today. */
export function demoEditsForToday(saved, today = todayIso()) {
  if (!saved) return [];
  if (Array.isArray(saved)) return saved;
  return shiftOps(saved.ops ?? [], isDate(saved.savedOn) ? daysBetween(saved.savedOn, today) : 0);
}
