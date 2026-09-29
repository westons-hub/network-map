// Optional calendar connections, straight from the browser (no server, no secrets).
//
// Google: Google Identity Services token client + Calendar API (scope calendar.events).
// Outlook: MSAL.js (auth code + PKCE, popup) + Microsoft Graph (Calendars.ReadWrite).
//
// Access tokens live in memory and sessionStorage only (gone when the tab closes), and "Disconnect"
// forgets them. Only the events you create or edit are sent. Setup: docs/CALENDAR_SETUP.md.

import { CONFIG } from "../../config.js";
import { meetingTitle, toDate } from "../core/schedule.js";

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GRAPH_SCOPES = ["Calendars.ReadWrite"];
const SESSION_KEY = "network-map:calendar-token";

let token = null; // { provider: "google" | "outlook", accessToken, expires, account }
try { token = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { token = null; }
if (token && token.expires < Date.now()) token = null;
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn(status()));

function remember(t) {
  token = t;
  try { t ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(t)) : sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  emit();
}

export const configured = { google: !!CONFIG.calendar.googleClientId, outlook: !!CONFIG.calendar.microsoftClientId };
export const status = () => ({ provider: token?.provider ?? null, account: token?.account ?? "", configured });
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = Object.assign(document.createElement("script"), { src, async: true, onload: resolve,
      onerror: () => reject(new Error(`Couldn't load ${src}`)) });
    document.head.append(s);
  });
}

// ---- connect / disconnect ----------------------------------------------------------------

export async function connectGoogle() {
  if (!configured.google) throw new Error("Google Calendar isn't set up for this site yet (see docs/CALENDAR_SETUP.md).");
  await loadScript("https://accounts.google.com/gsi/client");
  const response = await new Promise((resolve, reject) => {
    const client = globalThis.google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.calendar.googleClientId, scope: GOOGLE_SCOPE,
      callback: r => (r.error ? reject(new Error(r.error_description || r.error)) : resolve(r)),
      error_callback: e => reject(new Error(e.message || e.type || "Google sign-in was closed.")),
    });
    client.requestAccessToken({ prompt: "" });
  });
  remember({ provider: "google", accessToken: response.access_token, expires: Date.now() + (response.expires_in - 60) * 1000,
             account: "Google Calendar" });
}

let msalApp;
async function msal() {
  if (msalApp) return msalApp;
  await loadScript("vendor/msal-browser.min.js");
  msalApp = new globalThis.msal.PublicClientApplication({
    auth: { clientId: CONFIG.calendar.microsoftClientId,
            authority: `https://login.microsoftonline.com/${CONFIG.calendar.microsoftTenant || "common"}`,
            redirectUri: new URL(".", location.href).href },
    cache: { cacheLocation: "sessionStorage" },
  });
  await msalApp.initialize();
  return msalApp;
}

export async function connectOutlook() {
  if (!configured.outlook) throw new Error("Outlook isn't set up for this site yet (see docs/CALENDAR_SETUP.md).");
  const app = await msal();
  const login = await app.loginPopup({ scopes: GRAPH_SCOPES, prompt: "select_account" });
  const r = await app.acquireTokenSilent({ scopes: GRAPH_SCOPES, account: login.account });
  remember({ provider: "outlook", accessToken: r.accessToken, expires: r.expiresOn?.getTime?.() ?? Date.now() + 3_000_000,
             account: login.account?.username || "Outlook" });
}

export async function disconnect() {
  if (token?.provider === "google" && globalThis.google?.accounts?.oauth2) {
    try { globalThis.google.accounts.oauth2.revoke(token.accessToken, () => {}); } catch { /* ignore */ }
  }
  if (token?.provider === "outlook" && msalApp) {
    try { for (const a of msalApp.getAllAccounts()) await msalApp.clearCache({ account: a }); } catch { /* ignore */ }
  }
  remember(null);
}

// ---- API calls ------------------------------------------------------------------------------

async function api(url, { method = "GET", body, headers = {} } = {}) {
  if (!token || token.expires < Date.now()) { remember(null); throw new Error("Your calendar connection expired. Connect again in Settings."); }
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token.accessToken}`,
    ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { remember(null); throw new Error("Your calendar connection expired. Connect again in Settings."); }
  if (!res.ok && res.status !== 204 && res.status !== 410) throw new Error(`Calendar error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 || res.status === 410 ? null : res.json();
}

const iso = (date, time) => toDate(date, time).toISOString();
const [PREFIX_G, PREFIX_O] = ["google:", "outlook:"];

