// Meetings, tasks, calendar and invites.

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOp, replay } from "../site/js/core/ops.js";
import { makePerson } from "../site/js/core/people.js";
import {
  addDays, addMinutes, calendarItems, fillTemplate, gmailUrl, googleCalendarUrl, groupTasks, icsFile, mailtoUrl,
  meetingDate, meetingOps, monthGrid, outlookUrl, shiftDemoDates, taskBadge, toDate, weekDays,
} from "../site/js/core/schedule.js";
import { emptyModel, readWorkbook, writeWorkbook } from "../site/js/core/workbook.js";

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
  assert.equal(g.searchParams.get("text"), "Coffee Chat: Alex & Priya");
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
  assert.match(mailtoUrl(meeting(), ctx()), /^mailto:priya%40example\.com\?subject=Coffee%20Chat/);
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
