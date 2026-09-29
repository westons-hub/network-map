// Finishing touches SheetJS's free edition can't write: a frozen, bold header row, wrapped text in long
// columns, and dropdown lists (Excel data validation). The .xlsx is a zip of XML files; we open it with the
// zip reader that ships inside SheetJS, edit the sheet XML, and zip it back. Nothing is uploaded anywhere.

import * as XLSX from "../../vendor/xlsx.mjs";

const decoder = new TextDecoder(), encoder = new TextEncoder();
const escXml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 0 -> "A", 27 -> "AB". */
export function colName(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * Polish the named sheets. spec: { [sheetName]: { headers: [...], wrap: [header...], lists: { [header]: [values] },
 * strictLists: [header...] } }. Lists are dropdowns; typing something else only warns, except for strictLists.
 */
export function polishXlsx(bytes, spec) {
  const zip = XLSX.CFB.read(bytes, { type: "array" });
  const file = path => zip.FileIndex[zip.FullPaths.findIndex(p => p.endsWith(`/${path}`))];
  const read = path => decoder.decode(file(path).content);
  const write = (path, text) => { const f = file(path); f.content = encoder.encode(text); f.size = f.content.length; };

  // Two new cell styles: bold header, and wrapped text aligned to the top.
  let styles = read("xl/styles.xml");
  const fontCount = Number(styles.match(/<fonts count="(\d+)"/)?.[1] ?? 1);
  const firstFont = styles.match(/<fonts[^>]*>(<font>.*?<\/font>|<font\/>)/s)?.[1] ?? "<font/>";
  const boldFont = firstFont === "<font/>" ? "<font><b/></font>" : firstFont.replace("<font>", "<font><b/>");
  styles = styles.replace(/<fonts count="\d+"([^>]*)>(.*?)<\/fonts>/s, (_, attrs, body) => `<fonts count="${fontCount + 1}"${attrs}>${body}${boldFont}</fonts>`);
  const xfCount = Number(styles.match(/<cellXfs count="(\d+)"/)?.[1] ?? 1);
  const HEADER = xfCount, WRAP = xfCount + 1;
  styles = styles.replace(/<cellXfs count="\d+"([^>]*)>(.*?)<\/cellXfs>/s, (_, attrs, body) => `<cellXfs count="${xfCount + 2}"${attrs}>${body}` +
    `<xf numFmtId="0" fontId="${fontCount}" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>`);
  write("xl/styles.xml", styles);

  // Sheet name -> its XML file, through workbook.xml and its relationships.
  const wbXml = read("xl/workbook.xml"), rels = read("xl/_rels/workbook.xml.rels");
  const targetOf = id => rels.match(new RegExp(`<Relationship[^>]*Id="${id}"[^>]*Target="([^"]+)"`))?.[1]
                      ?? rels.match(new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${id}"`))?.[1];
  for (const [, attrs] of wbXml.matchAll(/<sheet ([^>]*)\/>/g)) {
    const name = attrs.match(/name="([^"]*)"/)?.[1]?.replace(/&amp;/g, "&");
    const s = spec[name];
    if (!s) continue;
    const id = attrs.match(/r:id="([^"]+)"/)?.[1];
    const path = `xl/${targetOf(id).replace(/^\/?xl\//, "")}`;
    write(path, polishSheet(read(path), s, { HEADER, WRAP }));
  }
  return new Uint8Array(XLSX.CFB.write(zip, { type: "array", fileType: "zip", compression: true }));
}

function polishSheet(xml, { headers, wrap = [], lists = {}, strictLists = [] }, { HEADER, WRAP }) {
  const wrapCols = new Set(wrap.map(h => headers.indexOf(h)).filter(i => i >= 0).map(colName));
  // Styles: header row bold; long-text columns wrapped (cells that already have a style, like dates, keep it).
  xml = xml.replace(/<c r="([A-Z]+)(\d+)"([^>]*?)(\/?)>/g, (m, col, row, attrs, selfClose) => {
    if (row === "1") return `<c r="${col}${row}"${attrs.replace(/\s*s="\d+"/, "")} s="${HEADER}"${selfClose}>`;
    if (wrapCols.has(col) && !/\ss="/.test(attrs)) return `<c r="${col}${row}"${attrs} s="${WRAP}"${selfClose}>`;
    return m;
  });
  // Frozen header row.
  const pane = `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>`;
  xml = xml.replace(/<sheetView([^>]*?)\/>/, `<sheetView$1>${pane}</sheetView>`);
  // Dropdowns, from row 2 down.
  const rows = Math.max(Number(xml.match(/<dimension ref="[A-Z]+\d+:[A-Z]+(\d+)"/)?.[1] ?? 1) + 500, 1000);
  const validations = Object.entries(lists).map(([h, values]) => [headers.indexOf(h), h, values]).filter(([i]) => i >= 0)
    .map(([i, h, values]) => {
      const strict = strictLists.includes(h);
      return `<dataValidation type="list" allowBlank="1" showInputMessage="0" showErrorMessage="${strict ? 1 : 0}"` +
        `${strict ? "" : ' errorStyle="information"'} sqref="${colName(i)}2:${colName(i)}${rows}">` +
        `<formula1>"${escXml(values.join(",")).replace(/&quot;/g, "")}"</formula1></dataValidation>`;
    });
  if (validations.length) {
    const block = `<dataValidations count="${validations.length}">${validations.join("")}</dataValidations>`;
    // dataValidations go after sheetData / autoFilter / mergeCells, before hyperlinks and the rest.
    const before = xml.match(/<(hyperlinks|printOptions|pageMargins|pageSetup|headerFooter|ignoredErrors|drawing|legacyDrawing|tableParts|extLst)[\s>/]/);
    xml = before ? xml.replace(before[0], `${block}${before[0]}`) : xml.replace("</worksheet>", `${block}</worksheet>`);
  }
  return xml;
}
