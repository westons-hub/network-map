# Network Map v2: build spec for Claude Code

This is the single spec. V2_ADDITIONS.md (and the change to its section B) has been merged in here.
Build in the phases at the bottom, run the tests, and **commit locally after each phase. Don't push until I say so.**
After each phase, show me screenshots of what changed. Ask me about anything unclear before building it.

## Goal

This is a portfolio project for job applications. A recruiter should be able to **click one link and use it
instantly**, with nothing to install and no sign-up.

## Ground rules

- **Browser-only** web app on **GitHub Pages**: plain HTML/CSS/JS ES modules in `site/`, no server, no backend, no build step.
- **All data stays in the browser. Nothing is uploaded**, and there are no analytics or trackers. Say so on the page.
  The only outside requests are company logos (the logo service sees a domain) and opt-in Gravatar (it sees an email hash).
  Section H adds optional calendar sign-in, which sends only the events I create.
- **No LinkedIn scraping:** only my own data exports plus manual entry.
- **Never commit real data.** `.gitignore` blocks `.xlsx`, `.csv`, `.html` exports and intro reports, except the demo
  (`site/demo/`), the blank template and test fixtures. Demo **people** are fictional.
- Vendor third-party JS into `site/vendor/` (vis-network, SheetJS, DiceBear) so the site has no CDN dependency.
  `site/vendor/ATTRIBUTION.md` lists each one with its license.
- Tests: `node --test` over the DOM-free logic in `site/js/core/`. Nothing needs `npm install` to *run* the site;
  dev-only packages (DiceBear) are used just to vendor files.
- **Deploy:** `.github/workflows/pages.yml` publishes `site/` to Pages on push to `main`; tests run first and block the deploy.

## 1. Excel is the database (read and written in the browser) ✅

- SheetJS reads and writes `.xlsx`. Chrome/Edge save in place (File System Access API); Safari/Firefox download the updated file.
- Before writing: back up the previous version in IndexedDB (last 10, downloadable/restorable). If the file changed on
  disk (edited in Excel), reload it and replay my pending edits instead of overwriting.
- Unsaved changes: a dot on Save, a warning on leaving, and autosave to browser storage.
- Migrate old files automatically. Demo edits only touch an in-browser copy; "Reset demo" restores it.
- Sheets (see E and F for the final People layout and the new sheets):
  **People**, **Targets** (Company, Priority, Stage, Notes), **Companies** (Company, Website, Logo),
  **LinkedIn Pool**, **Meetings**, **Tasks**, **Settings**, **Layout** (hidden).

## 2. Add people with a lookup (so it isn't overwhelming)

- The map starts small: **me + my targets + only the people I've added.** LinkedIn connections never flood the map.
- **Import LinkedIn:** choose `Connections.csv` → it goes into the LinkedIn Pool sheet, not onto the map.
  - Use every column: First Name, Last Name, URL, Email Address, Company, Position, Connected On (a date).
  - Skip the "Notes:" lines above the header. Re-importing never duplicates (dedupe by profile URL, then name).
  - If someone's company changed since the last import, move the old company and position into their Past Companies (see D).
- **Add person:** type-ahead over the pool (name, company, title) → a form prefilled from LinkedIn; or add someone not on LinkedIn.
  The form edits all fields (see F). My manual edits always beat LinkedIn data.
- Edit or remove a person from the details panel.

## 3. Targets are core ✅ (alumni and pool pieces pending)

- **Targets** is the top section of the sidebar. "+ Add target" (type-ahead over my people, pool and groups, plus free
  text; Priority P1/P2/P3; Stage Researching / Networking / Applied / Interviewing / Offer; Notes). Edit/remove from the
  card; "Make this a target" on company groups. Works in demo mode.
- Every target is always its own node (red ring, logo); anyone I know there attaches to it.
- For each target: how many people I know there, **alumni** (see D, ranked below current employees), my best path in
  (full chain, warmest contact first), a clear "no connections yet" state, and who in my LinkedIn Pool works there
  but isn't on the map, with one click to add them.
- Clicking a target focuses the map and draws the best path in red. Offer "Download intro report (.md)".

## 4. Company and school logos

