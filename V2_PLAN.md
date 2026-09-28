# Network Map v2: build spec for Claude Code

Read this whole file, then read the README and the code (`build_map.py`, `network_map/`).
**Start in plan mode:** propose a plan and ask me about anything unclear before writing code.
Build in the phases at the bottom, run the tests, and commit after each phase.
**Commit locally only. Don't push until I say so.**

## Goal

This is a portfolio project for job applications. A recruiter should be able to **click one link and use it
instantly**, with nothing to install and no sign-up.

## The big change: static page → browser-only app on GitHub Pages

Right now `build_map.py` generates a static HTML file, so the map can't be edited. v2 is a
**browser-only web app** hosted on **GitHub Pages**. It uses plain HTML/CSS/JS, has **no Python server** and no backend.

- Opening the link shows the map right away with the **fictional demo data** (from `examples/`).
- A **"Use my own data"** button opens my Excel workbook or a LinkedIn `Connections.csv`.
- The page edits data live: add people, add targets, drag nodes. It saves changes to the Excel workbook.
- **All data stays in the browser. Nothing is uploaded**, and there are no analytics or trackers. Say so clearly on the page.
- Keep a way to export a static offline HTML snapshot (the current behavior), as an "Export offline map" button.
- Keep vis-network as the map engine. Vendor third-party JS (vis-network, SheetJS) into the repo so the site
  doesn't depend on a CDN and works from a local copy.
- No build step is required: ES modules served as static files, so the repo root (or a `site/` folder) deploys as-is.
- The Streamlit `app.py` and `requirements-app.txt` are removed. Before starting, **commit the current
  uncommitted work** (targets, status, report.py, tests) so v2 starts from a clean point. *(Done: f3d4e74.)*
- **Deploy:** add a GitHub Actions workflow (`.github/workflows/pages.yml`) that publishes the site to GitHub
  Pages on push to `main` (`actions/upload-pages-artifact` + `actions/deploy-pages`). Tests run first, and a failure blocks the deploy.

## 1. Connect to Excel (Excel is the database, read and written in the browser)

- Read and write `.xlsx` in the browser with **SheetJS**.
- **Chrome/Edge:** use the **File System Access API** (`showOpenFilePicker`, `createWritable`) so "Save"
  writes straight back to the same file.
