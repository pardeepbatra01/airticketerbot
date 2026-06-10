/**
 * Datetime formatting for Jane.
 *
 * Jane expects ISO-8601 **with a timezone offset** everywhere — e.g.
 * `2026-06-09T21:35:03-04:00`. NOT UTC `Z`, NOT milliseconds. Plain dates are
 * `YYYY-MM-DD`. (Confirmed by capturing the admin UI's real requests.)
 *
 * The functions here turn whatever start time we're handed (a `Date`, an
 * offset-tagged ISO string, a `Z` UTC string, or a naive wall-clock string)
 * into that exact shape, and add minutes while preserving the offset so the
 * reserve/book payloads line up.
 */

const OFFSET_RE = /([+-]\d{2}:\d{2})$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Format a signed minute offset as `+HH:MM` / `-HH:MM`. */
function formatOffset(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? '-' : '+';
  const abs = Math.abs(totalMinutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Parse an `+HH:MM` / `-HH:MM` offset into signed minutes. */
function parseOffset(offset: string): number {
  const sign = offset.startsWith('-') ? -1 : 1;
  const [h, m] = offset.slice(1).split(':').map(Number);
  return sign * (h * 60 + m);
}

/**
 * The wall-clock minutes a given instant maps to in `timeZone`, minus UTC.
 * E.g. America/Toronto in summer → -240. Uses the Intl database, so it's
 * DST-correct for the specific instant.
 */
function offsetMinutesForTimeZone(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** Render an absolute instant as Jane ISO at the given fixed offset (minutes). */
function formatAtOffset(date: Date, offsetMinutes: number): string {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    formatOffset(offsetMinutes)
  );
}

/**
 * Normalize a start time into the exact string Jane wants.
 *
 *   - Offset-tagged string ("…-04:00")  → passed through unchanged (already correct).
 *   - `Z` UTC string                     → converted into `timeZone`'s offset (if known).
 *   - Naive wall-clock ("…T14:00:00")    → interpreted as local time in `timeZone`.
 *   - `Date`                             → rendered in `timeZone`.
 *
 * `timeZone` defaults to `JANE_TIMEZONE` (an IANA name like "America/Toronto").
 * When no zone is known we fall back to the host's local offset, which is fine
 * for offset-tagged inputs (the common case — the slot comes from openings).
 */
export function toJaneDateTime(
  value: Date | string,
  timeZone: string | undefined = process.env.JANE_TIMEZONE || undefined,
): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Already in Jane's shape — don't touch it.
    if (OFFSET_RE.test(trimmed)) return trimmed;

    if (/[zZ]$/.test(trimmed)) {
      const d = new Date(trimmed);
      if (Number.isNaN(d.getTime())) throw new Error(`Invalid datetime: ${value}`);
      return timeZone
        ? formatAtOffset(d, offsetMinutesForTimeZone(d, timeZone))
        : formatAtOffset(d, -d.getTimezoneOffset());
    }

    // Naive "YYYY-MM-DDTHH:mm[:ss]" — wall-clock in the clinic's zone.
    if (timeZone) return interpretWallClock(trimmed, timeZone);
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid datetime: ${value}`);
    return formatAtOffset(d, -d.getTimezoneOffset());
  }

  if (Number.isNaN(value.getTime())) throw new Error('Invalid Date');
  return timeZone
    ? formatAtOffset(value, offsetMinutesForTimeZone(value, timeZone))
    : formatAtOffset(value, -value.getTimezoneOffset());
}

/** Treat `wall` ("YYYY-MM-DDTHH:mm[:ss]") as local time in `timeZone`. */
function interpretWallClock(wall: string, timeZone: string): string {
  const guess = new Date(`${wall}Z`); // pretend it's UTC to get a ballpark instant
  if (Number.isNaN(guess.getTime())) throw new Error(`Invalid datetime: ${wall}`);
  // Solve for the real instant, then recompute the offset there (handles DST edges).
  let offset = offsetMinutesForTimeZone(guess, timeZone);
  const instant = new Date(guess.getTime() - offset * 60_000);
  offset = offsetMinutesForTimeZone(instant, timeZone);
  return formatAtOffset(new Date(guess.getTime() - offset * 60_000), offset);
}

/**
 * Add minutes to a Jane ISO string, keeping its offset. Used to derive `end_at`
 * from `start_at` + duration so both carry the same offset Jane sent us.
 */
export function addMinutes(janeIso: string, minutes: number): string {
  const next = new Date(new Date(janeIso).getTime() + minutes * 60_000);
  if (Number.isNaN(next.getTime())) throw new Error(`Invalid datetime: ${janeIso}`);
  const m = janeIso.match(OFFSET_RE);
  const offset = m ? parseOffset(m[1]) : -next.getTimezoneOffset();
  return formatAtOffset(next, offset);
}