- Company, school and target bubbles use `shape: "circularImage"`.
- **Logo source:** Google's favicon service `https://www.google.com/s2/favicons?domain=<domain>&sz=128`, loaded at
  runtime by the browser (browser-cached; domains with no logo are remembered). Swappable later (logo.dev / Brandfetch need keys).
  - Google returns a 16px globe for unknown domains, so ≤16px counts as "no logo".
  - No CORS headers, so favicons can't be embedded in the offline export; use the initials logo there.
- **Domain:** the Companies sheet's Website wins; otherwise guess it from the name with aliases (BYU → byu.edu).
- **Demo:** uses **real, well-known companies and schools** with their real logos, via **explicit domains in the demo
  Companies sheet** (no logo files committed). Fallback: a generated initials logo.
- Footer note (demo): **"Company names and logos are trademarks of their owners; demo people are fictional."**

## 5. Profile pictures

- LinkedIn's export has **no photos**, and we don't scrape. **No photos of real people in the demo.**
- **Demo people:** illustrated **DiceBear avatars in the CC0 "Notionists" style**, generated locally in the browser
  (vendored library, seeded by name). Attribution in `site/vendor/ATTRIBUTION.md`. Controlled by a Settings value
  "Avatar style" (the demo workbook sets it; my own data defaults to initials, and I can turn it on too).
- **My own data:** the Photo field. "Add photo" picks an image file (resized in the browser to ~96×96, stored as a data
  URI in the Photo cell) or pastes an image URL. Real uploaded photos are only for my own data.
- Optional, **off by default**: Gravatar by email (SHA-256 via Web Crypto).
- Fallback: an initials avatar. A person's **status shows as the colored border ring**.

## 6. Details panel ✅

- Email as a `mailto:` link plus a copy button; role, company, schools, Connected On, status, tags, notes, LinkedIn link.

## 7. Dragging the map

- Pan, zoom and drag nodes. Dragged positions are **saved** in the Layout sheet (browser storage for the demo).
- "Re-arrange" reruns the auto layout; "Lock layout" turns physics off.

## 8. Layout and look ✅

- Full screen, no page scrolling (`html, body { height: 100%; overflow: hidden; }`). A 340px left sidebar with a fixed
  header over a scrolling body; the map fills the right side. Graph-paper grid drawn in `beforeDrawing`.
- Phone: the sidebar becomes a bottom sheet. Demo banner: "You're viewing fictional demo data. Use my own data →".
- **Readability:** highlight on click (others fade to ~15%; hover = lighter preview; Esc / empty click clears);
  groups spread far apart; people link only to their primary group; no-connection targets on the outer edge;
  **Free | Ring** switch (animated, remembered, "Fit" in both); slower eased zoom; labels with a white halo that hide
  when zoomed out; red ring only on targets.
- **Edge styles**, all darker than the grid: solid dark gray = I know them; dashed gray = through someone;
  **faint dotted = alumni link** (past company or shared school, see D; a toggle shows/hides them);
  red = only a highlighted path to a target.
- View tabs at the top of the right pane: **Map | People | Calendar | To-Do** (see F). The sidebar stays.

## D. Work history and schools

LinkedIn's `Connections.csv` only has the **current** company and title and **no school**. The full archive's
`Positions.csv` and `Education.csv` are **my own** history only.

1. **Past Companies** (multiple, e.g. "Northwind Consulting (2019–2021); Summit Airlines"), edited with type-ahead
   and optional years. Past employers link to that company's node with the faint dotted alumni edge.
   Target cards and best-path logic count alumni: "Alumni: Liam Walsh (2019–21)", ranked below current employees.
2. **Schools** (multiple, with years, e.g. "BYU (2022–2026); Lakeview High"). Replaces the single School column
   (migrated automatically). Everyone sharing a school joins that school's group (using org aliases).
3. **LinkedIn re-import:** a changed company moves the old company/position into Past Companies.
4. **Optional import of my own `Positions.csv` and `Education.csv`:** sets MY past employers and schools. People who
   share them get a "Former coworker" / "Same school" badge and count as a warm path into targets.
5. In-app tip: "Find classmates on LinkedIn: People search → School filter → 1st connections."
6. Demo people get past companies and multiple schools.

