// Meetings, tasks, calendar and invites.

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOp, replay } from "../site/js/core/ops.js";
import { makePerson } from "../site/js/core/people.js";
import {
  addDays, addMinutes, calendarItems, fillTemplate, gmailUrl, googleCalendarUrl, groupTasks, icsFile, mailtoUrl,
  demoEditsForToday, meetingDate, meetingOps, monthGrid, outlookUrl, shiftDemoDates, shiftOps, taskBadge, toDate, weekDays,
} from "../site/js/core/schedule.js";
import { emptyModel, readWorkbook, writeWorkbook } from "../site/js/core/workbook.js";
import { readFileSync } from "node:fs";

const NOW = new Date(2026, 8, 28, 12, 0); // Mon Sep 28 2026, noon
const model = () => ({ ...emptyModel("Alex Rivera"),
  people: [makePerson({ name: "Priya Shah", company: "Deloitte", email: "priya@example.com", status: "Contacted" }),
           makePerson({ name: "Noah Carter", status: "Scheduled" })] });
const meeting = (over = {}) => ({ id: "m1", person: "Priya Shah", date: "2026-09-30", start: "10:00", end: "10:30",
  type: "Coffee Chat", method: "Zoom", link: "https://zoom.us/j/0000000000", notes: "", nextStep: "", eventId: "", ...over });

test("date helpers", () => {
  assert.equal(addDays("2026-09-28", 5), "2026-10-03");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addMinutes("09:45", 30), "10:15");
  assert.equal(monthGrid(2026, 8)[0], "2026-08-31"); // Monday before Sep 1
  assert.equal(monthGrid(2026, 8).length, 42);
  assert.deepEqual([weekDays("2026-10-01")[0], weekDays("2026-10-01")[6]], ["2026-09-28", "2026-10-04"]);
});

test("scheduling an upcoming meeting: saved, status Scheduled, thank-you task the next day", () => {
  const m = model();
  const ops = meetingOps(m, meeting(), NOW);
  assert.deepEqual(ops.map(o => o.type), ["upsertMeeting", "patchPerson", "upsertTask"]);
  const after = replay(m, ops);
  assert.equal(after.people[0].status, "Scheduled");
  assert.equal(after.meetings.length, 1);
  assert.deepEqual([after.tasks[0].task, after.tasks[0].due, after.tasks[0].company],
                   ["Send thank-you to Priya Shah within 24 hrs", "2026-10-01", "Deloitte"]);
  // Editing the same meeting doesn't add a second thank-you task.
  assert.equal(meetingOps(after, meeting({ notes: "moved" }), NOW).filter(o => o.type === "upsertTask").length, 0);
});

test("logging a past meeting sets status to Met", () => {
  const after = replay(model(), meetingOps(model(), meeting({ date: "2026-09-25", person: "Noah Carter" }), NOW));
  assert.equal(after.people[1].status, "Met");
});

test("Meeting Date is the next scheduled meeting, else the most recent one", () => {
  let m = model();
  m = applyOp(m, { type: "upsertMeeting", meeting: meeting({ id: "a", date: "2026-09-01" }) });
  m = applyOp(m, { type: "upsertMeeting", meeting: meeting({ id: "b", date: "2026-09-20" }) });
  assert.deepEqual(meetingDate(m, "priya shah", NOW), { meeting: m.meetings[1], upcoming: false });
  m = applyOp(m, { type: "upsertMeeting", meeting: meeting({ id: "c", date: "2026-10-05" }) });
  assert.equal(meetingDate(m, "Priya Shah", NOW).meeting.id, "c");
  assert.equal(meetingDate(m, "Nobody", NOW), null);
});

test("tasks group into Overdue / Today / This Week / Later / Done, with a badge", () => {
  const t = (id, due, done = false) => ({ id, task: id, due, done });
  const tasks = [t("late", "2026-09-20"), t("now", "2026-09-28"), t("soon", "2026-10-02"), t("far", "2026-11-01"),
                 t("undated", ""), t("finished", "2026-09-01", true)];
  const g = groupTasks(tasks, "2026-09-28");
  assert.deepEqual(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map(x => x.id)])),
    { overdue: ["late"], today: ["now"], week: ["soon"], later: ["far", "undated"], done: ["finished"] });
  assert.equal(taskBadge(tasks, "2026-09-28"), 2);
});

