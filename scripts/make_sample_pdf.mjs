// Generate FICTIONAL copies of the PDF LinkedIn makes from a profile (More → Save to PDF), laid out the same
// way (positions and type sizes measured from real exports): a grey sidebar (Contact, Top Skills, Languages,
// Certifications…) and a main column (name, headline, location, Summary, Experience, Education), letter
// size, "Page N of M" footers.
//   node scripts/make_sample_pdf.mjs
// Writes the demo's "Try a sample PDF" file (examples/ and site/demo/) and the test fixtures in
// tests/fixtures/linkedin-pdf/, one per layout quirk. Every person, email and link here is made up.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 612, H = 792, SIDE_X = 22, MAIN_X = 224, BOTTOM = 762, TOP = 53.5;

// ---- the profiles ------------------------------------------------------------------------------------
// Sidebar: [kind, text]. Main: [kind, text, extra]. Kinds set the type size and the gap above, like LinkedIn.

const PROFILES = {
  // The demo sample (also used by the demo's "Try a sample PDF"): two roles at one company, a summary.
  sample: {
    file: "sample_linkedin_profile.pdf", title: "Avery Quinn - LinkedIn profile, fictional sample",
    side: [["heading", "Contact"], ["email", "avery.quinn@example.com"], ["url", "www.linkedin.com/in/avery-", null], ["url+", "quinn-4b1c2d", "LinkedIn"],
      ["heading", "Top Skills"], ["item", "Product Strategy"], ["item", "SQL"], ["item", "Market Sizing"],
      ["heading", "Languages"], ["item", "Spanish (Professional Working)"]],
    main: [["name", "Avery Quinn"], ["headline", "Product Manager at Qualtrics | Stanford MBA candidate"],
      ["location", "Salt Lake City, Utah, United States"],
      ["heading", "Summary"], ["summary", "Product manager who likes turning messy survey data into"],
      ["summary", "decisions. Previously in consulting at Deloitte; interested in"], ["summary", "strategy roles at consumer brands."],
      ["heading", "Experience"], ["company", "Qualtrics"], ["duration", "2 years 11 months"],
      ["title", "Product Manager"], ["dates", "January 2024 - Present", "(1 year 9 months)"], ["place", "Provo, Utah, United States"],
      ["desc", "Owns the survey analytics roadmap and pricing experiments."],
      ["title", "Associate Product Manager"], ["dates", "November 2021 - December 2023", "(2 years 2 months)"],
      ["place", "Provo, Utah, United States"],
      ["company", "Deloitte"], ["title", "Business Analyst"], ["dates", "July 2019 - October 2021", "(2 years 4 months)"],
      ["place", "San Francisco Bay Area"], ["desc", "Market sizing and go-to-market work for retail and airline clients."],
      ["company", "Goldman Sachs"], ["title", "Summer Analyst"], ["dates", "June 2018 - August 2018", "(3 months)"],
      ["place", "New York, New York, United States"],
      ["heading", "Education"], ["school", "Stanford University"], ["degree", "Master of Business Administration - MBA · (2025 - 2027)"],
      ["school", "Brigham Young University"], ["degree", "Bachelor of Science - BS, Information Systems · (2015 - 2019)"]],
  },

  // Single-role entries; company website; Languages, wrapped Certifications, Honors; month dates in
  // Education that wrap onto a second line; a role with no location; a multi-line description.
  single: {
    file: "single.pdf", title: "Jordan Pike - fictional fixture",
    side: [["heading", "Contact"], ["email", "jordan.pike@example.com"],
      ["url", "www.linkedin.com/in/jordan-", null], ["url+", "pike-5a2b9c", "LinkedIn"], ["url", "www.harborpine.example", "Company"],
      ["heading", "Top Skills"], ["item", "Market Research"], ["item", "Financial Modeling"], ["item", "Public Speaking"],
      ["heading", "Languages"], ["item", "Spanish (Professional Working)"], ["item", "French (Elementary)"],
      ["heading", "Certifications"], ["item", "Certified Scrum Product Owner"], ["item", "Data Analytics Professional"],
      ["wrap", "Certificate"],
      ["heading", "Honors-Awards"], ["item", "Dean's List"]],
    main: [["name", "Jordan Pike"], ["headline", "Senior Associate at Harbor Pine Partners"], ["location", "Denver, Colorado, United States"],
      ["heading", "Summary"], ["summary", "Strategy consultant focused on pricing and growth for"],
      ["summary", "consumer companies. Looking to move into product strategy."],
      ["heading", "Experience"], ["company", "Harbor Pine Partners"], ["title", "Senior Associate"],
      ["dates", "March 2022 - Present", "(2 years 7 months)"], ["place", "Denver, Colorado"],
      ["desc", "Led pricing work for three retail clients and built the team's forecasting model."],
      ["desc", "Mentors new analysts."],
      ["company", "Northfield Analytics"], ["title", "Analyst"], ["dates", "June 2019 - February 2022", "(2 years 9 months)"],
      ["desc", "Customer segmentation and survey research for software companies."],
      ["heading", "Education"], ["school", "Western Plains University"],
      ["degree", "Bachelor of Arts - BA, Economics · (August 2015 - May"], ["wrap", "2019)"]],
  },

  // Several roles at one company (total duration line, department prefixes); year-only dates; an email and a
  // LinkedIn URL that wrap; no Summary; a long company line; an entry split by a page break.
  multi: {
    file: "multi.pdf", title: "Riley Okafor - fictional fixture",
    side: [["heading", "Contact"], ["email", "riley.okafor.92@example.c"], ["wrap-tight", "om"],
      ["url", "www.linkedin.com/in/riley-okafor-", null], ["url+", "3c9d1e2", "LinkedIn"],
      ["heading", "Top Skills"], ["item", "Process Improvement"], ["item", "Scheduling"], ["item", "Tableau"],
      ["heading", "Languages"], ["item", "English (Native or Bilingual)"], ["item", "Portuguese (Limited Working)"],
      ["heading", "Certifications"], ["item", "Lean Six Sigma Green Belt Certificate"],
      ["wrap", "- Healthcare Operations Track"], ["wrap", "LSS 2021"]],
    main: [["name", "Riley Okafor"], ["headline", "Operations Lead - Patient Flow at Northgate Health"],
      ["location", "Tucson, Arizona, United States"],
      ["heading", "Experience"], ["company", "Northgate Health"], ["duration", "6 years 2 months"],
      ["title", "Clinical Operations: Senior Analyst - Surgical Scheduling"], ["dates", "June 2022 - Present", "(2 years 4 months)"],
      ["place", "Tucson, AZ"],
      ["title", "Clinical Operations: Analyst - Staffing Models"], ["dates", "July 2020 - June 2022", "(2 years)"], ["place", "Tucson, AZ"],
      ["title", "Quality Office: Associate"], ["dates", "2018 - 2020", "(2 years)"], ["place", "Tucson, AZ"],
      ["company", "Pinewood Outfitters"], ["duration", "1 year"],
      ["title", "Merchandising Intern"], ["dates", "May 2017 - August 2017", "(4 months)"], ["place", "Bend, Oregon, United States"],
      ["title", "Store Operations Intern"], ["dates", "May 2016 - August 2016", "(4 months)"], ["place", "Bend, Oregon, United States"],
      ["company", "Canyon Transit"], ["title", "Operations Intern"], ["dates", "June 2015 - June 2016", "(1 year 1 month)"],
      ["place", "Flagstaff, AZ"],
      ["company", "Desert State University, School of Health Sciences", "bottom"], ["pagebreak"],
      ["title", "Research Assistant"], ["dates", "2000 - 2001", "(1 year)"], ["place", "Tempe, AZ"],
      ["heading", "Education"], ["school", "Desert State University"],
      ["degree", "Bachelor of Science - BS, Health Administration · (2014 - 2018)"]],
  },

  // Several "Present" roles at once (one with year-only dates), a personal site, Publications and Patents,
  // a summary with two paragraphs, a role with only a year.
  present: {
    file: "present.pdf", title: "Morgan Ellis - fictional fixture",
    side: [["heading", "Contact"], ["email", "morgan@ellisstudio.example"], ["url", "www.linkedin.com/in/morganellis", "LinkedIn"],
      ["url", "www.ellisstudio.example", "Company"], ["url", "morganellis.example/work", "Portfolio"],
      ["heading", "Top Skills"], ["item", "Brand Strategy"], ["item", "Design Leadership"],
      ["heading", "Publications"], ["item", "Designing for Small Budgets"],
      ["heading", "Patents"], ["item", "Modular Display Stand"]],
    main: [["name", "Morgan Ellis"], ["headline", "Founder, Ellis Studio | Adjunct Professor | Board Member"],
      ["location", "Boise, Idaho, United States"],
      ["heading", "Summary"], ["summary", "Designer and teacher. I help small brands look big."],
      ["para", "Board member at a local food bank."],
      ["heading", "Experience"], ["company", "Ellis Studio"], ["title", "Founder"], ["dates", "2006 - Present", "(18 years)"],
      ["place", "Boise, Idaho"],
      ["company", "Valley State College"], ["title", "Adjunct Professor"], ["dates", "August 2021 - Present", "(3 years 2 months)"],
      ["company", "Riverbend Food Bank"], ["title", "Board Member"], ["dates", "January 2020 - Present", "(4 years 9 months)"],
      ["company", "Brightwater Media"], ["title", "Designer"], ["dates", "2000 - 2006", "(6 years)"], ["place", "Portland, Oregon"],
      ["desc", "Print and web design for regional newspapers."],
      ["company", "Brightwater Media"], ["title", "Design Intern"], ["dates", "1999", "(less than a year)"],
      ["heading", "Education"], ["school", "Pacific Northwest College of Art"], ["degree", "Bachelor of Fine Arts - BFA, Graphic Design · (1995 - 1999)"]],
  },
};

