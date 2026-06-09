import 'dotenv/config';

export interface JaneConfig {
  /** Normalized base URL, e.g. https://yourclinic.janeapp.com (no trailing slash). */
  baseUrl: string;
  username: string;
  password: string;
  /** Path to persist the cookie jar, or null to keep session in memory only. */
  sessionFile: string | null;
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

export function loadConfig(): JaneConfig {
  const baseUrlRaw = process.env.JANE_BASE_URL;
  const username = process.env.JANE_USERNAME;
  const password = process.env.JANE_PASSWORD;

  const missing: string[] = [];
  if (!baseUrlRaw) missing.push('JANE_BASE_URL');
  if (!username) missing.push('JANE_USERNAME');
  if (!password) missing.push('JANE_PASSWORD');
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }

  const sessionFileRaw = (process.env.JANE_SESSION_FILE ?? '').trim();

  return {
    baseUrl: normalizeBaseUrl(baseUrlRaw!),
    username: username!,
    password: password!,
    sessionFile: sessionFileRaw.length > 0 ? sessionFileRaw : null,
    debug: (process.env.JANE_DEBUG ?? '').toLowerCase() === 'true',
  };
}
