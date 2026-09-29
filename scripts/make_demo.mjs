// Regenerate the demo workbook and the blank template.
//   node scripts/make_demo.mjs
// The people (names, emails, relationships) are fictional. Their headshots in site/demo/photos are
// AI-generated faces of people who don't exist (SFHQ dataset, MIT license; see site/vendor/ATTRIBUTION.md).
// The companies and schools are real, well-known organizations so the demo shows real logos: crisp SVGs in
// site/demo/logos (Simple Icons CC0 + public-domain Commons files; see SOURCES.md there).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "../site/vendor/xlsx.mjs";
import { makePerson, mergePeople, parseLinkedInCsv, personFromPool } from "../site/js/core/people.js";
import { makeConnection, reconcile } from "../site/js/core/connections.js";
import { emptyModel, writeWorkbook } from "../site/js/core/workbook.js";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..", "site");

// Name, Company, School, Role, Connected Through, Status, Tags, Notes
const PEOPLE = [
  ["Jordan Lee", "Deloitte", "Stanford University", "Senior Consultant", "", "Met", "Consulting club", "Case interview tips"],
  ["Priya Shah", "Deloitte", "University of Utah", "Manager", "", "Scheduled", "", ""],
  ["Marcus Bell", "Deloitte", "Stanford", "Analyst", "", "Met", "Consulting club", ""],
  ["Hana Kim", "Deloitte LLP", "", "Partner", "", "To Reach Out", "", "Leads the strategy practice"],
  ["Sofia Alvarez", "Microsoft", "Stanford University", "Product Manager", "", "Met", "Product", "Owns the marketplace roadmap"],
  ["Ethan Brooks", "Microsoft", "", "Data Analyst", "", "Scheduled", "Product", ""],
  ["Lena Novak", "Microsoft", "University of Utah", "Program Manager", "", "To Reach Out", "Product", ""],
  ["Noah Carter", "Delta Air Lines", "Stanford University", "Commercial Strategy Analyst", "", "Met", "", "Info session speaker"],
  ["Grace Owens", "Delta Air Lines", "", "Recruiter", "", "Scheduled", "", ""],
  ["Daniel Ortiz", "Goldman Sachs", "Stanford University", "Strategy Associate", "", "Met", "", ""],
  ["Mia Chen", "Google", "University of Utah", "Product Lead", "", "Met", "", ""],
  ["Owen Price", "Google", "University of Utah", "Associate Product Manager", "", "To Reach Out", "", ""],
  ["Ava Thompson", "Adobe", "University of Utah", "Operations Lead", "", "Met", "", ""],
  ["Liam Walsh", "Independent", "", "Founder", "", "Met", "", "Old roommate"],
  ["Rachel Green", "Deloitte", "", "Principal", "Jordan Lee", "To Reach Out", "", "Jordan offered an intro"],
  ["Tom Nguyen", "Microsoft", "", "Director of Product", "Sofia Alvarez", "To Reach Out", "Product", ""],
  ["Isla Moore", "Microsoft", "", "UX Researcher", "Sofia Alvarez", "", "Product", ""],
  ["Victor Hale", "Delta Air Lines", "", "VP Network Planning", "Noah Carter", "", "", ""],
  ["Chloe Park", "Adobe", "", "Design Manager", "Mia Chen", "", "", ""],
  ["Ben Foster", "Stanford University", "", "Career Coach", "Daniel Ortiz", "", "", ""],
  ["Zoe Adams", "Qualtrics", "", "Director of Strategy", "Liam Walsh", "", "", ""],
  ["Sam Rivera", "Qualtrics", "", "Head of Growth", "Zoe Adams", "", "", "3rd-degree example"],
];

// Company, Priority, Stage, Notes
const TARGETS = [
  ["Deloitte", "1", "Networking", "Strategy practice"],
  ["Delta Air Lines", "1", "Applied", ""],
  ["Goldman Sachs", "2", "Researching", "Three pool contacts there aren't on the map yet"],
  ["Qualtrics", "2", "Researching", "Reachable only through Liam"],
  ["Apple", "3", "Researching", "No one yet"],
  ["Nike", "3", "Researching", "No one yet"],
];

// Explicit logo domains for every organization in the demo (the demo never guesses domains).
const COMPANIES = [
  ["Deloitte", "deloitte.com", "deloitte"], ["Delta Air Lines", "delta.com", "delta"],
  ["Goldman Sachs", "goldmansachs.com", "goldman-sachs"], ["Qualtrics", "qualtrics.com", "qualtrics"],
  ["Microsoft", "microsoft.com", "microsoft"], ["Google", "google.com", "google"], ["Adobe", "adobe.com", "adobe"],
  ["Apple", "apple.com", "apple"], ["Nike", "nike.com", "nike"], ["Stanford University", "stanford.edu", "stanford"],
  ["University of Utah", "admissions.utah.edu", "university-of-utah"], // utah.edu itself has no favicon
];

