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

## 4. book_appointment (write, secured)

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
      "patientId":     { "type": "number", "description": "Existing patient id" },
      "locationId":    { "type": "number", "description": "Location id from get_locations" },
      "startAt":       { "type": "string", "description": "ISO-8601 start time with offset, e.g. 2026-06-15T14:00:00-04:00" },
      "durationMinutes": { "type": "number", "description": "Optional; defaults to the treatment duration" },
      "note":          { "type": "string", "description": "Optional note" }
    },
    "required": ["staffMemberId", "treatmentId", "patientId", "startAt"]
  }
}
```

## Suggested call flow (agent prompt guidance)

1. Caller asks to book → `get_staff` (and `get_treatments` if needed) to map
   names the caller says to IDs.
2. Confirm practitioner, service, location, and a specific date/time.
3. Identify the patient (see note below), then call `book_appointment`.
4. Read back the confirmation from the response.

## Open items before booking works end-to-end

- **Patient identification.** `book_appointment` needs a `patientId`. We still
  need a way to resolve the caller to an existing patient (by phone/name) or
  create one. This requires the authenticated patient-search/create endpoints —
  to be captured from the Jane admin Network tab and added to the API.
- **Booking auth on Vercel.** The write path logs into Jane per request; verify
  it works against the live clinic (needs `JANE_USERNAME`/`JANE_PASSWORD` set in
  Vercel and a non-MFA staff account). Reads need none of this.
