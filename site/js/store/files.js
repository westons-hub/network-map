// Opening and saving files in the browser.
//
// Chrome/Edge: the File System Access API, so Save writes back to the same file.
// Safari/Firefox: a normal file picker, and Save downloads the updated workbook.

export const canSaveInPlace = typeof window !== "undefined" && "showOpenFilePicker" in window;

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PICKER_TYPES = [
  { description: "Excel workbook or LinkedIn CSV", accept: { [XLSX_TYPE]: [".xlsx"], "text/csv": [".csv"] } },
];

/** Ask for a file. Returns { name, bytes, lastModified, handle } or null if cancelled. */
export async function pickFile() {
  if (canSaveInPlace) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES, excludeAcceptAllOption: false });
      return { ...(await readHandle(handle)), handle };
    } catch (e) {
      if (e.name === "AbortError") return null;
      throw e;
    }
  }
  return new Promise(resolve => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".xlsx,.csv" });
    input.onchange = async () => {
      const file = input.files[0];
      resolve(file ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()),
                       lastModified: file.lastModified, handle: null } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function readHandle(handle) {
  const file = await handle.getFile();
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), lastModified: file.lastModified };
}

/** Make sure we may write to a saved handle (asks the user if needed). */
export async function ensureWritable(handle) {
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission?.(opts)) === "granted") return true;
  return (await handle.requestPermission?.(opts)) === "granted";
}

/** Ask where to save a new workbook (Chrome/Edge). Returns a handle, or null if unsupported/cancelled. */
export async function pickSaveLocation(suggestedName) {
  if (!("showSaveFilePicker" in window)) return null;
  try {
    return await window.showSaveFilePicker({ suggestedName, types: [{ description: "Excel workbook",
                                                                       accept: { [XLSX_TYPE]: [".xlsx"] } }] });
  } catch (e) {
    if (e.name === "AbortError") return undefined; // cancelled: distinct from "unsupported"
    throw e;
  }
}

export async function writeHandle(handle, bytes) {
  const w = await handle.createWritable();
  await w.write(bytes);
  await w.close();
  return (await handle.getFile()).lastModified;
}

export function download(bytes, name, type = XLSX_TYPE) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
