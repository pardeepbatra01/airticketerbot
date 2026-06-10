import { NextResponse } from 'next/server';
import { normalizeBaseUrl } from '../../../../src/config.js';
import { JaneClient } from '../../../../src/jane/client.js';
import { JaneAuthError } from '../../../../src/jane/types.js';
import { consoleError, writeAuthCookie } from '../_session.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST { baseUrl, username, password } — form-login to Jane, then store only the
// resulting _jane_session cookie. Credentials are not persisted anywhere.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const baseUrlRaw = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!baseUrlRaw || !username || !password) {
    return NextResponse.json(
      { error: 'bad_request', message: 'baseUrl, username and password are all required.' },
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
      sessionCookie: '',
      sessionFile: null,
      timeZone: (process.env.JANE_TIMEZONE ?? '').trim() || undefined,
      debug: false,
    });
    await client.login();
    const janeSession = await client.exportSessionCookie();
    if (!janeSession) {
      throw new JaneAuthError(
        'Logged in but could not read the session cookie. The clinic may set it ' +
          'under a different name — capture it from DevTools and use cookie auth.',
      );
    }
    const res = NextResponse.json({ authenticated: true, baseUrl });
    writeAuthCookie(res, { baseUrl, janeSession });
    return res;
  } catch (err) {
    return consoleError(err);
  }
}