- **Safari/Firefox fallback:** open with a normal file input; "Save" downloads the updated workbook.
- One workbook, e.g. `my_network.xlsx` (never committed), with these sheets:
  - **People**: Name, Company, School, Role, Email, LinkedIn URL, Photo, Connected Through, Connected On, Status, Tags, Notes
  - **Targets**: Company, Priority, Stage, Notes
  - **Companies**: Company, Website (used for logos, see #4)
  - **LinkedIn Pool**: the imported LinkedIn connections (see #2)
  - **Layout**: saved node positions (see #7). Can be hidden.
- Before writing, keep a backup of the previous version in the browser (IndexedDB, the last ~10), with a way to
  download or restore one.
- If the file changed on disk since it was opened (for example I edited it in Excel), reload it instead of overwriting, then re-apply my pending change.
- Unsaved changes are obvious (a "Save" button with a dot, plus a warning on leaving the page). They're also autosaved to
  browser storage so a refresh doesn't lose them.
- Update `template/contacts_template.xlsx` to match (with a "Download blank template" button in the app), and migrate
  old-format files automatically (a `Contacts` sheet becomes People; old Targets gain Priority/Stage).
- Demo mode edits only an in-browser copy. A "Reset demo" button restores it. The committed examples never change.

## 2. Add people manually with a lookup (so it isn't overwhelming)

- The map starts small: **me + my targets + only the people I've added.** Don't dump all my LinkedIn connections onto the map.
- **Import LinkedIn:** a button to choose my `Connections.csv`. It goes into the LinkedIn Pool sheet, not onto the map.
  - Use **every column**: First Name, Last Name, URL, Email Address, Company, Position, Connected On (parse as a date).
  - The file has "Notes:" lines above the header (skip to the "First Name" line, as the current loader does).
    Re-importing must not create duplicates (dedupe by profile URL, then by name).
- **Add person:** a search box with type-ahead over the pool (matches name, company and title).
  - Pick a result → a short form prefilled from LinkedIn. I add School, Connected Through (type-ahead over people already on
    the map), Status, Tags, Notes, Email, Photo → Save.
  - Also allow adding someone who isn't in LinkedIn at all.
- Edit or remove a person from the details panel. My manual edits always beat LinkedIn data.

## 3. Targets are core

- **Targets** is the top section of the sidebar, not an afterthought.
- "+ Add target" button at the top of the Targets section opens a small form: company name with type-ahead (companies
  from my people, LinkedIn pool and existing groups, plus free text), Priority (P1/P2/P3), Stage
  (Researching / Networking / Applied / Interviewing / Offer), Notes. It saves to the Targets sheet.
- Edit and remove targets from the target's card. A "Make this a target" button on any company group's details panel.
- Works in demo mode too (edits the in-browser demo copy; "Reset demo" restores it).
- For each target show:
  - how many people I know there
  - my best path in (direct, or through whom for 2nd-degree, with the full chain: Me → Liam → Zoe → Sam)
  - a clear "no connections yet" state
  - who in my LinkedIn Pool works there but isn't on the map yet, with one click to add them
- Clicking a target focuses and zooms the map on it.
- Every target is **always its own node** (bigger, distinct red ring, logo). Anyone I know there attaches to it,
  even below the group threshold. Optional fields: Priority and Stage (e.g. Researching / Networking / Applied / Interviewing).
- This absorbs the old "who can intro me to X?" report. Port its logic (org-name normalization and aliases,
  "Connected Through" chains) to JS, and offer "Download intro report (.md)".

## 4. Company and school logos

- Company, school and target bubbles show a logo with vis-network `shape: "circularImage"`.
- **Demo data (fictional):** no real logos. Each fictional company/school gets a generated logo (colored rounded
  shape + a simple icon or initials) as inline SVG, stored in the demo workbook's Companies sheet (Logo column).
- **Real data:** guess the domain from the name (reusing the name normalization and aliases, e.g. BYU → byu.edu),
  overridable with the Website (or Logo) column in the Companies sheet. Logo source: Google's favicon service
  `https://www.google.com/s2/favicons?domain=<domain>&sz=128`, loaded directly by the browser (cached by the browser;
  domains with no logo are remembered so they aren't re-checked). Keep the source swappable (logo.dev / Brandfetch need
  API keys). This sends only company domains, never contact data, and never happens in demo mode.
  - Google returns a 16px globe (HTTP 404) for unknown domains, so anything ≤16px counts as "no logo".
  - Google sends no CORS headers, so favicons can't be embedded in the offline export; there, use the generated logo.
- Fallback everywhere: a generated initials logo.

## 5. Profile pictures

- LinkedIn's export does **not** include photos, and we don't scrape LinkedIn.
- **Demo data:** illustrated avatars generated in code (simple SVG faces in varied colors), not downloaded photos.
- **Real data:** each person has a Photo field. In the details panel, "Add photo" lets me pick an image file (resized in
  the browser to ~96×96 and stored as a data URI in the workbook's Photo cell) or paste an image URL.
- Optional, **off by default**: Gravatar by email (SHA-256 hash via Web Crypto). It sends a hash of the email to Gravatar, so it's opt-in.
- Fallback: an initials avatar. People render as circular images; their **status shows as the colored border ring**.

## 6. Emails in the info panel

- The details panel shows the email as a `mailto:` link plus a copy button.
- It also shows role, company, school, Connected On date, status, tags, notes and the LinkedIn link.

## 7. Dragging the map

- Pan and zoom the canvas, and drag nodes.
- Dragged positions are **saved** in the workbook's Layout sheet (and in browser storage for the demo), so the layout stays put next time.
- Add a "Re-arrange" button to rerun the auto layout and a "Lock layout" toggle (physics off).

## 8. Layout and look

- **Full screen, with no page scrolling.** Set `html, body { height: 100%; overflow: hidden; }`.
- Left sidebar, about 340px wide, scrolls internally: Targets on top, then Add person, then details.
- **The map fills the entire right side.** You must not be able to scroll past it.
- **Map background:** light, like math or graph paper. Use a near-white fill with thin light-blue/gray grid lines every ~20px and slightly darker lines every ~100px.
  - Draw the grid in vis-network's `beforeDrawing` hook so it pans and zooms with the map, not as a fixed CSS background.
- Keep the details panel, search and legend, but move them into the sidebar or a small overlay so they don't cover the map.
- It should be usable on a phone for a quick look: the sidebar becomes a bottom sheet.
- A small banner in demo mode: "You're viewing fictional demo data. Use my own data →".
- The sidebar header stays fixed above a scrolling body, so nothing (like the Targets heading) is ever clipped under it.

## 8b. Readability

- **Highlight on click:** clicking a person, group or target highlights it plus its direct connections; everything
  else fades to ~15% opacity (nodes, edges, labels). Clicking a target also highlights my **best path** to it
  (e.g. Me → Liam → Zoe → Sam) in bold red, and the sidebar shows that path. Click empty space or press Esc to clear.
  Hovering shows a lighter preview of the same thing.
- **Spacing:** groups spread far apart so each cluster is clearly separate (longer springs, stronger repulsion between
  group nodes, avoidOverlap on). Members stay tight around their own group. People link only to their primary group
  (secondary memberships appear only when highlighted). Targets with no connections sit on the outer edge.
- **Layout switch** (top-right of the map, next to "Fit"): a segmented control "Free | Ring".
  - Ring: me at the center, groups evenly spaced on a circle, members fanned around their group, 2nd-degree people just
    outside the person who connects them, and no-connection targets on an outer ring.
  - Free: the physics layout (with the extra spacing).
  - Animate between them; remember the choice (localStorage). "Fit" works in both.
- **Edges, only 3 styles**, all darker than the grid: solid dark gray = I know them (direct/group membership);
  dashed gray = through someone (2nd-degree); red = only a highlighted path to a target. The grid is lighter so edges stand out.
- **Zoom:** slower and smoother (eased, anchored under the cursor), including trackpad pinch.
- **Nodes:** a person's color = status only (legend shows the status colors). The red ring is only on target company
  nodes, never on people. Slightly larger labels with a white halo; person names hide when zoomed far out.

## 9. README (portfolio-first)

- Lead with the **live demo link** and an animated **GIF** of the app (made from the demo data), then
  "Why I built this", features, privacy, and how it works.
- The Python CLI (`build_map.py`, `network_map/`, pytest) is removed. The browser app does everything it did; the Python version stays in git history (f3d4e74).

## Rules

- **Privacy:** everything stays in the browser. Never commit real data: `.gitignore` blocks `.xlsx`, `.csv`, `.html`
  exports and intro reports, except the fictional demo (`site/demo/`), the blank template and test fixtures.
- **No LinkedIn scraping:** only my own data export plus manual entry.
- Tests: unit-test the JS logic (parsing the LinkedIn CSV, merging, org normalization and domain guessing, graph building,
  targets and intro paths, and the workbook round-trip with SheetJS) with `node --test`, with no npm install required to run the site.
  CI runs them before deploying.
- **Local commits only. No push until I say.**

## Phases (commit after each)

1. ✅ Static app skeleton: full-screen layout, graph-paper background, demo data loads by default; SheetJS open/save
   (File System Access + download fallback), backups, conflict reload, migration; JS tests; remove Streamlit *(8a6afe5)*
1b. ✅ Readability + visuals pass (moved earlier): highlight on click/hover with best path in red, more space between groups, slower/smoother zoom,
   Free | Ring layout switch, 3 edge styles, status-only person colors, labels with halo; **logos and photos**
   (generated demo art, favicons + Photo/Gravatar for real data); **Add/Edit/Remove target** + always-on target nodes;
   fix the clipped Targets heading
2. LinkedIn import (all columns) + lookup-based Add/Edit/Remove person
3. Targets, the rest: LinkedIn-pool suggestions with one-click add, intro report download
4. Draggable map with saved positions (Layout sheet), Re-arrange / Lock layout
5. Offline HTML export, GitHub Pages workflow, README with live link + GIF
