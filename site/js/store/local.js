// Browser-only storage (IndexedDB). Nothing here ever leaves this browser.
//
// - backups: the previous version of your workbook, kept before every save (last 10)
// - kv:      small values: unsaved edits (drafts), the demo's edits, the last file handle
//
// Every call fails soft: private windows or blocked storage just mean no backups/drafts.

const DB = "network-map";
const KEEP_BACKUPS = 10;
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("backups", { keyPath: "id", autoIncrement: true });
      req.result.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("Browser storage unavailable:", e);
    return undefined;
  }
}

export const kvGet = key => run("kv", "readonly", s => s.get(key));
export const kvSet = (key, value) => run("kv", "readwrite", s => s.put(value, key));
export const kvDelete = key => run("kv", "readwrite", s => s.delete(key));

/** Keep a copy of `bytes` (the version about to be replaced). */
export async function addBackup(fileName, bytes) {
  await run("backups", "readwrite", s => s.add({ fileName, bytes, time: Date.now() }));
  const all = (await listBackups()) ?? [];
  const old = all.slice(KEEP_BACKUPS);
  if (old.length) await run("backups", "readwrite", s => { old.forEach(b => s.delete(b.id)); });
}

/** Newest first. */
export async function listBackups() {
  const all = (await run("backups", "readonly", s => s.getAll())) ?? [];
  return all.sort((a, b) => b.time - a.time);
}
