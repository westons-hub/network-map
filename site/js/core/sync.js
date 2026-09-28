// Saving a workbook safely. File access is passed in (`io`), so the browser can
// use the File System Access API while tests use an in-memory fake.
//
// io = {
//   read():   Promise<{ bytes, lastModified } | null>  // null = can't re-read (download mode)
//   write(bytes): Promise<number | null>               // new lastModified, if known
//   backup(bytes): Promise<void>                       // keep the previous version
// }

import { replay } from "./ops.js";
import { readWorkbook, writeWorkbook } from "./workbook.js";

/**
 * doc = { model, base (bytes last read or written), lastModified, pending (ops since then) }
 * Returns the updated doc plus `reloaded: true` if the file had changed on disk
 * and your pending edits were replayed on top of the newer file.
 */
export async function saveDoc(doc, io) {
  let { model, base, lastModified } = doc;
  let reloaded = false;
  const current = await io.read();
  if (current && lastModified != null && current.lastModified !== lastModified) {
    base = current.bytes;
    model = replay(readWorkbook(base), doc.pending);
    reloaded = true;
  }
  const previous = current?.bytes ?? base;
  if (previous?.length) await io.backup(previous); // a brand-new empty file has nothing to back up
  const bytes = writeWorkbook(model, base);
  const written = await io.write(bytes);
  return { model, base: bytes, lastModified: written ?? current?.lastModified ?? null, pending: [], reloaded };
}
