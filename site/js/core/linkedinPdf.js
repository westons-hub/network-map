// Read the PDF LinkedIn makes from a profile (on their profile: More → Save to PDF). Everything happens
// on your computer; the app never contacts linkedin.com.
//
// LinkedIn's PDF has a grey sidebar (Contact, Top Skills, Languages…) and a main column: the name in the
// largest type, then headline and location, then sections (Summary, Experience, Education…). In
// Experience, each position is a title line followed by a date line ("January 2024 - Present (1 year)");
// the company is the nearest larger-type line above it (one company can list several roles).

import { formatEntries } from "./history.js";
import { clean, normalizeOrg } from "./org.js";

const SECTIONS = ["summary", "experience", "education", "licenses & certifications", "certifications",
  "volunteer experience", "volunteering", "honors-awards", "honors & awards", "publications", "projects", "patents",
  "courses", "organizations", "recommendations", "top skills", "languages", "contact", "skills"];
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE_RANGE = new RegExp(`^(?:${MONTH}\\s+)?(\\d{4})\\s*[-–—]\\s*(present|(?:${MONTH}\\s+)?(\\d{4}))(?:\\s*\\(.*\\))?$`, "i");
const SINGLE_DATE = new RegExp(`^(?:${MONTH}\\s+)?(\\d{4})(?:\\s*\\(.*\\))?$`, "i");
const DURATION = /^(?:\d+\s+years?)?\s*(?:\d+\s+months?)?$/i;
const FOOTER = /^page\s+\d+\s+of\s+\d+$/i;

/** Text items from pdf.js: [{ str, x, y (from the top), size, page }]. Pass the pdf.js module in. */
export async function pdfItems(pdfjs, bytes) {
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const items = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    for (const it of (await page.getTextContent()).items) {
      if (!it.str?.trim()) continue;
      const [a, b, , , e, f] = it.transform;
      items.push({ str: it.str, x: e, y: height - f, size: Math.round(Math.hypot(a, b) * 4) / 4, page: n, pageWidth: width });
    }
  }
  await task.destroy();
  return items;
}

/** Group items into lines per column (sidebar vs main), in reading order. */
export function toLines(items) {
  const lines = [];
  const sorted = [...items].sort((p, q) => p.page - q.page || p.y - q.y || p.x - q.x);
  for (const it of sorted) {
    const col = it.x < (it.pageWidth ?? 612) * 0.3 ? "side" : "main";
    const last = lines.findLast(l => l.page === it.page && l.col === col);
    if (last && Math.abs(last.y - it.y) < 1.5) {
      last.text = clean(`${last.text}${/[\s-]$/.test(last.text) || /^\s/.test(it.str) ? "" : " "}${it.str}`);
      last.size = Math.max(last.size, it.size);
    } else lines.push({ page: it.page, y: it.y, x: it.x, col, size: it.size, text: clean(it.str) });
  }
  return lines.filter(l => l.text && !FOOTER.test(l.text));
}

const isHeading = l => SECTIONS.includes(l.text.toLowerCase()) && l.size >= 12.5;
const mode = values => {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
};

function years(start, end) {
  if (!start) return "";
  return end && end !== start ? `${start}–${end}` : start;
}

function parseExperience(lines) {
  const dateIdx = lines.map((l, i) => (DATE_RANGE.test(l.text) || SINGLE_DATE.test(l.text) ? i : -1)).filter(i => i > 0);
  const roleSize = mode(dateIdx.map(i => lines[i - 1].size)) ?? 0;
  const positions = [];
  let current = "";
  for (const i of dateIdx) {
    const title = lines[i - 1].text;
    // The company is the nearest line above in larger type than the role titles.
    let company = "";
    for (let j = i - 2; j >= 0; j--) {
      if (lines[j].size > roleSize + 0.1) { company = lines[j].text; break; }
    }
    if (!company) {
      const prev = lines[i - 2];
      company = prev && !DATE_RANGE.test(prev.text) && !DURATION.test(prev.text) && i - 2 === 0 ? prev.text : current || prev?.text || "";
    }
    current = company;
    const m = lines[i].text.match(DATE_RANGE) ?? lines[i].text.match(SINGLE_DATE);
    const start = m[1];
    const end = /present/i.test(m[2] ?? "") ? "Present" : m[3] ?? m[2] ?? "";
    positions.push({ company, title, start, end, years: years(start, end), current: end === "Present" });
  }
  return positions;
}

