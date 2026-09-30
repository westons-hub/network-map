// A FICTIONAL copy of the data export LinkedIn emails you (Settings & Privacy -> Data privacy -> Get a copy of your
// data -> Download larger data archive): the same 23 file names and column headers, made-up people and values.
// Used by the tests (folder, zip, single-file and "Profile only" imports) and handy for trying the import.
//   node scripts/make_export_sample.mjs     -> examples/linkedin-export-sample/
// Everyone here is made up, including "Alex Rivera"; the connections are the demo's fictional LinkedIn pool.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "examples", "linkedin-export-sample");
const q = v => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = (header, rows) => [header, ...rows].map(r => r.map(q).join(",")).join("\n") + "\n";

// Connections: the demo's fictional pool (with LinkedIn's "Notes:" lines above the header).
const connections = readFileSync(join(ROOT, "site", "demo", "sample_linkedin_connections.csv"), "utf8");
const people = connections.split("\n").slice(3).filter(l => l && !l.startsWith("First Name")).map(l => l.split(","));
const slug = url => url.replace("https://www.linkedin.com/in/", "");
const ME = "https://www.linkedin.com/in/alex-rivera-demo";

const files = {
  "Connections.csv": connections,
  "Profile.csv": csv(["First Name", "Last Name", "Maiden Name", "Address", "Birth Date", "Headline", "Summary", "Industry", "Zip Code",
                      "Geo Location", "Twitter Handles", "Websites", "Instant Messengers"],
    [["Alex", "Rivera", "", "1 Example Way, Palo Alto", "Jan 1, 2000", "Stanford MBA '27 · Strategy & product",
      "MBA student looking for strategy and product roles.\nFormer airline analyst.", "Higher Education", "94000", "Palo Alto, California, United States",
      "[@alex_example]", "[PORTFOLIO:alex.example]", "[SKYPE:alex.example]"]]),
  "Profile Summary.csv": csv(["Profile Summary"], [["MBA student looking for strategy and product roles."]]),
  "Positions.csv": csv(["Company Name", "Title", "Description", "Location", "Started On", "Finished On"],
    [["Northwind Outfitters", "Strategy Intern", "Pricing work for a new product line.", "Seattle, Washington", "Jun 2026", ""],
     ["Harbor Airlines", "Revenue Analyst", "Forecasting and pricing.", "Salt Lake City, Utah", "Jul 2020", "Jun 2022"],
     ["Adobe", "Business Analyst", "", "San Jose, California", "Jul 2022", "Jul 2025"]]),
  "Education.csv": csv(["School Name", "Start Date", "End Date", "Notes", "Degree Name", "Activities"],
    [["Stanford University", "2025", "2027", "", "Master of Business Administration - MBA", "Product club"],
     ["University of Washington", "2016", "2020", "", "Bachelor of Science - BS", "Consulting club"]]),
  "Skills.csv": csv(["Name"], [["Market Sizing"], ["SQL"], ["Pricing Strategy"]]),
  "Certifications.csv": csv(["Name", "Url", "Authority", "Started On", "Finished On", "License Number"],
    [["Certified Scrum Product Owner", "https://example.com/cspo", "Example Alliance", "Mar 2024", "", ""],
     ["Data Analytics Certificate", "", "Example Academy", "Jan 2023", "", ""]]),
  "Volunteering.csv": csv(["Company Name", "Role", "Cause", "Started On", "Finished On", "Description"],
    [["Riverbend Food Bank", "Volunteer Coordinator", "Poverty Alleviation", "Sep 2019", "Jun 2021", "Weekend shifts."]]),
  "Email Addresses.csv": csv(["Email Address", "Confirmed", "Primary", "Updated On"],
    [["alex.old@example.com", "Yes", "No", "1/1/20, 9:00 AM"], ["alex.rivera@example.com", "Yes", "Yes", "9/1/25, 9:00 AM"]]),
  "Company Follows.csv": csv(["Organization", "Followed On"],
    [["Google", "Mon Sep 01 10:00:00 UTC 2025"], ["Microsoft", "Tue Sep 02 10:00:00 UTC 2025"], ["Qualtrics", "Wed Sep 03 10:00:00 UTC 2025"]]),
  "Invitations.csv": csv(["From", "To", "Sent At", "Message", "Direction", "inviterProfileUrl", "inviteeProfileUrl"], [
    ...people.slice(0, 6).map(([f, l, url], i) => (i % 2
      ? [`${f} ${l}`, "Alex Rivera", `8/${i + 3}/26, 10:1${i} AM`, "", "INCOMING", url, ME]
      : ["Alex Rivera", `${f} ${l}`, `8/${i + 3}/26, 9:0${i} AM`, i === 0 ? "Hi! Loved your talk at the info session." : "", "OUTGOING", ME, url])),
    ["Alex Rivera", "Casey Morgan", "9/20/26, 4:15 PM", "Hi Casey, fellow Stanford MBA here.", "OUTGOING", ME, "https://www.linkedin.com/in/casey-morgan-demo"],
    ["Alex Rivera", "Devon Park", "9/22/26, 11:05 AM", "", "OUTGOING", ME, "https://www.linkedin.com/in/devon-park-demo"],
  ]),
  "messages.csv": csv(["CONVERSATION ID", "CONVERSATION TITLE", "FROM", "SENDER PROFILE URL", "TO", "RECIPIENT PROFILE URLS", "DATE", "SUBJECT",
                       "CONTENT", "FOLDER", "ATTACHMENTS"], [
    ["c1", "", "Alex Rivera", ME, `${people[0][0]} ${people[0][1]}`, people[0][2], "2026-08-05 17:00:00 UTC", "", "(fictional message text)", "INBOX", ""],
    ["c1", "", `${people[0][0]} ${people[0][1]}`, people[0][2], "Alex Rivera", ME, "2026-08-06 09:30:00 UTC", "", "(fictional reply)", "INBOX", ""],
    ["c1", "", "Alex Rivera", ME, `${people[0][0]} ${people[0][1]}`, people[0][2], "2026-09-12 14:00:00 UTC", "", "(fictional follow-up)", "INBOX", ""],
    ["c2", "", `${people[1][0]} ${people[1][1]}`, people[1][2], "Alex Rivera", ME, "2026-07-01 08:00:00 UTC", "", "(fictional)", "ARCHIVE", ""],
  ]),
  "Notes.csv": csv(["Connection First Name", "Connection Last Name", "Connection Profile URL", "Note", "Created On", "Edited On"],
    [[people[2][0], people[2][1], people[2][2], "Met at the product club mixer.", "9/1/26, 8:00 PM", ""]]),
  // Files Orbit ignores for now (maybe later):
  "Learning.csv": csv(["Content Title", "Content Description", "Content Type", "Content Last Watched Date (if viewed)", "Content Completed At (if completed)", "Content Saved", "Notes taken on videos (if taken)"],
    [["Excel for analysts (fictional)", "", "COURSE", "", "", "false", ""]]),
  "Rich_Media.csv": csv(["Date/Time", "Media Description", "Media Link"], [["", "(fictional)", ""]]),
  "SavedJobAlerts.csv": csv(["Alert Parameters"], [["keywords:product strategy (fictional)"]]),
  // Files Orbit never reads (they're here so the tests can check they're skipped):
  "Ad_Targeting.csv": csv(["Member Age", "Company Names"], [["NEVER-READ-SENTINEL", "fictional"]]),
  "Registration.csv": csv(["Registered At", "Registration Ip"], [["NEVER-READ-SENTINEL", "0.0.0.0"]]),
  "PhoneNumbers.csv": csv(["Extension", "Number", "Type"], [["", "NEVER-READ-SENTINEL", "Mobile"]]),
  "guide_messages.csv": csv(["CONVERSATION ID", "CONTENT"], [["g1", "NEVER-READ-SENTINEL"]]),
  "learning_coach_messages.csv": csv(["CONVERSATION ID", "CONTENT"], [["l1", "NEVER-READ-SENTINEL"]]),
  "learning_role_play_messages.csv": csv(["CONVERSATION ID", "CONTENT"], [["r1", "NEVER-READ-SENTINEL"]]),
  "Verifications/Verifications.csv": csv(["Verification Type", "Status"], [["NEVER-READ-SENTINEL", "fictional"]]),
};

rmSync(OUT, { recursive: true, force: true });
for (const [name, text] of Object.entries(files)) {
  mkdirSync(dirname(join(OUT, name)), { recursive: true });
  writeFileSync(join(OUT, name), text);
}
console.log(`Wrote ${Object.keys(files).length} files to examples/linkedin-export-sample/ (${slug(ME)} and friends, all fictional)`);
