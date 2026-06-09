import { readFile, writeFile } from 'node:fs/promises';
import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import type { JaneConfig } from '../config.js';
import { JaneApiError, JaneAuthError } from './types.js';

/**
 * Low-level session client for a Jane clinic subdomain.
 *
 * Responsibilities:
 *   - hold a cookie jar (the session)
 *   - perform the form-based sign in (CSRF token -> POST credentials)
 *   - expose CSRF-protected GET/POST helpers that the higher-level modules use
 *
 * It deliberately knows nothing about appointments — see `appointments.ts`.
 */
export class JaneClient {
  readonly http: AxiosInstance;
  private readonly jar: CookieJar;
  private csrfToken: string | null = null;
  private authenticated = false;

  constructor(private readonly config: JaneConfig) {
    this.jar = new CookieJar();
    this.http = wrapper(
      axios.create({
        baseURL: config.baseUrl,
        jar: this.jar,
        withCredentials: true,
        // We handle non-2xx ourselves so we can read error bodies and follow
        // login redirects manually.
        maxRedirects: 5,
        timeout: 30_000,
        headers: {
          // Look like a normal browser; Jane's WAF is picky about bare clients.
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        validateStatus: () => true,
      }),
    );
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  // --- session persistence ------------------------------------------------

  /** Load a previously saved cookie jar so we can skip re-login. */
  async loadSession(): Promise<boolean> {
    if (!this.config.sessionFile) return false;
    try {
      const raw = await readFile(this.config.sessionFile, 'utf8');
      const data = JSON.parse(raw) as { cookies?: unknown; csrfToken?: string | null };
      if (data.cookies) {
        const restored = await CookieJar.deserialize(data.cookies as never);
        // Copy cookies into our jar (deserialize returns a fresh jar).
        const serialized = await restored.serialize();
        for (const c of serialized.cookies) {
          await this.jar.setCookie(
            `${c.key}=${c.value}`,
            `${this.config.baseUrl}${c.path ?? '/'}`,
          ).catch(() => undefined);
        }
      }
      this.csrfToken = data.csrfToken ?? null;
      // Verify the restored cookies are actually still valid.
      this.authenticated = await this.verifySession();
      return this.authenticated;
    } catch {
      return false;
    }
  }

  /** Persist the cookie jar to disk if a session file is configured. */
  async saveSession(): Promise<void> {
    if (!this.config.sessionFile) return;
    const cookies = await this.jar.serialize();
    await writeFile(
      this.config.sessionFile,
      JSON.stringify({ cookies, csrfToken: this.csrfToken }, null, 2),
      'utf8',
    );
  }

  // --- authentication -----------------------------------------------------

  /**
   * Sign in with username/password against the clinic's sign-in form.
   *
   * Rather than hardcoding field names, we parse the ACTUAL form from the
   * sign-in page — its action URL, the username/password input names, and all
   * hidden fields (authenticity_token, etc.) — and submit exactly that. This
   * adapts to whatever the clinic's form really looks like.
   *
   *   1. GET /admin (redirects to the real sign-in page).
   *   2. Parse the form, fill username/password, POST it.
   *   3. A successful login sets a session cookie and leaves the sign-in form;
   *      a failed one re-renders it, or asks for a 2-step verification code.
   */
  async login(): Promise<void> {
    // 1. Fetch the sign-in page (/admin redirects to it when unauthenticated).
    const page = await this.http.get('/admin');
    await this.maybeDump('login-page', page);

    if (this.looksLoggedIn(page)) {
      this.authenticated = true;
      this.csrfToken = this.extractMetaCsrf(page.data) ?? this.csrfToken;
      await this.saveSession();
      return;
    }

    // 2. Parse the real form instead of guessing field names.
    const pageUrl = this.finalUrl(page) ?? `${this.config.baseUrl}/admin`;
    const form = this.parseLoginForm(page.data, pageUrl);
    if (!form) {
      throw new JaneAuthError(
        'Could not find a username/password form on the sign-in page. It may ' +
          'be JavaScript-rendered (in which case raw HTTP cannot log in — use ' +
          'the headless-browser approach), or the clinic only offers Google/SSO ' +
          'sign-in. Enable JANE_DEBUG=true and inspect debug-login-page.html.',
      );
    }

    const body = new URLSearchParams(form.fields);
    body.set(form.usernameName, this.config.username);
    body.set(form.passwordName, this.config.password);
    const csrf = form.fields['authenticity_token'] ?? this.extractMetaCsrf(page.data) ?? '';

    const result = await this.http.post(form.actionUrl, body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: this.config.baseUrl,
        Referer: pageUrl,
        'X-CSRF-Token': csrf,
      },
    });
    await this.maybeDump('login-result', result);

    // 3. Decide the outcome.
    const resultBody = typeof result.data === 'string' ? result.data : '';
    if (this.mentionsMfa(resultBody)) {
      throw new JaneAuthError(
        '2-Step Verification (MFA) is enabled on this account. The raw HTTP ' +
          'login cannot complete an MFA challenge — disable MFA for this ' +
          'service account or switch to the headless-browser approach.',
      );
    }

    this.csrfToken = this.extractMetaCsrf(resultBody) ?? csrf ?? null;
    this.authenticated = await this.verifySession();
    if (!this.authenticated) {
      throw new JaneAuthError(
        'Login did not produce an authenticated session. The credentials were ' +
          'likely rejected — double-check by signing in manually in a browser ' +
          'at <clinic>/admin with the exact same username/password. Enable ' +
          'JANE_DEBUG=true and inspect debug-login-result.html.',
      );
    }

    await this.saveSession();
  }

