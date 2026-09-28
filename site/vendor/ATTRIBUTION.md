# Third-party code, art and trademarks

Everything in this folder is vendored so Network Map runs from static files with no CDN.

| What | Version | Used for | License |
|---|---|---|---|
| [vis-network](https://github.com/visjs/vis-network) | 9.1.9 | The interactive map | MIT (`vis-network-LICENSE-MIT.txt`) |
| [SheetJS Community Edition](https://sheetjs.com) | 0.20.3 | Reading and writing Excel files in the browser | Apache 2.0 (`xlsx-LICENSE-Apache-2.0.txt`) |
| [DiceBear](https://www.dicebear.com) core | 9.4.3 | Generating avatars in the browser | MIT, © Florian Körner (`dicebear/core/LICENSE`) |
| DiceBear Notionists style | 9.4.2 | Illustrated avatars for the fictional demo people | Code: MIT. Design: **CC0 1.0**, "Notionists" by [Zoish](https://bio.link/heyzoish) ([source](https://heyzoish.gumroad.com/l/notionists)) (`dicebear/notionists/LICENSE`) |

Avatars are generated locally, seeded by each person's name. No images are downloaded and no real people's photos are used.

## Logos and trademarks

The demo shows real, well-known companies and schools. Their logos are loaded at runtime from Google's favicon service
(`https://www.google.com/s2/favicons`) and are **not** stored in this repository. **Company names and logos are
trademarks of their owners; demo people are fictional.** Their use here is only to identify those organizations.

To update DiceBear: `npm install`, then `node scripts/vendor_dicebear.mjs`.
