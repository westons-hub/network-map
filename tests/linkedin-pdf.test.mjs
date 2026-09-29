// Parsing LinkedIn's "Save to PDF" profile (fictional sample in examples/).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseLinkedInProfile, pdfItems, profileToPerson, toLines } from "../site/js/core/linkedinPdf.js";

const pdfjs = await import("../site/vendor/pdfjs/pdf.min.mjs");
pdfjs.GlobalWorkerOptions.workerSrc = new URL("../site/vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
const bytes = () => new Uint8Array(readFileSync(new URL("../examples/sample_linkedin_profile.pdf", import.meta.url)));

test("the sample PDF in examples/ and the demo copy are the same file", () => {
  assert.deepEqual(readFileSync(new URL("../site/demo/sample_linkedin_profile.pdf", import.meta.url)), Buffer.from(bytes()));
});

test("parses name, headline, location, contact, summary, experience and education from the PDF", async () => {
  const profile = parseLinkedInProfile(await pdfItems(pdfjs, bytes()));
  assert.equal(profile.name, "Avery Quinn");
  assert.equal(profile.headline, "Product Manager at Qualtrics | Stanford MBA candidate");
  assert.equal(profile.location, "Salt Lake City, Utah, United States");
  assert.equal(profile.email, "avery.quinn@example.com");
  assert.equal(profile.linkedinUrl, "https://www.linkedin.com/in/avery-quinn-4b1c2d");
  assert.match(profile.summary, /^Product manager who likes .* consumer brands\.$/);
  assert.deepEqual(profile.positions.map(p => [p.company, p.title, p.years, p.current]), [
    ["Qualtrics", "Product Manager", "2024–Present", true],
    ["Qualtrics", "Associate Product Manager", "2021–2023", false],
    ["Deloitte", "Business Analyst", "2019–2021", false],
    ["Goldman Sachs", "Summer Analyst", "2018", false],
  ]);
  assert.deepEqual(profile.education, [
    { school: "Stanford University", degree: "Master of Business Administration - MBA", years: "2025–2027" },
    { school: "Brigham Young University", degree: "Bachelor of Science - BS, Information Systems", years: "2015–2019" },
  ]);
});

test("a profile becomes person fields: current job, past companies, schools, notes", async () => {
  const person = profileToPerson(parseLinkedInProfile(await pdfItems(pdfjs, bytes())));
  assert.deepEqual(person, {
    name: "Avery Quinn", company: "Qualtrics", role: "Product Manager",
    pastCompanies: "Deloitte (2019–2021); Goldman Sachs (2018)",
    school: "Stanford University (2025–2027); Brigham Young University (2015–2019)",
    email: "avery.quinn@example.com", linkedinUrl: "https://www.linkedin.com/in/avery-quinn-4b1c2d",
    notes: "Product Manager at Qualtrics | Stanford MBA candidate\nSalt Lake City, Utah, United States\n" +
           "Product manager who likes turning messy survey data into decisions. Previously in consulting at Deloitte; " +
           "interested in strategy roles at consumer brands.",
  });
});

test("line grouping joins pieces on one line and drops page footers", () => {
  const it = (str, x, y, size = 10.5, page = 1) => ({ str, x, y, size, page, pageWidth: 612 });
  const lines = toLines([it("Jane", 225, 60, 26), it("Doe", 262, 60.5, 26), it("Page 1 of 1", 280, 770, 9),
                         it("www.linkedin.com/in/jane-", 30, 88), it("doe-1 (LinkedIn)", 30, 100)]);
  assert.deepEqual(lines.map(l => [l.col, l.text]), [["main", "Jane Doe"], ["side", "www.linkedin.com/in/jane-"], ["side", "doe-1 (LinkedIn)"]]);
});

test("a PDF that isn't a LinkedIn profile gives a clear error", () => {
  assert.throws(() => parseLinkedInProfile([]), /doesn't look like a LinkedIn profile/);
  assert.throws(() => parseLinkedInProfile([{ str: "hello", x: 300, y: 100, size: 10, page: 1, pageWidth: 612 }]),
                /no name found/);
});
