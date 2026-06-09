# Jane Appointments (unofficial)

Create appointments in [Jane App](https://jane.app) (`jane.app`) by logging into
a clinic's own subdomain with **URL + username + password**, holding the session
cookie, and calling the same internal JSON endpoints the Jane admin UI uses.

This is the "raw HTTP session" approach — fast and dependency-light, but
**brittle and unofficial**. Read the caveats before relying on it.

> ⚠️ **Authorization & ToS.** Jane has no open self-serve API and this method is
> against Jane's Terms of Service. Only use it with **your own clinic's**
> account, with permission. It is not for accessing clinics you don't control.

---

## How it works

```
URL (clinic.janeapp.com)  +  username  +  password
        │
        ▼
  GET  /admin                → scrape authenticity_token (CSRF)
  POST /admin                → submit credentials, receive session cookie
        │
        ▼  (cookie jar now authenticated)
  GET  /api/v2/staff_members, /treatments, /locations, /patients   → look up IDs
  POST /api/v2/appointments  → create the appointment
```

- **URL** = your clinic subdomain, e.g. `https://yourclinic.janeapp.com`.
- The login is a standard Rails form: we read the `authenticity_token`, post the
  credentials, and keep the session cookie in a jar (optionally persisted to
  disk so you don't re-login every run).
- Writes send the `X-CSRF-Token` header Jane requires.

## Caveats (read these)

- **2-Step Verification (MFA) breaks it.** If the staff account has MFA enabled,
  raw HTTP login cannot answer the challenge. Use a dedicated service account
  without MFA, or switch to a headless-browser approach (Playwright).
- **Undocumented endpoints.** The `/api/v2/...` paths and the create payload are
  **best-effort** reconstructions of what the admin UI sends. Jane can change
  them at any time, and they may differ slightly for your clinic. When something
  fails, capture the real request (below) and adjust — everything is isolated in
  `src/jane/appointments.ts` and the login fields in `src/jane/client.ts`.
- **Timezones.** Jane works in the clinic's local time. Pass `--start` as a full
  ISO-8601 string **with an offset** (e.g. `2026-06-15T14:00:00-07:00`) to avoid
  ambiguity.

## Setup

```bash
npm install
cp .env.example .env      # then fill in URL + username + password
```

`.env`:

```
JANE_BASE_URL=https://yourclinic.janeapp.com
JANE_USERNAME=you@example.com
JANE_PASSWORD=your-password
JANE_SESSION_FILE=.jane-session.json   # optional, caches the session
JANE_DEBUG=false                       # set true to dump responses to debug-*.html
```

## Usage

CLI (via `tsx`, no build needed):

```bash
npm run dev login-check                 # verify credentials produce a session
npm run dev staff                       # list staff members + their IDs
npm run dev treatments                  # list treatments + their IDs
npm run dev locations                   # list locations + their IDs
npm run dev patients "smith"            # search patients

npm run dev create \
  --staff 12 --treatment 34 --patient 56 --location 1 \
  --start "2026-06-15T14:00:00-07:00" --duration 30 --note "Follow-up"
```

As a library:

```ts
import { createClient, JaneAppointments } from 'jane-appointments';

const client = createClient();          // reads .env
await client.ensureAuthenticated();

const jane = new JaneAppointments(client);
const appt = await jane.createAppointment({
  staffMemberId: 12,
  treatmentId: 34,
  patientId: 56,
  locationId: 1,
  startAt: '2026-06-15T14:00:00-07:00',
  durationMinutes: 30,
  note: 'Follow-up',
});
console.log(appt.id);
```

Build for production:

```bash
npm run build && npm start login-check
```

## Capturing the real endpoint

Because Jane's internal API is undocumented, the surest way to make `create`
work is to watch what the real UI does and copy it:

1. Log into `https://yourclinic.janeapp.com/admin` in Chrome.
2. Open **DevTools → Network**, filter to **Fetch/XHR**, check *Preserve log*.
3. Book one appointment manually on the schedule.
4. Find the `POST` request that creates it. Note its **URL path**, the
   **request payload** (JSON keys), and the **response shape**.
5. Update `src/jane/appointments.ts`:
   - `createAppointment()` → the `apiPost('/api/v2/appointments', ...)` path and
     the `payload` keys.
   - the `list*` methods → the lookup paths if they differ.
6. If **login** fails, do the same for the `POST /admin` request and fix the
   field names (`auth_key`, `password`, `authenticity_token`, `commit`) in
   `src/jane/client.ts → login()`.

Set `JANE_DEBUG=true` to dump server responses to `debug-*.html` when parsing
fails.

## Project layout

```
src/
  config.ts            env loading + URL normalization
  index.ts             library exports + createClient()
  cli.ts               command-line interface
  jane/
    client.ts          session client: CSRF + login + authenticated GET/POST
    appointments.ts    lookups + createAppointment  (← undocumented endpoints)
    types.ts           data shapes + error classes
```

## A safer alternative

Jane now runs an official **Jane Developer Platform** (OAuth 2.0 PKCE) for
vetted partners — no scraping, stable, ToS-compliant. If this becomes
mission-critical, applying there (`developers.jane.app`) is the durable path.
