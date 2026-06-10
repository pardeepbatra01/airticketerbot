import { NextResponse } from 'next/server';
import { appointmentsFromSession, consoleError } from '../_session.js';
import type { CreateAppointmentInput } from '../../../../src/jane/types.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST — reserve + book an appointment for the logged-in session.
export async function POST(req: Request) {
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
      note: typeof body.note === 'string' ? body.note : undefined,
    };
    return NextResponse.json(await appointmentsFromSession().createAppointment(input));
  } catch (err) {
    if (err instanceof BadRequest) {
      return NextResponse.json({ error: 'bad_request', message: err.message }, { status: 400 });
    }
    return consoleError(err);
  }
}

class BadRequest extends Error {}
