import { NextResponse } from 'next/server';
import { authedAppointments, checkSecret, errorResponse } from '../_jane.js';
import type { CreateAppointmentInput } from '../../../src/jane/types.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Booking write — requires the Retell shared secret AND staff credentials.
export async function POST(req: Request) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const num = (key: string): number => {
    const v = body[key];
    const n = typeof v === 'string' ? Number(v) : (v as number);
    if (typeof n !== 'number' || Number.isNaN(n)) {
      throw new BadRequest(`Missing or invalid "${key}" (expected a number)`);
    }
    return n;
  };

  try {
    if (!body.startAt) throw new BadRequest('Missing "startAt" (ISO-8601 datetime)');
    const input: CreateAppointmentInput = {
      staffMemberId: num('staffMemberId'),
      treatmentId: num('treatmentId'),
      patientId: num('patientId'),
      locationId: num('locationId'),
      startAt: String(body.startAt),
      endAt: typeof body.endAt === 'string' ? body.endAt : undefined,
      durationMinutes: body.durationMinutes != null ? num('durationMinutes') : undefined,
      timeZone: typeof body.timeZone === 'string' ? body.timeZone : undefined,
      patient:
        body.patient && typeof body.patient === 'object'
          ? (body.patient as CreateAppointmentInput['patient'])
          : undefined,
      note: typeof body.note === 'string' ? body.note : undefined,
    };
    const created = await authedAppointments().createAppointment(input);
    return NextResponse.json(created);
  } catch (err) {
    if (err instanceof BadRequest) {
      return NextResponse.json({ error: 'bad_request', message: err.message }, { status: 400 });
    }
    return errorResponse(err);
  }
}

class BadRequest extends Error {}
