// Pictures for nodes: logos for companies/schools/targets and avatars for people.
//
// Organizations: Logo on the Companies sheet (the demo's crisp SVGs live there) > a logo for the Companies
//   sheet's Website > a logo for a guessed domain (only with your own data) > generated initials logo.
//   Logos come from logo.dev or Brandfetch if a key is set in site/config.js, otherwise Google's favicons.
// People: Photo cell (an uploaded picture or a pasted image link) > the workbook's avatar style
//   (DiceBear "Notionists", generated locally) > initials avatar.
// Anything that fails to load falls back to the generated initials picture.

import { initialsAvatar, initialsLogo } from "../core/avatars.js";
import { CONFIG } from "../../config.js";
import { domainFrom, guessDomain, isRealLogo, logoSource, logoUrl } from "../core/logos.js";
import { normalizeOrg } from "../core/org.js";

// Soft pastel backgrounds for illustrated avatars (DiceBear picks one per seed).
const AVATAR_BACKGROUNDS = ["dbe7ff", "d3f5e6", "ece3ff", "ffe3d3", "d5f1f8", "ffdbe7", "fff1c2", "e3e8ef"];

const PROBE_KEY = "network-map:logo-probes";
const PROBE_TTL = 1000 * 60 * 60 * 24 * 30; // re-check "no logo" domains after 30 days

function loadProbes() {
  try { return JSON.parse(localStorage.getItem(PROBE_KEY)) ?? {}; } catch { return {}; }
}
function saveProbes(p) {
  try { localStorage.setItem(PROBE_KEY, JSON.stringify(p)); } catch { /* storage blocked: just re-check next time */ }
}

export function createImages({ onChange }) {
  let companies = new Map();
  let guessDomains = false;
  let avatarStyle = "initials";
  let dicebear = null;                 // { createAvatar, style } once loaded
  let dicebearLoading = false;
  const illustrated = new Map();       // name -> data URI
  const probes = loadProbes();         // domain -> { ok, t }
  const pending = new Set();
  let notifyTimer;
  const changed = () => { clearTimeout(notifyTimer); notifyTimer = setTimeout(onChange, 60); };

  const source = logoSource(CONFIG.logos);
  const url = domain => logoUrl(domain, CONFIG.logos);

  function probe(domain) {
    const key = source === "google" ? domain : `${source}:${domain}`;
    const known = probes[key];
    if (known && (known.ok || Date.now() - known.t < PROBE_TTL)) return known.ok ? "ok" : "none";
    if (!pending.has(domain)) {
      pending.add(domain);
      const img = new Image();
      const done = ok => { pending.delete(domain); probes[key] = { ok, t: Date.now() }; saveProbes(probes); changed(); };
      img.onload = () => done(isRealLogo(img.naturalWidth));
      img.onerror = () => done(false);
      // Brandfetch requires the site's origin as referrer; Google doesn't need one.
      img.referrerPolicy = source === "google" ? "no-referrer" : "strict-origin-when-cross-origin";
      img.src = url(domain);
    }
    return "pending";
  }

  /** The DiceBear library is ~500 KB, so it's only loaded when an illustrated style is in use. */
  function loadDicebear() {
    if (dicebear || dicebearLoading) return;
    dicebearLoading = true;
    Promise.all([import("../../vendor/dicebear/core/index.js"), import("../../vendor/dicebear/notionists/index.js")])
      .then(([core, style]) => { dicebear = { createAvatar: core.createAvatar, style }; changed(); })
      .catch(e => console.warn("Couldn't load illustrated avatars:", e))
      .finally(() => { dicebearLoading = false; });
  }

  function illustratedAvatar(name) {
    if (!dicebear) { loadDicebear(); return null; }
    if (!illustrated.has(name)) {
      illustrated.set(name, dicebear.createAvatar(dicebear.style, {
        seed: name, size: 96, scale: 125, translateY: 6, // frame the face, not the shoulders
        backgroundColor: AVATAR_BACKGROUNDS, backgroundType: ["solid"] }).toDataUri());
    }
    return illustrated.get(name);
  }

  return {
    /**
     * companies: Companies sheet rows; guessDomains: false in the demo (it only uses explicit Websites);
     * avatarStyle: the workbook's "Avatar style" setting.
     */
    configure(opts) {
      companies = new Map((opts.companies ?? []).map(c => [normalizeOrg(c.company), c]));
      guessDomains = !!opts.guessDomains;
      avatarStyle = opts.avatarStyle ?? "initials";
    },

    forOrg(node) {
      const fallback = initialsLogo(node.label);
      const row = companies.get(node.key ?? normalizeOrg(node.label));
      if (row?.logo) return { image: row.logo, brokenImage: fallback };
      if (node.kind !== "tag") {
        const domain = domainFrom(row?.website) || (guessDomains ? guessDomain(node.label) : "");
        if (domain && probe(domain) === "ok") return { image: url(domain), brokenImage: fallback };
      }
      return { image: fallback, brokenImage: fallback };
    },

    forPerson(node) {
      const art = avatarStyle === "notionists" ? illustratedAvatar(node.label) : null;
      const fallback = art ?? initialsAvatar(node.label);
      if (node.photo) return { image: node.photo, brokenImage: fallback };
      return { image: fallback, brokenImage: initialsAvatar(node.label) };
    },
  };
}
