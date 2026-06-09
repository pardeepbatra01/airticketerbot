import { NextResponse } from 'next/server';
import { publicAppointments, errorResponse } from '../_jane.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public read — no credentials, no secret required.
export async function GET() {
  try {
    const staff = await publicAppointments().listStaffMembers();
    // Trim to the fields a voice agent actually needs.
    const slim = staff.map((s) => ({
      id: s.id,
      name: s.full_name ?? s.professional_name,
      disciplines: (s.disciplines ?? []).map((d) => ({ id: d.id, name: d.name })),
      treatmentIds: s.all_treatment_ids ?? [],
      locationIds: s.location_ids ?? [],
      bookable: s.allow_online_booking ?? false,
    }));
    return NextResponse.json(slim);
  } catch (err) {
    return errorResponse(err);
  }
}
