# Wiring this API to a Retell voice agent

Once the app is deployed on Vercel (call its base URL `BASE`, e.g.
`https://jane-app-integration.vercel.app`), add these **Custom Functions** to
your Retell agent so it can read clinic data and book during a call.

Replace `BASE` with your Vercel URL and `YOUR_SECRET` with the
`RETELL_WEBHOOK_SECRET` you set in Vercel.

## 1. get_staff (read, public)

```json
{
  "type": "custom",
  "name": "get_staff",
  "description": "List the clinic's practitioners with their IDs, disciplines, treatment IDs, and locations. Call this to find which practitioner the caller wants.",
  "url": "BASE/api/staff",
  "method": "GET",
  "speak_during_execution": true,
  "execution_message_description": "Let me pull up our practitioners."
}
```

## 2. get_treatments (read, public)

```json
{
  "type": "custom",
  "name": "get_treatments",
  "description": "List bookable treatments/services with their IDs and durations.",
  "url": "BASE/api/treatments",
  "method": "GET"
}
```

## 3. get_locations (read, public)

```json
{
  "type": "custom",
  "name": "get_locations",
  "description": "List clinic locations with their IDs.",
  "url": "BASE/api/locations",
  "method": "GET"
}
```

## 4. get_availability (read, public)

```json
{
  "type": "custom",
  "name": "get_availability",
  "description": "List a practitioner's open appointment slots for a treatment and location over a date range. Call this to offer the caller specific times.",
  "url": "BASE/api/availability",
  "method": "POST",
  "speak_during_execution": true,
  "execution_message_description": "Let me check what's available.",
  "parameters": {
    "type": "object",
    "properties": {
      "treatmentId":   { "type": "number", "description": "Treatment id from get_treatments" },
      "staffMemberId": { "type": "number", "description": "Practitioner id from get_staff" },
      "locationId":    { "type": "number", "description": "Location id from get_locations" },
      "startDate":     { "type": "string", "description": "Window start, YYYY-MM-DD" },
      "endDate":       { "type": "string", "description": "Window end, YYYY-MM-DD" }
    },
    "required": ["treatmentId", "staffMemberId", "locationId", "startDate", "endDate"]
  }
}
```

Returns one entry per practitioner; the bookable times are in `openings[]`. Use a
slot's start time as `startAt` when booking.

## 5. find_patient (read, secured)

```json
{
  "type": "custom",
  "name": "find_patient",
  "description": "Look up an existing patient by name, email, or phone. Returns matches with their patient id.",
  "url": "BASE/api/patients?q={query}",
  "method": "GET",
  "headers": { "x-api-key": "YOUR_SECRET" },
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Caller's name, email, or phone number" }
    },
    "required": ["query"]
  }
}
```

## 6. create_patient (write, secured)

```json
{
  "type": "custom",
  "name": "create_patient",
  "description": "Create a new patient when find_patient returns no match. Returns the new patient id.",
  "url": "BASE/api/patients",
  "method": "POST",
  "headers": { "x-api-key": "YOUR_SECRET" },
  "parameters": {
    "type": "object",
    "properties": {
      "firstName":   { "type": "string" },
      "lastName":    { "type": "string" },
      "email":       { "type": "string" },
      "mobilePhone": { "type": "string" }
    },
    "required": ["firstName", "lastName"]
  }
}
```

## 7. book_appointment (write, secured)

```json
{
  "type": "custom",
  "name": "book_appointment",
  "description": "Book an appointment once you have the practitioner, treatment, patient, location, and start time.",
  "url": "BASE/api/appointments",
  "method": "POST",
  "headers": { "x-api-key": "YOUR_SECRET" },
  "speak_during_execution": true,
  "execution_message_description": "Booking that for you now.",
  "parameters": {
    "type": "object",
    "properties": {
      "staffMemberId": { "type": "number", "description": "Practitioner id from get_staff" },
      "treatmentId":   { "type": "number", "description": "Treatment id from get_treatments" },
      "patientId":     { "type": "number", "description": "Patient id from find_patient/create_patient" },
      "locationId":    { "type": "number", "description": "Location id from get_locations (required)" },
      "startAt":       { "type": "string", "description": "ISO-8601 start time with offset, e.g. 2026-06-15T14:00:00-04:00 (use an availability slot)" },
      "durationMinutes": { "type": "number", "description": "Optional; defaults to the treatment duration" },
      "note":          { "type": "string", "description": "Optional note" }
    },
    "required": ["staffMemberId", "treatmentId", "patientId", "locationId", "startAt"]
  }
}
```

> Booking is two-step server-side (reserve → book); the agent only calls this
> once and gets back the booked appointment (`state: "booked"`).

## Suggested call flow (agent prompt guidance)

1. Caller asks to book → `get_staff` (and `get_treatments` / `get_locations` if
   needed) to map the names the caller says to IDs.
2. `get_availability` for that practitioner + treatment + location over the
   caller's preferred dates; offer specific open times.
3. Identify the patient: `find_patient` by name/phone; if no match,
   `create_patient`.
4. Confirm everything, then `book_appointment` with a chosen slot's start time.
5. Read back the confirmation from the response (`state: "booked"`).

## Deployment checklist

- **Vercel env vars.** Set `JANE_BASE_URL`, `RETELL_WEBHOOK_SECRET`, and
  `JANE_SESSION_COOKIE` (the `_jane_session` cookie from a logged-in admin
  browser — preferred over `JANE_USERNAME`/`JANE_PASSWORD`, and required if the
  staff account has MFA). Set `JANE_TIMEZONE` (e.g. `America/Toronto`) if the
  agent passes naive/UTC times rather than offset-tagged ISO.
- **Auth scope.** Reads (`get_staff`, `get_treatments`, `get_locations`,
  `get_availability`) are public — no secret, no session. Patient + booking
  functions need both the `x-api-key` secret and the Jane session.
- **Cookie rotation.** The `_jane_session` cookie expires eventually; if booking
  starts returning `jane_auth_failed`, refresh `JANE_SESSION_COOKIE` from the
  browser and redeploy.
