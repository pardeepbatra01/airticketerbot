import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { JaneClient } from '../../../src/jane/client.js';
import { JaneAppointments } from '../../../src/jane/appointments.js';
import { JaneApiError, JaneAuthError } from '../../../src/jane/types.js';

/**
 * Auth for the interactive test console (app/page.tsx).
 *
 * Unlike the Retell production routes, the console takes the clinic URL +
 * credentials from the UI — never from env. After a successful form login we
 * keep only the resulting Jane `_jane_session` cookie (the credentials are
 * discarded) and stash it, with the baseUrl, in an httpOnly browser cookie.
 * Every console request rebuilds a JaneClient from that via the cheap
 * cookie-auth path. No server-side session store; works locally and on Vercel.
 *
 * Note: this is a test tool. The cookie carries a live Jane session token;
 * httpOnly keeps page JS from reading it (same posture as Jane's own cookie).
 */

const COOKIE = 'console_auth';

export interface ConsoleSession {
  baseUrl: string;
  janeSession: string;
}

/** Thrown when a console request arrives without a valid session cookie. */
export class NotLoggedIn extends Error {
  constructor() {
    super('Not logged in. Use the login form first.');
    this.name = 'NotLoggedIn';
  }
}

/** Write the session into the response as an httpOnly cookie. */
export function writeAuthCookie(res: NextResponse, session: ConsoleSession): void {
  const value = Buffer.from(JSON.stringify(session), 'utf8').toString('base64');
  res.cookies.set(COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12, // 12h — matches a typical Jane session lifetime
  });
}

/** Clear the session cookie on the response. */
export function clearAuthCookie(res: NextResponse): void {
  res.cookies.set(COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

/** Read + decode the current session from the request cookies, or null. */
export function readSession(): ConsoleSession | null {
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as ConsoleSession;
    if (parsed && parsed.baseUrl && parsed.janeSession) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Build a JaneAppointments bound to the logged-in session. Throws if absent. */
export function appointmentsFromSession(): JaneAppointments {
  const session = readSession();
  if (!session) throw new NotLoggedIn();
  const client = new JaneClient({
    baseUrl: session.baseUrl,
    username: '',
    password: '',
    sessionCookie: session.janeSession,
    sessionFile: null,
    timeZone: (process.env.JANE_TIMEZONE ?? '').trim() || undefined,
    debug: false,
  });
  return new JaneAppointments(client);
}

/** Turn a thrown error into a JSON response (console flavour — no secret). */
export function consoleError(err: unknown): NextResponse {
  if (err instanceof NotLoggedIn) {
    return NextResponse.json({ error: 'not_logged_in', message: err.message }, { status: 401 });
  }
  if (err instanceof JaneAuthError) {
    return NextResponse.json({ error: 'jane_auth_failed', message: err.message }, { status: 401 });
  }
  if (err instanceof JaneApiError) {
    return NextResponse.json(
      { error: 'jane_api_error', message: err.message, status: err.status },
      { status: 502 },
    );
  }
  return NextResponse.json(
    { error: 'internal', message: err instanceof Error ? err.message : String(err) },
    { status: 500 },
  );
}
