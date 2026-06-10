# Jane Appointments (unofficial)

[Jane App](https://jane.app) integration for a **Retell voice agent**, deployable
on **Vercel** as a Next.js app.

- **Reads** (staff, treatments, locations, availability) use Jane's **public
  online-booking API** — no login, no credentials. Just set `JANE_BASE_URL`.
- **Booking** (and patient search/create) uses the internal session-authenticated
  admin API. Authenticate with a copied **`_jane_session` cookie** (preferred) or
  staff `username + password` (fallback). Booking is two-step: **reserve** then
  **book**, mirroring the admin UI.

> ⚠️ **Authorization & ToS.** Jane has no open self-serve API and the booking
> path is against Jane's Terms of Service. Only use it with **your own clinic's**
> account, with permission. It is not for accessing clinics you don't control.

## Deploy on Vercel (for Retell)

1. Push this repo to GitHub and import it at [vercel.com/new](https://vercel.com/new).
2. Set environment variables in the Vercel project:
   - `JANE_BASE_URL` — e.g. `https://yourclinic.janeapp.com` (required, reads).
   - `RETELL_WEBHOOK_SECRET` — a long random string (required for booking/patients).
   - `JANE_SESSION_COOKIE` — the `_jane_session` cookie from a logged-in admin
     browser (preferred auth for booking/patients). Or set `JANE_USERNAME` +
     `JANE_PASSWORD` as a fallback (won't work if the account has MFA).
   - `JANE_TIMEZONE` — clinic IANA zone, e.g. `America/Toronto` (only needed if
     you pass naive/UTC start times rather than offset-tagged ISO).
3. Deploy. Vercel functions have full internet, so they reach Jane directly.

### API endpoints

| Method & path             | Auth                  | Purpose                          |
| ------------------------- | --------------------- | -------------------------------- |
| `GET /api/health`         | none                  | liveness check                   |
| `GET /api/staff`          | none (public)         | practitioners + their IDs        |
| `GET /api/treatments`     | none (public)         | bookable treatments              |
| `GET /api/locations`      | none (public)         | clinic locations                 |
| `POST /api/availability`  | none (public)         | a practitioner's open slots      |
| `GET /api/patients?q=`    | `x-api-key` + session | search patients (typeahead)      |
| `POST /api/patients`      | `x-api-key` + session | create a patient                 |
| `POST /api/appointments`  | `x-api-key` + session | reserve + book an appointment    |

`POST /api/availability` body:
`{ treatmentId, staffMemberId, locationId, startDate, endDate }` (dates `YYYY-MM-DD`).

`POST /api/appointments` body:
`{ staffMemberId, treatmentId, patientId, locationId, startAt, durationMinutes?, endAt?, timeZone?, note?, patient? }`
(`locationId` is required; pass `durationMinutes` or `endAt`, else the treatment's
duration is used.)

`POST /api/patients` body: `{ firstName, lastName, email?, mobilePhone?, homePhone? }`.

> Note: with `JANE_SESSION_COOKIE` set, each cold start just injects the cookie
> and reads the CSRF token — no login round-trip. (If you rely on
> username/password instead, it logs in per cold start; for high volume cache the
> session in Vercel KV via `JaneClient.loadSession`/`saveSession`.)

---

## The raw HTTP session approach (CLI / self-hosted)

The same logic is available as a CLI and a standalone HTTP server, without Vercel.

---

## How it works

```
JANE_SESSION_COOKIE (preferred)         or   username + password (fallback)
        │                                          │
        ▼                                          ▼
  inject _jane_session cookie               GET /admin → authenticity_token
  GET /admin → read meta CSRF token         POST sign-in form → session cookie
        │
        ▼  (cookie jar now authenticated, CSRF token in hand)
  Reads (public, no auth):
    GET /api/v2/staff_members, /treatments, /locations
    GET /api/v2/openings?treatment_id&staff_member_id&location_id&start_date&end_date
  Writes (admin, authenticated):
    POST /admin/api/v2/patient_lookup/lookup        → find patient
    POST /admin/api/v2/patients                     → create patient
    POST /admin/api/v2/appointments  (book:false)   → reserve  (state "reserved")
    PUT  /admin/api/v3/appointments/:id/book        → book     (state "booked")
```

- **URL** = your clinic subdomain, e.g. `https://yourclinic.janeapp.com`.
- **Auth.** Preferred: paste the `_jane_session` cookie — no login form, no MFA.
  Fallback: a standard Rails login (read `authenticity_token`, post credentials).
  Either way the session cookie lives in a jar (optionally persisted to disk).
- **Datetimes** are ISO-8601 *with an offset* (e.g. `…-04:00`), never UTC `Z` or
  milliseconds — see `src/jane/datetime.ts`.
- Writes send the `X-CSRF-Token` header (read from the admin page's
  `<meta name="csrf-token">`) Jane requires.

## Caveats (read these)

- **2-Step Verification (MFA) breaks it.** If the staff account has MFA enabled,
  raw HTTP login cannot answer the challenge. Use a dedicated service account
  without MFA, or switch to a headless-browser approach (Playwright).
- **Undocumented endpoints.** The paths and payloads were **captured from the
  live admin UI** (see `JANE_CAPTURE_RESULTS.md`) — not guessed — but Jane can
  still change them, and they may differ slightly per clinic. Everything is
  isolated in `src/jane/appointments.ts` (endpoints), `src/jane/client.ts`
  (auth), and `src/jane/datetime.ts` (time formatting) so fixes live in one place.
- **Timezones.** Jane works in the clinic's local time and expects an **offset**.
  Pass `startAt` as a full ISO-8601 string with offset (e.g.
  `2026-06-15T14:00:00-04:00`), or set `JANE_TIMEZONE` and pass a naive/UTC time.

## Setup

```bash
npm install
cp .env.example .env      # then fill in URL + auth (cookie or credentials)
```

`.env`:

```
JANE_BASE_URL=https://yourclinic.janeapp.com
JANE_SESSION_COOKIE=...                 # preferred: _jane_session cookie value
# JANE_USERNAME=you@example.com         # fallback auth (no MFA)
# JANE_PASSWORD=your-password
JANE_TIMEZONE=America/Toronto           # clinic zone (for naive/UTC start times)
JANE_SESSION_FILE=.jane-session.json    # optional, caches the session
JANE_DEBUG=false                        # set true to dump responses to debug-*.html
```

## Usage

CLI (via `tsx`, no build needed):

```bash
npm run dev login-check                 # verify auth produces a session
npm run dev staff                       # list staff members + their IDs
npm run dev treatments                  # list treatments + their IDs
npm run dev locations                   # list locations + their IDs
npm run dev patients "smith"            # search patients
npm run dev create-patient --first Jo --last Doe --email jo@example.com

npm run dev availability \
  --treatment 34 --staff 12 --location 1 \
  --start "2026-06-15" --end "2026-06-19"

npm run dev create \
  --staff 12 --treatment 34 --patient 56 --location 1 \
  --start "2026-06-15T14:00:00-04:00" --duration 30 --note "Follow-up"
```

> `npm run dev <command>` is an alias for the CLI (`tsx src/cli.ts`).

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
  startAt: '2026-06-15T14:00:00-04:00',
  durationMinutes: 30,
  note: 'Follow-up',
});
console.log(appt.id, appt.state); // → 999 'booked'
```

Build for production:

```bash
npm run build && npm start login-check
```

## Capturing the real endpoint

The endpoints here were captured from a live clinic — see
**`JANE_CAPTURE_RESULTS.md`** for the exact requests/responses, and
`JANE_CAPTURE_HANDOFF.md` for the procedure. If Jane changes something or your
clinic differs, re-capture and adjust:

1. Log into `https://yourclinic.janeapp.com/admin` in Chrome.
2. Open **DevTools → Network**, filter to **Fetch/XHR**, check *Preserve log*.
3. Reproduce the action (open the slot picker; book an appointment; search a
   patient). Note each request's **URL + method**, **payload**, and **response**.
4. Update the one relevant place:
   - endpoints/payloads → `src/jane/appointments.ts`
   - auth (cookie/CSRF/login) → `src/jane/client.ts`
   - datetime formatting → `src/jane/datetime.ts`

Set `JANE_DEBUG=true` to dump server responses to `debug-*.html` when parsing
fails.

## Project layout

```
src/
  config.ts            env loading + URL normalization
  index.ts             library exports + createClient()
  cli.ts               command-line interface
  jane/
    client.ts          session client: cookie/login auth + CSRF + GET/POST/PUT/DELETE
    appointments.ts    lookups, availability, patients, reserve+book  (← endpoints)
    datetime.ts        ISO-8601-with-offset formatting Jane requires
    types.ts           data shapes + error classes
```

## A safer alternative

Jane now runs an official **Jane Developer Platform** (OAuth 2.0 PKCE) for
vetted partners — no scraping, stable, ToS-compliant. If this becomes
mission-critical, applying there (`developers.jane.app`) is the durable path.
