// Parsing LinkedIn's "Save to PDF" profile. The fixtures are FICTIONAL copies of the real layout, one per quirk
// (scripts/make_sample_pdf.mjs). Real profile PDFs are never committed; if you keep some in private-samples/,
// the last test checks their shape (counts only) and is skipped when the folder isn't there.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { monthYear, parseLinkedInProfile, pdfItems, profileToPerson, splitTitle, toLines, yearSpan } from "../site/js/core/linkedinPdf.js";

const pdfjs = await import("../site/vendor/pdfjs/pdf.min.mjs");
pdfjs.GlobalWorkerOptions.workerSrc = new URL("../site/vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
const read = async path => parseLinkedInProfile(await pdfItems(pdfjs, new Uint8Array(readFileSync(new URL(path, import.meta.url)))));
const fixture = name => read(`./fixtures/linkedin-pdf/${name}.pdf`);
const roles = profile => profile.positions.map(p => [p.company, p.title, p.start, p.end, p.location]);

test("the sample PDF in examples/ and the demo copy are the same file", () => {
  assert.deepEqual(readFileSync(new URL("../site/demo/sample_linkedin_profile.pdf", import.meta.url)),
                   readFileSync(new URL("../examples/sample_linkedin_profile.pdf", import.meta.url)));
});

test("demo sample: header, contact, summary, a company with two roles, education", async () => {
  const p = await read("../examples/sample_linkedin_profile.pdf");
  assert.equal(p.name, "Avery Quinn");
  assert.equal(p.headline, "Product Manager at Qualtrics | Stanford MBA candidate");
  assert.equal(p.location, "Salt Lake City, Utah, United States");
  assert.equal(p.email, "avery.quinn@example.com");
  assert.equal(p.linkedinUrl, "https://www.linkedin.com/in/avery-quinn-4b1c2d");
  assert.equal(p.summary, "Product manager who likes turning messy survey data into decisions. Previously in consulting at " +
                          "Deloitte; interested in strategy roles at consumer brands.");
  assert.deepEqual(roles(p), [
    ["Qualtrics", "Product Manager", "2024-01", "Present", "Provo, Utah, United States"],
    ["Qualtrics", "Associate Product Manager", "2021-11", "2023-12", "Provo, Utah, United States"],
    ["Deloitte", "Business Analyst", "2019-07", "2021-10", "San Francisco Bay Area"],
    ["Goldman Sachs", "Summer Analyst", "2018-06", "2018-08", "New York, New York, United States"],
  ]);
  assert.equal(p.positions[0].description, "Owns the survey analytics roadmap and pricing experiments.");
  assert.deepEqual(p.positions.map(x => x.multi), [true, true, false, false]);
  assert.deepEqual(p.education.map(e => [e.school, e.degree, e.field, e.years]), [
    ["Stanford University", "Master of Business Administration - MBA", "", "2025–2027"],
    ["Brigham Young University", "Bachelor of Science - BS", "Information Systems", "2015–2019"],
  ]);
  assert.deepEqual(p.skills, ["Product Strategy", "SQL", "Market Sizing"]);
  assert.deepEqual(p.languages, [{ name: "Spanish", proficiency: "Professional Working" }]);
});

test("single-role entries: company website, wrapped URL, languages, wrapped certification, honors, wrapped month dates", async () => {
  const p = await fixture("single");
  assert.equal(p.name, "Jordan Pike");
  assert.equal(p.headline, "Senior Associate at Harbor Pine Partners");
  assert.equal(p.location, "Denver, Colorado, United States");
  assert.equal(p.email, "jordan.pike@example.com");
  assert.equal(p.linkedinUrl, "https://www.linkedin.com/in/jordan-pike-5a2b9c");
  assert.equal(p.website, "https://www.harborpine.example");
  assert.equal(p.summary, "Strategy consultant focused on pricing and growth for consumer companies. Looking to move into product strategy.");
  assert.deepEqual(p.skills, ["Market Research", "Financial Modeling", "Public Speaking"]);
  assert.deepEqual(p.languages, [{ name: "Spanish", proficiency: "Professional Working" }, { name: "French", proficiency: "Elementary" }]);
  assert.deepEqual(p.certifications, ["Certified Scrum Product Owner", "Data Analytics Professional Certificate"]);
  assert.deepEqual(p.honors, ["Dean's List"]);
  assert.deepEqual(roles(p), [
    ["Harbor Pine Partners", "Senior Associate", "2022-03", "Present", "Denver, Colorado"],
    ["Northfield Analytics", "Analyst", "2019-06", "2022-02", ""],
  ]);
  assert.equal(p.positions[0].description,
    "Led pricing work for three retail clients and built the team's forecasting model. Mentors new analysts.");
  assert.equal(p.positions[1].description, "Customer segmentation and survey research for software companies.");
  assert.deepEqual(p.education, [{ school: "Western Plains University", degree: "Bachelor of Arts - BA", field: "Economics",
                                    start: "2015-08", end: "2019-05", years: "2015–2019" }]);
  assert.deepEqual(p.unsure, []);
});

test("several roles at one company, department prefixes, year-only dates, wrapped email, page break mid-entry", async () => {
  const p = await fixture("multi");
  assert.equal(p.name, "Riley Okafor");
  assert.equal(p.headline, "Operations Lead - Patient Flow at Northgate Health");
  assert.equal(p.email, "riley.okafor.92@example.com");
  assert.equal(p.linkedinUrl, "https://www.linkedin.com/in/riley-okafor-3c9d1e2");
  assert.equal(p.summary, "");
  assert.deepEqual(roles(p), [
    ["Northgate Health", "Clinical Operations: Senior Analyst - Surgical Scheduling", "2022-06", "Present", "Tucson, AZ"],
    ["Northgate Health", "Clinical Operations: Analyst - Staffing Models", "2020-07", "2022-06", "Tucson, AZ"],
    ["Northgate Health", "Quality Office: Associate", "2018", "2020", "Tucson, AZ"],
    ["Pinewood Outfitters", "Merchandising Intern", "2017-05", "2017-08", "Bend, Oregon, United States"],
    ["Pinewood Outfitters", "Store Operations Intern", "2016-05", "2016-08", "Bend, Oregon, United States"],
    ["Canyon Transit", "Operations Intern", "2015-06", "2016-06", "Flagstaff, AZ"],
    ["Desert State University, School of Health Sciences", "Research Assistant", "2000", "2001", "Tempe, AZ"],
  ]);
  assert.deepEqual(p.positions.slice(0, 3).map(x => [x.department, x.role]), [
    ["Clinical Operations", "Senior Analyst - Surgical Scheduling"], ["Clinical Operations", "Analyst - Staffing Models"],
    ["Quality Office", "Associate"]]);
  assert.deepEqual(p.positions.map(x => x.multi), [true, true, true, true, true, false, false]);
  assert.deepEqual(p.languages.map(l => l.name), ["English", "Portuguese"]);
  assert.deepEqual(p.certifications, ["Lean Six Sigma Green Belt Certificate - Healthcare Operations Track LSS 2021"]);
  assert.deepEqual(p.education.map(e => [e.school, e.degree, e.field, e.start, e.end]),
                   [["Desert State University", "Bachelor of Science - BS", "Health Administration", "2014", "2018"]]);

  const { person } = profileToPerson(p);
  assert.equal(person.company, "Northgate Health");
  assert.equal(person.role, "Senior Analyst - Surgical Scheduling");
  assert.equal(person.pastCompanies, "Pinewood Outfitters (2016–2017); Canyon Transit (2015–2016); " +
                                     "Desert State University, School of Health Sciences (2000–2001)");
});

test("several Present roles: a picker, the others stay linked; personal site, publications, patents, two-paragraph summary", async () => {
  const p = await fixture("present");
  assert.equal(p.website, "https://www.ellisstudio.example");
  assert.deepEqual(p.sites, [{ label: "portfolio", url: "https://morganellis.example/work" }]);
  assert.equal(p.summary, "Designer and teacher. I help small brands look big.\nBoard member at a local food bank.");
  assert.deepEqual(p.publications, ["Designing for Small Budgets"]);
  assert.deepEqual(p.patents, ["Modular Display Stand"]);
  assert.deepEqual(p.positions.filter(x => x.current).map(x => x.company), ["Ellis Studio", "Valley State College", "Riverbend Food Bank"]);
  assert.deepEqual(p.positions.at(-1), { company: "Brightwater Media", title: "Design Intern", start: "1999", end: "1999", location: "",
    description: "", multi: false, department: "", role: "Design Intern", current: false, years: "1999" });

  const first = profileToPerson(p);
  // Default: the most recently started Present role.
  assert.deepEqual(first.currentOptions.map(x => x.company), ["Valley State College", "Riverbend Food Bank", "Ellis Studio"]);
  assert.equal(first.person.company, "Valley State College");
  assert.equal(first.person.pastCompanies, "Ellis Studio (2006–Present); Riverbend Food Bank (2020–Present); Brightwater Media (1999–2006)");
  assert.ok(first.unsure.some(u => u.field === "company" && /3 current roles/.test(u.message)));
  const picked = profileToPerson(p, { current: 2 });
  assert.equal(picked.person.company, "Ellis Studio");
  assert.equal(picked.person.role, "Founder");
  assert.match(picked.person.pastCompanies, /^Valley State College \(2021–Present\); Riverbend Food Bank/);
  assert.equal(picked.person.honors, "Designing for Small Budgets; Modular Display Stand");
});

test("profile -> person fields plus Experience and Education rows", async () => {
  const r = profileToPerson(await fixture("single"));
  assert.deepEqual(r.person, {
    name: "Jordan Pike", company: "Harbor Pine Partners", role: "Senior Associate",
    headline: "Senior Associate at Harbor Pine Partners", location: "Denver, Colorado, United States",
    email: "jordan.pike@example.com", linkedinUrl: "https://www.linkedin.com/in/jordan-pike-5a2b9c",
    website: "https://www.harborpine.example", pastCompanies: "Northfield Analytics (2019–2022)",
    school: "Western Plains University (2015–2019)",
    skills: "Market Research; Financial Modeling; Public Speaking",
    languages: "Spanish (Professional Working); French (Elementary)",
    certifications: "Certified Scrum Product Owner; Data Analytics Professional Certificate",
    honors: "Dean's List",
    about: "Strategy consultant focused on pricing and growth for consumer companies. Looking to move into product strategy.",
  });
  assert.deepEqual(r.experience[1], { person: "Jordan Pike", company: "Northfield Analytics", title: "Analyst", start: "2019-06",
    end: "2022-02", location: "", description: "Customer segmentation and survey research for software companies." });
  assert.deepEqual(r.education, [{ person: "Jordan Pike", school: "Western Plains University", degree: "Bachelor of Arts - BA",
    field: "Economics", start: "2015-08", end: "2019-05" }]);
  assert.deepEqual(r.currentOptions.length, 1);
});

test("date and title helpers", () => {
  assert.equal(monthYear("August 2016"), "2016-08");
  assert.equal(monthYear("Sept. 2016"), "2016-09");
  assert.equal(monthYear("2016"), "2016");
  assert.equal(monthYear("Present"), "Present");
  assert.equal(yearSpan("2016-08", "2021-05"), "2016–2021");
  assert.equal(yearSpan("2018-06", "2018-08"), "2018");
  assert.equal(yearSpan("2021-03", "Present"), "2021–Present");
  assert.deepEqual(splitTitle("Clinical Operations: Senior Analyst"), { department: "Clinical Operations", role: "Senior Analyst" });
  assert.deepEqual(splitTitle("Q3 2020: Launch lead"), { department: "", role: "Q3 2020: Launch lead" });
});

test("line grouping joins pieces on one line and drops page footers split into pieces", () => {
  const it = (str, x, y, size = 10.5, page = 1) => ({ str, x, y, size, page, pageWidth: 612 });
  const lines = toLines([it("Jane", 225, 60, 26), it("Doe", 262, 60.5, 26), it("Page", 384, 778, 9), it("1", 407, 778, 9),
                         it("of", 415, 778, 9), it("1", 425, 778, 9),
                         it("www.linkedin.com/in/jane-", 30, 88), it("doe-1 (LinkedIn)", 30, 100)]);
  assert.deepEqual(lines.map(l => [l.col, l.text]), [["main", "Jane Doe"], ["side", "www.linkedin.com/in/jane-"], ["side", "doe-1 (LinkedIn)"]]);
});

test("a PDF that isn't a LinkedIn profile gives a clear error", () => {
  assert.throws(() => parseLinkedInProfile([]), /doesn't look like a LinkedIn profile/);
  assert.throws(() => parseLinkedInProfile([{ str: "hello", x: 300, y: 100, size: 10, page: 1, pageWidth: 612 }]),
                /no name found/);
});

// Your own real profile PDFs, if you keep some locally in private-samples/ (gitignored). Only shapes are checked,
// so nothing about the people ends up in the test output.
const PRIVATE = new URL("../private-samples/", import.meta.url);
const privateFiles = existsSync(PRIVATE) ? readdirSync(PRIVATE).filter(f => /\.pdf$/i.test(f)) : [];
test("real profile PDFs in private-samples/ parse completely", { skip: !privateFiles.length && "no private-samples/ folder" }, async () => {
  for (const f of privateFiles) {
    const p = await read(`../private-samples/${f}`);
    assert.ok(p.name && p.headline && p.location, `${f}: header`);
    assert.match(p.email, /^[^@\s]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}$/i, `${f}: email`);
    assert.match(p.linkedinUrl, /^https:\/\/www\.linkedin\.com\/in\/[\w-]*[^-]$/, `${f}: LinkedIn URL`);
    assert.ok(p.positions.length, `${f}: positions`);
    for (const x of p.positions) assert.ok(x.company && x.title && x.start, `${f}: every position has company, title and dates`);
    for (const e of p.education) assert.ok(e.school && e.years, `${f}: every school has years`);
  }
});

test("merging a PDF into someone already on the map fills gaps and never overwrites your edits", async () => {
  const { fillPerson, makePerson } = await import("../site/js/core/people.js");
  const mine = makePerson({ name: "Jordan Pike", company: "Harbor Pine", role: "", school: "Western Plains University",
                            notes: "Met at the case competition", status: "Met", tags: "consulting" });
  const { person, filled } = fillPerson(mine, profileToPerson(await fixture("single")).person);
  assert.equal(person.company, "Harbor Pine", "my company spelling stays");
  assert.equal(person.role, "Senior Associate", "empty role is filled");
  assert.equal(person.school, "Western Plains University (2015–2019)", "years are added to a school I already had");
  assert.equal(person.pastCompanies, "Northfield Analytics (2019–2022)");
  assert.equal(person.notes, "Met at the case competition");
  assert.equal(person.status, "Met");
  assert.deepEqual(person.tags, ["consulting"]);
  assert.deepEqual(filled.sort(), ["about", "certifications", "email", "headline", "honors", "languages", "linkedinUrl",
                                   "location", "pastCompanies", "role", "school", "skills", "website"]);
});
