// Read the PDF LinkedIn makes from a profile (on their profile: More → Save to PDF). Everything happens
// on your computer; the app never contacts linkedin.com.
//
// The PDF has a grey left sidebar (Contact, Top Skills, Languages, Certifications, Honors-Awards,
// Publications, Patents) and a main column: the name in the largest type, the headline, the location, then
// Summary, Experience and Education. pdf.js gives each piece of text with its position and size; we split the
// columns by x, rebuild lines by y, and read each section by type size:
//   Experience: company (12pt) · optional total duration ("4 years 9 months") when a company lists several
//               roles · title (11.5pt, may start with a department: "Clinical Operations: Senior Analyst")
//               · dates ("January 2020 - Present (4 years)", or years only) · optional location
//               (right under the dates) · optional description (after a bigger gap)
//   Education:  school (12pt) · "Degree, Field · (August 2016 - May 2021)" (may wrap onto a second line)
// "Page N of M" footers are dropped and entries continue across page breaks.

import { formatEntries } from "./history.js";
import { clean, normalizeOrg } from "./org.js";

const MAIN_SECTIONS = ["summary", "experience", "education", "licenses & certifications", "certifications",
  "volunteer experience", "volunteering", "honors-awards", "honors & awards", "publications", "projects", "patents",
  "courses", "organizations", "recommendations", "skills", "languages"];
const SIDE_SECTIONS = { "contact": "contact", "top skills": "skills", "skills": "skills", "languages": "languages",
  "certifications": "certifications", "licenses & certifications": "certifications", "honors-awards": "honors",
  "honors & awards": "honors", "publications": "publications", "patents": "patents" };
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const WHEN = `(?:${MONTH}\\s+)?\\d{4}`;
const DATE_RANGE = new RegExp(`^(${WHEN})\\s*[-–—]\\s*(present|${WHEN})(?:\\s*\\(.*\\))?$`, "i");
const SINGLE_DATE = new RegExp(`^(${WHEN})(?:\\s*\\(.*\\))?$`, "i");
const DURATION = /^(?:\d+\s+years?)?\s*(?:\d+\s+months?)?$/i;
const FOOTER = /^page\s+\d+\s+of\s+\d+$/i;
const URL_LABEL = /\s*\((LinkedIn|Company|Personal|Portfolio|Blog|Other|RSS Feed)\)\s*$/i;

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

// ---- small helpers ------------------------------------------------------------------------------

const near = (a, b) => Math.abs(a - b) < 0.05;
/** Vertical distance to the previous line, or Infinity across a page break. */
const gapOf = (prev, l) => (prev && prev.page === l.page ? l.y - prev.y : Infinity);
const mode = values => {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
};

/** "August 2016" -> "2016-08", "2016" -> "2016", "Present" -> "Present". */
export function monthYear(text) {
  const t = clean(text);
  if (/^present$/i.test(t)) return "Present";
  const m = t.match(/^(?:([a-z]+)\.?\s+)?(\d{4})$/i);
  if (!m) return "";
  const month = m[1] ? MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1 : 0;
  return month ? `${m[2]}-${String(month).padStart(2, "0")}` : m[2];
}
const yearOf = v => (v === "Present" ? "Present" : String(v ?? "").slice(0, 4));

/** "2019"–"2021" -> "2019–2021" (one year if they're the same). */
export function yearSpan(start, end) {
  const s = yearOf(start), e = yearOf(end);
  if (!s) return e && e !== "Present" ? e : "";
  return e && e !== s ? `${s}–${e}` : s;
}

function parseDates(text) {
  const m = text.match(DATE_RANGE);
  if (m) return { start: monthYear(m[1]), end: monthYear(m[2]) };
  const s = text.match(SINGLE_DATE);
  return s ? { start: monthYear(s[1]), end: monthYear(s[1]) } : null;
}
const isDateLine = t => DATE_RANGE.test(t) || SINGLE_DATE.test(t);

/** A place, not a sentence: short, no sentence punctuation, no link. */
const looksLikeLocation = t => t.length <= 60 && !/[.!?]$/.test(t) && !/https?:|www\./i.test(t) && t.split(/\s+/).length <= 7;

/** "Clinical Operations: Senior Analyst - Scheduling" -> { department, role }. */
export function splitTitle(title) {
  const m = title.match(/^([^:]{2,40}):\s+(.+)$/);
  if (!m || /\d/.test(m[1]) || m[1].split(/\s+/).length > 4) return { department: "", role: title };
  return { department: m[1].trim(), role: m[2].trim() };
}

