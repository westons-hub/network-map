// Generate a FICTIONAL sample of the PDF LinkedIn makes from a profile (More → Save to PDF), laid out the
// same way: a grey sidebar (Contact, Top Skills, Languages) and a main column (name, headline, location,
// Summary, Experience, Education), letter size, "Page N of M" footers. Used by the tests and the demo's
// "Try a sample PDF" button.
//   node scripts/make_sample_pdf.mjs
// "Avery Quinn" is not a real person.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 612, H = 792;

// [page, x, yFromTop, size, bold, text]
const S = 30, M = 225;
const LINES = [
  [1, S, 50, 13, 1, "Contact"],
  [1, S, 70, 10.5, 0, "avery.quinn@example.com"],
  [1, S, 88, 10.5, 0, "www.linkedin.com/in/avery-quinn-4b1c2d"],
  [1, S, 102, 10.5, 0, "(LinkedIn)"],
  [1, S, 132, 13, 1, "Top Skills"],
  [1, S, 150, 10.5, 0, "Product Strategy"],
  [1, S, 165, 10.5, 0, "SQL"],
  [1, S, 180, 10.5, 0, "Market Sizing"],
  [1, S, 210, 13, 1, "Languages"],
  [1, S, 228, 10.5, 0, "Spanish (Professional Working)"],

  [1, M, 58, 26, 0, "Avery Quinn"],
  [1, M, 82, 12, 0, "Product Manager at Qualtrics | Stanford MBA candidate"],
  [1, M, 100, 10.5, 0, "Salt Lake City, Utah, United States"],
  [1, M, 134, 15.75, 0, "Summary"],
  [1, M, 154, 10.5, 0, "Product manager who likes turning messy survey data into decisions. Previously in"],
  [1, M, 168, 10.5, 0, "consulting at Deloitte; interested in strategy roles at consumer brands."],
  [1, M, 202, 15.75, 0, "Experience"],
  [1, M, 224, 12, 1, "Qualtrics"],
  [1, M, 240, 10.5, 0, "2 years 11 months"],
  [1, M, 258, 11.5, 0, "Product Manager"],
  [1, M, 274, 10.5, 0, "January 2024 - Present (1 year 9 months)"],
  [1, M, 289, 10.5, 0, "Provo, Utah, United States"],
  [1, M, 306, 10.5, 0, "Owns the survey analytics roadmap and pricing experiments."],
  [1, M, 330, 11.5, 0, "Associate Product Manager"],
  [1, M, 346, 10.5, 0, "November 2021 - December 2023 (2 years 2 months)"],
  [1, M, 361, 10.5, 0, "Provo, Utah, United States"],
  [1, M, 392, 12, 1, "Deloitte"],
  [1, M, 410, 11.5, 0, "Business Analyst"],
  [1, M, 426, 10.5, 0, "July 2019 - October 2021 (2 years 4 months)"],
  [1, M, 441, 10.5, 0, "San Francisco Bay Area"],
  [1, M, 458, 10.5, 0, "Market sizing and go-to-market work for retail and airline clients."],
  [1, W / 2 - 30, 770, 9, 0, "Page 1 of 2"],

  [2, M, 50, 12, 1, "Goldman Sachs"],
  [2, M, 68, 11.5, 0, "Summer Analyst"],
  [2, M, 84, 10.5, 0, "June 2018 - August 2018 (3 months)"],
  [2, M, 99, 10.5, 0, "New York, New York, United States"],
  [2, M, 134, 15.75, 0, "Education"],
  [2, M, 156, 12, 1, "Stanford University"],
  [2, M, 172, 10.5, 0, "Master of Business Administration - MBA · (2025 - 2027)"],
  [2, M, 198, 12, 1, "Brigham Young University"],
  [2, M, 214, 10.5, 0, "Bachelor of Science - BS, Information Systems · (2015 - 2019)"],
  [2, W / 2 - 30, 770, 9, 0, "Page 2 of 2"],
];

// ---- a tiny PDF writer (text only, standard Helvetica fonts, WinAnsi encoding) ------------------------
const esc = s => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
function pageStream(page) {
  const parts = [];
  if (page === 1 || page === 2) parts.push("0.95 0.95 0.95 rg 0 0 200 792 re f 0 0 0 rg"); // grey sidebar
  for (const [p, x, y, size, bold, text] of LINES) {
    if (p !== page) continue;
    parts.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${H - y} Td (${esc(text)}) Tj ET`);
  }
  return parts.join("\n");
}

function buildPdf() {
  const objects = [];
  const add = body => { objects.push(body); return objects.length; };
  const catalog = add(null), pages = add(null);
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids = [];
  for (const n of [1, 2]) {
    const stream = pageStream(n);
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${content} 0 R ` +
                  `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objects[pages - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info << /Title (Avery Quinn - LinkedIn profile, fictional sample) >> >>\n`;
  out += `startxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const pdf = buildPdf();
for (const dir of ["examples", "site/demo"]) {
  mkdirSync(join(ROOT, dir), { recursive: true });
  writeFileSync(join(ROOT, dir, "sample_linkedin_profile.pdf"), pdf);
}
console.log(`sample_linkedin_profile.pdf: ${pdf.length} bytes (examples/ and site/demo/)`);
