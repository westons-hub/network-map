// Regenerate the fictional demo workbook and the blank template.
//   node scripts/make_demo.mjs
// All names, companies and emails here are made up.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "../site/vendor/xlsx.mjs";
import { demoFace, demoLogo } from "../site/js/core/avatars.js";
import { makePerson, mergePeople, parseLinkedInCsv, personFromPool } from "../site/js/core/people.js";
import { emptyModel, writeWorkbook } from "../site/js/core/workbook.js";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..", "site");

// Name, Company, School, Role, Connected Through, Status, Tags, Notes
const PEOPLE = [
  ["Jordan Lee", "Northwind Consulting", "Riverbend University", "Senior Consultant", "", "Met", "Consulting club", "Case interview tips"],
  ["Priya Shah", "Northwind Consulting", "Lakeview State University", "Manager", "", "Contacted", "", ""],
  ["Marcus Bell", "Northwind Consulting", "Riverbend University", "Analyst", "", "Met", "Consulting club", ""],
  ["Hana Kim", "Northwind Consulting, Inc.", "", "Partner", "", "To Reach Out", "", "Leads the strategy practice"],
  ["Sofia Alvarez", "Contoso Games", "Riverbend University", "Product Manager", "", "Met", "Gaming", "Owns the marketplace roadmap"],
  ["Ethan Brooks", "Contoso Games", "", "Data Analyst", "", "Follow Up", "Gaming", ""],
  ["Lena Novak", "Contoso Games", "Harbor Tech Institute", "Producer", "", "To Reach Out", "Gaming", ""],
  ["Noah Carter", "Summit Airlines", "Riverbend University", "Commercial Strategy Analyst", "", "Met", "", "Info session speaker"],
  ["Grace Owens", "Summit Airlines", "", "Recruiter", "", "Contacted", "", ""],
  ["Daniel Ortiz", "Brightline Bank", "Riverbend University", "Strategy Associate", "", "Met", "", ""],
  ["Mia Chen", "Fieldstone Capital", "Lakeview State University", "Partner", "", "Met", "", ""],
  ["Owen Price", "Fieldstone Capital", "Lakeview State University", "Associate", "", "To Reach Out", "", ""],
  ["Ava Thompson", "Keystone Health", "Lakeview State University", "Operations Lead", "", "Met", "", ""],
  ["Liam Walsh", "Independent", "", "Founder", "", "Met", "", "Old roommate"],
  ["Rachel Green", "Northwind Consulting", "", "Principal", "Jordan Lee", "To Reach Out", "", "Jordan offered an intro"],
  ["Tom Nguyen", "Contoso Games", "", "Director of Product", "Sofia Alvarez", "To Reach Out", "Gaming", ""],
  ["Isla Moore", "Contoso Games", "", "UX Researcher", "Sofia Alvarez", "", "Gaming", ""],
  ["Victor Hale", "Summit Airlines", "", "VP Network Planning", "Noah Carter", "", "", ""],
  ["Chloe Park", "Harbor Ventures", "", "Investor", "Mia Chen", "", "", ""],
  ["Ben Foster", "Riverbend University", "", "Career Coach", "Daniel Ortiz", "", "", ""],
  ["Zoe Adams", "Pinecrest Labs", "", "CEO", "Liam Walsh", "", "", ""],
  ["Sam Rivera", "Pinecrest Labs", "", "Head of Growth", "Zoe Adams", "", "", "3rd-degree example"],
];

// Company, Priority, Stage, Notes
const TARGETS = [
  ["Northwind Consulting", "1", "Networking", "Strategy practice"],
  ["Summit Airlines", "1", "Applied", ""],
  ["Brightline Bank", "2", "Researching", "Three pool contacts there aren't on the map yet"],
  ["Pinecrest Labs", "2", "Researching", "Reachable only through Liam"],
  ["Granite Peak Partners", "3", "Researching", "No one yet"],
  ["Harborview Media", "3", "Researching", "No one yet"],
];

const HOW_TO = [
  ["Sheet / column", "What to put there"],
  ["People", "Everyone on your map. Only Name is required."],
  ["  Name", "Full name, spelled the same way everywhere."],
  ["  Company / School", "3+ direct connections at one company or school become a group bubble. 'BYU' and 'Brigham Young University' count as the same."],
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
  ["Layout / Settings", "Managed by the app (saved node positions, your name)."],
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
// Fictional people get illustrated faces and fictional organizations get made-up logos, all drawn in code.
const orgs = [...new Set([...PEOPLE.flatMap(r => [r[1], r[2]]), ...TARGETS.map(t => t[0])].filter(Boolean))].sort();
const demo = { ...emptyModel("Alex Rivera"),
  people: mergePeople(fromPool, people).map(p => ({ ...p, photo: demoFace(p.name), source: "" })),
  companies: orgs.map(company => ({ company, website: "", logo: demoLogo(company), extra: {} })),
  targets: TARGETS.map(([company, priority, stage, notes]) => ({ company, priority, stage, notes, extra: {} })),
  pool };
writeFileSync(join(SITE, "demo", "demo_network.xlsx"), withHowTo(writeWorkbook(demo)));

// ---- blank template ----
writeFileSync(join(SITE, "template", "contacts_template.xlsx"), withHowTo(writeWorkbook(emptyModel(""))));

console.log(`demo: ${demo.people.length} people, ${demo.targets.length} targets, ${pool.length} in pool`);
