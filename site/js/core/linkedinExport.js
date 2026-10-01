// Your whole LinkedIn data export (the zip LinkedIn emails you, the unzipped folder, or single CSVs), read in the
// browser. Only the files and fields listed here are used; the rest are never parsed (messages text, phone
// numbers, ID verification, ad data…). DOM-free, so it's tested in Node.
//
//   Connections.csv      -> LinkedIn pool                Profile.csv / Profile Summary.csv -> My profile
//   Positions.csv        -> my jobs                      Education.csv  -> my schools
//   Skills.csv, Certifications.csv, Volunteering.csv -> mine    Email Addresses.csv -> my primary email
//   Company Follows.csv  -> suggested targets            Invitations.csv -> who reached out first, pending invites
//   Notes.csv            -> my LinkedIn notes on people  messages.csv -> ONLY if you opt in: count + last date per person

import { formatEntries, parseEntries } from "./history.js";
import { clean, normalizeName, normalizeOrg } from "./org.js";
import { INVITE_PENDING, csvRecords, parseCsv, parseDate, poolEntry, poolName } from "./people.js";
import { mergePool } from "./pool.js";

/** File name -> what it is. Names match ignoring case, spaces and underscores ("Company_Follows.csv"). */
const KINDS = {
  connections: "connections", profile: "profile", profilesummary: "profileSummary", positions: "positions",
  education: "education", skills: "skills", certifications: "certifications", volunteering: "volunteering",
  emailaddresses: "emails", companyfollows: "follows", invitations: "invitations", messages: "messages", notes: "notes",
};
const IGNORED = ["learning", "richmedia", "savedjobalerts"]; // maybe later
const NEVER = ["adtargeting", "registration", "phonenumbers", "verifications", "guidemessages", "learningcoachmessages",
               "learningroleplaymessages"];
const squash = s => s.toLowerCase().replace(/\.csv$/, "").replace(/[\s_-]+/g, "");

/** "Basic_Export/Company Follows.csv" -> "follows" | "never" | "ignored" | null (not a LinkedIn file). */
export function exportFileKind(path) {
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  if (parts.some(p => squash(p) === "verifications")) return "never";
  const name = parts.at(-1) ?? "";
  if (!/\.csv$/i.test(name)) return null;
  const key = squash(name);
  if (NEVER.includes(key)) return "never";
  if (IGNORED.includes(key)) return "ignored";
  return KINDS[key] ?? null;
}
/** Whether a file inside a zip should even be decompressed. */
export const wantedInZip = path => /\.zip$/i.test(path) || !["never", "ignored", null].includes(exportFileKind(path));

/**
 * A zip (bytes) -> [{ path, text }] of the files we use, including zips inside the zip. Pass the fflate module in.
 * Files we don't use are never decompressed.
 */
export function unzipExport(fflate, bytes, prefix = "") {
  const out = [];
  const files = fflate.unzipSync(bytes, { filter: f => wantedInZip(f.name) });
  for (const [name, data] of Object.entries(files)) {
    if (/\.zip$/i.test(name)) out.push(...unzipExport(fflate, data, `${prefix}${name}/`));
    else if (exportFileKind(name)) out.push({ path: `${prefix}${name}`, text: new TextDecoder().decode(data) });
  }
  return out;
}

// ---- small parsers ----------------------------------------------------------------------------------

