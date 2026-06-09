#!/usr/bin/env node
/**
 * Small CLI for the Jane integration.
 *
 *   npm run dev login-check
 *   npm run dev staff
 *   npm run dev treatments
 *   npm run dev locations
 *   npm run dev patients "smith"
 *   npm run dev create --staff 12 --treatment 34 --patient 56 --location 1 \
 *                       --start "2026-06-15T14:00:00-07:00" --duration 30 --note "Follow-up"
 */
import { loadConfig } from './config.js';
import { JaneClient } from './jane/client.js';
import { JaneAppointments } from './jane/appointments.js';
import { JaneApiError, JaneAuthError } from './jane/types.js';

type Flags = Record<string, string | boolean>;

function parseFlags(args: string[]): { positionals: string[]; flags: Flags } {
  const positionals: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function requireNum(flags: Flags, name: string): number {
  const v = flags[name];
  if (v === undefined || v === true) {
    throw new Error(`Missing required --${name} <number>`);
  }
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`--${name} must be a number, got "${v}"`);
  return n;
}

async function main() {
  const [, , command = 'help', ...rest] = process.argv;
  const { positionals, flags } = parseFlags(rest);

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  const config = loadConfig();
  const client = new JaneClient(config);
  const appts = new JaneAppointments(client);

  switch (command) {
    case 'login-check': {
      await client.ensureAuthenticated();
      console.log(`✓ Authenticated against ${client.baseUrl}`);
      break;
    }
    case 'staff': {
      console.log(JSON.stringify(await appts.listStaffMembers(), null, 2));
      break;
    }
    case 'treatments': {
      console.log(JSON.stringify(await appts.listTreatments(), null, 2));
      break;
    }
    case 'locations': {
      console.log(JSON.stringify(await appts.listLocations(), null, 2));
      break;
    }
    case 'patients': {
      const query = positionals[0] ?? '';
      console.log(JSON.stringify(await appts.searchPatients(query), null, 2));
      break;
    }
    case 'create': {
      const created = await appts.createAppointment({
        staffMemberId: requireNum(flags, 'staff'),
        treatmentId: requireNum(flags, 'treatment'),
        patientId: requireNum(flags, 'patient'),
        locationId: flags.location !== undefined ? requireNum(flags, 'location') : undefined,
        startAt: String(flags.start),
        durationMinutes: flags.duration !== undefined ? requireNum(flags, 'duration') : undefined,
        note: typeof flags.note === 'string' ? flags.note : undefined,
      });
      console.log('✓ Created appointment:');
      console.log(JSON.stringify(created, null, 2));
      break;
    }
    default:
      console.error(`Unknown command: ${command}\n`);
      printHelp();
      process.exitCode = 1;
  }
}

function printHelp() {
  console.log(`Jane appointments CLI

Commands:
  login-check                 Verify URL + username + password produce a session
  staff                       List staff members (get their IDs)
  treatments                  List treatments (get their IDs)
  locations                   List locations (get their IDs)
  patients "<query>"          Search patients by name/email
  create --staff N --treatment N --patient N [--location N]
         --start "<ISO>" [--duration MIN] [--note "..."]
                              Create an appointment

Config comes from .env (copy .env.example). See README.md.`);
}

main().catch((err) => {
  if (err instanceof JaneAuthError) {
    console.error(`Authentication failed: ${err.message}`);
  } else if (err instanceof JaneApiError) {
    console.error(`API error${err.status ? ` (HTTP ${err.status})` : ''}: ${err.message}`);
    if (err.body) console.error(typeof err.body === 'string' ? err.body : JSON.stringify(err.body, null, 2));
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
});
