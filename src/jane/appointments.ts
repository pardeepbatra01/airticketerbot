import type { JaneClient } from './client.js';
import { addMinutes, toJaneDateTime } from './datetime.js';
import {
  type AvailabilityInput,
  type CreateAppointmentInput,
  type CreatePatientInput,
  type CreatedAppointment,
  type Location,
  type Patient,
  type StaffMember,
  type StaffOpenings,
  type Treatment,
} from './types.js';

/**
 * High-level appointment + lookup operations.
 *
 * The admin endpoints below were captured from the live Jane admin UI (see
 * JANE_CAPTURE_RESULTS) — Jane has no public API for them. Conventions:
 *   - Reads of openings use the public `/api/v2/...` API (no auth).
 *   - Admin reads/writes use `/admin/api/v2/...` and `/admin/api/v3/...` and
 *     require an authenticated session (cookie) + CSRF token (handled by the
 *     client).
 *   - Datetimes are ISO-8601 WITH offset (see datetime.ts).
 *   - Booking is two-step: reserve (`POST .../appointments`, state "reserved")
 *     then book (`PUT .../appointments/:id/book`, state "booked").
 */
export class JaneAppointments {
  /** Client-generated tab id Jane includes on UI requests (telemetry). */
  private readonly browserTabId = `srv-${Math.random().toString(36).slice(2, 14)}`;

  constructor(private readonly client: JaneClient) {}

  /** List staff members (practitioners). Public — no login required. */
  async listStaffMembers(): Promise<StaffMember[]> {
    return unwrap<StaffMember>(
      await this.client.publicGet('/api/v2/staff_members'),
      'staff_members',
    );
  }

  /** List bookable treatments / services. Public — no login required. */
  async listTreatments(): Promise<Treatment[]> {
    return unwrap<Treatment>(
      await this.client.publicGet('/api/v2/treatments'),
      'treatments',
    );
  }

  /** List clinic locations. Public — no login required. */
  async listLocations(): Promise<Location[]> {
    return unwrap<Location>(
      await this.client.publicGet('/api/v2/locations'),
      'locations',
    );
  }

  /**
   * Get a practitioner's open slots for a treatment + location over a date
   * window. `location_id` is required by Jane (omitting it 404s).
   *
   * Returns one entry per practitioner; the bookable slots are in `.openings`.
   * (`.openings` is empty when the staff member has no shifts configured.)
   */
  async getAvailability(input: AvailabilityInput): Promise<StaffOpenings[]> {
    const data = await this.client.publicGet('/api/v2/openings', {
      treatment_id: input.treatmentId,
      staff_member_id: input.staffMemberId,
      location_id: input.locationId,
      start_date: input.startDate,
      end_date: input.endDate,
    });
    return Array.isArray(data) ? (data as StaffOpenings[]) : [];
  }

  /**
   * Search patients by name/email/phone — the admin "Add Client" typeahead.
   * Requires authentication. Returns the matching patient objects.
   */
  async searchPatients(query: string): Promise<Patient[]> {
    const data = await this.client.apiPost('/admin/api/v2/patient_lookup/lookup', {
      q: query,
      limit: 10,
      autocomplete: true,
      browser_tab_id: this.browserTabId,
    });
    return unwrap<Patient>(data, 'patients');
  }

  /**
   * Create a patient. Only first/last name are required; email/phone improve
   * matching. Jane returns the created patient (same shape as search results).
   */
  async createPatient(input: CreatePatientInput): Promise<Patient> {
    const created = await this.client.apiPost<Patient | { patient: Patient }>(
      '/admin/api/v2/patients',
      {
        patient: {
          first_name: input.firstName,
          last_name: input.lastName,
          ...(input.email ? { email: input.email } : {}),
          ...(input.mobilePhone ? { mobile_phone: input.mobilePhone } : {}),
          ...(input.homePhone ? { home_phone: input.homePhone } : {}),
        },
        browser_tab_id: this.browserTabId,
      },
    );
    return unwrapOne<Patient>(created, 'patient');
  }