function parseEducation(lines) {
  const body = Math.min(...lines.map(l => l.size)); // degree/years lines are the smallest type; schools are larger
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].size <= body + 0.1) continue;
    const school = lines[i].text;
    const detail = lines[i + 1] && lines[i + 1].size <= body + 0.1 ? lines[i + 1].text : "";
    const y = detail.match(/\((\d{4})\s*(?:[-–—]\s*(\d{4}|present))?\)/i);
    const degree = clean(detail.replace(/\s*·?\s*\([^()]*\)\s*$/, ""));
    out.push({ school, degree, years: y ? years(y[1], /present/i.test(y[2] ?? "") ? "Present" : y[2]) : "" });
  }
  return out;
}

/** Items (from pdfItems) -> a structured profile. */
export function parseLinkedInProfile(items) {
  const lines = toLines(items);
  const main = lines.filter(l => l.col === "main");
  const side = lines.filter(l => l.col === "side");
  if (!main.length) throw new Error("This doesn't look like a LinkedIn profile PDF (no text found).");

  const firstPage = main.filter(l => l.page === main[0].page);
  const nameLine = firstPage.reduce((a, b) => (b.size > a.size ? b : a));
  const start = main.indexOf(nameLine);
  const firstHeading = main.findIndex((l, i) => i > start && isHeading(l));
  const header = main.slice(start + 1, firstHeading < 0 ? main.length : firstHeading);
  const headline = header.length > 1 ? header.slice(0, -1).map(l => l.text).join(" ") : header[0]?.text ?? "";
  const location = header.length > 1 ? header.at(-1).text : "";

  const sections = {};
  let currentSection = null;
  for (const l of main.slice(firstHeading < 0 ? main.length : firstHeading)) {
    if (isHeading(l)) { currentSection = l.text.toLowerCase(); sections[currentSection] = []; continue; }
    if (currentSection) sections[currentSection].push(l);
  }

  const summary = (sections.summary ?? []).map(l => l.text).join(" ")
    .replace(/\s+/g, " ").trim();
  const sideText = side.map(l => l.text).join(" ");
  const email = (sideText.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) ?? [])[0] ?? "";
  const slug = (side.map(l => l.text).join("").replace(/\s+/g, "").match(/linkedin\.com\/in\/([\w%-]+?)(?:\(LinkedIn\)|$|\()/i) ?? [])[1];
  if (!nameLine.text || nameLine.size < 14) throw new Error("This doesn't look like a LinkedIn profile PDF (no name found).");

  return {
    name: nameLine.text, headline, location, summary, email,
    linkedinUrl: slug ? `https://www.linkedin.com/in/${slug.replace(/-$/, "")}` : "",
    positions: parseExperience(sections.experience ?? []),
    education: parseEducation(sections.education ?? []),
  };
}

/** A parsed profile -> person fields for the review form. */
export function profileToPerson(profile) {
  const now = profile.positions.find(p => p.current) ?? profile.positions[0];
  // Past companies: every other employer, with the span of years you were there.
  const past = new Map();
  for (const p of profile.positions) {
    if (!p.company || (now && normalizeOrg(p.company) === normalizeOrg(now.company))) continue;
    const key = normalizeOrg(p.company);
    const prev = past.get(key);
    const startYear = [prev?.start, p.start].filter(Boolean).sort()[0];
    const endYear = [prev?.end, p.end].filter(Boolean).sort((a, b) => (a === "Present" ? 1 : b === "Present" ? -1 : a.localeCompare(b))).at(-1);
    past.set(key, { name: p.company, start: startYear, end: endYear });
  }
  return {
    name: profile.name,
    company: now?.company ?? "",
    role: now?.title ?? profile.headline,
    pastCompanies: formatEntries([...past.values()].map(p => ({ name: p.name, years: years(p.start, p.end) }))),
    school: formatEntries(profile.education.map(e => ({ name: e.school, years: e.years }))),
    email: profile.email,
    linkedinUrl: profile.linkedinUrl,
    notes: [profile.headline && profile.headline !== now?.title ? profile.headline : "", profile.location, profile.summary]
      .filter(Boolean).join("\n"),
  };
}
