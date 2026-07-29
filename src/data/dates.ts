/**
 * Local-calendar-date helpers.
 *
 * Every function here is pure and takes its clock as an argument. The ledger
 * engine (Phase 2) builds on these, so they must be right before anything
 * counts on them.
 *
 * WHY LOCAL DATES: the 28-day window counts local calendar days. Deriving
 * local days from UTC epochs at read time produces DST and timezone
 * off-by-ones, so every user record stores `localDate` alongside `ts`.
 * `localDate` is the ledger key; `ts` is for ordering only.
 *
 * All arithmetic here goes through the local-midnight constructor
 * `new Date(y, m, d)` rather than epoch offsets. Subtracting `n * 86_400_000`
 * ms is the bug this module exists to prevent: on a DST boundary that yields a
 * duplicated or skipped calendar day.
 */

/** `YYYY-MM-DD` for the local calendar day containing `d`. */
export function toLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local midnight that starts the calendar day containing `d`. */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** `YYYY-MM-DD` for the local calendar day `n` days before `now`. */
export function daysAgoLocal(n: number, now: Date): string {
  const d = startOfLocalDay(now);
  d.setDate(d.getDate() - n);
  return toLocalDate(d);
}

/**
 * Is `localDate` inside the trailing window of `n` local calendar days
 * ending on (and including) the day of `now`?
 *
 * The window is INCLUSIVE OF TODAY and spans exactly `n` distinct calendar
 * days: `isWithinLast(28, …)` covers today plus the previous 27 days.
 * Future-dated records are excluded — a trailing ledger must not count
 * sessions that have not happened yet.
 */
export function isWithinLast(n: number, localDate: string, now: Date): boolean {
  if (n <= 0) return false;
  const earliest = daysAgoLocal(n - 1, now);
  const today = toLocalDate(now);
  // YYYY-MM-DD is lexicographically ordered, so string compare is date compare.
  return localDate >= earliest && localDate <= today;
}

/**
 * The `n` local calendar days ending today, oldest first. Exactly `n` distinct
 * entries across DST boundaries — the ledger relies on that.
 */
export function lastNLocalDates(n: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(daysAgoLocal(i, now));
  return out;
}

/** Parse `YYYY-MM-DD` to local midnight. Throws on malformed input. */
export function parseLocalDate(localDate: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!m) throw new Error(`Malformed local date: ${localDate}`);
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

/** Whole local calendar days from `from` to `to` (negative if `to` is earlier). */
export function daysBetweenLocal(from: string, to: string): number {
  const a = parseLocalDate(from);
  const b = parseLocalDate(to);
  // Round because the span may contain a 23- or 25-hour DST day.
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** True if `value` is a well-formed `YYYY-MM-DD` denoting a real calendar day. */
export function isValidLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return toLocalDate(parseLocalDate(value)) === value;
  } catch {
    return false;
  }
}