test("calendar items include meetings and task due dates in range", () => {
  const m = { ...model(), meetings: [meeting()], tasks: [{ id: "t", task: "Call", due: "2026-09-29", done: false },
                                                         { id: "u", task: "Old", due: "2026-09-01", done: false }] };
  const items = calendarItems(m, "2026-09-28", "2026-10-04", "2026-09-28");
  assert.deepEqual(items.map(i => [i.kind, i.date]), [["task", "2026-09-29"], ["meeting", "2026-09-30"]]);
});

test("meetings and tasks round-trip through the workbook", () => {
  const m = replay(model(), meetingOps(model(), meeting({ notes: "Talk about, the \"APM\" role" }), NOW));
  const back = readWorkbook(writeWorkbook({ ...m, settings: { ...m.settings, zoomLink: "https://zoom.us/my/alex" } }));
  assert.deepEqual(back.meetings.map(({ extra, ...x }) => x), m.meetings.map(({ extra, ...x }) => x));
  assert.deepEqual(back.tasks.map(({ extra, ...x }) => x), m.tasks.map(({ extra, ...x }) => x));
  assert.equal(back.settings.zoomLink, "https://zoom.us/my/alex");
  assert.equal(back.settings.meetingLength, 30);
});

// ---- invites ----------------------------------------------------------------------

const ctx = () => ({ me: "Alex Rivera", email: "priya@example.com", myEmail: "alex@example.com",
                     message: fillTemplate("Hi {first name}, see you {date} at {time}. {link}", { meeting: meeting(), me: "Alex Rivera" }) });

test("invite message template", () => {
  assert.equal(ctx().message, "Hi Priya, see you Wednesday, September 30 at 10:00 AM. https://zoom.us/j/0000000000");
});

