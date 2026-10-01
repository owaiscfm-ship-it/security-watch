# SecureWatch
**Security Operations & Patrol Management**

> **Server version (2.0)** — SecureWatch now uses a Supabase server (London). Logins, the rota and all records sync between devices. Set-up: run `01-setup.sql` then `02-atl-data-PRIVATE.sql` in Supabase → SQL Editor, paste the publishable key into `config.js`. Manage logins in Settings → Logins. The notes below about local-only storage apply only if no server is configured.
>
> **Important limitation (no-server mode)**
>
> This GitHub Pages version is a functional prototype. It stores operational data locally on the device. True multi-user synchronization, secure authentication, centralised database storage, push notifications, client accounts and real-time management require a backend.

In practice this means: a guard's phone and the manager's laptop each have **their own separate copy** of the data. The manager dashboard only shows what was recorded in the same browser, or what has been imported from a guard's data file (see "Moving data between devices"). Nothing here pretends otherwise — every record in the dashboard is labelled **Device** (recorded by a real browser) or **Demo** (sample data).

---

## 1. What's in the box

```
securewatch/
├── index.html            App entry point (single page)
├── style.css             All styles (guard mobile UI, dashboard, reports, print)
├── app.js                Boot, router, login, offline sync banner, backup import/export, printing
├── manifest.json         PWA manifest (installable "SecureWatch")
├── service-worker.js     Offline app shell cache
├── .nojekyll             Tells GitHub Pages to serve files as-is
├── js/
│   ├── utils.js          Escaping, dates, GPS, hashing, CSV, toasts, dialogs
│   ├── db.js             IndexedDB data layer, media blobs, audit log, offline queue
│   ├── core.js           Auth, shift/patrol/scan/incident/welfare/SOS logic, demo data
│   ├── guard.js          Guard mobile app
│   └── manager.js        Management dashboard, client portal, reports, CSV exports
├── lib/
│   ├── qrcode.js         QR code generator (Kazuhiko Arase, MIT)
│   └── jsQR.js           QR code reader (cozmo/jsQR, Apache-2.0)
├── fonts/                Barlow + Barlow Condensed (SIL Open Font Licence)
└── icons/                App icons (placeholders — replace with your own artwork)
```

No build step, no npm, no server. All libraries and fonts are stored locally so the guard app keeps working with no signal.

---

## 2. Deploy to GitHub Pages

1. **Create a repository**
   Sign in at github.com → **New repository** → name it e.g. `securewatch` → choose **Public** (GitHub Pages on private repos needs a paid plan) → **Create repository**.
2. **Upload the files**
   On the new repository page click **uploading an existing file**. Drag in **everything inside** the `securewatch` folder (including the `js`, `lib`, `fonts` and `icons` folders and the `.nojekyll` file) so that `index.html` sits at the top level of the repository, not inside a sub-folder. Click **Commit changes**.
   *Tip: hidden files like `.nojekyll` may not show in your file browser. The app still works without it.*
3. **Enable GitHub Pages**
   Repository → **Settings** → **Pages** → under *Build and deployment* set **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`** → **Save**.
4. **Open the application**
   After 1–2 minutes the Pages screen shows your address, normally `https://YOUR-USERNAME.github.io/securewatch/`. Open it. GitHub Pages uses HTTPS, which the browser requires for GPS, camera and offline support.
5. **Install on a phone as an app (PWA)**
   - **Android (Chrome):** open the address → menu **⋮** → **Install app** (or **Add to Home screen**) → **Install**.
   - **iPhone (Safari):** open the address in **Safari** → **Share** button → **Add to Home Screen** → **Add**. (On iPhone this must be done in Safari.)
   Open SecureWatch from the home-screen icon once while online so it can cache itself for offline use. Allow **Location** and **Camera** when asked.

**Updating later:** upload the changed files, then open `service-worker.js` and change the `CACHE` version to a new value (e.g. `v1.0.1`). Phones pick up the update the next time the app is opened online and closed/reopened.

---

## 3. Logins

There are no demo logins. Every user signs in with their own username and password, which are listed in `config.js` as secure hashes (PBKDF2-SHA256, 150,000 rounds) — the same on every device.

To add a login, reset a password or remove someone: sign in as a manager → **Settings → Logins**, then **Settings → Publish setup → Download config.js**, and upload that file to GitHub, replacing the old one.

