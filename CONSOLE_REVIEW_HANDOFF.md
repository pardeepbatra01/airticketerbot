# Jane Test Console — Browser Review Handoff

**For:** a browser-enabled Claude (Claude in Chrome) with access to the Vercel
preview deployment.
**Goal:** drive the test console end-to-end, confirm every endpoint works against
the live clinic, and report back the few data shapes we couldn't capture before.

---

## What this is

A console (the app's home page `/`) to manually exercise the Jane integration:
log in → staff → availability → patient → book. It takes the clinic URL + Jane
credentials **in the page** (no env vars). Auth is a form-login to Jane; the
session is kept in an httpOnly cookie, so it works on Vercel serverless.

## Setup

1. Open the **Vercel preview URL** for branch `claude/jain-app-integration-5fCrO`
   (commit `0caa3eb`). The console is at `/`.
   - If you hit a Vercel login wall, that's Deployment Protection — sign in to
     Vercel in the same browser, or it must be disabled on the project.
2. You'll see **"Jane Test Console"** with a login form.

## Walkthrough (do each, in order)

### 1 · Log in
The login has two tabs:
- **Session cookie (use this on Vercel).** In a tab where you're logged into
  Jane: DevTools → Application → Cookies → your clinic → copy the
  `_jane_session` value. Paste it + the clinic URL → **Log in**. This is the
  reliable path — Jane blocks server-side *password* login from new IPs (incl.
  Vercel) with an emailed device code.
- **Username + password.** Only works from a trusted IP; on Vercel it returns the
  MFA/new-device error.

Expect: the form is replaced by a green "✓ Connected to …" bar and the Staff
section. If it errors, copy the exact red message (that's Jane's own reason).

### 2 · Staff
- Click **Load staff, treatments & locations**.
- Confirm the list populates; try the **search box** (filters by name).
- Click a staff member who actually has shifts/availability → it highlights.

### 3 · Availability  ← most important capture
- Pick a **Treatment** and **Location** in the dropdowns, set a date range that
  should have openings, click **Get availability**.
- Expand **"Raw response"** and **copy the full JSON** — especially one entry's
  `openings[]` array. We need the per-slot object shape (which keys hold the
  start/end datetime).
- Note whether the green **"Open slots (N)"** buttons appeared (means we parsed
  the start time) or not (means the slot uses a different key — that's fine, the
  raw JSON tells us what to fix).

### 4 · Patient
- **Search** for a known patient by name/phone → confirm results, click to select
  (blue "Selected:" banner).
- Optionally expand **"+ Create a new patient"**, make a throwaway test patient,
  confirm it's created and auto-selected. **Delete it in Jane afterward.**

### 5 · Book appointment
- With a staff + patient selected, pick treatment + location, and a **Start**
  (click a slot button in step 3 to prefill, or paste an offset ISO like
  `2026-06-15T14:00:00-04:00`).
- Click **Book appointment**.
- Expect a green **"Appointment state: booked"** banner + the appointment JSON.
- **Verify it appears on the Jane schedule, then cancel/delete the test booking.**
- If it errors, copy the red message and the raw JSON.

---

## Report back (checklist)

- [ ] Login: worked? (if not, the exact error text)
- [ ] Staff: list + search OK?
- [ ] **Availability: the raw JSON, incl. one full `openings[]` entry** ← key
- [ ] Did the green slot buttons appear, or only raw JSON?
- [ ] Patient search: worked? sample result fields?
- [ ] Patient create (if tried): worked? (then deleted in Jane?)
- [ ] Booking: `state: "booked"`? appeared on the schedule? (then cancelled?)
- [ ] Any console/network errors (open DevTools → Console/Network if something
      fails) — the failing request URL + response.

With the availability `openings[]` shape, the slot parsing/types get finalized in
one place (`app/page.tsx` slot extractor + `src/jane/types.ts`).
