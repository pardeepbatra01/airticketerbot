# Jane Endpoint Capture — Handoff

**Purpose.** Jane has no public API, so we need the *real* internal requests the
Jane admin UI makes. This document tells an inspector (a browser-enabled Claude
Code, or you with Chrome DevTools) exactly what to do and what to send back, so we
can implement these endpoints **exactly** instead of guessing.

We need captures for the two operations in scope now:
- **Get staff availability** (open slots for a practitioner)
- **Confirm appointment** = the booking flow (which ClinicSync Pro shows is
  two-step: create a *provisional* appointment → *confirm/finalise* it), including
  the **patient lookup/create** that must happen first.

---

## Setup (do once)

1. Log into Jane admin in Chrome: `https://<your-clinic>.janeapp.com/admin`.
2. Open **DevTools** (⌥⌘I / Ctrl+Shift+I) → **Network** tab.
3. Filter to **Fetch/XHR**. Check **Preserve log**.
4. Perform each action below. For the matching request:
   - **Copy → Copy as cURL** (then **delete the `Cookie:` line / any token** before sharing).
   - Copy the **Response** JSON (Response or Preview tab).

For every captured request, send back: **method**, **full URL incl. query string**,
**request payload (all keys)**, and **response JSON**.

---

## Captures needed

### 1. Availability (open slots for a practitioner)
**Do:** Start a *New Appointment* for a known practitioner — e.g. **Kayla Schofield
(staff id `1`)** — choose a treatment, then open the date/time slot picker and flip
to the next week so it loads times.

**Find:** the XHR(s) that return bookable times. Likely a path containing
`openings`, `availability`, or `available`, with date/datetime query params.

**Capture + call out:**
- The exact path and **all query params**.
- The **datetime format** used (UTC? milliseconds, e.g. `2026-04-18T13:59:59.999Z`?
  `start_at`/`end_at`? a single `date`?).
- Whether `treatment_id` and/or `location_id` are required.
- A sample of the response (one or two slot objects).

### 2. Patient search (lookup)
**Do:** In the New Appointment dialog, type a patient's name into the patient
search box.

**Find:** XHR like `/api/v2/patients?query=...` (or `/search`).

**Capture:** the request URL + query, and **one** patient object from the response
showing the `id` and name/email/phone fields.

### 3. Patient create *(optional — only if safe)*
**Do:** If you have a throwaway/test patient, create one and capture the `POST`
(URL + payload + response). Otherwise **skip** and just note the create-form field
names (first/last name, phone, email, etc.).

### 4. Create the appointment (provisional / step 1)
**Do:** Complete the New Appointment flow so it actually lands on the schedule.
*(You can delete the test appointment afterward.)*

**Find:** the `POST` that creates it (likely `/api/v2/appointments`).

**Capture:**
- URL + method.
- **Full request payload** — every key (e.g. `staff_member_id`, `treatment_id`,
  `patient_id`, `location_id`, `start_at`, `end_at`, `duration`, and any
  `state`/`status`).
- The **response** (the created appointment), noting any `state`/`status` field
  (e.g. *pending* vs *booked/arrived*).

### 5. Confirm / finalise *(step 2 — only if it exists)*
ClinicSync Pro splits booking into `createAppt` → `bookAppt`. In your Jane:
- If the appointment is **already booked** right after step 4 (single step), just
  **say so** — there's no separate confirm.
- If there's a distinct confirm/book action (or a `PATCH`/`PUT` that flips the
  status), capture that request too: URL + payload + response.

### 6. Auth — session cookie *(send privately)*
DevTools → **Application → Cookies → `<your-clinic>.janeapp.com`** → copy the
**`_jane_session`** value. We'll store it as the Vercel env var
`JANE_SESSION_COOKIE` so the server authenticates as your existing session
(skips the login form / MFA). **Treat it like a password.**

---

## What to send back (checklist)

- [ ] 1. Availability: path + query params + datetime format + sample slots
- [ ] 2. Patient search: URL + sample patient object
- [ ] 3. (optional) Patient create: URL + payload + response
- [ ] 4. Create appointment: URL + full payload + response (+ status field)
- [ ] 5. Confirm step: exists? if yes, URL + payload + response
- [ ] 6. `_jane_session` cookie value (privately)

With those, each endpoint is a one-place edit in `src/jane/appointments.ts`
(reads/writes) + `src/jane/client.ts` (auth), then we deploy and verify on Vercel.