// ---- layout: kinds -> [size, gap above] (measured from real exports) ----------------------------------

const MAIN = { name: [26, 0], headline: [12, 21.2], location: [12, 15.4], heading: [15.75, 37.6], summary: [12, 18],
  para: [12, 30], company: [12, 38], duration: [10.5, 16.5], title: [11.5, 35], dates: [10.5, 14.5], place: [10.5, 14.7],
  desc: [10.5, 20.4], school: [12, 25.4], degree: [10.5, 17.7], wrap: [10.5, 17.9] };
const FIRST_AFTER = { heading: 25.5, company: 16.1, duration: 21.3 }; // gap to the next line after these kinds
const SIDE = { heading: [13, 34.8], item: [10.5, 17.6], wrap: [10.5, 12.6], "wrap-tight": [10.5, 12.6], email: [10.5, 19.4],
  url: [11, 24.4], "url+": [11, 14.4] };

function layoutMain(entries) {
  const out = [];
  let page = 1, y = 65.5, prevKind = null;
  for (const [kind, text, extra] of entries) {
    if (kind === "pagebreak") { page++; y = TOP; prevKind = null; continue; }
    const [size, gap] = MAIN[kind];
    if (kind === "company" && extra === "bottom") y = 753.9 - MAIN.company[1]; // pushed to the foot of the page
    if (prevKind) {
      let g = gap;
      if (prevKind === "heading") g = kind === "summary" ? 25.5 : kind === "company" ? 30.5 : 25.4;
      else if (kind === "title" && FIRST_AFTER[prevKind]) g = FIRST_AFTER[prevKind];
      else if (kind === "desc" && prevKind === "desc") g = 18;
      y += g;
    }
    if (y > BOTTOM) { page++; y = TOP; }
    out.push([page, MAIN_X, y, size, text]);
    if (extra && extra !== "bottom") out.push([page, MAIN_X + text.length * 5.1 + 4, y, size, extra]); // "(2 years 3 months)" is its own piece
    prevKind = kind;
  }
  return out;
}