Note: the login protects the app screens. Files on a public GitHub Pages site (including `config.js`) can still be downloaded by anyone who knows the address. Do not put anything in the setup that must stay secret.

## 4. Changing the site, rota or checkpoints

Edit on the manager laptop (Sites, Guards, Shifts, Patrols, Checkpoints), then **Settings → Publish setup → Download config.js** and upload it to GitHub. Every phone picks it up the next time SecureWatch is opened online. Shift progress, patrols, scans and incidents already recorded are never overwritten.

## 5. Features and how they behave in a static site

| Area | What works | Honest limitation |
|---|---|---|
| GPS clock in/out | Real Geolocation API: time, lat/long, accuracy, distance from site, browser/OS | If permission is denied or the fix fails the guard is told *"GPS verification could not be completed"*; nothing is faked |
| QR checkpoints | Phone camera scanning (native BarcodeDetector where available, jsQR otherwise), manual ID entry fallback, wrong-site/duplicate/wrong-route detection, GPS distance check per checkpoint | Camera needs HTTPS and permission |
| Patrols | Progress, elapsed time excluding pauses, pause reasons, auto-complete, incomplete with mandatory explanation | — |
| Incidents | Type, severity, description, GPS, photos, video, voice notes (MediaRecorder), witness, police/emergency flags, `INC-YYYY-NNNN` IDs, manager status workflow | Media is stored on the device that recorded it (IndexedDB) |
| SOS | Confirmation, saved with GPS, *Call 999* button, alert banner on the dashboard | **No SMS, call or notification is sent.** The dashboard only sees it on the same device or after import |
| Welfare checks | Configurable interval and grace period, full-screen prompt with vibration, *I'm safe* with GPS, automatic *Missed* records | Prompts only appear while the app is open; no push notifications without a backend |
| Site instructions | Versioned; guards must acknowledge and re-acknowledge after changes | — |
| Dashboard / live status | KPIs, alerts, live status, shift timeline | Not live tracking — GPS is captured only when the guard does something |
| Reports | Professional print-friendly daily report; **Export PDF** uses the browser's *Save as PDF* | No server-side PDF generation |
| CSV | Patrol history, checkpoint scans, incidents, attendance, welfare, audit log (with spreadsheet-formula protection) | — |
| Guards | SIA licence number validation (16 digits), expiry status 🟢/🟠/🔴 calculated from today, "checked on SIA register" flag, expired licences cannot be rostered | The app cannot verify a licence — check the [SIA register](https://services.sia.homeoffice.gov.uk/rolh) |
| Offline | Service worker caches the whole app; IndexedDB stores all records. Start shift, scan, incidents and welfare all work with no signal. On reconnect: *Syncing data… → All data synced* | Without a backend, "synced" means committed on that device — the banner says so |
| Client portal | Read-only status, patrols, incidents, daily report, missed checkpoints, welfare | Simulated role, not secure client accounts |
| Audit log | Every significant action with time, user, site and related record | Stored locally, so it is not tamper-proof |

### Moving data between devices (without a backend)
Guard phone: **More → Send my data to a manager** (uses the phone's share sheet, or downloads a `.json` file). Manager laptop: **Settings → Import data file**. Records are merged by ID, including photos/video/audio up to about 80 MB per export. This is a stop-gap, not synchronisation.

---

## 6. Time zone
All dates and times are shown and entered in UK time (Europe/London), whatever time zone the viewing device uses.

## 7. Data architecture

All records live in IndexedDB database `securewatch`, one object store per collection, keyed by `id`:

`users, guards, sites, patrolRoutes, checkpoints, shifts, patrols, checkpointScans, incidents, welfareChecks, siteInstructions, instructionAcks, attendance, sosEvents, auditLogs, settings, syncQueue` + `media` (Blobs).

Key shapes (simplified):

```js
checkpoint     { id:'CP-001', siteId, routeId, order, name, description, lat, lng, qr:'SECUREWATCH:S-001:CP-001:TOKEN', required }
shift          { id, guardId, siteId, date, start, end, startAt, endAt, patrolFreq, welfareFreq, status, actualStart, actualEnd }
patrol         { id:'PATROL-0001', shiftId, routeId, siteId, guardId, startAt, endAt, status, pauses:[{start,end,reason}], missed:[], explanation }
checkpointScan { id, patrolId, checkpointId, guardId, siteId, at, gps:{ok,lat,lng,accuracy}, distance, locationStatus, status, method, source }
incident       { id:'INC-2026-0001', at, siteId, guardId, type, severity, description, gps, media:[{id,kind,name}], witness, police, emergency, status, statusHistory }
welfareCheck   { id, shiftId, guardId, dueAt, at, status:'Confirmed'|'Missed', gps }
auditLog       { id, at, user, role, action, siteId, subject, related }
```

Every operational record carries `source: 'device' | 'demo'`.

---

## 8. Connecting a backend later (Supabase, Firebase or your own API)

The code is already split so a backend can be added without rewriting the UI:

1. **Database.** Create one table/collection per store above (same field names). In Supabase use Postgres tables with **Row Level Security**: guards can insert their own scans/incidents and read their own site; managers read/write their organisation; clients read only their site(s).
2. **Authentication.** Replace `SW.auth.login/logout/restore` in `js/core.js` with Supabase Auth or Firebase Auth. Remove the demo users. Roles come from the user's profile/claims, never from the browser.
3. **Sync.** Replace `SW.syncAdapter` in `js/db.js` with a real adapter. It receives queued items (`{store, recordId}`) and must return the IDs it uploaded:
   ```js
   SW.syncAdapter = {
     name: 'Supabase', remote: true,
     async push(items) {
       const done = [];
       for (const q of items) {
         const rec = SW.db.get(q.store, q.recordId);
         const { error } = await supabase.from(q.store).upsert(rec);
         if (!error) done.push(q.id);
       }
       return done;
     },
   };
   ```
   Also change `db.queue()` to queue **every** operational write (not just offline ones), and upload media Blobs to Supabase Storage / Firebase Storage, storing the file path in `incident.media`.
4. **Manager dashboard.** Load records from the backend on open, and subscribe to changes (Supabase Realtime or Firestore listeners) for genuine live status.
5. **Notifications.** SOS and missed welfare alerts need a server function (e.g. Supabase Edge Function, Firebase Cloud Function) that sends SMS/calls/push via a provider such as Twilio or Web Push. Missed welfare detection must also run on the server so it works when the guard's phone is off.
6. **PDF.** Optionally generate PDFs server-side; the print report already works well as a fallback.

---

## 9. Security and privacy

- All user-entered text is HTML-escaped before display (XSS protection) and a Content-Security-Policy blocks external scripts.
- Input is validated (SIA number format, dates, coordinates, phone/email, lengths). CSV exports neutralise spreadsheet formulas.
- Passwords are never stored in plain text (salted SHA-256), and the full SIA licence number is masked in tables.
- Location is captured only at the moment of an action — there is no background tracking.
- A privacy notice is available on the sign-in screen, in the guard app (More) and in Settings.
- **This prototype does not make you GDPR / UK GDPR compliant.** Before production use you need: proper backend authentication and access control, encrypted central storage, a Data Protection Impact Assessment (location data and CCTV-adjacent evidence are sensitive), a full privacy notice for officers, retention and deletion rules, and device management for company phones.

---

## 10. Tested

Automated browser tests (Chromium, mobile 390×844 and desktop 1440×900) covered: all navigation pages, guard/manager/client login, start and end shift with GPS granted and with GPS blocked, patrol start, simulated, manual and invalid checkpoint scans, pause/resume, incomplete patrol with explanation, full 6/6 patrol completion, incident with photo, welfare confirmation and automatic missed-check detection, SOS, site instruction acknowledgement, guard/site/route/checkpoint/shift creation and validation, incident status change, daily report print and PDF output, all six CSV exports, QR code print sheet (generated codes were decoded back successfully), demo reset, going offline → reloading → recording → back online with the sync banner, and mobile layout with no horizontal scrolling. No JavaScript errors were reported.

Not testable in an automated browser, so please check on a real phone: the live camera scanning a printed QR code, real GPS accuracy indoors, voice-note recording and video capture, and installing to the home screen on Android and iPhone.

---

## 11. Credits
- QR generation: `qrcode-generator` by Kazuhiko Arase — MIT
- QR reading: `jsQR` by Cosmo Wolfe — Apache 2.0
- Fonts: Barlow and Barlow Condensed by Jeremy Tribby — SIL Open Font Licence 1.1
- "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
