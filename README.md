# Network Map

**An interactive map of who you know, where they work, and who can introduce you to the companies you're targeting. It runs entirely in your browser.**

You sit at the center, and your connections branch out from you. When 3 or more of them share a company or school, they collapse into a group bubble. People you know *through* someone hang off that person, so you can see who could make an intro.

![Network map screenshot](docs/screenshot.png)

*The people in the demo are fictional, and their photos are AI-generated faces of people who don't exist. Company names and logos are trademarks of their owners.*

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
- **One "+ Add person" box** (or press **N**): type a name (type-ahead over your LinkedIn connections), paste their LinkedIn link, or drop the PDF LinkedIn makes from their profile (**More → Save to PDF**) to fill in their whole work history and schools. A short review card highlights the things only you know. The app never contacts LinkedIn; the PDF is read on your computer.
- **LinkedIn pool:** import `Connections.csv` once. Everyone is searchable and filterable, and nobody lands on the map until you add them (one at a time, selected, or "everyone at Apple"). Re-importing never creates duplicates.
- **Work history:** multiple schools with years, past companies, and faint dotted "alumni" links, which also count as a way into a target.
- **Logos and photos:** crisp vector logos in the demo; for your own companies, logos from their website icon or, with a free key, logo.dev / Brandfetch. People get a photo you upload or link (resized in your browser and saved in your workbook), or illustrated avatars drawn locally with [DiceBear](https://www.dicebear.com) (CC0 "Notionists" style).
- **Status colors:** each person's ring shows To Reach Out, Contacted, Scheduled, Met, Follow Up or Referral.
- **Person cards:** click anyone and a card opens right next to them: photo, status (click to change), LinkedIn, email + copy, what's next, the latest meeting, and every field editable in place (click, type, Enter). Groups and targets get a smaller card with your best way in.
- **Meetings, invites, calendar and to-dos:** schedule or log a meeting from a card or the calendar. Your Zoom link is filled in, the person's status updates, and a "send thank-you" task is added. Send the invite through Google Calendar, Outlook, a Gmail draft, your mail app or an `.ics` file. Network Map never sends anything itself; you always click send. The Calendar tab has a month view and a week view with times (drag a meeting to move it, click an empty slot to book one), and the To-Do tab (Overdue / Today / This week / Later) keeps you on track. Optionally connect Google Calendar or Outlook to sync meetings, send invites automatically and see your own events ([setup](docs/CALENDAR_SETUP.md)).
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

Network Map has no backend. Your workbook is read and written by JavaScript in your own browser tab and is never uploaded. The only outside requests are company logos for your own data (the logo service sees the company's domain, e.g. `deloitte.com`; the demo's logos are stored in the site). LinkedIn profile PDFs are read in your browser. Invites open in Google Calendar, Outlook or Gmail only when you click them, and a calendar connection is optional: sign-in stays in your browser tab and only the meetings you create are sent. Backups and unsaved edits are kept in your browser's storage on your machine. Don't commit real contact data: `.gitignore` blocks `.xlsx`, `.csv` and `.html` files except the fictional demo, the blank template and test fixtures.

## License

MIT.

## Credits

- [vis-network](https://github.com/visjs/vis-network) (MIT), [SheetJS Community Edition](https://sheetjs.com) (Apache 2.0), [pdf.js](https://mozilla.github.io/pdf.js/) (Apache 2.0), [MSAL.js](https://github.com/AzureAD/microsoft-authentication-library-for-js) (MIT), [DiceBear](https://www.dicebear.com) (MIT; "Notionists" avatar design by Zoish, CC0).
- Demo logos: [Simple Icons](https://simpleicons.org) (CC0) and public-domain Wikimedia Commons files (sources in `site/demo/logos/SOURCES.md`).
- Demo headshots: AI-generated faces from the [SFHQ dataset](https://github.com/SelfishGene/SFHQ-dataset) by David Beniaguev (MIT). The demo people are fictional.
- Company names and logos are trademarks of their owners.

Details and license texts: [`site/vendor/ATTRIBUTION.md`](site/vendor/ATTRIBUTION.md).
