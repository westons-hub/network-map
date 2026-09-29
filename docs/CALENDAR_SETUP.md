# Connecting Google Calendar or Outlook (optional)

Orbit works without this: every meeting already has **Add to Google Calendar**, **Add to Outlook** and
**Download .ics**, which open a prefilled event you save yourself. Connecting a calendar lets the app create,
update and cancel events for you (sending the invite to the other person), and shows your own events, muted, in the
Calendar tab so you can see when you're free.

Everything still runs in the browser: there's no server and no secret. You create a free **OAuth client ID**
(a public identifier, safe to publish) and paste it into `site/config.js`. Sign-in tokens stay in the browser tab
(memory and sessionStorage) and are forgotten when you click **Disconnect** or close the tab.

Authorized origins used below:

- `http://127.0.0.1:8000` and `http://localhost:8000` (running locally with `npm start`)
- `https://westons-hub.github.io` (the GitHub Pages site)

## Google Calendar

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a project (e.g. "Orbit").
2. **APIs & Services → Library →** search **Google Calendar API → Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding/Audience):
   - User type **External**; app name "Orbit"; your email as support and developer contact.
   - **Data access / Scopes → Add** `https://www.googleapis.com/auth/calendar.events`.
   - **Audience → Test users:** add your own Google account. (While the app is in "Testing", only test users can
     sign in, which is exactly right for a personal tool. Publishing for everyone requires Google's verification.)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Application type **Web application**.
   - **Authorized JavaScript origins:** the three origins above. (No redirect URIs are needed.)
   - Create, then copy the **Client ID** (`…apps.googleusercontent.com`).
5. In `site/config.js`, set `calendar.googleClientId` to that ID. Commit and push (it's public by design).
6. In the app: **Use my own data → Settings… → Connect Google Calendar.** Approve the popup.

What the app does with it: creates/edits/cancels events on your **primary** calendar with the person as a guest
(`sendUpdates=all`, so Google emails the invite), can auto-create a Google Meet link, and reads the next 60 days of
your events to show them muted.

## Outlook / Microsoft 365

1. Open the [Azure portal](https://portal.azure.com/) → **Microsoft Entra ID → App registrations → New registration.**
   - Name "Orbit".
   - **Supported account types:** "Accounts in any organizational directory and personal Microsoft accounts"
     (so both work/school and Outlook.com accounts can sign in).
   - **Redirect URI:** platform **Single-page application (SPA)**, URI `https://westons-hub.github.io/network-map/`.
2. After creating it, open **Authentication** and add the local SPA redirect URIs too:
   `http://127.0.0.1:8000/` and `http://localhost:8000/`. (No client secret, no implicit grant: MSAL uses the
   authorization code flow with PKCE.)
3. **API permissions → Add a permission → Microsoft Graph → Delegated → `Calendars.ReadWrite`** (and the default
   `User.Read`). Personal accounts consent themselves; a work tenant may need an admin to grant consent.
4. Copy the **Application (client) ID** from **Overview**.
5. In `site/config.js`, set `calendar.microsoftClientId` to it (leave `microsoftTenant: "common"`).
6. In the app: **Settings… → Connect Outlook.** Pick your account in the popup.

What the app does with it: creates/edits events in your default calendar with the person as an attendee (Outlook
sends the invite), can make it a Teams meeting, cancels with a cancellation notice, and reads your next 60 days of
events to show them muted.

## Privacy notes

- Only the meetings you create or change in Orbit are sent to your calendar provider.
- Reading your events is only to display them; they're never saved to your workbook.
- In the demo, the connect buttons say "Connect your own calendar" and don't sign in; the add-to-calendar links work.
- **Zoom:** auto-creating Zoom meetings needs Zoom's API with a secret key, which requires a server, so it isn't
  built. Put your personal Zoom link in Settings and it's added to every invite.
