# Jane Endpoint Capture — Results

**Clinic:** `https://kaylarp.janeapp.com` (Kalm Wellness Therapy Inc.)
**Captured:** 2026-06-09, live, via authenticated admin session (logged in as "LeadsMagnet AI", staff_member_id 27).
**All test data created during capture was deleted afterward** (2 test appointments + 1 test patient).

> Note: this is an empty test clinic — **0 patients and 0 shifts** existed. That's why availability returns empty slot arrays and why a test patient had to be created to exercise the booking flow.

---

## Auth / conventions

- **Base host:** `https://kaylarp.janeapp.com`
- **APIs:** admin endpoints live under `/admin/api/v2/...` and `/admin/api/v3/...`. The public openings endpoint is under `/api/v2/...`.
- **Session:** browser cookie **`_jane_session`** (→ store as `JANE_SESSION_COOKIE`). Copy it yourself from DevTools → Application → Cookies → `kaylarp.janeapp.com`. (Not included here — it's password-equivalent.)
- **CSRF:** write requests (POST/PUT/DELETE) send header **`X-CSRF-Token`**, value read from `<meta name="csrf-token">` on the admin page. With a raw session cookie + server-side request you typically also need to fetch a page first to get a CSRF token, or Jane may accept the request without it for API v2/v3 JSON — verify.
- **`browser_tab_id`:** a client-generated random string included in many requests (e.g. `"0p6wij15sdagudd1pbgstk"`). Appears optional/telemetry — generate any stable string per session.
- **Datetime format (everywhere):** ISO-8601 **with timezone offset**, e.g. `2026-06-09T21:09:08-04:00` — **not** UTC `Z`, **not** milliseconds. Plain dates use `YYYY-MM-DD`.

---

## 1. Availability / openings  ✅ endpoint confirmed (slots empty — no shifts in this clinic)

```
GET /api/v2/openings
  ?treatment_id=<id>
  &staff_member_id=<id>
  &location_id=<id>
  &start_date=YYYY-MM-DD
  &end_date=YYYY-MM-DD
→ 200
```
- `location_id` **is required** (omitting it → 404). Wrong paths (`/admin/api/v2/openings`, `/api/v2/availability`) → 404.
- **Response envelope** — array, one object per practitioner:
```json
[ { "id": 23, "full_name": "Tara Fiodorowicz", "first_date": "2026-06-10", "openings": [], "shifts": [] } ]
```
- `openings` is the bookable-slots array (empty here because the clinic has no shifts configured). `first_date` is the earliest date Jane computed. **The per-slot object shape could not be captured** (no availability exists). Confirm it once a shift exists — it lives inside `openings[]`.
- Treatments are **staff-scoped** (`GET /admin/api/v2/treatments` → each has `staff_member_id`, `book_online`, `online_only`, `scheduled_duration`).

---

## 2. Patient search  ✅ (this is what the admin "Add Client" box actually calls)

```
POST /admin/api/v2/patient_lookup/lookup
Content-Type: application/json
Body: {"q":"<text>","limit":10,"autocomplete":true,"browser_tab_id":"..."}
→ 200, returns an array of patient objects
```
(There is also `GET /admin/api/v2/patients?query=` → 200, but in practice it returned empty; the **POST lookup** above is the real typeahead.)

**Patient object fields** (from a real lookup result):
```
id, name, first_name, last_name, all_names, preferred_first_name, preferred_name,
email, dob, mobile_phone, home_phone, work_phone, primary_phone, member_since,
public_id, staff_member_id, country, email_notify_ok, deceased, discharged,
medical_alert, test_patient, patient_count, updated_at, "staff_member?"
```

---

## 3. Patient create  ✅ endpoint confirmed; create-form field names captured

```
POST /admin/api/v2/patients → 201
```
(The exact request body wasn't intercepted, but the New Client form fields are:)
- **Required:** `first_name`, `last_name`
- Also: `preferred_name`, `pronouns`, `prefix`, `middle_name`, `email`,
  `home_phone` + country code, `mobile_phone` + country code,
  street address, suite, city, birth date (month/day/year), sex,
  personal health number, family doctor, parent/guardian, occupation, employer,
  referring professional (+phone/email), emergency contact, email-notification prefs.

Returns the created patient (same shape as §2). The created `patient_id` is then used in booking.

---

## 4. Create appointment (provisional / step 1)  ✅ full request + response captured

Created by Jane the instant you open "New Appointment" on a slot:
```
POST /admin/api/v2/appointments → 201
Body:
{
  "appointment": {
    "location_id": 1,
    "start_at": "2026-06-09T21:35:03-04:00",
    "end_at":   "2026-06-09T21:50:03-04:00",
    "staff_member_id": 27,
    "break": false,
    "room_id": null
  },
  "book": false,
  "browser_tab_id": "..."
}
```
**Response** = the appointment object, key fields:
```
state: "reserved",  booked: false,  booked_at: null,
treatment_id: null, patient_id: null,
staff_member_id, location_id, location_name, start_at, end_at, duration,
booker_id (=current staff), booker_type: "StaffMember", capacity: 1, room_id
```
> The provisional carries **only** staff + location + time. `treatment_id` and `patient_id` are **not** sent at create — they go in the book call (§5). Canceling the panel issues `DELETE /admin/api/v2/appointments/:id → 204`.

---

## 5. Confirm / finalise (step 2)  ✅ full request + response captured — there IS a distinct step

Before booking, Jane checks resources:
```
GET /admin/api/v2/resource_pools?appointment_id=<id>&treatment_id=<id>&start_at=<iso>&end_at=<iso> → 200
```
Then **"Book Appointment"** fires (note: **API v3**, method **PUT**):
```
PUT /admin/api/v3/appointments/<id>/book → 200
Body:
{
  "book": true,
  "appointment": { ...the full appointment object... },
  "browser_tab_id": "..."
}
```
The nested `appointment` object is the whole record with the now-selected values set:
```
treatment_id: 117, patient_id: 1298, patient: { ...full patient object... },
staff_member_id: 27, location_id: 1, start_at, end_at, duration,
booking_type, state: "reserved", booked: false   ← still reserved IN the body;
                                                    top-level "book": true flips it
```
**Minimum the book needs set on the appointment:** `treatment_id`, `patient_id` (+ `patient`), `staff_member_id`, `location_id`, `start_at`, `end_at`.

**Response / after:** `GET /admin/api/v3/appointments/<id>?booking_type=one_on_one_booking → 200`. The appointment becomes:
```
state: "booked",  booked: true,  booked_at: "2026-06-09T21:32:44-04:00",
booking_type: "one_on_one_booking", treatment_id, patient_id, patient_name, duration
```

### Server flow to replicate (ClinicSync Pro `createAppt` → `bookAppt`)
1. `POST /admin/api/v2/appointments` with `{appointment:{location_id, staff_member_id, start_at, end_at, break:false, room_id:null}, book:false}` → get `id`, state `reserved`.
2. `PUT /admin/api/v3/appointments/<id>/book` with `{book:true, appointment:{<that object> + treatment_id + patient_id (+patient)}}` → state `booked`.

---

## 6. Auth cookie
Copy `_jane_session` from DevTools → Application → Cookies → `kaylarp.janeapp.com` and store as `JANE_SESSION_COOKIE`. (Deliberately not captured here.)

---

## IDs seen in this clinic (for reference)
- location_id `1` = "Kalm Wellness Therapy"
- staff_member_id `27` = "LeadsMagnet AI"; `1` exists too (the "Kayla" referenced in the brief — but the brief's "staff id 1 = Kayla Schofield" doesn't match this clinic's roster, so don't hardcode it)
- treatment `117` = "Test Psychotherapy Session" (staff 27, 30 min); treatment `103` = "Follow-Up Psychotherapy Session (Virtual)" (staff 23)

## Gaps to confirm later
- **Per-slot object shape + its datetime keys** inside `openings[]` — needs a shift to exist.
- **Exact `POST /admin/api/v2/patients` request body** — only the form field names were captured.
- Whether `browser_tab_id` / `X-CSRF-Token` are strictly required for server-to-server calls.