## E. Networking tracker format + Excel import/export

My tracker's columns, in order. ⚠️ **To confirm with me before Phase 4** (especially the three date columns):

Name | Company | Role / Background | How We're Connected | LinkedIn | Meeting Type | Method | Status |
Date Reached Out | Meeting Date | Follow-Up Date | Referral? | Relevant Opportunities | Next Steps | Relationship Plan

Example: Jamie Ortega | Northwind / Contoso | Strategy Analyst at Northwind; Contoso Growth Strategy Intern (summer),
returning as Growth Associate | BYU; 11 mutual connections (Casey, Morgan) | Profile | Coffee Chat | Phone | Met |
| | | No | Contoso APM; Northwind | Send thank-you within 24 hrs; ask for resume review | Keep In contact

- The **People sheet uses this layout** (so my workbook stays familiar). Extra fields follow: Email, Photo,
  Past Companies, Schools, Tags, Connected On, Connected Through. Old v2 People sheets are migrated.
- **LinkedIn** is a hyperlink with the text "Profile".
- **Company** may hold several ("Northwind / Contoso"): the first is current; the others count as past/next employers for groups and targets.
- **How We're Connected** combines schools, the mutual count and mutual names. Mutual names that match exactly one
  person on my map (full name, or a unique first name) create Connected Through links; otherwise they stay text.
