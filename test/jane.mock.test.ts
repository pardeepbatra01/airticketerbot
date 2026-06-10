/**
 * End-to-end test against a LOCAL mock that imitates Jane's login + API flow.
 *
 * The environment's network policy blocks all outbound traffic, so we cannot
 * hit a real clinic from here. Instead we point the real JaneClient at a
 * localhost server that reproduces Jane's behaviour (CSRF page -> form POST ->
 * session cookie -> authenticated JSON endpoints) and assert the client drives
 * it correctly, including the MFA and bad-credentials failure paths.
 *
 * Run: npm test
 */
import http from 'node:http';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { JaneClient } from '../src/jane/client.js';
import { JaneAppointments } from '../src/jane/appointments.js';
import { JaneAuthError } from '../src/jane/types.js';
import { addMinutes, toJaneDateTime } from '../src/jane/datetime.js';

type Mode = 'happy' | 'mfa' | 'badcreds';

const GOOD_USER = 'clinic@example.com';
const GOOD_PASS = 's3cret';
const FORM_TOKEN = 'FORM-CSRF-TOKEN-123';
const META_TOKEN = 'META-CSRF-TOKEN-456';
const SESSION_COOKIE = '_jane_session=valid-session-abc';

// Deliberately uses a NON-/admin action and namespaced field names that don't
// match any hardcoded guess — proves the client parses the real form (action +
// field names + hidden fields) rather than assuming them.
function signInPage(): string {
  return `<!doctype html><html><body>
    <h1>Welcome back. Please sign in.</h1>
    <form id="new_session" action="/staff_member/sign_in" method="post">
      <input type="hidden" name="utf8" value="✓">
      <input type="hidden" name="authenticity_token" value="${FORM_TOKEN}">
      <label>Email, username or mobile phone</label>
      <input name="session[auth_key]" type="email">
      <label>Password</label>
      <input name="session[password]" type="password">
      <button type="submit" name="commit" value="Sign In">Sign In</button>
    </form>
  </body></html>`;
}

function authenticatedShell(): string {
  return `<!doctype html><html><head>
    <meta name="csrf-token" content="${META_TOKEN}">
    </head><body><div id="app">Schedule</div></body></html>`;
}

function mfaPage(): string {
  return `<!doctype html><html><body>
    <h1>2-Step Verification</h1>
    <p>Enter the verification code we sent you.</p>
    <input name="otp_code">
  </body></html>`;
}

