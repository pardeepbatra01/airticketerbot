import { NextResponse } from 'next/server';
import { appointmentsFromSession, consoleError } from '../_session.js';
import type { AvailabilityInput } from '../../../../src/jane/types.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST { treatmentId, staffMemberId, locationId, startDate, endDate }
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
  const str = (key: string): string => {
    const v = body[key];
    if (typeof v !== 'string' || !v) throw new BadRequest(`Missing "${key}"`);
    return v;
  };

  try {
    const input: AvailabilityInput = {
      treatmentId: num('treatmentId'),
      staffMemberId: num('staffMemberId'),
      locationId: num('locationId'),
      startDate: str('startDate'),
      endDate: str('endDate'),
    };
    return NextResponse.json(await appointmentsFromSession().getAvailability(input));
  } catch (err) {
    if (err instanceof BadRequest) {
      return NextResponse.json({ error: 'bad_request', message: err.message }, { status: 400 });
    }
    return consoleError(err);
  }
}

class BadRequest extends Error {}