- **Dates:** Date Reached Out = first outreach. **Meeting Date = the next scheduled meeting, or the most recent one if
  none is scheduled.** Follow-Up Date = when the next follow-up is due (the Next Steps task's due date).
- **Dropdowns** (Excel data validation): Meeting Type: Coffee Chat, Informational, Networking Event, Class/Club,
  Interview, Other · Method: Phone, Zoom, Google Meet, Teams, In Person, Email, LinkedIn ·
  **Status: To Reach Out, Contacted, Scheduled, Met, Follow Up, Referral** (Scheduled is new) · Referral?: Yes/No ·
  Relationship Plan: Keep In Contact, Follow Up Later, One-Time. Values match case-insensitively.
- **Import** an existing tracker in this format, matching columns by header name (ignoring case/punctuation).
- **"Export to Excel":** all people or only the current filter/highlight; frozen header, auto widths, wrapped text;
  plus Meetings and To-Do sheets.

## F. Full person editing, Meetings log, and views

1. The details panel and "Add person" edit **all** fields in sections: Basics (name, company, role, LinkedIn, email,
   photo) · Connection (schools, past companies, mutuals, connected through) · Outreach (meeting type, method, status,
   dates, referral) · Notes & Next Steps.
2. **Meetings log** per person (date/time, type, method, notes, next step). Logging a meeting sets Status to Met and
   fills Meeting Date. The latest meeting shows at the top of the person's panel.
3. **View tabs** (right pane): **Map | People | Calendar | To-Do**.
   - **People:** spreadsheet-style table in tracker order; sort, filters (status, company, school, target), search,
     inline edit; clicking a row opens the person.
   - **Calendar:** month and week views of meetings, follow-ups and task due dates, color-coded. Click a day to add a
     meeting or task; click an event to open the person.
   - **To-Do:** tasks with due dates, linked to a person and/or target; grouped Overdue / Today / This Week / Later /
     Done; check off to complete. Automatic tasks: Next Steps → task due on the Follow-Up Date; after a meeting,
     "Send thank-you within 24 hrs"; Keep In Contact people get a check-in every 60 days (configurable). The tab shows
     a badge with the overdue + today count.
4. New sheets: **Meetings** (Person, Date, Start, End, Type, Method, Notes, Next Step, Calendar Event ID) ·
   **Tasks** (Task, Person, Company, Due, Done, Created) · **Settings** (my name, my email, default meeting length,
   Zoom link, avatar style).

## G. Meeting invites (no Zoom API)

1. Settings: my name, email, default length (30 min), my Zoom link (personal room or scheduling link).
2. **"Schedule meeting"** from a calendar day, an event or a person's panel: person (type-ahead, pulls their email),
   date/time, length, type; method: Zoom (prefilled with my link), Google Meet, Teams, Phone or In Person.
3. **"Send invite"** — **the app never sends anything itself; I always click send or save:**
   Google Calendar prefilled event URL (`calendar.google.com/calendar/render?action=TEMPLATE`, with text, dates,
   details incl. the link, `add=<their email>`) · Outlook compose-event deeplink (outlook.live.com / outlook.office.com) ·
   email draft (Gmail compose URL, `mailto:` fallback) from an editable template
   ("Hi {first name}, looking forward to our chat on {date} at {time}. {link}") · download `.ics`
   (ATTENDEE, ORGANIZER, link in LOCATION and DESCRIPTION).
4. Scheduling adds the meeting to Meetings, sets Status to Scheduled, fills Meeting Date, and creates a "Send thank-you"
   task for the next day.
5. If the person has no email, warn me and let me type one; save it to their row.

## H. Calendar connections (optional sign-in, still no server)

1. The prefilled links in G stay the default (no sign-in).
2. **"Connect Google Calendar"** (Google Identity Services token client, `calendar.events` scope, Calendar API from the
   browser): create events with the person as attendee (`sendUpdates=all`), optional auto Google Meet link
   (conferenceData); show my next 60 days of events read-only in a muted color; edits/cancels in the app update the
   Google event (event ID stored in Meetings).
3. **"Connect Outlook"**: the same with MSAL.js (SPA, auth code + PKCE) and Microsoft Graph (`Calendars.ReadWrite`),
   with an optional Teams link.
4. Client IDs in `site/config.js` as placeholders — **never secrets**. `docs/CALENDAR_SETUP.md` explains Google Cloud and
   Azure setup. Authorized origins: localhost and `https://westons-hub.github.io`.
5. Tokens in memory/sessionStorage only, with a clear "Disconnect". Only the event details I create are sent.
6. Demo mode: the buttons say "Connect your own calendar"; the fallback links still work.
7. **Zoom API** (auto-created Zoom meetings) needs a server secret, so it's **not built**; list it under Roadmap in the README.

## I. Demo data shows everything off

Realistic tracker rows; real company/school logos and DiceBear avatars; past companies and schools with alumni links;
6 targets (some with no connections: Apple, Nike); meetings spread across this month and next; open, overdue and done
tasks. Every view should look alive for a recruiter.

**Demo company mapping** (people stay fictional; all relationships, statuses, meetings and tasks stay the same):
Northwind Consulting → **Deloitte** (P1 target) · Summit Airlines → **Delta Air Lines** (P1 target) ·
Brightline Bank → **Goldman Sachs** (target) · Pinecrest Labs → **Qualtrics** (target, reached through Liam → Zoe) ·
Contoso Games → **Microsoft** · Fieldstone Capital → **Google** · Keystone Health and Harbor Ventures → **Adobe** ·
Riverbend University → **BYU** · Lakeview State University and Harbor Tech Institute → **University of Utah** ·
new no-connection targets **Apple** and **Nike** (replacing Granite Peak Partners and Harborview Media).

## 9. README (portfolio-first)

Lead with the **live demo link** and an animated **GIF**, then "Why I built this", features, privacy, how it works,
and a Roadmap (Zoom API). The Python CLI is gone; it stays in git history (f3d4e74).

## Phases (commit locally after each; screenshots after each)

1. ✅ App skeleton: full-screen layout, graph paper, demo by default, SheetJS open/save, backups, conflict reload,
   migration, JS tests *(8a6afe5)*
1b. ✅ Map readability (A) + Add target (C) + first pictures pass *(f9b85e2)*
2. **Pictures (B, revised):** real companies/schools with real logos in the demo (explicit domains), DiceBear Notionists
   avatars (vendored, CC0, attribution), "Avatar style" setting, trademark footer note
3. **LinkedIn import + lookup Add/Edit/Remove person** (original Phase 2) **+ work history and schools (D)**, including
   alumni edges, alumni on target cards, pool suggestions with one-click add, and the intro report download
4. **Tracker format + Excel import/export (E) + full person editing, Meetings log, People/Calendar/To-Do views (F)**
   — confirm the tracker headers first
5. **Meeting invites (G) + calendar connections (H)**
6. **Saved drag positions + Re-arrange/Lock (7), offline export, GitHub Pages workflow, README with live link + GIF,
   demo polish (I)**
