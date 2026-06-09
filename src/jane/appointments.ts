import type { JaneClient } from './client.js';
import {
  type CreateAppointmentInput,
  type CreatedAppointment,
  type Location,
  type Patient,
  type StaffMember,
  type Treatment,
} from './types.js';

/**
 * High-level appointment + lookup operations.
 *
 * ── IMPORTANT: endpoints below are the part Jane does not document. ──
 * The paths and the create payload mirror what the Jane admin UI sends, but
 * Jane can change them and they may differ slightly per clinic. They are all
 * collected in this one file so you can correct them in a single place after
 * capturing the real request from your clinic's DevTools Network tab.
 * See README → "Capturing the real endpoint".
 */
export class JaneAppointments {
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

  /** Search patients by name/email. Requires authentication (not public). */
  async searchPatients(query: string): Promise<Patient[]> {
    return unwrap<Patient>(
      await this.client.apiGet('/api/v2/patients', { query }),
      'patients',
    );
  }

  /**
   * Create an appointment.
   *
   * The payload shape follows Jane's internal schedule "book" call. If creation
   * returns an error, capture the real request (README) and adjust the keys
   * here — they live in exactly one place on purpose.
   */
  async createAppointment(input: CreateAppointmentInput): Promise<CreatedAppointment> {
    const startAt = toIso(input.startAt);

    const payload = {
      appointment: {
        staff_member_id: input.staffMemberId,
        treatment_id: input.treatmentId,
        patient_id: input.patientId,
        location_id: input.locationId,
        start_at: startAt,
        ...(input.durationMinutes != null
          ? { duration: input.durationMinutes, end_at: addMinutesIso(startAt, input.durationMinutes) }
          : {}),
        ...(input.note ? { note: input.note } : {}),
      },
    };

    const created = await this.client.apiPost<CreatedAppointment | { appointment: CreatedAppointment }>(
      '/api/v2/appointments',
      payload,
    );

    // Jane sometimes wraps the record under an "appointment" key.
    if (created && typeof created === 'object' && 'appointment' in created) {
      return (created as { appointment: CreatedAppointment }).appointment;
    }
    return created as CreatedAppointment;
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

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  // Pass strings through, but validate they parse.
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid startAt value: ${value}`);
  }
  return value;
}

function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
