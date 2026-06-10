import 'dotenv/config';
import http from 'node:http';
import { loadConfig } from './config.js';
import { JaneClient } from './jane/client.js';
import { JaneAppointments } from './jane/appointments.js';
import { JaneApiError, JaneAuthError, type CreateAppointmentInput } from './jane/types.js';

/**
 * HTTP server that exposes the Jane operations as JSON endpoints a voice agent
 * (e.g. Retell) can call as custom functions during a live call.
 *
 * Endpoints (all POST, JSON in/out, protected by a shared secret header):
 *   GET  /health                      -> { ok: true }
 *   POST /staff                       -> StaffMember[]
 *   POST /treatments                  -> Treatment[]
 *   POST /locations                   -> Location[]
 *   POST /availability     { ... }    -> StaffOpenings[]
 *   POST /patients/search  { query }  -> Patient[]
 *   POST /patients         { ... }    -> Patient (create)
 *   POST /appointments     { ... }    -> CreatedAppointment (reserve + book)
 *
 * Auth: every request except /health must send  x-api-key: <RETELL_WEBHOOK_SECRET>.
 * Configure RETELL_WEBHOOK_SECRET and PORT in .env.
 *
 * One shared, lazily-authenticated JaneClient is reused across requests so the
 * session cookie is established once, not per call.
 */

const PORT = Number(process.env.PORT ?? 8080);
const SECRET = (process.env.RETELL_WEBHOOK_SECRET ?? '').trim();

// Build the Jane client once; it logs in lazily on the first call and reuses
// the session afterwards.
const client = new JaneClient(loadConfig());
const jane = new JaneAppointments(client);

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function authorized(req: http.IncomingMessage): boolean {
  // If no secret is configured, refuse rather than run wide open.
  if (!SECRET) return false;
  const provided = req.headers['x-api-key'];
  return typeof provided === 'string' && provided === SECRET;
}

function requireNumber(body: Record<string, unknown>, key: string): number {
  const v = body[key];
  const n = typeof v === 'string' ? Number(v) : (v as number);
  if (typeof n !== 'number' || Number.isNaN(n)) {
    throw new HttpError(400, `Missing or invalid "${key}" (expected a number)`);
  }
  return n;
}

function requireString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new HttpError(400, `Missing or invalid "${key}" (expected a string)`);
  }
  return v;
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const server = http.createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const route = `${method} ${url.pathname}`;

  // Health check is open (no secret) so load balancers can probe it.
  if (route === 'GET /health') {
    return send(res, 200, { ok: true, authenticated: client.isAuthenticated() });
  }

  if (!authorized(req)) {
    return send(res, 401, {
      error: 'unauthorized',
      hint: SECRET
        ? 'Send the correct x-api-key header.'
        : 'Server has no RETELL_WEBHOOK_SECRET configured — set it in .env.',
    });
  }

  try {
    const body = method === 'POST' ? await readJson(req) : {};

    switch (route) {
      case 'POST /staff':
        return send(res, 200, await jane.listStaffMembers());
      case 'POST /treatments':
        return send(res, 200, await jane.listTreatments());
      case 'POST /locations':
        return send(res, 200, await jane.listLocations());
      case 'POST /availability': {
        return send(
          res,
          200,
          await jane.getAvailability({
            treatmentId: requireNumber(body, 'treatmentId'),
            staffMemberId: requireNumber(body, 'staffMemberId'),
            locationId: requireNumber(body, 'locationId'),
            startDate: requireString(body, 'startDate'),
            endDate: requireString(body, 'endDate'),
          }),
        );
      }
      case 'POST /patients/search': {
        const query = typeof body.query === 'string' ? body.query : '';
        return send(res, 200, await jane.searchPatients(query));
      }
      case 'POST /patients': {
        return send(
          res,
          200,
          await jane.createPatient({
            firstName: requireString(body, 'firstName'),
            lastName: requireString(body, 'lastName'),
            email: typeof body.email === 'string' ? body.email : undefined,
            mobilePhone: typeof body.mobilePhone === 'string' ? body.mobilePhone : undefined,
            homePhone: typeof body.homePhone === 'string' ? body.homePhone : undefined,
          }),
        );
      }
      case 'POST /appointments': {
        const input: CreateAppointmentInput = {
          staffMemberId: requireNumber(body, 'staffMemberId'),
          treatmentId: requireNumber(body, 'treatmentId'),
          patientId: requireNumber(body, 'patientId'),
          locationId: requireNumber(body, 'locationId'),
          startAt: String(body.startAt ?? ''),
          endAt: typeof body.endAt === 'string' ? body.endAt : undefined,
          durationMinutes:
            body.durationMinutes != null ? requireNumber(body, 'durationMinutes') : undefined,
          timeZone: typeof body.timeZone === 'string' ? body.timeZone : undefined,
          patient:
            body.patient && typeof body.patient === 'object'
              ? (body.patient as CreateAppointmentInput['patient'])
              : undefined,
          note: typeof body.note === 'string' ? body.note : undefined,
        };
        if (!input.startAt) throw new HttpError(400, 'Missing "startAt" (ISO-8601 datetime)');
        return send(res, 200, await jane.createAppointment(input));
      }
      default:
        return send(res, 404, { error: 'not_found', route });
    }
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    if (err instanceof JaneAuthError)
      return send(res, 502, { error: 'jane_auth_failed', message: err.message });
    if (err instanceof JaneApiError)
      return send(res, 502, { error: 'jane_api_error', message: err.message, status: err.status });
    return send(res, 500, { error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`Jane → Retell webhook server listening on :${PORT}`);
  console.log(SECRET ? 'Auth: x-api-key required.' : '⚠ RETELL_WEBHOOK_SECRET not set — all calls will be rejected.');
});
