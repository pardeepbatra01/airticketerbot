import { NextResponse } from 'next/server';
import { publicAppointments, errorResponse } from '../_jane.js';
import type { AvailabilityInput } from '../../../src/jane/types.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Availability read — Jane's openings API is public, so no secret is required.
// Supports POST (JSON body, for Retell custom functions) and GET (query params,
// for quick manual testing). Required: treatmentId, staffMemberId, locationId,
// startDate, endDate (dates as YYYY-MM-DD).

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  return run((key) => body[key]);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  return run((key) => searchParams.get(key) ?? undefined);
}

async function run(get: (key: string) => unknown): Promise<NextResponse> {
  const num = (key: string): number => {
    const v = get(key);
    const n = typeof v === 'string' ? Number(v) : (v as number);
    if (typeof n !== 'number' || Number.isNaN(n)) {
      throw new BadRequest(`Missing or invalid "${key}" (expected a number)`);
    }
    return n;
  };
  const str = (key: string): string => {
    const v = get(key);
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
    const availability = await publicAppointments().getAvailability(input);
    return NextResponse.json(availability);
  } catch (err) {
    if (err instanceof BadRequest) {
      return NextResponse.json({ error: 'bad_request', message: err.message }, { status: 400 });
    }
    return errorResponse(err);
  }
}

class BadRequest extends Error {}
