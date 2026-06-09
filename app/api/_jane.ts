import { NextResponse } from 'next/server';
import { loadConfig, loadPublicConfig } from '../../src/config.js';
import { JaneClient } from '../../src/jane/client.js';
import { JaneAppointments } from '../../src/jane/appointments.js';
import { JaneApiError, JaneAuthError } from '../../src/jane/types.js';

/** Appointments wrapper for PUBLIC reads (no credentials needed). */
export function publicAppointments(): JaneAppointments {
  return new JaneAppointments(new JaneClient(loadPublicConfig()));
}

/** Appointments wrapper for authenticated writes (needs credentials). */
export function authedAppointments(): JaneAppointments {
  return new JaneAppointments(new JaneClient(loadConfig()));
}

/** Verify the Retell shared-secret header. */
export function checkSecret(req: Request): boolean {
  const secret = (process.env.RETELL_WEBHOOK_SECRET ?? '').trim();
  if (!secret) return false;
  return req.headers.get('x-api-key') === secret;
}

/** Turn any thrown error into a sensible JSON response. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof JaneAuthError) {
    return NextResponse.json({ error: 'jane_auth_failed', message: err.message }, { status: 502 });
  }
  if (err instanceof JaneApiError) {
    return NextResponse.json(
      { error: 'jane_api_error', message: err.message, status: err.status },
      { status: 502 },
    );
  }
  if (err instanceof Error && err.message.startsWith('Missing required')) {
    return NextResponse.json({ error: 'config_error', message: err.message }, { status: 500 });
  }
  return NextResponse.json(
    { error: 'internal', message: err instanceof Error ? err.message : String(err) },
    { status: 500 },
  );
}
