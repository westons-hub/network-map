// Regenerate the demo workbook and the blank template.
//   node scripts/make_demo.mjs
// The people (names, emails, relationships) are fictional. Their headshots in site/demo/photos are
// AI-generated faces of people who don't exist (SFHQ dataset, MIT license; see site/vendor/ATTRIBUTION.md).
// The companies and schools are real, well-known organizations so the demo shows real logos; logos are
// loaded at runtime from each organization's domain (listed below), never stored in the repo.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "../site/vendor/xlsx.mjs";
import { makePerson, mergePeople, parseLinkedInCsv, personFromPool } from "../site/js/core/people.js";
import { emptyModel, writeWorkbook } from "../site/js/core/workbook.js";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..", "site");

// Name, Company, School, Role, Connected Through, Status, Tags, Notes
const PEOPLE = [
  ["Jordan Lee", "Deloitte", "Stanford University", "Senior Consultant", "", "Met", "Consulting club", "Case interview tips"],
  ["Priya Shah", "Deloitte", "University of Utah", "Manager", "", "Contacted", "", ""],
  ["Marcus Bell", "Deloitte", "Stanford", "Analyst", "", "Met", "Consulting club", ""],
  ["Hana Kim", "Deloitte LLP", "", "Partner", "", "To Reach Out", "", "Leads the strategy practice"],
  ["Sofia Alvarez", "Microsoft", "Stanford University", "Product Manager", "", "Met", "Product", "Owns the marketplace roadmap"],
  ["Ethan Brooks", "Microsoft", "", "Data Analyst", "", "Follow Up", "Product", ""],
  ["Lena Novak", "Microsoft", "University of Utah", "Program Manager", "", "To Reach Out", "Product", ""],
  ["Noah Carter", "Delta Air Lines", "Stanford University", "Commercial Strategy Analyst", "", "Met", "", "Info session speaker"],
  ["Grace Owens", "Delta Air Lines", "", "Recruiter", "", "Contacted", "", ""],
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
  ["Deloitte", "deloitte.com"], ["Delta Air Lines", "delta.com"], ["Goldman Sachs", "goldmansachs.com"],
  ["Qualtrics", "qualtrics.com"], ["Microsoft", "microsoft.com"], ["Google", "google.com"], ["Adobe", "adobe.com"],
  ["Apple", "apple.com"], ["Nike", "nike.com"], ["Stanford University", "stanford.edu"],
  ["University of Utah", "admissions.utah.edu"], // utah.edu itself has no favicon
];

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
  ["Settings", "Your name, and Avatar style: initials, or notionists for illustrated avatars drawn in your browser."],
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
const demo = { ...emptyModel("Alex Rivera"), avatarStyle: "notionists",
  people: mergePeople(fromPool, people).map(p => ({ ...p, source: "",
    photo: `demo/photos/${p.name.toLowerCase().replaceAll(" ", "-")}.jpg` })),
  companies: COMPANIES.map(([company, website]) => ({ company, website, logo: "", extra: {} })),
  targets: TARGETS.map(([company, priority, stage, notes]) => ({ company, priority, stage, notes, extra: {} })),
  pool };
writeFileSync(join(SITE, "demo", "demo_network.xlsx"), withHowTo(writeWorkbook(demo)));

// ---- blank template ----
writeFileSync(join(SITE, "template", "contacts_template.xlsx"), withHowTo(writeWorkbook(emptyModel(""))));

console.log(`demo: ${demo.people.length} people, ${demo.targets.length} targets, ${pool.length} in pool`);
