import { addDaysLocal, daysBetweenLocal, toLocalDate } from '../data/dates';
import type { RotationPosition, ScheduledSession } from '../types';

/**
 * Rotation sequencing. Pure — the clock is always injected.
 *
 * The rotation is FREE-FLOATING: it advances on completed work, not on the
 * calendar. That property is what stops rest from banking.
 */

export type Density = '3:1' | '2:1';

const CYCLE_3_1: RotationPosition[] = ['TD1', 'TD2', 'TD3', 'RD'];
const CYCLE_2_1: RotationPosition[] = [
  'TD-A', 'TD-B-STR', 'RD', 'TD-A', 'TD-B-ESD', 'RD',
];

export const ROTATION_CYCLES: Record<Density, RotationPosition[]> = {
  '3:1': CYCLE_3_1,
  '2:1': CYCLE_2_1,
};

/** Chronological order. `localDate` is authoritative; `ts` breaks ties only. */
function chronological(sessions: ScheduledSession[]): ScheduledSession[] {
  return [...sessions].sort(
    (a, b) => (a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : a.ts - b.ts),
  );
}

function completed(sessions: ScheduledSession[]): ScheduledSession[] {
  // Only `done` advances the rotation. planned/missed/deferred do not — a
  // session you did not complete cannot move you through the cycle.
  return chronological(sessions).filter((s) => s.status === 'done');
}

/**
 * The next rotation position.
 *
 * Consecutive Recovery Days do NOT bank: if the last completed session was an
 * RD, the next position is the top of the cycle regardless of how many RDs
 * preceded it. Three RDs in a row still yield one TD1, never three.
 */
export function nextPosition(
  history: ScheduledSession[],
  density: Density,
): RotationPosition {
  const done = completed(history);
  const last = done[done.length - 1];

  if (density === '2:1') {
    if (!last) return 'TD-A';
    switch (last.position) {
      case 'TD-A':
        return nextBVariant(done);
      case 'TD-B-STR':
      case 'TD-B-ESD':
        return 'RD';
      case 'RD':
        return 'TD-A';
      default:
        // A 3:1 position in a 2:1 history (density was switched). Restart the
        // supercycle rather than guess an equivalence.
        return 'TD-A';
    }
  }

  if (!last) return 'TD1';
  // An explicit successor map rather than index arithmetic: indexing under
  // `noUncheckedIndexedAccess` would need an unreachable fallback branch, and
  // unreachable branches cannot be honestly tested.
  // A 2:1 position under 3:1 density falls through to TD1 — restart, don't guess.
  return NEXT_3_1[last.position] ?? 'TD1';
}

const NEXT_3_1: Partial<Record<RotationPosition, RotationPosition>> = {
  TD1: 'TD2',
  TD2: 'TD3',
  TD3: 'RD',
  RD: 'TD1',
};

/**
 * TD-B alternates STR -> ESD -> STR. Determined by the most recent completed
 * TD-B-*: if it was STR the next is ESD; if it was ESD, or there is none, the
 * next is STR.
 */
function nextBVariant(done: ScheduledSession[]): RotationPosition {
  for (let i = done.length - 1; i >= 0; i--) {
    const p = done[i]?.position;
    if (p === 'TD-B-STR') return 'TD-B-ESD';
    if (p === 'TD-B-ESD') return 'TD-B-STR';
  }
  return 'TD-B-STR';
}

/**
 * Shift every session on or after `fromLocalDate` forward by `byDays`.
 *
 * Relative spacing is preserved because every affected session moves by the
 * same number of calendar days. Nothing is skipped and nothing collapses onto
 * an occupied date: shifted sessions only move later, and unshifted sessions
 * are strictly earlier than `fromLocalDate`.
 *
 * `localDate` and `ts` are both recomputed. `ts` keeps its local time-of-day,
 * so a 06:00 session stays a 06:00 session across a DST boundary.
 */
export function applyDeferral(
  schedule: ScheduledSession[],
  fromLocalDate: string,
  byDays: number,
): ScheduledSession[] {
  if (byDays === 0) return [...schedule];

  return schedule.map((s) => {
    if (s.localDate < fromLocalDate) return s;
    return {
      ...s,
      localDate: addDaysLocal(s.localDate, byDays),
      ts: shiftTsPreservingLocalTime(s.ts, byDays),
    };
  });
}

/** Move a timestamp `byDays` calendar days, keeping its local wall-clock time. */
function shiftTsPreservingLocalTime(ts: number, byDays: number): number {
  const d = new Date(ts); // argument-taking constructor: not a clock read
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + byDays,
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
  ).getTime();
}

export interface LayoffState {
  consecutiveRestDays: number;
  requiresReentry: boolean;
  loadMultiplier: number;
}

export const REENTRY_THRESHOLD_DAYS = 4;
export const REENTRY_LOAD_MULTIPLIER = 0.85;

/**
 * Consecutive rest days ending today (inclusive).
 *
 * A rest day is a calendar day with no completed non-RD session. A logged
 * Recovery Day is therefore a rest day — it is rest, not training. (Days with
 * an RD are not counted a second time; that would double-count the same day.)
 *
 * Re-entry is required past 4 consecutive rest days, and drops load to 85%.
 */
export function layoffState(history: ScheduledSession[], now: Date): LayoffState {
  const trainingDates = new Set(
    history
      .filter((s) => s.status === 'done' && s.position !== 'RD')
      .map((s) => s.localDate),
  );

  const today = toLocalDate(now);
  let consecutiveRestDays = 0;

  // Walk backwards from today until a training day is found. Bounded so a
  // database with no training history cannot spin.
  for (let i = 0; i < 3650; i++) {
    const day = addDaysLocal(today, -i);
    if (trainingDates.has(day)) break;
    consecutiveRestDays++;
  }

  const requiresReentry = consecutiveRestDays > REENTRY_THRESHOLD_DAYS;
  return {
    consecutiveRestDays,
    requiresReentry,
    loadMultiplier: requiresReentry ? REENTRY_LOAD_MULTIPLIER : 1,
  };
}

/** Calendar days since the most recent completed non-RD session, or null. */
export function daysSinceLastTrainingDay(
  history: ScheduledSession[],
  now: Date,
): number | null {
  const dates = history
    .filter((s) => s.status === 'done' && s.position !== 'RD')
    .map((s) => s.localDate)
    .sort();
  const last = dates[dates.length - 1];
  return last === undefined ? null : daysBetweenLocal(last, toLocalDate(now));
}
