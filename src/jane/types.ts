/**
 * Types describing the data needed to create an appointment in Jane.
 *
 * Jane's internal API is undocumented, so these field names mirror what the
 * Jane admin UI sends when you book on the schedule. They are isolated here and
 * in `appointments.ts` so you can adjust them after inspecting your own clinic's
 * Network tab (see README "Capturing the real endpoint").
 */

/** A bookable discipline (service category), as embedded in a staff member. */
export interface Discipline {
  id: number;
  name?: string;
  professional_title?: string;
  book_online?: boolean;
  normalized_type?: string;
  [key: string]: unknown;
}

/**
 * A staff member (practitioner). Field names mirror the real
 * /api/v2/staff_members payload from a live clinic (the public online-booking
 * API — returned without authentication).
 */
export interface StaffMember {
  id: number;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  professional_name?: string;
  suffix?: string | null;
  prefix?: string | null;
  allow_online_booking?: boolean;
  /** Disciplines this practitioner offers (embedded in the staff record). */
  disciplines?: Discipline[];
  /** Treatment IDs this practitioner can be booked for. */
  all_treatment_ids?: number[];
  /** Preferred display order of treatments. */
  treatment_order?: number[];
  /** Location IDs this practitioner works at. */
  location_ids?: number[];
  [key: string]: unknown;
}

/** A bookable treatment / service. */
export interface Treatment {
  id: number;
  name?: string;
  /** Duration in minutes. */
  scheduled_duration?: number;
  discipline_id?: number;
  [key: string]: unknown;
}

/** A patient / client record. */
export interface Patient {
  id: number;
  name?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  mobile_phone?: string;
  home_phone?: string;
  [key: string]: unknown;
}

/** A clinic location. */
export interface Location {
  id: number;
  name?: string;
  [key: string]: unknown;
}

/**
 * One bookable opening (a free slot) returned inside a practitioner's
 * `openings[]`. Exact keys depend on the clinic's config — we keep it open and
 * expose whatever Jane sends (typically a start/end datetime).
 */
export interface Opening {
  [key: string]: unknown;
}

/**
 * Availability for one practitioner, as returned by `GET /api/v2/openings`
 * (one object per staff member in the response array).
 */
export interface StaffOpenings {
  id: number;
  full_name?: string;
  /** Earliest date Jane found, `YYYY-MM-DD`. */
  first_date?: string;
  /** Bookable slots in the requested window. Empty if the staff has no shifts. */
  openings: Opening[];
  shifts?: unknown[];
  [key: string]: unknown;
}

/** Query parameters for an availability/openings lookup. */
export interface AvailabilityInput {
  treatmentId: number;
  staffMemberId: number;
  /** Required by Jane — omitting it returns 404. */
  locationId: number;
  /** Inclusive date window, `YYYY-MM-DD`. */
  startDate: string;
  endDate: string;
}

/** Fields for creating a new patient. Only first/last name are required. */
export interface CreatePatientInput {
  firstName: string;
  lastName: string;
  email?: string;
  mobilePhone?: string;
  homePhone?: string;
}

/**
 * The minimum information needed to create an appointment. IDs come from the
 * lookup endpoints (staff members, treatments, patients, locations).
 */
export interface CreateAppointmentInput {
  staffMemberId: number;
  treatmentId: number;
  patientId: number;
  /** Required by Jane's reserve step. */
  locationId: number;
  /**
   * Appointment start. Accepts a Date or an ISO-8601 string. An offset-tagged
   * string (e.g. `2026-06-15T14:00:00-04:00`) is passed through as-is; naive or
   * UTC values are resolved using `timeZone` / `JANE_TIMEZONE`.
   */
  startAt: Date | string;
  /** Explicit end. If omitted, derived from `startAt` + `durationMinutes`. */
  endAt?: Date | string;
  /**
   * Duration in minutes. Used to derive `end_at` when `endAt` is absent. If
   * neither is given we look up the treatment's `scheduled_duration`.
   */
  durationMinutes?: number;
  /** IANA timezone override for resolving naive/UTC start times. */
  timeZone?: string;
  /**
   * The full patient object (from search/create). Jane's book step embeds it
   * alongside `patient_id`; if omitted we send just the id.
   */
  patient?: Patient;
  /** Optional note attached to the appointment. */
  note?: string;
}

/** Result of a create call. Shape depends on Jane's response. */
export interface CreatedAppointment {
  id: number;
  [key: string]: unknown;
}

/** Raised when login does not produce an authenticated session. */
export class JaneAuthError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'JaneAuthError';
  }
}

/** Raised when an authenticated API call fails. */
export class JaneApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'JaneApiError';
  }
}
