// Pictures for nodes: logos for companies/schools/targets and avatars for people.
//
// Priority for organizations: Logo on the Companies sheet (the demo's made-up logos live there)
//   > favicon for the guessed/overridden domain (real data only) > generated initials logo.
// Priority for people: Photo cell > Gravatar (only if turned on) > initials avatar.
// Anything that fails to load falls back to the generated picture.

import { initialsAvatar, initialsLogo } from "../core/avatars.js";
import { guessDomain, isRealLogo, logoUrl } from "../core/logos.js";
import { normalizeOrg } from "../core/org.js";

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
  let allowNetwork = false;
  let gravatar = false;
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

  return {
    /** companies: the Companies sheet rows; allowNetwork: false in demo mode; gravatar: user setting. */
    configure(opts) {
      companies = new Map((opts.companies ?? []).map(c => [normalizeOrg(c.company), c]));
      allowNetwork = !!opts.allowNetwork;
      gravatar = !!opts.gravatar;
    },

    forOrg(node) {
      const fallback = initialsLogo(node.label);
      const row = companies.get(node.key ?? normalizeOrg(node.label));
      if (row?.logo) return { image: row.logo, brokenImage: fallback };
      if (allowNetwork && node.kind !== "tag") {
        const domain = guessDomain(node.label, row?.website);
        if (domain && probe(domain) === "ok") return { image: logoUrl(domain), brokenImage: fallback };
      }
      return { image: fallback, brokenImage: fallback };
    },

    forPerson(node) {
      const fallback = initialsAvatar(node.label);
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
      return { image: fallback, brokenImage: fallback };
    },
  };
}
