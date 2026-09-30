# Third-party code, art and trademarks

Everything in this folder is vendored so Orbit runs from static files with no CDN.

| What | Version | Used for | License |
|---|---|---|---|
| [vis-network](https://github.com/visjs/vis-network) | 9.1.9 | The interactive map | MIT (`vis-network-LICENSE-MIT.txt`) |
| [SheetJS Community Edition](https://sheetjs.com) | 0.20.3 | Reading and writing Excel files in the browser | Apache 2.0 (`xlsx-LICENSE-Apache-2.0.txt`) |
| [DiceBear](https://www.dicebear.com) core | 9.4.3 | Generating avatars in the browser | MIT, © Florian Körner (`dicebear/core/LICENSE`) |
| [DM Sans](https://github.com/googlefonts/dm-fonts) (`fonts/dm-sans-*.woff2`) | variable | The Orbit typeface, self-hosted (no Google Fonts request) | SIL Open Font License 1.1 (`fonts/OFL.txt`) |
| [pdf.js](https://mozilla.github.io/pdf.js/) | 6.3.289 (legacy build, for older browsers) | Reading LinkedIn "Save to PDF" profiles in the browser | Apache 2.0 (`pdfjs/LICENSE-Apache-2.0.txt`) |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3 (`fflate.mjs`, the browser ES module build) | Unzipping your LinkedIn data export in the browser | MIT (`fflate-LICENSE-MIT.txt`) |
| [MSAL.js](https://github.com/AzureAD/microsoft-authentication-library-for-js) (`@azure/msal-browser`) | 3.30.0 | Optional Outlook sign-in (loaded only when you connect) | MIT (`msal-browser-LICENSE-MIT.txt`) |
| DiceBear Notionists style | 9.4.2 | Illustrated fallback avatars (people without a photo) | Code: MIT. Design: **CC0 1.0**, "Notionists" by [Zoish](https://bio.link/heyzoish) ([source](https://heyzoish.gumroad.com/l/notionists)) (`dicebear/notionists/LICENSE`) |

Avatars are generated locally, seeded by each person's name. They're the fallback for anyone without a photo.

## Demo headshots

The demo people's photos (`site/demo/photos/`) are **AI-generated faces of people who do not exist**, from the
[Synthetic Faces High Quality (SFHQ) dataset](https://github.com/SelfishGene/SFHQ-dataset) (part 3, StyleGAN2),
© 2022 David Beniaguev, **MIT License** (`site/demo/photos/LICENSE-SFHQ.txt`). MIT requires keeping the copyright and
license notice with copies; it does **not** require attribution on the page. Resized to 128×128; each file's SFHQ source
is listed in `site/demo/photos/SOURCES.md`. No photos of real people are used, and the demo names are fictional.

## Logos and trademarks

The demo shows real, well-known companies and schools. Their logos are crisp SVGs in `site/demo/logos/`, built from
[Simple Icons](https://simpleicons.org) (CC0 1.0) and, for brands Simple Icons doesn't carry, Wikimedia Commons files
marked public domain; each file's source is in `site/demo/logos/SOURCES.md`. With your own data, logos come from
Google's favicon service, or from logo.dev / Brandfetch if you set a key in `site/config.js`; none are stored.
**Company names and logos are trademarks of their owners; demo people are fictional.** They're used only to identify
those organizations.

Google Identity Services (`accounts.google.com/gsi/client`) is loaded from Google, only if you choose to connect Google
Calendar.

To update DiceBear: `npm install`, then `node scripts/vendor_dicebear.mjs`.

## Orbit brand

The Orbit logo, mark, favicons and colors in `site/brand/` are the project's own brand assets (see `site/brand/README.md`).
