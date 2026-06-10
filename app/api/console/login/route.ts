import { NextResponse } from 'next/server';
import { normalizeBaseUrl } from '../../../../src/config.js';
import { JaneClient } from '../../../../src/jane/client.js';
import { JaneAuthError } from '../../../../src/jane/types.js';
import { consoleError, writeAuthCookie } from '../_session.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST one of:
 *   { baseUrl, username, password }   — form-login to Jane (only works from a
 *                                       trusted IP; new IPs get an MFA/device
 *                                       challenge that raw HTTP can't answer).
 *   { baseUrl, sessionCookie }        — use a `_front_desk_session` cookie copied
 *                                       from a logged-in admin browser. Skips the
 *                                       login form and any device challenge — the
 *                                       reliable path on Vercel.
 * Either way we end up storing only the `_front_desk_session` value in our
 * httpOnly cookie; credentials are never persisted.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const baseUrlRaw = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const sessionCookie = typeof body.sessionCookie === 'string' ? body.sessionCookie.trim() : '';
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!baseUrlRaw) {
    return NextResponse.json(
      { error: 'bad_request', message: 'baseUrl is required.' },
      { status: 400 },
    );
  }
  if (!sessionCookie && !(username && password)) {
    return NextResponse.json(
      {
        error: 'bad_request',
        message: 'Provide either a sessionCookie, or both username and password.',
      },
      { status: 400 },
    );
  }

  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(baseUrlRaw);
  } catch (err) {
    return NextResponse.json(
      { error: 'bad_request', message: err instanceof Error ? err.message : 'Invalid baseUrl' },
      { status: 400 },
    );
  }

  try {
    const client = new JaneClient({
      baseUrl,
      username,
      password,
      sessionCookie,
      sessionFile: null,
      timeZone: (process.env.JANE_TIMEZONE ?? '').trim() || undefined,
      debug: false,
    });

    let janeSession: string | null;
    if (sessionCookie) {
      // Cookie path: verify it's a live session (cookie-only — no form-login
      // fallback, so the error stays accurate).
      const ok = await client.authenticateWithCookie();
      if (!ok) {
        throw new JaneAuthError(
          'That _front_desk_session cookie was rejected — it may be expired or ' +
            'for a different clinic. Re-copy it from a logged-in admin browser ' +
            '(DevTools → Application → Cookies → _front_desk_session) and try again.',
        );
      }
      janeSession = sessionCookie;
    } else {
      // Credential path: form-login, then read the resulting session cookie.
      await client.login();
      janeSession = await client.exportSessionCookie();
      if (!janeSession) {
        throw new JaneAuthError(
          'Logged in but could not read the session cookie. Use the session-cookie ' +
            'login instead (copy _front_desk_session from a logged-in browser).',
        );
      }
    }

    const res = NextResponse.json({ authenticated: true, baseUrl });
    writeAuthCookie(res, { baseUrl, janeSession });
    return res;
  } catch (err) {
    return consoleError(err);
  }
}
