# Network Map

**An interactive map of who you know, where they work, and who can introduce you to the companies you're targeting. It runs entirely in your browser.**

You sit at the center, and your connections branch out from you. When 3 or more of them share a company or school, they collapse into a group bubble. People you know *through* someone hang off that person, so you can see who could make an intro.

![Network map screenshot](docs/screenshot.png)

*The people in the demo are fictional. Company names and logos are trademarks of their owners.*

## Why I built this

I'm recruiting for strategy and product internships, and my contacts lived in a spreadsheet, a LinkedIn export and my head. I wanted to answer three questions quickly:

1. **Where are my clusters?** Which companies and schools do I already have several people in?
2. **Who can introduce me?** If I want to reach someone at a target company, who in my network connects to them?
3. **Where are my gaps?** Which target companies have no one on the map yet?

## Features

- **Opens instantly with demo data.** There's nothing to install and no sign-up.
- **Use your own data:** open your Excel workbook or LinkedIn `Connections.csv`. Excel is the database: edits save straight back to your `.xlsx` in Chrome and Edge, and Safari and Firefox download the updated file.
- **Safe saving:** the previous version is backed up in your browser before every save. If you edited the file in Excel meanwhile, it's reloaded and your changes are applied on top instead of overwriting. Unsaved changes survive a refresh.
- **Automatic grouping:** 3+ direct connections at the same company or school form a group. "BYU" and "Brigham Young University", or "Acme" and "Acme, Inc.", count as the same.
- **2nd-degree connections:** fill in "Connected Through" and the person attaches to whoever connects you.
- **Target companies:** add them with "+ Add target" (type-ahead over your companies, plus Priority and Stage). Every target is its own red-ringed node. Click one to see **your best way in** (for example Me → Liam → Zoe) drawn in red on the map, preferring the contacts you're warmest with.
- **Highlight on click:** a person, group or target lights up with its connections while everything else fades. Hovering previews the same thing.
- **Free or Ring layout:** physics with well-separated clusters, or a tidy ring with groups around you and no-connection targets on the outer edge.
- **Logos and photos:** companies and schools show their real logo, loaded from their website's icon (only the domain is sent, never contact data; set a Website in the Companies sheet to override the guess). People get an "Add photo" (resized in your browser and saved in your workbook), opt-in Gravatar, or illustrated avatars drawn locally with [DiceBear](https://www.dicebear.com) (CC0 "Notionists" style).
- **Status colors:** each person's ring shows Met, Contacted, To Reach Out, Follow Up or Referral.
- **Details panel:** email (click to write, or copy), role, school, Connected On date, tags, notes and LinkedIn link.
- **Full-screen map** on a graph-paper background, with smooth zoom.
- **Private by design:** no server, no uploads and no trackers. See [Privacy](#privacy).

## Use it

**Online:** a live link is coming with the GitHub Pages deploy.

**Locally:** the app is static files, so any web server works:

```bash
git clone https://github.com/westons-hub/network-map.git
cd network-map
npm start            # same as: python3 -m http.server 8000 --bind 127.0.0.1 -d site
# open http://127.0.0.1:8000
```

### Your own data

1. **Use my own data → Download the blank template** (or **Start a new, empty workbook**). The "How to use" tab explains each column.
2. *(Optional)* Download your LinkedIn connections: **Settings → Data privacy → Get a copy of your data → Connections**, then open `Connections.csv` from **Use my own data**. There's no scraping and no LinkedIn login; it only reads the file you choose.
3. Open your workbook, edit it, and **Save** (⌘S / Ctrl+S).

Old-format files from v1 (a "Contacts" sheet) are migrated automatically.

## How it works

```
your .xlsx / Connections.csv
        │  SheetJS (in the browser)
        ▼
 core/workbook.js ──► model ──► core/graph.js ──► ui/map.js (vis-network)
        ▲               │ edits are small operations (core/ops.js)
        └── core/sync.js: back up, check the file didn't change on disk, replay edits, write
```

- `site/js/core/`: pure logic with no DOM, unit-tested in Node. It covers name normalization and aliases (`org.js`), people and LinkedIn CSV parsing (`people.js`), grouping and targets (`graph.js`), "who can intro me?" chains and best paths (`intro.js`, `paths.js`), the Ring layout (`layout.js`), generated avatars and logos (`avatars.js`), domain guessing (`logos.js`), and the workbook format and migration (`workbook.js`).
- `site/js/store/`: file access (File System Access API or download) and browser storage (IndexedDB backups and drafts).
- `site/js/ui/`: the map and sidebar.
- `site/vendor/`: vis-network and SheetJS, vendored so the site has no CDN dependency.

The demo workbook and blank template are generated by `npm run demo-data`. DiceBear is vendored with `npm install && node scripts/vendor_dicebear.mjs` (only needed to update it).

## Tests

```bash
npm test             # node --test, no install needed (Node 22+)
```

## Privacy

Network Map has no backend. Your workbook is read and written by JavaScript in your own browser tab and is never uploaded. The only outside requests are company logos (Google's favicon service sees the company's domain, e.g. `deloitte.com`) and, only if you turn it on, Gravatar (it sees a hash of each email). The demo loads just the logos of its listed companies and never uses Gravatar. Backups and unsaved edits are kept in your browser's storage on your machine. Don't commit real contact data: `.gitignore` blocks `.xlsx`, `.csv` and `.html` files except the fictional demo, the blank template and test fixtures.

## License

MIT. Third-party code and art are listed in [`site/vendor/ATTRIBUTION.md`](site/vendor/ATTRIBUTION.md): vis-network (MIT), SheetJS Community Edition (Apache 2.0) and DiceBear (MIT code; the Notionists design by Zoish is CC0). Company names and logos are trademarks of their owners.
