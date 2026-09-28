// Pictures for nodes: logos for companies/schools/targets and avatars for people.
//
// Organizations: Logo on the Companies sheet > favicon for the Companies sheet's Website >
//   favicon for a guessed domain (only with your own data; the demo only uses its explicit domains) >
//   generated initials logo.
// People: Photo cell > Gravatar (only if turned on) > the workbook's avatar style
//   (DiceBear "Notionists", generated locally) > initials avatar.
// Anything that fails to load falls back to the generated initials picture.

import { initialsAvatar, initialsLogo } from "../core/avatars.js";
import { domainFrom, guessDomain, isRealLogo, logoUrl } from "../core/logos.js";
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

async function sha256(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function createImages({ onChange }) {
  let companies = new Map();
  let guessDomains = false;
  let gravatar = false;
  let avatarStyle = "initials";
  let dicebear = null;                 // { createAvatar, style } once loaded
  let dicebearLoading = false;
  const illustrated = new Map();       // name -> data URI
  const probes = loadProbes();         // domain -> { ok, t }
  const pending = new Set();
  const hashes = new Map();            // email -> sha256 | null (pending)
  let notifyTimer;
  const changed = () => { clearTimeout(notifyTimer); notifyTimer = setTimeout(onChange, 60); };

  function probe(domain) {
    const known = probes[domain];
    if (known && (known.ok || Date.now() - known.t < PROBE_TTL)) return known.ok ? "ok" : "none";
    if (!pending.has(domain)) {
      pending.add(domain);
      const img = new Image();
      const done = ok => { pending.delete(domain); probes[domain] = { ok, t: Date.now() }; saveProbes(probes); changed(); };
      img.onload = () => done(isRealLogo(img.naturalWidth));
      img.onerror = () => done(false);
      img.referrerPolicy = "no-referrer";
      img.src = logoUrl(domain);
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
     * gravatar: user setting; avatarStyle: the workbook's "Avatar style" setting.
     */
    configure(opts) {
      companies = new Map((opts.companies ?? []).map(c => [normalizeOrg(c.company), c]));
      guessDomains = !!opts.guessDomains;
      gravatar = !!opts.gravatar;
      avatarStyle = opts.avatarStyle ?? "initials";
    },

    forOrg(node) {
      const fallback = initialsLogo(node.label);
      const row = companies.get(node.key ?? normalizeOrg(node.label));
      if (row?.logo) return { image: row.logo, brokenImage: fallback };
      if (node.kind !== "tag") {
        const domain = domainFrom(row?.website) || (guessDomains ? guessDomain(node.label) : "");
        if (domain && probe(domain) === "ok") return { image: logoUrl(domain), brokenImage: fallback };
      }
      return { image: fallback, brokenImage: fallback };
    },

    forPerson(node) {
      const art = avatarStyle === "notionists" ? illustratedAvatar(node.label) : null;
      const fallback = art ?? initialsAvatar(node.label);
      if (node.photo) return { image: node.photo, brokenImage: fallback };
      const email = (node.email ?? "").trim().toLowerCase();
      if (gravatar && email.includes("@")) {
        if (!hashes.has(email)) {
          hashes.set(email, null);
          sha256(email).then(h => { hashes.set(email, h); changed(); }).catch(() => {});
        }
        const h = hashes.get(email);
        if (h) return { image: `https://gravatar.com/avatar/${h}?s=96&d=404`, brokenImage: fallback };
      }
      return { image: fallback, brokenImage: initialsAvatar(node.label) };
    },
  };
}