/** Records under the header row (skipping LinkedIn's "Notes:" lines above it). */
function records(text, firstHeader) {
  const rows = csvRecords(text, firstHeader.toLowerCase());
  return rows ?? [];
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** "Jan 2021" -> "2021-01", "2019" -> "2019", "" -> "". */
function monthYear(v) {
  const t = clean(v);
  const m = t.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[2]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, "0")}`;
  return /^\d{4}$/.test(t) ? t : "";
}
const yearSpan = (a, b, current) => { const s = a.slice(0, 4), e = b ? b.slice(0, 4) : current ? "Present" : ""; return s && e && e !== s ? `${s}–${e}` : s || e; };
/** "9/29/26, 11:17 PM" (Invitations) or "2026-09-29 23:17:00 UTC" (messages) -> "2026-09-29". */
function anyDate(v) {
  const t = clean(v);
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  m = t.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return parseDate(t);
}
/** Profile URLs compare without protocol, www, trailing slash or case. */
export const urlKey = u => String(u ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "")
  .replace(/[?#].*$/, "").replace(/\/+$/, "");

// ---- read the files -----------------------------------------------------------------------------------

/**
 * [{ path, text }] -> everything found (nothing applied yet). Messages are only summarized (count + dates per
 * person), and only their dates and participants are read.
 */
export function readExport(files) {
  const byKind = {};
  for (const f of files) {
    const kind = exportFileKind(f.path);
    if (kind && kind !== "never" && kind !== "ignored" && !(kind in byKind)) byKind[kind] = f.text;
  }
  const found = { files: Object.keys(byKind) };

  found.connections = byKind.connections ? records(byKind.connections, "First Name").map(poolEntry).filter(e => e.firstName || e.lastName) : [];

  if (byKind.profile) {
    const p = records(byKind.profile, "First Name")[0] ?? {};
    // Never kept: Birth Date, Address, Zip Code, Instant Messengers, Maiden Name, Twitter Handles.
    found.profile = { name: clean(`${p["First Name"] ?? ""} ${p["Last Name"] ?? ""}`), headline: clean(p.Headline),
                      about: String(p.Summary ?? "").trim(), industry: clean(p.Industry), location: clean(p["Geo Location"]),
                      websites: clean(String(p.Websites ?? "").replace(/^\[|\]$/g, "")) };
  }
  if (byKind.profileSummary) {
    const rows = parseCsv(byKind.profileSummary).filter(r => r.some(v => clean(v)));
    const text = String(rows[1]?.[0] ?? "").trim();
    if (text) { found.profile ??= {}; if (!found.profile.about) found.profile.about = text; }
  }
  found.positions = byKind.positions ? records(byKind.positions, "Company Name").map(r => ({
    company: clean(r["Company Name"]), title: clean(r.Title), description: String(r.Description ?? "").trim(), location: clean(r.Location),
    start: monthYear(r["Started On"]), end: monthYear(r["Finished On"]) })).filter(p => p.company) : [];
  found.education = byKind.education ? records(byKind.education, "School Name").map(r => ({
    school: clean(r["School Name"]), degree: clean(r["Degree Name"]), start: monthYear(r["Start Date"]), end: monthYear(r["End Date"]),
    activities: clean(r.Activities) })).filter(e => e.school) : [];
  found.skills = byKind.skills ? records(byKind.skills, "Name").map(r => clean(r.Name)).filter(Boolean) : [];
  found.certifications = byKind.certifications ? records(byKind.certifications, "Name").map(r => ({
    name: clean(r.Name), authority: clean(r.Authority), start: monthYear(r["Started On"]), url: clean(r.Url) })).filter(c => c.name) : [];
  found.volunteering = byKind.volunteering ? records(byKind.volunteering, "Company Name").map(r => ({
    org: clean(r["Company Name"]), role: clean(r.Role), cause: clean(r.Cause), start: monthYear(r["Started On"]), end: monthYear(r["Finished On"]) }))
    .filter(v => v.org) : [];
  const emails = byKind.emails ? records(byKind.emails, "Email Address") : [];
  found.email = clean((emails.find(r => /^yes$/i.test(clean(r.Primary))) ?? emails[0])?.["Email Address"]);
  found.follows = byKind.follows ? records(byKind.follows, "Organization").map(r => clean(r.Organization)).filter(Boolean) : [];
  found.invitations = byKind.invitations ? records(byKind.invitations, "From").map(r => ({
    from: clean(r.From), to: clean(r.To), sentAt: anyDate(r["Sent At"]), note: String(r.Message ?? "").trim(),
    direction: clean(r.Direction).toUpperCase(), inviter: urlKey(r.inviterProfileUrl), invitee: urlKey(r.inviteeProfileUrl) })) : [];
  found.notes = byKind.notes ? records(byKind.notes, "Connection First Name").map(r => ({
    name: clean(`${r["Connection First Name"] ?? ""} ${r["Connection Last Name"] ?? ""}`), url: urlKey(r["Connection Profile URL"]),
    note: String(r.Note ?? "").trim() })).filter(n => n.note) : [];
  found.hasMessages = !!byKind.messages;
  found.messageText = byKind.messages ?? ""; // summarized only on request (messageStats); never stored
  return found;
}

/**
 * messages.csv -> per profile URL: { count, last, firstFromMe }. Reads only participants and dates; the message
 * text, subjects and attachments are never looked at. "Me" is the participant in the most messages.
 */
export function messageStats(text) {
  const rows = parseCsv(text);
  const head = rows.findIndex(r => r.some(c => clean(c).toUpperCase() === "SENDER PROFILE URL"));
  if (head < 0) return new Map();
  const h = rows[head].map(c => clean(c).toUpperCase());
  const col = name => h.indexOf(name);
  const [iFrom, iTo, iDate] = [col("SENDER PROFILE URL"), col("RECIPIENT PROFILE URLS"), col("DATE")];
  const msgs = rows.slice(head + 1).filter(r => r.length > iDate).map(r => ({
    from: urlKey(r[iFrom]), to: String(r[iTo] ?? "").split(/[,\s]+/).map(urlKey).filter(Boolean), date: anyDate(r[iDate]) }));
  const tally = new Map();
  for (const m of msgs) for (const u of [m.from, ...m.to]) if (u) tally.set(u, (tally.get(u) ?? 0) + 1);
  const me = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
  const stats = new Map();
  for (const m of msgs) {
    for (const u of new Set([m.from, ...m.to])) {
      if (!u || u === me) continue;
      const s = stats.get(u) ?? { count: 0, last: "", firstFromMe: "" };
      s.count++;
      if (m.date > s.last) s.last = m.date;
      if (m.from === me && (!s.firstFromMe || m.date < s.firstFromMe)) s.firstFromMe = m.date;
      stats.set(u, s);
    }
  }
  return stats;
}

// ---- what it becomes ---------------------------------------------------------------------------------

/** Pool entries: connections with who reached out first (and, if opted in, message counts) + pending invites. */
export function poolFromExport(found, { useMessages = false } = {}) {
  const stats = useMessages && found.hasMessages ? messageStats(found.messageText) : new Map();
  const byUrl = new Map(), byName = new Map();
  for (const inv of found.invitations) {
    const other = inv.direction === "OUTGOING" ? inv.invitee : inv.inviter;
    const name = inv.direction === "OUTGOING" ? inv.to : inv.from;
    if (other) byUrl.set(other, inv);
    if (name) byName.set(normalizeName(name), inv);
  }
  const notes = new Map(found.notes.map(n => [n.url || normalizeName(n.name), n.note]));
  const connected = new Set();
  const entries = found.connections.map(e => {
    const k = urlKey(e.url);
    connected.add(k); connected.add(normalizeName(poolName(e)));
    const inv = byUrl.get(k) ?? byName.get(normalizeName(poolName(e)));
    const s = stats.get(k);
    const out = { ...e };
    if (inv) { out.reachedOut = inv.direction === "OUTGOING" ? "You" : "Them"; out.invitedOn = inv.sentAt; if (inv.note) out.inviteNote = inv.note; }
    if (s) { out.messages = String(s.count); out.lastContacted = s.last; if (!out.invitedOn && s.firstFromMe) { out.reachedOut ??= "You"; out.invitedOn = s.firstFromMe; } }
    const note = notes.get(k) ?? notes.get(normalizeName(poolName(e)));
    if (note) out.note = note;
    return out;
  });
  // Invites you sent that haven't been accepted: in the pool as "Invite pending" (suggests To Reach Out).
  const pending = found.invitations.filter(i => i.direction === "OUTGOING" && !connected.has(i.invitee) && !connected.has(normalizeName(i.to)))
    .map(i => {
      const [firstName, ...rest] = i.to.split(/\s+/);
      return { firstName: firstName ?? "", lastName: rest.join(" "), url: i.invitee ? `https://www.${i.invitee}` : "", email: "", company: "",
               position: "", connectedOn: "", reachedOut: INVITE_PENDING, invitedOn: i.sentAt, ...(i.note ? { inviteNote: i.note } : {}) };
    }).filter(e => e.firstName);
  return { entries: [...entries, ...pending], pending: pending.length, withInvite: entries.filter(e => e.reachedOut).length,
           withMessages: entries.filter(e => e.messages).length };
}

