import { NextResponse } from 'next/server';
import { appointmentsFromSession, consoleError } from '../_session.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await appointmentsFromSession().listStaffMembers());
  } catch (err) {
    return consoleError(err);
  }
}