// ---- main column ----------------------------------------------------------------------------------

function parseExperience(lines, unsure) {
  const dateAt = lines.map((l, i) => (isDateLine(l.text) ? i : -1)).filter(i => i >= 0);
  const body = mode(dateAt.map(i => lines[i].size)) ?? Math.min(...lines.map(l => l.size));
  // The title is the line right above the dates, in type a little bigger than the dates.
  const titleSize = mode(dateAt.map(i => lines[i - 1]).filter(l => l && l.size > body + 0.1).map(l => l.size)) ?? body;
  const companySize = Math.max(...lines.map(l => l.size));
  const hasCompanyTier = companySize > titleSize + 0.1;

  const positions = [];
  let company = null, pos = null, prev = null, kind = "";
  for (const l of lines) {
    const gap = gapOf(prev, l);
    if (hasCompanyTier && l.size >= companySize - 0.05) {
      if (kind === "company" && gap < 16) company.name = clean(`${company.name} ${l.text}`); // a long name that wrapped
      else { company = { name: l.text, total: "" }; pos = null; }
      kind = "company";
    } else if (near(l.size, titleSize) && titleSize > body + 0.1 && !isDateLine(l.text)) {
      if (kind === "title" && gap < 15) pos.title = clean(`${pos.title} ${l.text}`);
      else {
        pos = { company: company?.name ?? "", title: l.text, start: "", end: "", location: "", description: "", multi: !!company?.total };
        positions.push(pos);
      }
      kind = "title";
    } else if (isDateLine(l.text) && (kind === "title" || kind === "company" || kind === "duration" || !pos?.start)) {
      if (!pos || pos.start) {
        pos = { company: company?.name ?? "", title: "", start: "", end: "", location: "", description: "", multi: false };
        positions.push(pos);
        unsure.push({ field: "experience", message: `A role at ${pos.company || "an unknown company"} has no title.` });
      }
      Object.assign(pos, parseDates(l.text));
      kind = "dates";
    } else if (kind === "company" && DURATION.test(l.text)) {
      company.total = l.text; // several roles at this company follow
      kind = "duration";
    } else if (pos?.start) {
      if (kind === "dates" && (gap < 17 || (gap === Infinity && looksLikeLocation(l.text))) && looksLikeLocation(l.text)) {
        pos.location = l.text;
        kind = "location";
      } else {
        const sep = !pos.description ? "" : gap > 22 && gap !== Infinity ? "\n" : " "; // wrapped lines are ~18pt apart
        pos.description = `${pos.description}${sep}${l.text}`;
        kind = "description";
      }
    }
    prev = l;
  }
  for (const p of positions) {
    if (!p.company) unsure.push({ field: "experience", message: `"${p.title}" has no company.` });
    if (!p.start) unsure.push({ field: "experience", message: `No dates for "${p.title}" at ${p.company}.` });
    Object.assign(p, splitTitle(p.title), { current: p.end === "Present", years: yearSpan(p.start, p.end) });
  }
  return positions;
}

function parseEducation(lines, unsure) {
  const body = Math.min(...lines.map(l => l.size)); // degree/dates are the smallest type; schools are larger
  const out = [];
  let cur = null, prev = null;
  for (const l of lines) {
    if (l.size > body + 0.1) {
      if (cur && !cur.detail && prev?.size > body + 0.1 && gapOf(prev, l) < 16) cur.school = clean(`${cur.school} ${l.text}`);
      else { cur = { school: l.text, detail: "" }; out.push(cur); }
    } else if (cur) cur.detail = clean(`${cur.detail} ${l.text}`);
    prev = l;
  }
  return out.map(({ school, detail }) => {
    const d = detail.match(/\(([^()]*)\)\s*$/);
    const dates = d ? parseDates(d[1].trim()) : null;
    const text = clean(detail.replace(/\s*·?\s*\([^()]*\)\s*$/, ""));
    const comma = text.indexOf(", ");
    const [degree, field] = comma > 0 ? [text.slice(0, comma), text.slice(comma + 2)] : [text, ""];
    if (!dates) unsure.push({ field: "education", message: `No years for ${school}.` });
    return { school, degree, field, start: dates?.start ?? "", end: dates?.end ?? "", years: dates ? yearSpan(dates.start, dates.end) : "" };
  });
}