/**
 * Create or update the event for a meeting on the connected calendar, inviting the person.
 * Returns the stored event ID ("google:…" / "outlook:…"), or null when not connected.
 */
export async function syncMeeting(meeting, { me, email, message }) {
  if (!token) return null;
  const title = meetingTitle(meeting, me);
  const start = iso(meeting.date, meeting.start), end = iso(meeting.date, meeting.end || meeting.start);
  if (token.provider === "google") {
    const id = meeting.eventId?.startsWith(PREFIX_G) ? meeting.eventId.slice(PREFIX_G.length) : "";
    const event = { summary: title, description: message, location: meeting.link || meeting.method || "",
                    start: { dateTime: start }, end: { dateTime: end }, attendees: email ? [{ email }] : [] };
    if (meeting.method === "Google Meet" && !meeting.link) {
      event.conferenceData = { createRequest: { requestId: meeting.id, conferenceSolutionKey: { type: "hangoutsMeet" } } };
    }
    const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    const q = "sendUpdates=all&conferenceDataVersion=1";
    const saved = id ? await api(`${base}/${encodeURIComponent(id)}?${q}`, { method: "PATCH", body: event })
                     : await api(`${base}?${q}`, { method: "POST", body: event });
    return { eventId: PREFIX_G + saved.id, link: saved.hangoutLink || meeting.link };
  }
  const id = meeting.eventId?.startsWith(PREFIX_O) ? meeting.eventId.slice(PREFIX_O.length) : "";
  const event = { subject: title, body: { contentType: "Text", content: message },
                  start: { dateTime: start.replace("Z", ""), timeZone: "UTC" }, end: { dateTime: end.replace("Z", ""), timeZone: "UTC" },
                  location: { displayName: meeting.link || meeting.method || "" },
                  attendees: email ? [{ emailAddress: { address: email, name: meeting.person }, type: "required" }] : [] };
  if (meeting.method === "Teams" && !meeting.link) Object.assign(event, { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" });
  const saved = id ? await api(`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(id)}`, { method: "PATCH", body: event })
                   : await api("https://graph.microsoft.com/v1.0/me/events", { method: "POST", body: event });
  return { eventId: PREFIX_O + saved.id, link: saved.onlineMeeting?.joinUrl || meeting.link };
}

/** Cancel the meeting's event (attendees get a cancellation). */
export async function cancelMeeting(meeting) {
  if (!token || !meeting.eventId) return;
  if (token.provider === "google" && meeting.eventId.startsWith(PREFIX_G)) {
    await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(meeting.eventId.slice(PREFIX_G.length))}?sendUpdates=all`,
              { method: "DELETE" });
  } else if (token.provider === "outlook" && meeting.eventId.startsWith(PREFIX_O)) {
    await api(`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(meeting.eventId.slice(PREFIX_O.length))}/cancel`,
              { method: "POST", body: { comment: "Canceled from Network Map" } });
  }
}

/** Your own events between two dates (read-only, shown muted in the Calendar). */
export async function listEvents(from, to) {
  if (!token) return [];
  const timeMin = toDate(from).toISOString(), timeMax = toDate(to, "23:59").toISOString();
  const local = d => { const x = new Date(d); return { date: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`,
                                                       time: `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}` }; };
  if (token.provider === "google") {
    const q = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
    const data = await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
    return (data.items ?? []).filter(e => e.status !== "cancelled").map(e => {
      if (e.start?.date) return { id: `google:${e.id}`, date: e.start.date, start: "", end: "", title: e.summary || "Busy" };
      const s = local(e.start.dateTime), en = local(e.end.dateTime);
      return { id: `google:${e.id}`, date: s.date, start: s.time, end: en.time, title: e.summary || "Busy" };
    });
  }
  const q = new URLSearchParams({ startDateTime: timeMin, endDateTime: timeMax, $top: "250", $select: "id,subject,start,end,isAllDay" });
  const data = await api(`https://graph.microsoft.com/v1.0/me/calendarView?${q}`, { headers: { Prefer: 'outlook.timezone="UTC"' } });
  return (data.value ?? []).map(e => {
    const s = local(`${e.start.dateTime}Z`), en = local(`${e.end.dateTime}Z`);
    return { id: `outlook:${e.id}`, date: s.date, start: e.isAllDay ? "" : s.time, end: e.isAllDay ? "" : en.time, title: e.subject || "Busy" };
  });
}
