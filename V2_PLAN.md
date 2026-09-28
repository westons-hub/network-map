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
- Add a target with a company lookup: type-ahead over companies in my pool and people, plus free text.
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

## 4. Company icons

- Company, school and target bubbles show the logo with vis-network `shape: "circularImage"`.
- Domain: guess it from the name, overridable in the Companies sheet (reuse the name normalization and aliases, e.g. BYU → byu.edu).
- Logo source: Google's favicon service `https://www.google.com/s2/favicons?domain=<domain>&sz=128`, loaded
  directly by the browser. Keep the source swappable (logo.dev / Brandfetch need API keys). This sends only company domains, never contact data.
- Cache logos in the browser. In the offline export, embed them as data URIs when the browser allows it (CORS);
  otherwise fall back to the colored bubble. If there's no logo, use the current colored bubble.

## 5. Profile pictures

- LinkedIn's export does **not** include photos, and we don't scrape LinkedIn.
- Each person gets a Photo field: choose an image file or paste an image URL. Uploaded images are resized in the browser
  (e.g. 96×96 JPEG) and stored as a small data URI, so they fit in the workbook's Photo cell and travel with the file.
- Optional, **off by default**: Gravatar using the email (SHA-256 hash via Web Crypto). It sends a hash of the email to Gravatar, so it's opt-in.
- Fallback: an initials avatar colored by status. Render people as circular images.

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

## 9. README (portfolio-first)

- Lead with the **live demo link** and an animated **GIF** of the app (made from the demo data), then
  "Why I built this", features, privacy, and how it works.
- The Python CLI (`build_map.py`, `network_map/`, pytest) is removed. The browser app does everything it did; the Python version stays in git history (f3d4e74).

## Rules

- **Privacy:** everything stays in the browser. Never commit real data: `.gitignore` blocks `.xlsx`, `.csv`, `.html`
  exports and intro reports, except the fictional `examples/` and the template.
- **No LinkedIn scraping:** only my own data export plus manual entry.
- Tests: unit-test the JS logic (parsing the LinkedIn CSV, merging, org normalization and domain guessing, graph building,
  targets and intro paths, and the workbook round-trip with SheetJS) with `node --test`, with no npm install required to run the site.
  CI runs them before deploying.
- **Local commits only. No push until I say.**

## Phases (commit after each)

1. Static app skeleton: full-screen layout, graph-paper background, demo data loads by default; SheetJS open/save
   (File System Access + download fallback), backups, conflict reload, migration; JS tests; remove Streamlit
2. LinkedIn import (all columns) + lookup-based Add/Edit/Remove person + email in the details panel
3. Targets as the core sidebar section (+ intro report download)
4. Company logos + profile photos/avatars
5. Draggable map with saved positions, offline HTML export, GitHub Pages workflow, README with live link + GIF
