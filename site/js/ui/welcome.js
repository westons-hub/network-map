// First visit: a "Welcome!" card (after the intro) with two choices, See the demo or Start your own, and the
// "Start your own" guide to LinkedIn's data export, one illustrated step at a time, ending in a drop zone for
// Connections.csv. The illustrations are site/onboarding/stepN.svg (swap in real screenshots any time).

import { el } from "./dom.js";
import { ask } from "./dialog.js";
import { brandSrc } from "./theme.js";
import { PRIVACY_LINE, exportPickers, filesFromDrop, wrongZipHelp } from "./exportImport.js";

const SEEN_KEY = "orbit:welcome-seen";
export const welcomeSeen = () => { try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked: it may show again */ } };

/** Resolves with "demo", "start" or "" (closed). */
export async function showWelcome() {
  markSeen();
  const body = el("div", undefined, { class: "welcome" });
  const logo = el("img", undefined, { src: brandSrc("logo"), alt: "Orbit", class: "welcome-logo", width: 180, height: 50 });
  logo.dataset.brand = "logo";
  const choice = (value, title, sub, primary) => {
    const b = el("button", undefined, { class: `welcome-choice${primary ? " primary" : ""}`, type: "button",
      onclick: () => document.getElementById("dialog").close(value) });
    b.append(el("strong", title), el("span", sub));
    return b;
  };
  const choices = el("div", undefined, { class: "welcome-choices" });
  choices.append(choice("demo", "See the demo", "Explore an example network", false),
                 choice("start", "Start your own", "Build your network map", true));
  body.append(logo, el("p", "Map who you know, where they work, and who can introduce you to the companies you're targeting. " +
    "Everything stays in your browser.", { class: "welcome-line" }), choices);
  return ask("Welcome!", body, []);
}

const STEPS = [
  ["On LinkedIn, click Me, then Settings & Privacy.", "The Me menu is at the top right, under your photo."],
  ["Open Data privacy, then Get a copy of your data.", "It's in the left-hand list of the settings page."],
  ["Choose Download larger data archive (the top option), then Request archive.",
   "⚠️ Don't use \"Want something in particular?\": that list doesn't include your connections. Picking only \"Profile\" gives a zip with just Profile.csv."],
  ["Wait for LinkedIn's email, then download the zip.", "A first zip with your connections usually arrives in about 10 minutes; the complete one within 24 hours. No need to unzip it."],
  ["Drop the whole .zip here.", "Or the unzipped folder, or single CSV files. It stays in your browser; nothing is uploaded, and you choose who goes on the map."],
];

/**
 * The "Start your own" guide. Resolves with { files: [File] } (the export zip, folder or CSVs),
 * { skip: true } (start with an empty map) or { manual: true } (empty map, then Add person), or null.
 */
export async function showOnboarding() {
  const body = el("div", undefined, { class: "onboarding" });
  const dialog = document.getElementById("dialog");
  let step = 0, result = null;
  const done = value => { result = value; dialog.close("done"); };

  const drop = el("div", undefined, { class: "drop-zone onboarding-drop" });
  drop.append(el("strong", "Drop your LinkedIn export here"), el("span", "the .zip, the unzipped folder, or CSV files", { class: "muted small" }),
              exportPickers(files => { if (files.length) done({ files: [...files] }); }));
  for (const t of [drop, body]) {
    t.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
    t.addEventListener("dragleave", () => drop.classList.remove("over"));
    t.addEventListener("drop", async e => {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.remove("over");
      const files = await filesFromDrop(e.dataTransfer);
      if (files.length) done({ files });
    });
  }
  const help = el("details", undefined, { class: "wrong-zip-toggle" });
  help.append(el("summary", "Wrong zip? (only Profile.csv, no connections)"), wrongZipHelp());

  const img = el("img", undefined, { class: "onboarding-img", alt: "", width: 640, height: 360 });
  const title = el("h4", "");
  const hint = el("p", "", { class: "muted small" });
  const dots = el("div", undefined, { class: "onboarding-dots", "aria-hidden": "true" });
  const back = el("button", "← Back", { class: "btn small", type: "button", onclick: () => go(step - 1) });
  const next = el("button", "Next →", { class: "btn small primary", type: "button", onclick: () => go(step + 1) });
  const nav = el("div", undefined, { class: "onboarding-nav" });
  nav.append(back, dots, next);
  const alt = el("div", undefined, { class: "onboarding-alt" });
  alt.append(el("button", "Skip for now (start with an empty map)", { class: "linklike small", type: "button", onclick: () => done({ skip: true }) }),
             el("button", "Add people manually instead", { class: "linklike small", type: "button", onclick: () => done({ manual: true }) }));

  function go(i) {
    step = Math.max(0, Math.min(STEPS.length - 1, i));
    img.src = `onboarding/step${step + 1}.svg`;
    img.alt = `Step ${step + 1}: ${STEPS[step][0]}`;
    title.textContent = `${step + 1}. ${STEPS[step][0]}`;
    hint.textContent = STEPS[step][1];
    dots.replaceChildren(...STEPS.map((_, j) => el("span", undefined, { class: j === step ? "on" : "" })));
    back.disabled = step === 0;
    next.hidden = step === STEPS.length - 1;
    drop.hidden = step !== STEPS.length - 1;
    help.hidden = step < 2;
    privacy.hidden = step !== STEPS.length - 1;
    img.hidden = step === STEPS.length - 1;
  }
  const privacy = el("p", `🔒 ${PRIVACY_LINE}`, { class: "muted small privacy-line" });
  body.append(el("p", "Your map starts from your LinkedIn data. LinkedIn lets you download it in a few steps:", { class: "small" }),
              img, drop, privacy, title, hint, help, nav, alt);
  go(0);
  const v = await ask("Start your own map", body, [{ label: "Close", value: "" }]);
  return v === "done" ? result : null;
}