function makeServer(mode: Mode): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const cookie = req.headers.cookie ?? '';
    const authed = cookie.includes('_jane_session=valid-session-abc');

    // --- sign-in page / dashboard ---
    if (url.pathname === '/admin' && req.method === 'GET') {
      if (authed) {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(authenticatedShell());
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(signInPage());
      }
      return;
    }

    // --- login POST (note: NOT /admin — the client must read the form action) ---
    if (url.pathname === '/staff_member/sign_in' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        const tokenOk = form.get('authenticity_token') === FORM_TOKEN;
        // The client must have carried the namespaced field names through.
        const credsOk =
          form.get('session[auth_key]') === GOOD_USER &&
          form.get('session[password]') === GOOD_PASS;

        if (mode === 'mfa' && tokenOk && credsOk) {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(mfaPage());
          return;
        }
        if (mode === 'badcreds' || !tokenOk || !credsOk) {
          // Re-render the sign-in form (Jane's failed-login behaviour).
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(signInPage());
          return;
        }
        // Happy path: set the session cookie and redirect to the dashboard.
        res.writeHead(302, { 'set-cookie': `${SESSION_COOKIE}; Path=/`, location: '/admin' });
        res.end();
      });
      return;
    }

    // --- PUBLIC read endpoints (no session required — Jane's online-booking API) ---
    if (url.pathname === '/api/v2/staff_members' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ id: 12, full_name: 'Dr. Ada Lovelace', location_ids: [1] }]));
      return;
    }

    if (url.pathname === '/api/v2/openings' && req.method === 'GET') {
      // location_id is required — Jane 404s without it.
      if (!url.searchParams.get('location_id')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify([
          {
            id: Number(url.searchParams.get('staff_member_id')),
            full_name: 'Dr. Ada Lovelace',
            first_date: '2026-06-15',
            openings: [{ start_at: '2026-06-15T14:00:00-04:00', duration: 30 }],
            shifts: [],
          },
        ]),
      );
      return;
    }

    // --- authenticated JSON endpoints (writes) ---
    if (!authed) {
      // Real Jane redirects unauthenticated admin/API calls to the sign-in HTML.
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(signInPage());
      return;
    }

    // Patient typeahead — POST lookup returns a bare array.
    if (url.pathname === '/admin/api/v2/patient_lookup/lookup' && req.method === 'POST') {
      assert.equal(req.headers['x-csrf-token'], META_TOKEN, 'lookup must send the meta CSRF token');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ id: 56, name: 'Jo Doe', email: 'jo@example.com' }]));
      return;
    }

    // Step 1: reserve — returns a "reserved" appointment with an id.
    if (url.pathname === '/admin/api/v2/appointments' && req.method === 'POST') {
      assert.equal(req.headers['x-csrf-token'], META_TOKEN, 'reserve must send the meta CSRF token');
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const payload = JSON.parse(body);
        assert.equal(payload.book, false, 'reserve must send book:false');
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            appointment: { id: 999, state: 'reserved', booked: false, ...payload.appointment },
          }),
        );
      });
      return;
    }

    // Step 2: book — PUT flips the reserved appointment to "booked".
    if (url.pathname === '/admin/api/v3/appointments/999/book' && req.method === 'PUT') {
      assert.equal(req.headers['x-csrf-token'], META_TOKEN, 'book must send the meta CSRF token');
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const payload = JSON.parse(body);
        assert.equal(payload.book, true, 'book must send book:true');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            appointment: { ...payload.appointment, state: 'booked', booked: true },
          }),
        );
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

