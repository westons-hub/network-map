# Network Map v2: build spec for Claude Code

This is the single spec. V2_ADDITIONS.md (and the change to its section B) and NEXT_UPDATE.md have been merged in here.
Build in the phases at the bottom, run the tests, and **commit locally after each phase. Don't push until I say so.**
After each phase, show me screenshots of what changed. Ask me about anything unclear before building it.

## Goal

This is a portfolio project for job applications. A recruiter should be able to **click one link and use it
instantly**, with nothing to install and no sign-up.

## Ground rules

- **Browser-only** web app on **GitHub Pages**: plain HTML/CSS/JS ES modules in `site/`, no server, no backend, no build step.
- **All data stays in the browser. Nothing is uploaded**, and there are no analytics or trackers. Say so on the page.
  The only outside requests are company logos (the logo service sees a domain). Section H adds optional calendar
  sign-in, which sends only the events I create.
- **No LinkedIn scraping:** only my own data exports plus manual entry.
- **Never commit real data.** `.gitignore` blocks `.xlsx`, `.csv`, `.html` exports and intro reports, except the demo
  (`site/demo/`), the blank template and test fixtures. Demo **people** are fictional; their photos are AI-generated
  faces of people who don't exist.
- Vendor third-party JS into `site/vendor/` (vis-network, SheetJS, DiceBear) so the site has no CDN dependency.
  Attribution lives **only** in `site/vendor/ATTRIBUTION.md` and a short "Credits" section at the bottom of the README —
  no credits/trademark footer on the page.
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

## 2. Add people with a lookup (so it isn't overwhelming) ✅

- The map starts small: **me + my targets + only the people I've added.** LinkedIn connections never flood the map.
- **Import LinkedIn:** choose `Connections.csv` → it goes into the LinkedIn Pool sheet, not onto the map.
  - Use every column: First Name, Last Name, URL, Email Address, Company, Position, Connected On (a date).
  - Skip the "Notes:" lines above the header. Re-importing never duplicates (dedupe by profile URL, then name).
  - If someone's company changed since the last import, move the old company and position into their Past Companies (see D).
- **One "+ Add person" box** (sidebar button + shortcut **N**; a PDF can also be dropped onto the map) that accepts anything:
  - typing a name → type-ahead over the LinkedIn pool and people already on the map (warns "Already on map")
  - pasting a LinkedIn profile URL → normalized and matched against the pool (by URL, then by the name in the slug);
    matched: name, company, title, email, connected on and URL are prefilled; not matched: name from the slug + URL,
    and it says what's missing
  - dropping (or "Upload PDF") the profile PDF LinkedIn makes (**More → Save to PDF**) → parsed in the browser with
    vendored pdf.js: name, headline, location, current and past positions with dates (→ Company, Role, Past
    Companies), education with years (→ Schools), summary (→ Notes). Fictional sample: `examples/sample_linkedin_profile.pdf`
    (demo: "Try a sample PDF").
  - no match → a blank form with the typed name
  All paths lead to the same prefilled **review card**, with the empty fields only I know highlighted (Connected
  Through, Status, Schools, Notes, Photo). Save → the person appears with their card open. Tip shown in the box:
  "For full history, open their LinkedIn profile → More → Save to PDF, then drop it here." **Never fetch linkedin.com.**
- **LinkedIn pool tab:** searchable, filterable by company/title/connected date, "Add to map" per person (opens the
  review card), checkboxes + "Add selected", "Add everyone at [company]", "Already on map" badges. Re-import merges
  without duplicates. The demo has a 26-person fictional pool (incl. people at Apple and Nike).
  My manual edits always beat LinkedIn data.
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

## 4. Company and school logos ✅

- Company, school and target bubbles use `shape: "circularImage"`.
- **Demo:** crisp vector logos **stored in the repo** (`site/demo/logos/`, 512×512 SVG, brand mark on a white circle),
  from **Simple Icons** (CC0) in brand colors where available (Delta, Goldman Sachs, Qualtrics, Google, Apple, Nike) and
  **public-domain Wikimedia Commons** SVGs for the rest (Microsoft, Adobe, Deloitte, Stanford, University of Utah).
  Sources and licenses in `site/demo/logos/SOURCES.md`; built by `scripts/make_logos.mjs`.