  /**
   * Book an appointment. Mirrors the admin UI's two-step flow:
   *   1. Reserve  — POST /admin/api/v2/appointments  (state "reserved", no
   *      treatment/patient yet) → returns the appointment id + record.
   *   2. Book     — PUT  /admin/api/v3/appointments/:id/book  with the record
   *      plus treatment_id + patient_id (+ patient) → state "booked".
   * If the book step fails, we release the reserved slot so we don't leave an
   * orphaned hold on the schedule.
   */
  async createAppointment(input: CreateAppointmentInput): Promise<CreatedAppointment> {
    const startAt = toJaneDateTime(input.startAt, input.timeZone);
    const endAt = await this.resolveEndAt(input, startAt);

    // --- step 1: reserve -------------------------------------------------
    const reserved = await this.client.apiPost<
      CreatedAppointment | { appointment: CreatedAppointment }
    >('/admin/api/v2/appointments', {
      appointment: {
        location_id: input.locationId,
        start_at: startAt,
        end_at: endAt,
        staff_member_id: input.staffMemberId,
        break: false,
        room_id: null,
      },
      book: false,
      browser_tab_id: this.browserTabId,
    });
    const appt = unwrapOne<CreatedAppointment>(reserved, 'appointment');

    // --- step 2: book ----------------------------------------------------
    try {
      const booked = await this.client.apiPut<
        CreatedAppointment | { appointment: CreatedAppointment }
      >(`/admin/api/v3/appointments/${appt.id}/book`, {
        book: true,
        appointment: {
          ...appt,
          treatment_id: input.treatmentId,
          patient_id: input.patientId,
          ...(input.patient ? { patient: input.patient } : {}),
          staff_member_id: input.staffMemberId,
          location_id: input.locationId,
          start_at: startAt,
          end_at: endAt,
          ...(input.note ? { note: input.note } : {}),
        },
        browser_tab_id: this.browserTabId,
      });
      return unwrapOne<CreatedAppointment>(booked, 'appointment');
    } catch (err) {
      // Best-effort cleanup of the dangling "reserved" hold.
      await this.cancelAppointment(appt.id).catch(() => undefined);
      throw err;
    }
  }

  /** Cancel/delete an appointment (e.g. release a reserved hold). */
  async cancelAppointment(appointmentId: number): Promise<void> {
    await this.client.apiDelete(`/admin/api/v2/appointments/${appointmentId}`);
  }

  /** Compute `end_at`: explicit > start + duration > treatment's duration. */
  private async resolveEndAt(input: CreateAppointmentInput, startAt: string): Promise<string> {
    if (input.endAt != null) return toJaneDateTime(input.endAt, input.timeZone);
    if (input.durationMinutes != null) return addMinutes(startAt, input.durationMinutes);

    const treatment = (await this.listTreatments()).find((t) => t.id === input.treatmentId);
    const duration = treatment?.scheduled_duration;
    if (!duration) {
      throw new Error(
        `Cannot determine appointment length: pass durationMinutes or endAt, or ` +
          `ensure treatment ${input.treatmentId} has a scheduled_duration.`,
      );
    }
    return addMinutes(startAt, duration);
  }
}

/** Jane responds either as a bare array or `{ "<key>": [...] }`; handle both. */
function unwrap<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>)[key])) {
    return (data as Record<string, T[]>)[key];
  }
  if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>)['data'])) {
    return (data as Record<string, T[]>)['data'];
  }
  return [];
}

/** Unwrap a single object that Jane may nest under `{ "<key>": {...} }`. */
function unwrapOne<T>(data: unknown, key: string): T {
  if (data && typeof data === 'object' && key in (data as Record<string, unknown>)) {
    return (data as Record<string, T>)[key];
  }
  return data as T;
}
