// Name normalization shared by grouping, targets and the intro search.

// Spellings that should count as the same organization. Keys and values are
// normalized (lowercase, no punctuation or legal suffixes). Add your own.
export const ALIASES = {
  "byu": "brigham young university",
  "byu marriott": "brigham young university",
  "byu marriott school of business": "brigham young university",
  "marriott school of business": "brigham young university",
  "stanford university": "stanford",
  "u of u": "university of utah",
  "uofu": "university of utah",
  "the church of jesus christ of latterday saints": "church of jesus christ",
  "lds church": "church of jesus christ",
  "mojang": "mojang studios",
  "mojang ab": "mojang studios",
  "google llc": "google",
  "alphabet": "google",
  "meta platforms": "meta",
  "facebook": "meta",
  "ey": "ernst young",
  "ernst and young": "ernst young",
};

const SUFFIXES = new Set(["inc", "llc", "ltd", "co", "corp", "corporation", "company", "plc", "the", "lp", "llp"]);

/** 'Delta Air Lines, Inc.' -> 'delta air lines'; 'BYU' -> 'brigham young university'. */
export function normalizeOrg(name) {
  const text = String(name ?? "").toLowerCase().replaceAll("&", " ").replace(/[^\p{L}\p{N}_\s]/gu, "");
  const key = text.split(/\s+/).filter(w => w && !SUFFIXES.has(w)).join(" ");
  return ALIASES[key] ?? key;
}

/** '  Jordan   LEE ' -> 'jordan lee' (how people are matched across sheets). */
export function normalizeName(name) {
  return String(name ?? "").split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

/** Collapse whitespace; blank for null/undefined. */
export function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).split(/\s+/).filter(Boolean).join(" ");
}