- **My own data:** a logo provider with a publishable key in `site/config.js`:
  - **logo.dev** (`img.logo.dev/{domain}?token=pk_…`): free plan; **no attribution for personal projects**, but
    commercial projects on the free plan must show a visible "Logos provided by Logo.dev" link.
  - **Brandfetch** (`cdn.brandfetch.io/{domain}?c=…`): free tier, **no attribution**, but logos must be hotlinked
    (not stored/cached) and requests must send the site's origin as referrer.
  - Neither is enabled by default (empty keys) — decide before relying on one. Fallback: Google favicons (`sz=256`),
    then a generated initials logo. The Companies sheet's Website/Logo override the guess.
- Google returns a 16px globe for unknown domains, so ≤16px counts as "no logo". Favicons can't be embedded in the
  offline export (no CORS); the demo's SVGs can.

## 5. Profile pictures

- LinkedIn's export has **no photos**, and we don't scrape. **No photos of real people anywhere in the demo.**
- **Demo people:** photorealistic **AI-generated headshots of people who do not exist**, from the SFHQ dataset
  (MIT license; no on-page attribution required), resized to 128px and stored in `site/demo/photos/` (one per person,
  matched to the name's apparent gender/age; sources in `SOURCES.md`).
- **My own data:** the Photo field only — "Change photo" picks an image file (resized in the browser to ~96×96, stored
  as a data URI in the Photo cell) or pastes an image URL. Photos come only from an upload or a pasted image link.
- Fallback: DiceBear "Notionists" (CC0, generated locally, seeded by name; the "Avatar style" setting) or initials.
- A person's **status shows as the colored border ring**.

## 6. Person popover card — *superseded by K (details back in the sidebar)*

- Clicking a person on the map opens a **floating card next to their node** (not in the sidebar). It stays attached to
  the node when I pan/zoom, flips side/position to stay fully on screen, and never covers the node. Highlight-on-click
  still happens behind it.
- Layout (compact; scrolls internally if long):
  - Header: photo/avatar, name, role @ company, **status pill** (click → small dropdown to change status), close ×.
  - Quick links: LinkedIn (opens profile), Email (mailto) + copy, **Schedule meeting**, **Add task**.
  - Info: company, schools, past companies, how we're connected / connected through, connected on.
  - Notes: shown in full, **editable inline** (click to edit, autosaves).
  - Next steps + upcoming meetings/tasks for this person; latest meeting summary.
- Easy editing: every field is **click-to-edit inline** (type-ahead for company/school/connected-through); Enter/blur
  saves, Esc cancels, a small "Saved" confirmation. "Edit all" opens the full form; "Change photo" on the avatar (upload
  or paste URL); "Remove person" at the bottom with a confirm.
- Close with ×, Esc, or clicking empty map space. Clicking another person moves the card to them.
- Group/company/target nodes get a similar, smaller card (logo, who I know there, best path, "Make target"/target stage).
- Mobile: the card becomes a bottom sheet. Demo mode: edits work on the in-browser copy.

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
- **Edge styles**, all darker than the grid: solid dark gray = I know them (company membership **and current school**);
  dashed gray = through someone; **faint dotted = alumni link** (past company or past school, see D; a toggle
  shows/hides them); red = only a highlighted path to a target.
- **School connections:** people link to their school node(s) with an edge, like company membership (solid for a
  current school, dotted for a past one). School edges are drawn but don't pull on the layout; they're part of
  highlight-on-click and paths.
- View tabs at the top of the right pane: **Map | Calendar | To-Do | LinkedIn pool**, **People** added with the
  tracker (see E/F). The sidebar stays.
- **No-connection targets** sit on a ring just outside the outermost group (evenly spread in the widest gaps, capped
  distance) in both Free and Ring, so "Fit" keeps the network large.
- **Modals:** a click on the backdrop or Esc closes; with unsaved edits it asks "Discard changes?" first.
- **Week view** has a time axis (hourly rows; opens at 8 AM; scroll for earlier/later), meetings placed by start time
  with height = duration, an "All day / Due" row for tasks, a red "now" line, click an empty slot to schedule, drag a
  meeting to move it. Every meeting has "Add to Google Calendar", "Add to Outlook" and "Download .ics".

## D. Work history and schools (1, 2, 6 ✅; 3–5 pending)

LinkedIn's `Connections.csv` only has the **current** company and title and **no school**. The full archive's
`Positions.csv` and `Education.csv` are **my own** history only.

1. ✅ **Past Companies** (multiple, e.g. "Northwind Consulting (2019–2021); Summit Airlines"), edited with type-ahead
   and optional years. Past employers link to that company's node with the faint dotted alumni edge.
   Target cards and best-path logic count alumni: "Alumni: Liam Walsh (2019–21)", ranked below current employees.
2. ✅ **Schools** (multiple, with years, e.g. "BYU (2022–2026); Lakeview High"). Replaces the single School column
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

## H. Calendar connections (optional sign-in, still no server) ✅ built — needs client IDs to try for real

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

- **Demo dates are always fresh:** every date (meetings, tasks, connected on) is stored as an offset from a base date
  and shifted to today when the demo loads (and on "Reset demo"). There's always something due today, 1–2 overdue, a
  meeting tomorrow, more this week and next, and done items in the past (tested for several dates).

Realistic tracker rows; real company/school logos and AI-generated headshots; past companies and schools with alumni links;
6 targets (some with no connections: Apple, Nike); meetings spread across this month and next; open, overdue and done
tasks. Every view should look alive for a recruiter.

**Demo company mapping** (people stay fictional; all relationships, statuses, meetings and tasks stay the same):
Northwind Consulting → **Deloitte** (P1 target) · Summit Airlines → **Delta Air Lines** (P1 target) ·
Brightline Bank → **Goldman Sachs** (target) · Pinecrest Labs → **Qualtrics** (target, reached through Liam → Zoe) ·
Contoso Games → **Microsoft** · Fieldstone Capital → **Google** · Keystone Health and Harbor Ventures → **Adobe** ·
Riverbend University → **Stanford University** (BYU is not used in the demo) ·
Lakeview State University and Harbor Tech Institute → **University of Utah** ·
new no-connection targets **Apple** and **Nike** (replacing Granite Peak Partners and Harborview Media).

## J. Orbit brand + welcome intro (NEXT_UPDATE §1)

- **Full rebrand to Orbit** (the GitHub repo keeps its name): app name, header logo, favicon/touch icon, page title,
  README, demo banner; UI accents from the brand (navy #1E3A5F, rose #F43F5E, orange #F97316, slate #5B6B80) and
  **DM Sans** (self-hosted under the SIL Open Font License; no Google Fonts request). Brand files from `~/Downloads/brand/`.
  Tagline: "Your orbit, always moving outward."
- **Welcome intro** recreating `Orbit Welcome Short.mp4` (6.5 s, 1920×1080) in **SVG + CSS/JS** (no video file, no
  animation library), dark background #131A26, centered:
  0.0–0.5 s white core dot fades/scales in → 0.5–1.5 s the orbit arc draws around it (stroke-dashoffset, rose→orange
  gradient, arrowhead) and the orange satellite pops on → ~1.8–2.4 s the mark shrinks and moves down; **"Map your orbit"**
  types in above it letter by letter (DM Sans 700, white), then **"Find your path."** fades in (#A3AEBF) → ~3.3–4.0 s a
  thin wide ellipse draws around the small mark (faint rose/orange) and the **"Orbit"** wordmark appears beside it →
  4.0–6.0 s an orange and a rose dot travel the ellipse in opposite directions → 6.0–6.5 s fade out, app fades in.
  First visit only (localStorage, try/catch); "Replay intro" in Settings; skip by click/any key/"Skip";
  `prefers-reduced-motion` → static logo + tagline ~1 s. The app loads behind it.

## K. Details back in the sidebar (NEXT_UPDATE §2)

Replaces the floating popover (section 6): clicking a person, company, school, target **or me** opens full details in
the **left sidebar** with everything the card had (photo + Change photo, status quick-change, LinkedIn / email + copy /
Schedule meeting / Add task, all fields click-to-edit, notes, next steps, upcoming meetings and tasks, Edit all, Remove).
A back arrow/× returns to the default sidebar; clicking empty map space also clears it; highlight-on-click stays. On
phones the sidebar details are the bottom sheet.

## L. Autofill everywhere (NEXT_UPDATE §3)

One type-ahead component for every repeating field — Company, Past Companies, Schools, Role, Tags, Meeting Type,
Method, Status, Relationship Plan, Connections/people — with suggestions from everything already entered (people, pool,
targets, Companies sheet, imported PDFs), matched through org aliases ("U of U" → University of Utah), showing the logo
and how many people share each company/school; ↑/↓, Enter, Tab; "Add 'X'" for new values. Multi-entry fields keep the
optional years format ("Deloitte (2021–2023)").

## M. Connections between people (NEXT_UPDATE §4)

- A **Connections** section in the Add-person review and in the details view: pick existing people (type-ahead) and a
  type for each: **Introduced me**, Coworker, Classmate, Friend, Mentor, Other (free text).
- **Only "Introduced me" makes someone 2nd-degree** (they hang off the introducer); the other types are extra
  person-to-person links. All types draw edges, appear in highlight-on-click, and count in best-path logic.
- Shown and removable from both people's details. Stored in a **Connections sheet** (Person A, Person B, Type, Notes).
  The old Connected Through column **migrates** into it and **stays in People, filled automatically** from "Introduced
  me" (typing in that column in Excel still imports). Nice-to-have: Shift+drag from one person to another to connect.

## N. My profile (NEXT_UPDATE §5)

- The center node has a photo and full profile. Demo: Alex Rivera gets an AI-generated headshot (same SFHQ source/license
  rules), role and headline (student/recent grad looking for strategy/product roles), school with years, past jobs with
  years, email, LinkedIn, location, "What I'm looking for" notes.
- Clicking the center node opens this profile in the sidebar. With my own data, **"My profile"** (Settings and the
  center node) edits my name, photo, schools, jobs and info, saved in a **Me** sheet. My schools/past companies drive
  "Same school" and "Former coworker" badges.

## O. Demo dates always current (NEXT_UPDATE §6)

Every demo date (meetings, tasks, follow-ups, connected on, date reached out, meeting logs) is relative to **today** when
the demo starts; always something due today, 1–2 overdue, a meeting tomorrow, several this week and next, some done.
Calendar and To-Do open on today. **Saved demo edits never go stale:** edits made days ago are shifted by (today − the day
they were saved). "Reset demo" rebuilds from today. Tests fake the clock (incl. month-end, a Monday, a Sunday) and reload
a saved demo copy a week later.

## 9. README (portfolio-first)

Lead with the **live demo link** and an animated **GIF**, then "Why I built this", features, privacy, how it works,
and a Roadmap (Zoom API). The Python CLI is gone; it stays in git history (f3d4e74).

## Phases (commit locally after each; screenshots after each)

1. ✅ App skeleton *(8a6afe5)* · 1b. ✅ Readability + Add target *(f9b85e2)* · 2. ✅ Pictures *(2edc770)* ·
   2b. ✅ School edges, Stanford, AI headshots *(1b4c1a2)*
3. ✅ To-Do + Calendar + meetings + invites, person popover card, Gravatar removed *(ce61e04)*
3b. ✅ **Fixes + features:** always-fresh demo dates; modals close on backdrop/Esc with "Discard changes?"; week view
   with times, drag to move, click a slot to book; **calendar connections (H)** + add-to-calendar on every meeting;
   no-connection targets on a capped outer ring; **LinkedIn pool** tab; crisp repo logos + logo.dev/Brandfetch support;
   **one "+ Add person" box** (name / LinkedIn link / profile PDF) with a review card; Schools + Past Companies +
   alumni links (D.1, D.2, D.6)
3c. **Next update (NEXT_UPDATE.md), one local commit per part:**
   1) demo dates always current (O) · 2) details back in the sidebar (K) · 3) my profile (N) · 4) connections between
   people (M) · 5) autofill everywhere (L) · 6) Orbit rebrand + welcome intro (J)
4. **Work history, the rest (D.3–D.5):** LinkedIn re-import moves a changed company into Past Companies; import my own
   `Positions.csv` / `Education.csv` ("Former coworker" / "Same school" badges, warm paths); classmates tip; intro report download
5. **Tracker format + Excel import/export + People table (E)** — confirm the tracker headers first
6. **Calendar connections, verified for real** (create the Google/Azure client IDs per docs/CALENDAR_SETUP.md and test)
7. **Polish + deploy:** saved drag positions + Re-arrange/Lock (7), offline export, GitHub Pages workflow, README with
   live link + GIF, demo polish (I)
