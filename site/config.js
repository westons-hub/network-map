// Public settings for your deployment of Orbit.
//
// ⚠️ This file is served to everyone who opens the site. Only put PUBLISHABLE values here — never secrets.
// Everything is optional: with the defaults, the app works fully (Google favicons for logos, and
// "Send invite → Google Calendar" (plus Outlook, Gmail and .ics) instead of a calendar connection).

export const CONFIG = {
  logos: {
    // "logo.dev" | "brandfetch" | "" (use Google's favicon service)
    provider: "",
    // logo.dev publishable key (starts with "pk_"). Free plan: no attribution for personal projects;
    // commercial projects must show a visible "Logos provided by Logo.dev" link. https://www.logo.dev
    logoDevKey: "",
    // Brandfetch Logo API client ID. Free tier: no attribution; logos must be hotlinked (not stored).
    // https://docs.brandfetch.com/logo-api/overview
    brandfetchClientId: "",
  },
  calendar: {
    // OAuth client IDs are public identifiers, not secrets. See docs/CALENDAR_SETUP.md.
    googleClientId: "",     // Google Cloud → OAuth client (Web application)
    microsoftClientId: "",  // Azure → App registration (Single-page application)
    microsoftTenant: "common",
  },
};