// Every demo date is an offset from BASE; when the demo loads, the app shifts all of them by (today - BASE), so
// there's always something due today, a couple of overdue tasks, a meeting tomorrow, more this week and next,
// and finished items in the past. Connected On dates move the same way.
const BASE = "2026-09-28";
// [person, days from BASE, start, minutes, type, method, notes, next step]
const MEETINGS = [
  ["Liam Walsh", -30, "18:00", 60, "Coffee Chat", "In Person", "Caught up; he offered to introduce me to Zoe at Qualtrics.", "Ask Liam for the Zoe intro"],
  ["Sofia Alvarez", -20, "12:00", 30, "Coffee Chat", "In Person", "Marketplace roadmap, how PMs at Microsoft pick problems.", "Send thank-you"],
  ["Jordan Lee", -12, "16:30", 30, "Informational", "Zoom", "Walked through case interview prep and the strategy practice.", "Send resume for review"],
  ["Noah Carter", -5, "09:00", 30, "Informational", "Phone", "Delta's commercial strategy team; APM-style rotation.", "Apply to the fall rotation"],
  ["Daniel Ortiz", -2, "15:00", 30, "Coffee Chat", "Zoom", "Goldman strategy group; offered to connect me with Ben.", "Send thank-you"],
  ["Priya Shah", 1, "10:00", 30, "Coffee Chat", "Zoom", "", ""],
  ["Grace Owens", 6, "13:30", 30, "Interview", "Teams", "Recruiter screen for the Delta internship.", ""],
  ["Mia Chen", 12, "11:00", 30, "Coffee Chat", "Google Meet", "", ""],
  ["Ethan Brooks", 25, "14:00", 30, "Informational", "Zoom", "", ""],
];
// [task, person, company, due (days from BASE), done]
const TASKS = [
  ["Send thank-you to Daniel Ortiz within 24 hrs", "Daniel Ortiz", "Goldman Sachs", -1, false],
  ["Follow up with Hana Kim about the strategy practice", "Hana Kim", "Deloitte", -3, false],
  ["Send resume to Jordan for review", "Jordan Lee", "Deloitte", 0, false],
  ["Prepare questions for coffee chat with Priya", "Priya Shah", "Deloitte", 1, false],
  ["Ask Liam for the intro to Zoe Adams", "Liam Walsh", "Qualtrics", 3, false],
  ["Research Apple strategy & operations roles", "", "Apple", 9, false],
  ["Update resume with fall projects", "", "", 14, false],
  ["Send thank-you to Noah Carter within 24 hrs", "Noah Carter", "Delta Air Lines", -4, true],
  ["Send thank-you to Sofia Alvarez within 24 hrs", "Sofia Alvarez", "Microsoft", -19, true],
];
const day = n => { const d = new Date(`${BASE}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const plus = (t, min) => { const [h, m] = t.split(":").map(Number); const x = h * 60 + m + min; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };

const HOW_TO = [
  ["Sheet / column", "What to put there"],
  ["People", "Everyone on your map. Only Name is required."],
  ["  Name", "Full name, spelled the same way everywhere."],
  ["  Company / School", "3+ direct connections at one company or school become a group bubble. 'Stanford' and 'Stanford University' count as the same."],
  ["  Email", "Shown in the details panel with a copy button."],
  ["  LinkedIn URL", "Their profile link. Double-click them on the map to open it."],
  ["  Photo", "An image link, or use 'Add photo' in the app (it stores a small picture here). LinkedIn exports don't include photos."],
  ["  Connected Through", "Leave BLANK if you know them directly. Otherwise put the name of the person who connects you; they appear as a 2nd-degree connection."],
  ["  Connected On", "The date you connected (filled in from LinkedIn)."],
  ["  Status", "Met / Contacted / To Reach Out / Follow Up / Referral."],
  ["  Tags, Notes", "Anything you want to remember. Tags are comma-separated."],
  ["Targets", "Companies you want to work at. Priority (1 = highest) and Stage (Researching / Networking / Applied / Interviewing / Offer) are optional."],
  ["Companies", "Optional. Set a company's Website (e.g. byu.edu) if its logo comes out wrong, or put an image link in Logo."],
  ["LinkedIn Pool", "Filled by 'Import LinkedIn' from your Connections.csv. These people are NOT on the map until you add them."],
  ["Connections", "Who knows whom: Person A, Person B, Type (Introduced me, Coworker, Classmate, Friend, Mentor, or anything else), Notes. 'Introduced me' means A introduced you to B; it's kept in sync with People → Connected Through."],
  ["Me", "Your own profile: photo, role, schools, past companies, what you're looking for."],
  ["Meetings", "One row per meeting: Person, Date, Start, End, Type, Method, Notes, Next Step. The app fills this when you schedule or log a meeting."],
  ["Tasks", "Your to-dos: Task, Person, Company, Due, Done. Scheduling a meeting adds a 'Send thank-you' task automatically."],
  ["Settings", "Your name and email, default meeting length, your Zoom link (used in invites), the invite message, and Avatar style (initials or notionists)."],
  ["Layout", "Managed by the app (saved node positions)."],
  ["Privacy", "Network Map runs entirely in your browser. This file is never uploaded anywhere."],
];

function withHowTo(bytes) {
  const wb = XLSX.read(bytes, { type: "array", cellNF: true, cellStyles: true });
  const ws = XLSX.utils.aoa_to_sheet(HOW_TO);
  ws["!cols"] = [{ wch: 22 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, ws, "How to use");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
}

// ---- demo ----
const csv = readFileSync(join(SITE, "demo", "sample_linkedin_connections.csv"), "utf8");
const pool = parseLinkedInCsv(csv);
const people = PEOPLE.map(([name, company, school, role, connectedThrough, status, tags, notes]) =>
  makePerson({ name, company, school, role, connectedThrough, status, tags, notes,
               email: connectedThrough ? "" : `${name.toLowerCase().replace(" ", ".")}@example.com` }));
// LinkedIn data fills gaps (URL, Connected On) for people who are in the pool; your rows win.
const onMap = new Set(people.map(p => p.name));
const fromPool = pool.map(personFromPool).filter(p => onMap.has(p.name));
// You, in the center: a fictional student profile (headshot: an AI-generated face, see site/demo/photos/SOURCES.md).
const PROFILE = {
  photo: "demo/photos/alex-rivera.jpg",
  role: "MBA Candidate",
  headline: "Stanford MBA '27 · Looking for strategy & product roles",
  company: "",
  school: "Stanford University (2025–2027); University of Utah (2016–2020)",
  pastCompanies: "Delta Air Lines (2020–2022); Adobe (2022–2025)",
  email: "alex.rivera@example.com",
  linkedinUrl: "https://www.linkedin.com/in/alex-rivera-demo",
  location: "Palo Alto, California",
  lookingFor: "Summer 2027 internships in strategy or product at consumer-tech and airline companies.\n" +
              "Happy to swap notes on case prep and product sense interviews.",
};

const demo = { ...emptyModel("Alex Rivera"), avatarStyle: "notionists", profile: PROFILE,
  people: mergePeople(fromPool, people).map(p => ({ ...p, source: "",
    photo: `demo/photos/${p.name.toLowerCase().replaceAll(" ", "-")}.jpg` })),
  // Crisp vector logos stored in the repo (see site/demo/logos/SOURCES.md); the Website stays as a fallback.
  companies: COMPANIES.map(([company, website, logo]) => ({ company, website, logo: `demo/logos/${logo}.svg`, extra: {} })),
  targets: TARGETS.map(([company, priority, stage, notes]) => ({ company, priority, stage, notes, extra: {} })),
  meetings: MEETINGS.map(([person, d, start, min, type, method, notes, nextStep], i) => ({ id: `demo-m${i + 1}`, person,
    date: day(d), start, end: plus(start, min), type, method, notes, nextStep, eventId: "",
    link: method === "Zoom" ? "https://zoom.us/j/0000000000" : method === "Google Meet" ? "https://meet.google.com/abc-defg-hij" : "",
    extra: {} })),
  tasks: TASKS.map(([task, person, company, d, done], i) => ({ id: `demo-t${i + 1}`, task, person, company, due: day(d),
    done, created: day(Math.min(d, 0) - 3), source: "", extra: {} })),
  settings: { ...emptyModel().settings, email: "alex.rivera@example.com", zoomLink: "https://zoom.us/j/0000000000",
              demoBaseDate: BASE },
  pool };
// Connections: "Introduced me" comes from Connected Through above; plus a few links between people you know.
reconcile(demo);
for (const [a, b, type, notes] of [
  ["Liam Walsh", "Mia Chen", "Friend", "Roommates' friend group"],
  ["Sofia Alvarez", "Daniel Ortiz", "Classmate", "Stanford, same product club"],
  ["Jordan Lee", "Owen Price", "Mentor", "Jordan mentors Owen on case interviews"],
  ["Hana Kim", "Ethan Brooks", "Coworker", "Worked together at Deloitte"],
]) demo.connections.push(makeConnection({ a, b, type, notes }));
writeFileSync(join(SITE, "demo", "demo_network.xlsx"), withHowTo(writeWorkbook(demo)));

// ---- blank template ----
writeFileSync(join(SITE, "template", "contacts_template.xlsx"), withHowTo(writeWorkbook(emptyModel(""))));

console.log(`demo: ${demo.people.length} people, ${demo.targets.length} targets, ${pool.length} in pool`);
