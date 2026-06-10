import { NextResponse } from 'next/server';
import { readSession } from '../_session.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lets the UI restore login state on reload without exposing the session token.
export async function GET() {
  const session = readSession();
  return NextResponse.json({
    authenticated: Boolean(session),
    baseUrl: session?.baseUrl ?? null,
  });
}