  /** Ensure we are logged in, logging in if necessary. */
  async ensureAuthenticated(): Promise<void> {
    if (this.authenticated) return;
    if (await this.loadSession()) return;
    await this.login();
  }

  /**
   * Hit a known authenticated-only endpoint to confirm the session is live.
   * We use the schedule/dashboard root: an authenticated session returns 200
   * HTML for the app shell; an expired one redirects to the sign-in form.
   */
  private async verifySession(): Promise<boolean> {
    const res = await this.http.get('/admin', { maxRedirects: 5 });
    return this.looksLoggedIn(res);
  }

  // --- authenticated requests --------------------------------------------

  /** Authenticated JSON GET. */
  async apiGet<T = unknown>(path: string, params?: Record<string, unknown>): Promise<T> {
    await this.ensureAuthenticated();
    const res = await this.http.get(path, {
      params,
      headers: { Accept: 'application/json' },
    });
    return this.handleJson<T>(res, 'GET', path);
  }

  /** Authenticated JSON POST (sends the CSRF token Jane requires for writes). */
  async apiPost<T = unknown>(path: string, payload: unknown): Promise<T> {
    await this.ensureAuthenticated();
    const res = await this.http.post(path, payload, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': this.csrfToken ?? '',
        Origin: this.config.baseUrl,
        Referer: `${this.config.baseUrl}/admin`,
      },
    });
    return this.handleJson<T>(res, 'POST', path);
  }

  private handleJson<T>(res: AxiosResponse, method: string, path: string): T {
    if (res.status < 200 || res.status >= 300) {
      throw new JaneApiError(
        `${method} ${path} failed with HTTP ${res.status}. ` +
          (res.status === 401 || res.status === 302
            ? 'The session may have expired — delete the session file and retry.'
            : ''),
        res.status,
        res.data,
      );
    }
    if (typeof res.data === 'string') {
      // Got HTML where JSON was expected — usually a redirect to sign-in.
      throw new JaneApiError(
        `${method} ${path} returned HTML instead of JSON. The session is ` +
          'probably not authenticated, or this is not a JSON endpoint.',
        res.status,
      );
    }
    return res.data as T;
  }

  // --- HTML helpers -------------------------------------------------------

  /** Resolve the final URL after redirects, for resolving relative form actions. */
  private finalUrl(res: AxiosResponse): string | null {
    const req = res.request as
      | { res?: { responseUrl?: string }; responseURL?: string }
      | undefined;
    return req?.res?.responseUrl ?? req?.responseURL ?? null;
  }

  /**
   * Parse the real sign-in form so we submit exactly what the clinic expects.
   * Picks the form containing a password input, reads its action + the
   * username/password field names, and carries over every hidden/default field
   * (authenticity_token, utf8, the submit button, etc.).
   */
  private parseLoginForm(
    html: unknown,
    pageUrl: string,
  ): {
    actionUrl: string;
    usernameName: string;
    passwordName: string;
    fields: Record<string, string>;
  } | null {
    if (typeof html !== 'string') return null;
    const $ = cheerio.load(html);

    const form = $('form')
      .filter((_, el) => $(el).find('input[type="password"]').length > 0)
      .first();
    if (form.length === 0) return null;

    const passwordName = form.find('input[type="password"]').first().attr('name');
    if (!passwordName) return null;

    // Username = first visible text/email/tel/search input that isn't password.
    let usernameName: string | undefined;
    form.find('input').each((_, el) => {
      if (usernameName) return;
      const name = $(el).attr('name');
      const type = ($(el).attr('type') ?? 'text').toLowerCase();
      if (name && ['text', 'email', 'tel', 'search', ''].includes(type)) {
        usernameName = name;
      }
    });
    if (!usernameName) return null;

    // Carry over hidden/default fields + the first submit button's name/value.
    const fields: Record<string, string> = {};
    let submitIncluded = false;
    form.find('input').each((_, el) => {
      const name = $(el).attr('name');
      if (!name || name === usernameName || name === passwordName) return;
      const type = ($(el).attr('type') ?? 'text').toLowerCase();
      if (type === 'submit' || type === 'button') {
        if (!submitIncluded) {
          fields[name] = $(el).attr('value') ?? '';
          submitIncluded = true;
        }
        return;
      }
      if (type === 'checkbox' || type === 'radio') {
        if ($(el).attr('checked') !== undefined) fields[name] = $(el).attr('value') ?? 'on';
        return;
      }
      fields[name] = $(el).attr('value') ?? '';
    });
    if (!submitIncluded) {
      const btn = form.find('button[type="submit"], button:not([type])').first();
      const bname = btn.attr('name');
      if (bname) fields[bname] = btn.attr('value') ?? '';
    }

    const actionUrl = new URL(form.attr('action') || pageUrl, pageUrl).toString();
    return { actionUrl, usernameName, passwordName, fields };
  }

  private extractMetaCsrf(html: unknown): string | null {
    if (typeof html !== 'string') return null;
    const $ = cheerio.load(html);
    return $('meta[name="csrf-token"]').attr('content') ?? null;
  }

  /**
   * Heuristic: are we looking at the authenticated app rather than the form?
   * axios follows redirects, so by the time we get here `res` is the final
   * response. We're authenticated if it's a 2xx that is NOT a sign-in page —
   * detected by the presence of a password input (field-name agnostic).
   */
  private looksLoggedIn(res: AxiosResponse): boolean {
    if (res.status < 200 || res.status >= 300) return false;
    const body = typeof res.data === 'string' ? res.data : '';
    if (!body) return true;
    const $ = cheerio.load(body);
    const hasPasswordForm = $('input[type="password"]').length > 0;
    const saysSignIn = /please sign in|sign in to your account/i.test(body);
    return !hasPasswordForm && !saysSignIn;
  }

  private mentionsMfa(body: string): boolean {
    return /2-step|two-step|verification code|one-time|otp/i.test(body) &&
      /code/i.test(body);
  }

  private async maybeDump(label: string, res: AxiosResponse): Promise<void> {
    if (!this.config.debug) return;
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
    await writeFile(`debug-${label}.html`, body, 'utf8').catch(() => undefined);
  }
}
