// Read a LinkedIn "Save to PDF" profile in the browser. pdf.js (~1.7 MB) is loaded only when needed.

import { parseLinkedInProfile, pdfItems, profileToPerson } from "../core/linkedinPdf.js";

let pdfjs;
async function load() {
  if (!pdfjs) {
    pdfjs = await import("../../vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  }
  return pdfjs;
}

export const isPdf = file => /\.pdf$/i.test(file?.name ?? "") || file?.type === "application/pdf";

/**
 * A File/Blob or bytes -> { person (fields for the review form), experience, education, currentOptions, unsure,
 * profile (everything parsed) }.
 */
export async function readProfilePdf(fileOrBytes) {
  const bytes = fileOrBytes instanceof Uint8Array ? fileOrBytes : new Uint8Array(await fileOrBytes.arrayBuffer());
  const profile = parseLinkedInProfile(await pdfItems(await load(), bytes));
  return { ...profileToPerson(profile), profile };
}
