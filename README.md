# Network Map

**Turn your contacts into an interactive map of who you know, and who they know.**

You sit at the center. Your direct connections branch out from you. When 3 or more of them share a company or school, they collapse into a group bubble. People you know *through* someone hang off that person, so you can see who could make an intro.

![Network map screenshot](docs/screenshot.png)

*All names and organizations in the demo are fictional.*

## Why I built this

I'm recruiting for strategy and product internships, and my contacts lived in a spreadsheet, a LinkedIn export and my head. I wanted to answer three questions quickly:

1. **Where are my clusters?** Which companies and schools do I already have several people in?
2. **Who can introduce me?** If I want to reach someone at a target company, who in my network connects to them?
3. **Where are my gaps?** Which target companies have no one on the map yet?

## Features

- **Automatic grouping:** 3+ direct connections at the same company or school form a group (configurable). "BYU" and "Brigham Young University", or "Acme" and "Acme, Inc.", count as the same.
- **2nd-degree connections:** fill in "Connected Through" and the person attaches to whoever connects you.
- **Imports your LinkedIn export:** reads `Connections.csv` from LinkedIn's *Get a copy of your data*. There's no scraping and no LinkedIn login.
- **Excel template:** add schools, intros, status and notes. Your edits override the LinkedIn export.
- **Target companies:** list them on the workbook's "Targets" tab (or with `--targets`). They're outlined in red, and any target with no one on your map shows up as a hollow red "gap" bubble.
- **Status colors:** people are colored by Status (Met, Contacted, To Reach Out, Follow Up, Referral). You can toggle this on the page.
- **"Who can intro me to X?" report:** for each target (or any company or person), it lists who you know there and who to ask, with the full path: You → Liam → Zoe → Sam.
- **Interactive page:** search, click for details, double-click to open a LinkedIn profile, toggle 2nd-degree connections. It's one self-contained HTML file that works offline.
- **Streamlit app:** upload your files in the browser and get the map, intro report and target coverage without touching the command line.
- **Private by default:** `.gitignore` keeps your real contact files out of the repo.

## Quick start

```bash
git clone https://github.com/westons-hub/network-map.git
cd network-map
pip install -r requirements.txt

# Try it with the fictional demo data
python build_map.py --demo
```

### Use your own network

1. Copy `template/contacts_template.xlsx` to `my_contacts.xlsx` and fill it in. The "How to use" tab explains each column.
2. *(Optional)* Download your LinkedIn connections: **Settings → Data privacy → Get a copy of your data → Connections**.
3. Build the map:

```bash
python build_map.py --me "Your Name" --contacts my_contacts.xlsx --linkedin Connections.csv
```

The map opens in your browser and is saved as `network_map.html`. If you listed targets, `intro_report.md` is saved too.

Ask about one company or person at any time:

```bash
python build_map.py --me "Your Name" --contacts my_contacts.xlsx --intro "Delta" --no-open
```

### Streamlit version

```bash
pip install -r requirements-app.txt
streamlit run app.py
```

Upload your contacts (and optionally `Connections.csv`) in the sidebar, or turn on the demo data.

### Options

| Flag | What it does | Default |
|---|---|---|
| `--me` | Your name, shown in the center | `Me` |
| `--contacts` | Your Excel (or CSV) contacts file | |
| `--linkedin` | LinkedIn `Connections.csv` export | |
| `--min-group` | People needed to form a group | `3` |
| `--group-by` | Any of `company`, `school`, `tags` | `company,school` |
| `--targets` | Target companies, comma-separated (added to the "Targets" tab) | |
| `--report` | Where to save the intro report when you have targets (`''` skips it) | `intro_report.md` |
| `--intro` | Print who can introduce you to X. Repeatable | |
| `--out` | Output file | `network_map.html` |
| `--no-open` | Don't open the browser | off |

## How it works

```
Excel template ─┐
                ├─► loader.py ──► merge by name ──► graph.py ──► render.py ──► network_map.html
LinkedIn CSV ───┘                 (Excel wins)      (groups,      (vis-network,
                                                     2nd-degree)   inlined, offline)
```

- `network_map/loader.py` reads both sources into `Person` records and merges duplicates.
- `network_map/graph.py` normalizes organization names, finds groups and builds nodes and edges.
- `network_map/render.py` writes a single HTML page using [vis-network](https://github.com/visjs/vis-network).
- `network_map/report.py` walks "Connected Through" chains to answer "who can intro me to X?".
- `app.py` is the Streamlit front end over the same pieces.

## Tests

```bash
pip install -r requirements-app.txt pytest
pytest
```

The Streamlit test is skipped if Streamlit isn't installed.

## Roadmap

- [x] Highlight target companies with no connections yet
- [x] Color people by status (Met / To Reach Out / Follow Up)
- [x] Export a "who can intro me to X?" report
- [x] Streamlit version with file upload

## Privacy

This tool only reads files you give it, and nothing is sent anywhere. Don't commit real contact data: the `.gitignore` blocks `.xlsx`, `.csv`, `.html` and intro-report files except the fictional examples. The Streamlit app keeps uploads in memory only; run it locally if your contacts are private.

## License

MIT. vis-network is used under its MIT license (`network_map/static/vis-network-LICENSE-MIT.txt`).