/** Your profile from the export, filling only what's empty (your edits always win). */
export function profileFromExport(found, current = {}, me = "") {
  const fill = {};
  const set = (k, v) => { if (v && !clean(current[k])) fill[k] = v; };
  const p = found.profile ?? {};
  set("headline", p.headline); set("about", p.about); set("industry", p.industry); set("location", p.location); set("websites", p.websites);
  // Jobs: the current one (no end date) is your company and role; the rest are past companies with years.
  const now = found.positions.find(x => !x.end);
  if (now) { set("company", now.company); set("role", now.title); }
  const past = found.positions.filter(x => x !== now).map(x => ({ name: x.company, years: yearSpan(x.start, x.end) }));
  const merge = (text, list) => {
    const have = parseEntries(text);
    for (const e of list) if (e.name && !have.some(h => normalizeOrg(h.name) === normalizeOrg(e.name))) have.push(e);
    return formatEntries(have);
  };
  const pastText = merge(current.pastCompanies, past);
  if (pastText !== (current.pastCompanies ?? "")) fill.pastCompanies = pastText;
  const schools = merge(current.school, found.education.map(e => ({ name: e.school, years: yearSpan(e.start, e.end) })));
  if (schools !== (current.school ?? "")) fill.school = schools;
  const vol = merge(current.volunteering, found.volunteering.map(v => ({ name: v.org, years: yearSpan(v.start, v.end, true) })));
  if (vol !== (current.volunteering ?? "")) fill.volunteering = vol;
  const addList = (k, list) => {
    const have = String(current[k] ?? "").split(";").map(x => x.trim()).filter(Boolean);
    const next = [...have, ...list.filter(x => !have.some(h => h.toLowerCase() === x.toLowerCase()))];
    if (next.length !== have.length) fill[k] = next.join("; ");
  };
  addList("skills", found.skills);
  addList("certifications", found.certifications.map(c => c.name));
  set("email", found.email);
  const name = !clean(me) && p.name ? p.name : "";
  return { fields: fill, name };
}

