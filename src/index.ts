/**
 * Library entry point. Import these to use the Jane integration from your own
 * code (e.g. a bot, a queue worker, or an HTTP service).
 *
 *   import { createClient, JaneAppointments } from 'jane-appointments';
 *
 *   const client = createClient();
 *   await client.ensureAuthenticated();
 *   const appts = new JaneAppointments(client);
 *   await appts.createAppointment({ ... });
 */
export { JaneClient } from './jane/client.js';
export { JaneAppointments } from './jane/appointments.js';
export * from './jane/types.js';
export { loadConfig, normalizeBaseUrl, type JaneConfig } from './config.js';

import { loadConfig, type JaneConfig } from './config.js';
import { JaneClient } from './jane/client.js';

/** Convenience factory: build a client from environment (.env) config. */
export function createClient(config?: Partial<JaneConfig>): JaneClient {
  const base = loadConfig();
  return new JaneClient({ ...base, ...config });
}
