import { NextResponse } from 'next/server';
import { authedAppointments, checkSecret, errorResponse } from '../_jane.js';
import type { CreatePatientInput } from '../../../src/jane/types.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Patient search + create. Both touch authenticated admin data (PII), so both
// require the Retell shared secret AND a Jane session.

// GET /api/patients?q=<text> — search the client list (typeahead).
export async function GET(req: Request) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const q = new URL(req.url).searchParams.get('q') ?? '';
  if (!q.trim()) {
    return NextResponse.json({ error: 'bad_request', message: 'Missing "q"' }, { status: 400 });
  }
  try {
    const patients = await authedAppointments().searchPatients(q);
    // Trim to the fields a voice agent actually needs.
    const slim = patients.map((p) => ({
      id: p.id,
      name: p.name ?? p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
      email: p.email,
      mobilePhone: p.mobile_phone,
      homePhone: p.home_phone,
    }));
    return NextResponse.json(slim);
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/patients — create a new client. Requires firstName + lastName.
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

  const str = (key: string, required: boolean): string | undefined => {
    const v = body[key];
    if (v == null || v === '') {
      if (required) throw new BadRequest(`Missing "${key}"`);
      return undefined;
    }
    if (typeof v !== 'string') throw new BadRequest(`"${key}" must be a string`);
    return v;
  };

  try {
    const input: CreatePatientInput = {
      firstName: str('firstName', true)!,
      lastName: str('lastName', true)!,
      email: str('email', false),
      mobilePhone: str('mobilePhone', false),
      homePhone: str('homePhone', false),
    };
    const created = await authedAppointments().createPatient(input);
    return NextResponse.json({ id: created.id, name: created.name ?? created.full_name });
  } catch (err) {
    if (err instanceof BadRequest) {
      return NextResponse.json({ error: 'bad_request', message: err.message }, { status: 400 });
    }
    return errorResponse(err);
  }
}

class BadRequest extends Error {}