/**
 * The summary shown before importing: [{ key, label, count, detail, on }]. `on` is the default checkbox.
 * Messages are off unless you tick them.
 */
export function exportSummary(found, model) {
  const onMap = new Set(model.people.map(p => normalizeName(p.name)));
  const targets = new Set(model.targets.map(t => normalizeOrg(t.company)));
  const invites = found.invitations.length;
  const rows = [
    ["connections", `${found.connections.length} connections`, found.connections.length, "go to your LinkedIn pool (nothing is added to the map yet)"],
    ["invitations", `${invites} invitations`, invites, "who reached out first, when, and pending invites"],
    ["profile", "Your profile", found.profile ? 1 : 0, "name, headline, About, industry, location, websites (only empty fields are filled)"],
    ["positions", `${found.positions.length} ${found.positions.length === 1 ? "job" : "jobs"}`, found.positions.length, "your company and past companies (\"Former coworker\" badges)"],
    ["education", `${found.education.length} ${found.education.length === 1 ? "school" : "schools"}`, found.education.length, "\"Same school\" badges"],
    ["skills", `${found.skills.length} skills`, found.skills.length, ""],
    ["certifications", `${found.certifications.length} certifications`, found.certifications.length, ""],
    ["volunteering", `${found.volunteering.length} volunteer ${found.volunteering.length === 1 ? "role" : "roles"}`, found.volunteering.length, "count like past companies"],
    ["email", "Your primary email", found.email ? 1 : 0, "the organizer on your invites"],
    ["notes", `${found.notes.length} LinkedIn ${found.notes.length === 1 ? "note" : "notes"}`, found.notes.length, "added to those people's notes, marked \"From LinkedIn\""],
    ["follows", `${found.follows.length} followed companies`, found.follows.filter(c => !targets.has(normalizeOrg(c))).length, "pick any to add as targets"],
  ];
  const out = rows.filter(([, , n]) => n > 0).map(([key, label, count, detail]) => ({ key, label, count, detail, on: true }));
  if (found.hasMessages) out.push({ key: "messages", label: "Message history", count: 1, detail: "only to work out \"last contacted\" and message counts; no message text is kept", on: false });
  return { rows: out, noConnections: !found.connections.length, onMap: found.connections.filter(e => onMap.has(normalizeName(poolName(e)))).length };
}