async function withServer(mode: Mode, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = makeServer(mode);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function baseConfig(baseUrl: string, overrides: Record<string, unknown> = {}) {
  return {
    baseUrl,
    username: GOOD_USER,
    password: GOOD_PASS,
    sessionCookie: '',
    sessionFile: null,
    timeZone: undefined,
    debug: false,
    ...overrides,
  };
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('Jane client integration (local mock):');

  await test('datetime: offset-tagged passthrough, Z + naive conversion, addMinutes', async () => {
    // Offset-tagged strings are Jane-shaped already → untouched.
    assert.equal(toJaneDateTime('2026-06-15T14:00:00-04:00'), '2026-06-15T14:00:00-04:00');
    // UTC Z resolved into the clinic's zone (Toronto is -04:00 in June).
    assert.equal(toJaneDateTime('2026-06-15T18:00:00Z', 'America/Toronto'), '2026-06-15T14:00:00-04:00');
    // Naive wall-clock interpreted as clinic-local.
    assert.equal(toJaneDateTime('2026-06-15T14:00:00', 'America/Toronto'), '2026-06-15T14:00:00-04:00');
    // addMinutes preserves the offset.
    assert.equal(addMinutes('2026-06-15T14:00:00-04:00', 30), '2026-06-15T14:30:00-04:00');
    // No millis, no Z.
    assert.ok(!/\.\d{3}/.test(toJaneDateTime(new Date('2026-06-15T18:00:00Z'), 'America/Toronto')));
  });

  await test('logs in, extracts CSRF, holds session', async () => {
    await withServer('happy', async (baseUrl) => {
      const client = new JaneClient(baseConfig(baseUrl));
      await client.login();
      assert.equal(client.isAuthenticated(), true);
    });
  });

  await test('lists staff WITHOUT logging in (public booking API)', async () => {
    await withServer('happy', async (baseUrl) => {
      const client = new JaneClient(baseConfig(baseUrl));
      const staff = await new JaneAppointments(client).listStaffMembers();
      assert.equal(staff.length, 1);
      assert.equal(staff[0].id, 12);
      // The read must NOT have triggered a login.
      assert.equal(client.isAuthenticated(), false, 'reads must not require auth');
    });
  });

  await test('authenticates from a session cookie (no login form)', async () => {
    await withServer('badcreds', async (baseUrl) => {
      // badcreds mode would reject a form login — proving we used the cookie.
      const client = new JaneClient(baseConfig(baseUrl, { sessionCookie: 'valid-session-abc' }));
      await client.ensureAuthenticated();
      assert.equal(client.isAuthenticated(), true);
    });
  });

  await test('gets availability (openings) without auth, requires location', async () => {
    await withServer('happy', async (baseUrl) => {
      const client = new JaneClient(baseConfig(baseUrl));
      const slots = await new JaneAppointments(client).getAvailability({
        treatmentId: 34,
        staffMemberId: 12,
        locationId: 1,
        startDate: '2026-06-15',
        endDate: '2026-06-19',
      });
      assert.equal(slots.length, 1);
      assert.equal(slots[0].openings.length, 1);
      assert.equal(client.isAuthenticated(), false, 'openings must not require auth');
    });
  });

  await test('searches patients via the POST lookup endpoint', async () => {
    await withServer('happy', async (baseUrl) => {
      const client = new JaneClient(baseConfig(baseUrl));
      const patients = await new JaneAppointments(client).searchPatients('jo');
      assert.equal(patients.length, 1);
      assert.equal(patients[0].id, 56);
    });
  });

  await test('books an appointment via reserve + book (two-step), CSRF on both', async () => {
    await withServer('happy', async (baseUrl) => {
      const client = new JaneClient(baseConfig(baseUrl));
      const appt = await new JaneAppointments(client).createAppointment({
        staffMemberId: 12,
        treatmentId: 34,
        patientId: 56,
        locationId: 1,
        startAt: '2026-06-15T14:00:00-04:00',
        durationMinutes: 30,
        note: 'Follow-up',
      });
      assert.equal(appt.id, 999);
      assert.equal((appt as Record<string, unknown>).state, 'booked');
      assert.equal((appt as Record<string, unknown>).booked, true);
      assert.equal((appt as Record<string, unknown>).treatment_id, 34);
      assert.equal((appt as Record<string, unknown>).patient_id, 56);
      assert.equal((appt as Record<string, unknown>).staff_member_id, 12);
    });
  });

  await test('console flow: login → export session cookie → rebuild client → book', async () => {
    await withServer('happy', async (baseUrl) => {
      // 1. Form-login with credentials (what the console login route does).
      const loginClient = new JaneClient(baseConfig(baseUrl));
      await loginClient.login();
      const cookie = await loginClient.exportSessionCookie();
      assert.equal(cookie, 'valid-session-abc', 'must extract the _jane_session value');

      // 2. Rebuild a fresh client from ONLY that cookie (what every console
      //    request does via appointmentsFromSession) and drive an endpoint.
      const sessionClient = new JaneClient(
        baseConfig(baseUrl, { username: '', password: '', sessionCookie: cookie! }),
      );
      const appt = await new JaneAppointments(sessionClient).createAppointment({
        staffMemberId: 12,
        treatmentId: 34,
        patientId: 56,
        locationId: 1,
        startAt: '2026-06-15T14:00:00-04:00',
        durationMinutes: 30,
      });
      assert.equal(appt.id, 999);
      assert.equal((appt as Record<string, unknown>).state, 'booked');
    });
  });

  await test('rejects MFA-enabled accounts with a clear error', async () => {
    await withServer('mfa', async (baseUrl) => {
      const client = new JaneClient(baseConfig(baseUrl));
      await assert.rejects(
        () => client.login(),
        (e: unknown) => e instanceof JaneAuthError && /MFA|2-step/i.test((e as Error).message),
      );
    });
  });

  await test('fails cleanly on bad credentials', async () => {
    await withServer('badcreds', async (baseUrl) => {
      const client = new JaneClient(baseConfig(baseUrl));
      await assert.rejects(
        () => client.login(),
        (e: unknown) => e instanceof JaneAuthError,
      );
    });
  });

  console.log(`\n${passed}/10 passed`);
}

main();