function layoutSide(entries) {
  const out = [];
  let y = 54.4, prevKind = null;
  for (const [kind, text, label] of entries) {
    const [size, gap] = SIDE[kind];
    if (prevKind) y += prevKind === "heading" ? 19.4 : gap;
    out.push([1, SIDE_X, y, size, text]);
    if (label) out.push([1, Math.min(SIDE_X + text.length * 5.6 + 4, 150), y, size, `(${label})`]); // stays in the sidebar
    prevKind = kind;
  }
  return out;
}

// ---- a tiny PDF writer (text only, standard Helvetica, WinAnsi encoding) -----------------------------

const WINANSI = { "–": 0x96, "—": 0x97, "’": 0x92, "‘": 0x91, "“": 0x93, "”": 0x94, "•": 0x95 };
const encode = s => [...s].map(ch => (WINANSI[ch] ? String.fromCharCode(WINANSI[ch]) : ch)).join("");
const esc = s => encode(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function buildPdf({ side, main, title }) {
  const lines = [...layoutSide(side), ...layoutMain(main)];
  const pageCount = Math.max(...lines.map(l => l[0]));
  for (let p = 1; p <= pageCount; p++) {
    // The footer is four separate pieces in real exports: "Page", "1", "of", "2".
    [["Page", 384], [String(p), 407], ["of", 415], [String(pageCount), 425]].forEach(([t, x]) => lines.push([p, x, 778.1, 9, t]));
  }
  const objects = [];
  const add = body => { objects.push(body); return objects.length; };
  const catalog = add(null), pages = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids = [];
  for (let n = 1; n <= pageCount; n++) {
    const parts = ["0.95 0.95 0.95 rg 0 0 200 792 re f 0 0 0 rg"]; // grey sidebar
    for (const [p, x, y, size, text] of lines) if (p === n) parts.push(`BT /F1 ${size} Tf ${x.toFixed(1)} ${(H - y).toFixed(1)} Td (${esc(text)}) Tj ET`);
    const stream = parts.join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${content} 0 R ` +
                  `/Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objects[pages - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info << /Title (${esc(title)}) >> >>\n`;
  out += `startxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

for (const [key, profile] of Object.entries(PROFILES)) {
  const pdf = buildPdf(profile);
  const dirs = key === "sample" ? ["examples", "site/demo"] : ["tests/fixtures/linkedin-pdf"];
  for (const dir of dirs) {
    mkdirSync(join(ROOT, dir), { recursive: true });
    writeFileSync(join(ROOT, dir, profile.file), pdf);
  }
  console.log(`${profile.file}: ${pdf.length} bytes (${dirs.join(", ")})`);
}