/**
 * The edits an import makes. choices: { rows: Set of summary keys to use, targets: [company names to add] }.
 * Re-importing a newer export merges without duplicates and never overwrites your edits.
 */
export function exportOps(model, found, { rows, targets = [] }) {
  const use = k => rows.has(k);
  const ops = [];
  const cut = {
    ...found,
    invitations: use("invitations") ? found.invitations : [],
    notes: use("notes") ? found.notes : [],
    connections: use("connections") ? found.connections : [],
  };
  const pool = poolFromExport(cut, { useMessages: use("messages") });
  if (pool.entries.length) ops.push({ type: "mergePool", entries: pool.entries });
  const prof = profileFromExport({
    profile: use("profile") ? found.profile : undefined,
    positions: use("positions") ? found.positions : [], education: use("education") ? found.education : [],
    skills: use("skills") ? found.skills : [], certifications: use("certifications") ? found.certifications : [],
    volunteering: use("volunteering") ? found.volunteering : [], email: use("email") ? found.email : "",
  }, model.profile, model.me);
  if (Object.keys(prof.fields).length) ops.push({ type: "setProfile", fields: prof.fields });
  if (prof.name) ops.push({ type: "setMe", name: prof.name });
  if (use("email") && found.email && !model.settings.email) ops.push({ type: "setSettings", settings: { email: found.email } });
  // Someone on your map changed jobs since your last import: their old company and role move to Past Companies.
  const moved = new Map(mergePool(model.pool, pool.entries).changedCompany.map(c => [normalizeName(c.name), c]));
  for (const p of model.people) {
    const c = moved.get(normalizeName(p.name));
    if (!c || normalizeOrg(p.company) !== normalizeOrg(c.from)) continue; // only if their row still says the old company
    const entry = pool.entries.find(e => normalizeName(poolName(e)) === normalizeName(p.name));
    const past = parseEntries(p.pastCompanies);
    if (!past.some(x => normalizeOrg(x.name) === normalizeOrg(c.from))) past.push({ name: c.from, years: "" });
    ops.push({ type: "patchPerson", key: normalizeName(p.name), fields: { company: c.to, role: entry?.position || p.role, pastCompanies: formatEntries(past) } });
  }
  // People already on your map: fill their empty "Date Reached Out" / "Last Contacted" and add LinkedIn notes.
  for (const e of pool.entries) {
    const p = model.people.find(x => normalizeName(x.name) === normalizeName(poolName(e)) || (e.url && urlKey(x.linkedinUrl) === urlKey(e.url)));
    if (!p) continue;
    const fields = {};
    const extra = { ...p.extra };
    if (e.reachedOut === "You" && e.invitedOn && !extra["Date Reached Out"]) extra["Date Reached Out"] = e.invitedOn;
    if (e.lastContacted && (!extra["Last Contacted"] || extra["Last Contacted"] < e.lastContacted)) extra["Last Contacted"] = e.lastContacted;
    if (JSON.stringify(extra) !== JSON.stringify(p.extra)) fields.extra = extra;
    if (e.note && !String(p.notes ?? "").includes(e.note)) fields.notes = [p.notes, `From LinkedIn: ${e.note}`].filter(Boolean).join("\n");
    if (Object.keys(fields).length) ops.push({ type: "patchPerson", key: normalizeName(p.name), fields });
  }
  for (const company of targets) {
    if (!model.targets.some(t => normalizeOrg(t.company) === normalizeOrg(company))) ops.push({ type: "upsertTarget", target: { company, priority: "", stage: "Researching", notes: "Followed on LinkedIn", extra: {} } });
  }
  return { ops, pool };
}
