import { NextResponse } from 'next/server';
import { publicAppointments, errorResponse } from '../_jane.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public read — no credentials, no secret required.
export async function GET() {
  try {
    return NextResponse.json(await publicAppointments().listLocations());
  } catch (err) {
    return errorResponse(err);
  }
}
