import { lastNLocalDates, toLocalDate } from '../data/dates';
import type { ScheduledSession, SessionStatus } from '../types';

/**
 * Calendar geometry. Pure functions over plain data, clock injected — same
 * discipline as src/engine, because month boundaries and DST are exactly where
 * date grids go quietly wrong.
 */

export const DENSITY_DAYS = 28;

/** Sunday-first. This program has no weekdays, so no day is privileged. */
export const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/** Days in a local calendar month. `month` is 0-indexed. */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month + 1, 0).getDate();
}

/**
 * A month as rows of seven. Leading and trailing cells are `null` so the grid
 * keeps its column alignment without inventing dates that belong to a
 * neighbouring month.
 */
export function monthMatrix(year: number, month: number): Array<Array<string | null>> {
  const leading = new Date(year, month, 1).getDay(); // 0 = Sunday
  const total = daysInMonth(year, month);

  const cells: Array<string | null> = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: total }, (_, i) => toLocalDate(new Date(year, month, i + 1))),
  ];

  // Pad to a whole number of weeks.
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1)
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    .toUpperCase();
}

/** The seven local dates of the week containing `localDate`, Sunday first. */
export function weekOf(date: Date): string[] {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
  return Array.from({ length: 7 }, (_, i) =>
    toLocalDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)),
  );
}

/* ---------------- dots ---------------- */

export type DotState = 'done' | 'planned' | 'missed' | 'deferred';

/** Status -> dot state. One mapping, used by every view. */
export function dotState(status: SessionStatus): DotState {
  switch (status) {
    case 'done':
      return 'done';
    case 'planned':
      return 'planned';
    case 'missed':
      return 'missed';
    case 'deferred':
      return 'deferred';
  }
}

export interface DotStyle {
  /** CSS colour, or null when the dot takes the session colour. */
  colorVar: string | null;
  filled: boolean;
}

/**
 * solid = done · hollow ring = planned · --alert solid = missed ·
 * --text-faint = deferred.
 */
export const DOT_STYLE: Record<DotState, DotStyle> = {
  done: { colorVar: null, filled: true },
  planned: { colorVar: null, filled: false },
  missed: { colorVar: '--alert', filled: true },
  deferred: { colorVar: '--text-faint', filled: true },
};

/* ---------------- density strip ---------------- */

export interface DensityCell {
  localDate: string;
  /** The day's sessions, in the order they were scheduled. */
  sessions: ScheduledSession[];
}

/**
 * The trailing 28 local days, oldest first, one cell per day including days
 * with nothing on them.
 *
 * Empty days are the point: this strip is where rotation drift becomes
 * visible, and a gap you can see beats a number you have to interpret.
 */
export function densityStrip(
  sessions: ScheduledSession[],
  now: Date,
  days: number = DENSITY_DAYS,
): DensityCell[] {
  const byDate = new Map<string, ScheduledSession[]>();
  for (const s of sessions) {
    const bucket = byDate.get(s.localDate);
    if (bucket) bucket.push(s);
    else byDate.set(s.localDate, [s]);
  }

  return lastNLocalDates(days, now).map((localDate) => ({
    localDate,
    sessions: byDate.get(localDate) ?? [],
  }));
}

/** Sessions grouped by local date, for the grid and week views. */
export function groupByDate(sessions: ScheduledSession[]): Map<string, ScheduledSession[]> {
  const out = new Map<string, ScheduledSession[]>();
  for (const s of [...sessions].sort((a, b) => a.ts - b.ts)) {
    const bucket = out.get(s.localDate);
    if (bucket) bucket.push(s);
    else out.set(s.localDate, [s]);
  }
  return out;
}

/** Long date header, e.g. "Wed, 29 Jul 2026". */
export function longDate(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Shift a local date by whole calendar days, via local midnight. */
export function shiftDate(localDate: string, byDays: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  return toLocalDate(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + byDays));
}