// ---- sidebar ----------------------------------------------------------------------------------------

/** Sidebar lines -> { contact: [lines], skills: [items], languages: [...], ... }. */
function sideSections(side) {
  const heading = mode(side.map(l => l.size).filter(s => s >= 12.5)) ?? 13;
  const out = {};
  let cur = null, prev = null;
  for (const l of side) {
    const key = SIDE_SECTIONS[l.text.toLowerCase()];
    if (key && l.size >= heading - 0.3) { cur = out[key] = []; prev = null; continue; }
    if (!cur) continue;
    cur.push({ ...l, gap: gapOf(prev, l) });
    prev = l;
  }
  return out;
}

/** One item per entry: a wrapped line (closer than a normal item gap) continues the previous item. */
function sideItems(lines = []) {
  const items = [];
  for (const l of lines) {
    if (items.length && l.gap < 14) items[items.length - 1] = clean(`${items.at(-1)} ${l.text}`);
    else items.push(l.text);
  }
  return items;
}

/** Contact lines -> email, LinkedIn URL, company website, other sites. URLs and emails can wrap mid-word. */
function parseContact(lines = [], unsure) {
  const entries = [];
  for (const l of lines) {
    const last = entries.at(-1);
    const startsNew = /^(?:https?:\/\/|www\.)/i.test(l.text) || l.text.includes("@");
    const continues = last && !URL_LABEL.test(last) && (
      (l.gap < 13.5 && !startsNew) ||                                   // a wrapped email or URL
      (!last.includes("@") && /[./-]$/.test(last) && !startsNew));      // a URL that broke after "-", "/" or "."
    if (continues) entries[entries.length - 1] = `${last}${l.text}`;
    else entries.push(l.text);
  }
  const out = { email: "", linkedinUrl: "", website: "", sites: [] };
  for (const raw of entries) {
    const label = raw.match(URL_LABEL)?.[1]?.toLowerCase() ?? "";
    const value = raw.replace(URL_LABEL, "").replace(/\s+/g, "");
    if (!out.email && /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(value)) {
      out.email = value;
      if (!/\.[a-z]{2,}$/i.test(value)) unsure.push({ field: "email", message: "The email address may be cut off." });
    } else if (/linkedin\.com\/in\//i.test(value) || label === "linkedin") {
      const slug = value.match(/linkedin\.com\/in\/([\w%-]+)/i)?.[1]?.replace(/-$/, "");
      if (slug) out.linkedinUrl = `https://www.linkedin.com/in/${slug}`;
    } else if (/^(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+/i.test(value)) {
      const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      if (label === "company" && !out.website) out.website = url;
      else out.sites.push({ label: label || "other", url });
    }
  }
  return out;
}

/** "Spanish (Professional Working)" -> { name, proficiency }. */
const parseLanguage = t => {
  const m = t.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  return m ? { name: m[1], proficiency: m[2] } : { name: t, proficiency: "" };
};

// ---- everything together -----------------------------------------------------------------------------

/** Items (from pdfItems) -> a structured profile, with `unsure` notes for anything it had to guess. */
export function parseLinkedInProfile(items) {
  const lines = toLines(items);
  const main = lines.filter(l => l.col === "main");
  const side = lines.filter(l => l.col === "side");
  if (!main.length) throw new Error("This doesn't look like a LinkedIn profile PDF (no text found).");
  const unsure = [];

  const firstPage = main.filter(l => l.page === main[0].page);
  const nameLine = firstPage.reduce((a, b) => (b.size > a.size ? b : a));
  if (!nameLine.text || nameLine.size < 14) throw new Error("This doesn't look like a LinkedIn profile PDF (no name found).");
  const headingSize = mode(main.filter(l => MAIN_SECTIONS.includes(l.text.toLowerCase())).map(l => l.size)) ?? 15.75;
  const isHeading = l => MAIN_SECTIONS.includes(l.text.toLowerCase()) && l.size >= Math.min(12.5, headingSize - 0.1);

  const start = main.indexOf(nameLine);
  const firstHeading = main.findIndex((l, i) => i > start && isHeading(l));
  const header = main.slice(start + 1, firstHeading < 0 ? main.length : firstHeading);
  // Headline (may wrap) then location, which sits a little further down.
  let headline = header.map(l => l.text).join(" "), location = "";
  if (header.length > 1) {
    headline = header.slice(0, -1).map(l => l.text).join(" ");
    location = header.at(-1).text;
  } else if (header.length === 1) unsure.push({ field: "location", message: "Couldn't tell the headline from the location." });

  const sections = {};
  let current = null;
  for (const l of main.slice(firstHeading < 0 ? main.length : firstHeading)) {
    if (isHeading(l)) { current = l.text.toLowerCase(); sections[current] ??= []; continue; }
    if (current) sections[current].push(l);
  }
  let summary = "", prev = null;
  for (const l of sections.summary ?? []) {
    const gap = gapOf(prev, l);
    summary += !summary ? l.text : `${gap > l.size * 2.2 && gap !== Infinity ? "\n" : " "}${l.text}`;
    prev = l;
  }

  const sideBy = sideSections(side);
  const contact = parseContact(sideBy.contact, unsure);
  const positions = sections.experience?.length ? parseExperience(sections.experience, unsure) : [];
  const education = sections.education?.length ? parseEducation(sections.education, unsure) : [];
  if (!positions.length) unsure.push({ field: "experience", message: "No experience found." });

  return {
    name: nameLine.text, headline, location, summary: summary.trim(),
    email: contact.email, linkedinUrl: contact.linkedinUrl, website: contact.website, sites: contact.sites,
    skills: sideItems(sideBy.skills),
    languages: sideItems(sideBy.languages).map(parseLanguage),
    certifications: sideItems(sideBy.certifications),
    honors: sideItems(sideBy.honors),
    publications: sideItems(sideBy.publications),
    patents: sideItems(sideBy.patents),
    positions, education, unsure,
  };
}

/** Roles you hold now, most recent start first (the default current role is the first). */
export function currentRoles(profile) {
  return profile.positions.filter(p => p.current).sort((a, b) => (b.start || "").localeCompare(a.start || ""));
}

/**
 * A parsed profile -> what the review screen shows:
 *   person      fields for the People row (current company + role, past companies, schools, skills…)
 *   experience  rows for the Experience sheet; education rows for the Education sheet
 *   currentOptions  the roles marked Present (a picker when there are several)
 * Pass `current` (an index into currentOptions) to pick a different current role.
 */
export function profileToPerson(profile, { current = 0 } = {}) {
  const options = currentRoles(profile);
  const now = options[current] ?? options[0] ?? profile.positions[0];
  const unsure = [...profile.unsure];
  if (!options.length && now) unsure.push({ field: "company", message: "No current (Present) role; used the most recent one." });
  if (options.length > 1) unsure.push({ field: "company", message: `${options.length} current roles; pick the main one.` });

  // Past companies: every other employer, with the span of years there. Other current employers stay listed
  // with "–Present" so they link to the person too.
  const past = new Map();
  for (const p of profile.positions) {
    if (!p.company || (now && normalizeOrg(p.company) === normalizeOrg(now.company))) continue;
    const key = normalizeOrg(p.company);
    const prev = past.get(key);
    const starts = [prev?.start, p.start].filter(Boolean).sort();
    const ends = [prev?.end, p.end].filter(Boolean).sort((a, b) => (a === "Present" ? 1 : b === "Present" ? -1 : a.localeCompare(b)));
    past.set(key, { name: p.company, start: starts[0], end: ends.at(-1) });
  }
  const list = xs => xs.filter(Boolean).join("; ");
  const person = {
    name: profile.name,
    company: now?.company ?? "",
    role: now?.role ?? now?.title ?? profile.headline,
    headline: profile.headline,
    location: profile.location,
    email: profile.email,
    linkedinUrl: profile.linkedinUrl,
    website: profile.website,
    pastCompanies: formatEntries([...past.values()].map(p => ({ name: p.name, years: yearSpan(p.start, p.end) }))),
    school: formatEntries(profile.education.map(e => ({ name: e.school, years: e.years }))),
    skills: list(profile.skills),
    languages: list(profile.languages.map(l => (l.proficiency ? `${l.name} (${l.proficiency})` : l.name))),
    certifications: list(profile.certifications),
    honors: list([...profile.honors, ...profile.publications, ...profile.patents]),
    about: profile.summary,
  };
  const experience = profile.positions.map(p => ({ person: profile.name, company: p.company, title: p.title,
    start: p.start, end: p.end, location: p.location, description: p.description }));
  const education = profile.education.map(e => ({ person: profile.name, school: e.school, degree: e.degree, field: e.field,
    start: e.start, end: e.end }));
  return { person, experience, education, currentOptions: options, unsure };
}
