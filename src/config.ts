import 'dotenv/config';

export interface JaneConfig {
  /** Normalized base URL, e.g. https://yourclinic.janeapp.com (no trailing slash). */
  baseUrl: string;
  username: string;
  password: string;
  /**
   * The `_jane_session` cookie value, copied from a logged-in admin browser.
   * When set, the client authenticates as that session (skipping the login
   * form + MFA) — this is the preferred, reliable auth path. Empty = unused.
   */
  sessionCookie: string;
  /** Path to persist the cookie jar, or null to keep session in memory only. */
  sessionFile: string | null;
  /**
   * IANA timezone of the clinic (e.g. "America/Toronto"), used to format
   * appointment times Jane expects with an offset. Optional — only needed when
   * start times are passed as naive/UTC values rather than offset-tagged ISO.
   */
  timeZone: string | undefined;
  debug: boolean;
}

/** Normalize a user-supplied clinic URL into https://host with no trailing slash. */
export function normalizeBaseUrl(raw: string): string {
  let value = raw.trim();
  if (!value) {
    throw new Error('JANE_BASE_URL is empty. Set it to e.g. https://yourclinic.janeapp.com');
  }
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  // Drop any path/trailing slash — we only want scheme + host.
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

/**
 * Config for PUBLIC reads only (staff/treatments/locations). Requires just
 * JANE_BASE_URL — no credentials, since those endpoints need no login.
 */
export function loadPublicConfig(): JaneConfig {
  const baseUrlRaw = process.env.JANE_BASE_URL;
  if (!baseUrlRaw) {
    throw new Error('Missing required environment variable: JANE_BASE_URL');
  }
  const sessionFileRaw = (process.env.JANE_SESSION_FILE ?? '').trim();
  return {
    baseUrl: normalizeBaseUrl(baseUrlRaw),
    username: process.env.JANE_USERNAME ?? '',
    password: process.env.JANE_PASSWORD ?? '',
    sessionCookie: (process.env.JANE_SESSION_COOKIE ?? '').trim(),
    sessionFile: sessionFileRaw.length > 0 ? sessionFileRaw : null,
    timeZone: (process.env.JANE_TIMEZONE ?? '').trim() || undefined,
    debug: (process.env.JANE_DEBUG ?? '').toLowerCase() === 'true',
  };
}

export function loadConfig(): JaneConfig {
  const baseUrlRaw = process.env.JANE_BASE_URL;
  const username = process.env.JANE_USERNAME;
  const password = process.env.JANE_PASSWORD;
  const sessionCookie = (process.env.JANE_SESSION_COOKIE ?? '').trim();

  // Writes need authentication. The preferred path is a copied session cookie;
  // username/password (form login) is the fallback. Require one of the two.
  const missing: string[] = [];
  if (!baseUrlRaw) missing.push('JANE_BASE_URL');
  const hasCredentials = Boolean(username && password);
  if (!sessionCookie && !hasCredentials) {
    missing.push('JANE_SESSION_COOKIE (or JANE_USERNAME + JANE_PASSWORD)');
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }

  const sessionFileRaw = (process.env.JANE_SESSION_FILE ?? '').trim();

  return {
    baseUrl: normalizeBaseUrl(baseUrlRaw!),
    username: username ?? '',
    password: password ?? '',
    sessionCookie,
    sessionFile: sessionFileRaw.length > 0 ? sessionFileRaw : null,
    timeZone: (process.env.JANE_TIMEZONE ?? '').trim() || undefined,
    debug: (process.env.JANE_DEBUG ?? '').toLowerCase() === 'true',
  };
}
