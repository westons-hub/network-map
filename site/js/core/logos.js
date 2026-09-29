// Company/school logos for real data: guess a website domain from the name, then
// ask a logo service for its icon. The service only ever sees the domain.

import { normalizeOrg } from "./org.js";

// Known domains, keyed by normalizeOrg() output (so aliases like "BYU" work too). Add your own,
// or set a Website on the Companies sheet.
export const DOMAINS = {
  "brigham young university": "byu.edu",
  "stanford": "stanford.edu",
  "university of utah": "admissions.utah.edu", // utah.edu itself has no favicon
  "utah state university": "usu.edu",
  "utah valley university": "uvu.edu",
  "church of jesus christ": "churchofjesuschrist.org",
  "ernst young": "ey.com",
  "google": "google.com",
  "meta": "meta.com",
  "amazon": "amazon.com",
  "amazon web services": "aws.amazon.com",
  "microsoft": "microsoft.com",
  "apple": "apple.com",
  "delta air lines": "delta.com",
  "delta": "delta.com",
  "mckinsey": "mckinsey.com",
  "mckinsey company": "mckinsey.com",
  "boston consulting group": "bcg.com",
  "bcg": "bcg.com",
  "bain": "bain.com",
  "bain company": "bain.com",
  "deloitte": "deloitte.com",
  "pwc": "pwc.com",
  "pricewaterhousecoopers": "pwc.com",
  "kpmg": "kpmg.com",
  "accenture": "accenture.com",
  "goldman sachs": "goldmansachs.com",
  "jpmorgan chase": "jpmorganchase.com",
  "jp morgan": "jpmorgan.com",
  "mojang studios": "minecraft.net",
  "qualtrics": "qualtrics.com",
  "adobe": "adobe.com",
};

/** Pull a bare domain out of 'https://www.byu.edu/about' or 'byu.edu'. */
export function domainFrom(text) {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return "";
  const host = t.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : "";
}

/**
 * Best guess at an organization's domain. `website` (from the Companies sheet) always wins.
 * 'Stanford University' -> stanford.edu, 'University of Oregon' -> oregon.edu, 'Acme Corp' -> acme.com.
 */
export function guessDomain(name, website = "") {
  const override = domainFrom(website);
  if (override) return override;
  const key = normalizeOrg(name);
  if (!key) return "";
  if (DOMAINS[key]) return DOMAINS[key];
  const words = key.split(" ");
  const slug = ws => ws.join("").replace(/[^a-z0-9]/g, "");
  if (words[0] === "university" && words[1] === "of" && words.length > 2) return `${slug(words.slice(2))}.edu`;
  const school = words.findIndex(w => ["university", "college"].includes(w));
  if (school > 0) return `${slug(words.slice(0, school))}.edu`;
  return slug(words) ? `${slug(words)}.com` : "";
}

// Where logos come from. Swap in another service here (logo.dev and Brandfetch need API keys).
export const LOGO_SOURCES = {
  google: domain => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
};
export const logoUrl = (domain, source = "google") => (domain ? LOGO_SOURCES[source](domain) : "");

/** Google answers unknown domains with a 16px globe, so tiny images mean "no logo". */
export const isRealLogo = naturalWidth => naturalWidth > 16;