test("Google Calendar, Outlook, Gmail and mailto links carry the event and the guest", () => {
  const start = toDate("2026-09-30", "10:00").toISOString().replace(/[-:]/g, "").replace(".000", "");
  const g = new URL(googleCalendarUrl(meeting(), ctx()));
  assert.equal(g.origin + g.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(g.searchParams.get("action"), "TEMPLATE");
  assert.equal(g.searchParams.get("text"), "Coffee chat: Alex Rivera ↔ Priya Shah");
  assert.equal(g.searchParams.get("dates").split("/")[0], start);
  assert.equal(g.searchParams.get("add"), "priya@example.com");
  assert.match(g.searchParams.get("details"), /zoom\.us/);
  assert.equal(g.searchParams.get("location"), "https://zoom.us/j/0000000000");

  const o = new URL(outlookUrl(meeting(), ctx(), "office"));
  assert.equal(o.host, "outlook.office.com");
  assert.equal(o.searchParams.get("to"), "priya@example.com");
  assert.equal(o.searchParams.get("startdt"), toDate("2026-09-30", "10:00").toISOString());
  assert.equal(new URL(outlookUrl(meeting(), ctx())).host, "outlook.live.com");

  const gm = new URL(gmailUrl(meeting(), ctx()));
  assert.equal(gm.searchParams.get("to"), "priya@example.com");
  assert.match(mailtoUrl(meeting(), ctx()), /^mailto:priya%40example\.com\?subject=Coffee%20chat/);
});

test(".ics file has organizer, attendee, link, UTC times, escaping and folded lines", () => {
  const ics = icsFile(meeting({ notes: "" }), { ...ctx(), message: "Line one, with; punctuation\nand a long line ".repeat(3) }, NOW);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  const unfolded = ics.replace(/\r\n /g, "");
  assert.match(unfolded, /ORGANIZER;CN=Alex Rivera:mailto:alex@example\.com/);
  assert.match(unfolded, /ATTENDEE;CN=Priya Shah;[^\r]*RSVP=TRUE:mailto:priya@example\.com/);
  assert.match(unfolded, /LOCATION:https:\/\/zoom\.us\/j\/0000000000/);
  assert.match(unfolded, /DTSTART:\d{8}T\d{6}Z/);
  assert.match(unfolded, /DESCRIPTION:Line one\\, with\\; punctuation\\nand/);
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
});

test("demo dates move with today so the demo always looks current", () => {
  const m = { ...model(), settings: { ...model().settings, demoBaseDate: "2026-09-28" },
              meetings: [meeting({ date: "2026-09-30" })], tasks: [{ id: "t", task: "x", due: "2026-09-27", created: "2026-09-20" }] };
  const s = shiftDemoDates(m, "2027-01-10");
  assert.equal(s.meetings[0].date, "2027-01-12");
  assert.equal(s.tasks[0].due, "2027-01-09");
  assert.equal(shiftDemoDates(m, "2026-09-28"), m);
});

test("the demo always has today / overdue / tomorrow / this week / next week / done, whatever the date", () => {
  const raw = readWorkbook(readFileSync(new URL("../site/demo/demo_network.xlsx", import.meta.url)));
  // Includes a month-end (Jan 31), a Monday (2027-03-01), a Sunday (2027-03-07), a leap day and a year boundary.
  for (const today of ["2026-09-28", "2027-01-31", "2027-03-01", "2027-03-07", "2028-02-29", "2027-12-31", "2030-06-15", "2025-01-01"]) {
    const m = shiftDemoDates(raw, today);
    const g = groupTasks(m.tasks, today);
    assert.ok(g.today.length >= 1, `${today}: something due today`);
    assert.ok(g.overdue.length >= 1 && g.overdue.length <= 2, `${today}: 1-2 overdue`);
    assert.ok(g.week.length >= 1, `${today}: tasks this week`);
    assert.ok(g.done.length >= 1, `${today}: done items`);
    const tomorrow = addDays(today, 1);
    assert.ok(m.meetings.some(x => x.date === tomorrow), `${today}: a meeting tomorrow`);
    assert.ok(m.meetings.some(x => x.date > tomorrow && x.date <= addDays(today, 7)), `${today}: meetings this week`);
    assert.ok(m.meetings.some(x => x.date > addDays(today, 7) && x.date <= addDays(today, 14)), `${today}: meetings next week`);
    assert.ok(m.meetings.some(x => x.date < today), `${today}: past meetings`);
    assert.ok(m.people.every(p => !p.connectedOn || p.connectedOn <= today), `${today}: connections are in the past`);
    assert.equal(taskBadge(m.tasks, today), g.today.length + g.overdue.length);
  }
});

test("saved demo edits don't go stale: reloaded a week later, their dates move with today", () => {
  const raw = readWorkbook(readFileSync(new URL("../site/demo/demo_network.xlsx", import.meta.url)));
  const day1 = "2027-03-01";
  // On day 1 you add a meeting for tomorrow and a task due today in the demo.
  const ops = [{ type: "upsertMeeting", meeting: meeting({ id: "mine", person: "Mia Chen", date: addDays(day1, 1) }) },
               { type: "upsertTask", task: { id: "t-mine", task: "Mine", person: "", due: day1, done: false, created: day1 } }];
  const saved = { savedOn: day1, ops };
  const weekLater = addDays(day1, 7);
  const m = replay(shiftDemoDates(raw, weekLater), demoEditsForToday(saved, weekLater));
  assert.equal(m.meetings.find(x => x.id === "mine").date, addDays(weekLater, 1)); // still tomorrow
  assert.equal(m.tasks.find(x => x.id === "t-mine").due, weekLater);                // still due today
  const g = groupTasks(m.tasks, weekLater);
  assert.ok(g.today.length >= 2 && g.overdue.length >= 1);
  assert.ok(m.meetings.some(x => x.date === addDays(weekLater, 1) && x.id !== "mine"), "the demo's own meeting tomorrow is still there");
  // Older saves (a bare list) still load unchanged, and "no edits" is an empty list.
  assert.deepEqual(demoEditsForToday(ops, weekLater), ops);
  assert.deepEqual(demoEditsForToday(undefined), []);
  assert.deepEqual(shiftOps(ops, 0), ops);
});

test("invites: several guests, a time zone, a reminder and a custom title", async () => {
  const { guestList, zonedDate, meetingTitle } = await import("../site/js/core/schedule.js");
  const m = meeting({ guests: "priya@example.com; sam@example.com", timeZone: "America/New_York", reminder: "15",
                      title: "Resume review with Priya" });
  assert.deepEqual(guestList(m, ctx()), ["priya@example.com", "sam@example.com"]);
  assert.equal(meetingTitle(m, "Alex Rivera"), "Resume review with Priya");
  // 10:00 in New York on Sep 30 2026 (EDT, UTC-4) is 14:00 UTC, whatever zone this computer is in.
  assert.equal(zonedDate("2026-09-30", "10:00", "America/New_York").toISOString(), "2026-09-30T14:00:00.000Z");
  assert.equal(zonedDate("2026-12-01", "10:00", "America/New_York").toISOString(), "2026-12-01T15:00:00.000Z");
  assert.equal(zonedDate("2026-09-30", "10:00", "Asia/Tokyo").toISOString(), "2026-09-30T01:00:00.000Z");
  const g = new URL(googleCalendarUrl(m, ctx()));
  assert.equal(g.searchParams.get("add"), "priya@example.com,sam@example.com");
  assert.equal(g.searchParams.get("ctz"), "America/New_York");
  assert.equal(g.searchParams.get("dates"), "20260930T140000Z/20260930T143000Z");
  assert.equal(g.searchParams.get("text"), "Resume review with Priya");
  assert.equal(new URL(gmailUrl(m, ctx())).searchParams.get("to"), "priya@example.com,sam@example.com");
  const ics = icsFile(m, ctx(), NOW).replace(/\r\n /g, "");
  assert.equal(ics.match(/^ATTENDEE/gm).length, 2);
  assert.match(ics, /BEGIN:VALARM\r\nACTION:DISPLAY\r\n.*\r\nTRIGGER:-PT15M\r\nEND:VALARM/);
  assert.match(ics, /DTSTART:20260930T140000Z/);
});

test("deleting a meeting finds its automatic tasks: untouched ones go, edited ones are asked about, done ones stay", async () => {
  const { meetingTasks, meetingOps, thankYouText } = await import("../site/js/core/schedule.js");
  const mtg = meeting({ id: "m9", person: "Priya Shah", date: "2026-10-02", type: "Coffee Chat" });
  let m = { ...model(), tasks: [] };
  for (const op of meetingOps(m, mtg, NOW)) if (op.type === "upsertTask") m.tasks.push(op.task);
  m.tasks.push({ id: "p1", task: "Prepare questions for coffee chat with Priya", person: "Priya Shah", due: "2026-10-01", done: false, source: "prep:m9" },
               { id: "p2", task: "Ask Priya about the APM program", person: "Priya Shah", due: "2026-10-01", done: false, source: "prep:m9" },
               { id: "p3", task: thankYouText("Priya Shah"), done: true, source: "thanks:m9" },
               { id: "o1", task: "Unrelated", done: false, source: "" });
  const r = meetingTasks(m, mtg);
  assert.deepEqual(r.untouched.map(t => t.id), ["t-m9", "p1"]);
  assert.deepEqual(r.edited.map(t => t.id), ["p2"]);
  m.tasks[0] = { ...m.tasks[0], due: "2026-10-05" }; // moved the thank-you: now it counts as edited
  assert.deepEqual(meetingTasks(m, mtg).edited.map(t => t.id).sort(), ["p2", "t-m9"]);
});

test("the demo's automatic tasks are linked to their meetings", async () => {
  const { meetingTasks } = await import("../site/js/core/schedule.js");
  const { readWorkbook } = await import("../site/js/core/workbook.js");
  const d = readWorkbook(readFileSync(new URL("../site/demo/demo_network.xlsx", import.meta.url)));
  const priya = d.meetings.find(x => x.person === "Priya Shah");
  assert.deepEqual(meetingTasks(d, priya).untouched.map(t => t.task), ["Prepare questions for coffee chat with Priya"]);
  const daniel = d.meetings.find(x => x.person === "Daniel Ortiz");
  assert.deepEqual(meetingTasks(d, daniel).untouched.map(t => t.task), ["Send thank-you to Daniel Ortiz within 24 hrs"]);
});
