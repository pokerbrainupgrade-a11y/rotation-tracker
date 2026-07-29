import { describe, expect, it } from 'vitest';
import {
  DOT_STYLE,
  daysInMonth,
  densityStrip,
  dotState,
  groupByDate,
  monthMatrix,
  shiftDate,
  weekOf,
} from '../../src/lib/calendarGrid';
import type { SessionStatus } from '../../src/types';
import { session } from './factories';

// TZ pinned to America/New_York by vitest.config.ts.

/* ---------- TEST 1: month grid date math ---------- */

describe('1 — month grid date math', () => {
  it('counts days correctly for 28/29/30/31-day months', () => {
    expect(daysInMonth(2026, 0)).toBe(31);  // January
    expect(daysInMonth(2026, 1)).toBe(28);  // February, common year
    expect(daysInMonth(2028, 1)).toBe(29);  // February, leap year
    expect(daysInMonth(2026, 3)).toBe(30);  // April
    expect(daysInMonth(2000, 1)).toBe(29);  // 400-year rule
    expect(daysInMonth(1900, 1)).toBe(28);  // 100-year rule
  });

  it('pads leading blanks to the correct weekday', () => {
    // 1 Feb 2026 is a Sunday -> no leading blanks.
    const feb = monthMatrix(2026, 1);
    expect(feb[0]?.[0]).toBe('2026-02-01');

    // 1 Jul 2026 is a Wednesday -> three leading blanks.
    const jul = monthMatrix(2026, 6);
    expect(jul[0]?.slice(0, 3)).toEqual([null, null, null]);
    expect(jul[0]?.[3]).toBe('2026-07-01');
  });

  it('pads to whole weeks and never truncates the month', () => {
    for (let m = 0; m < 12; m++) {
      const rows = monthMatrix(2026, m);
      const flat = rows.flat();
      expect(flat.length % 7).toBe(0);

      const dates = flat.filter((d): d is string => d !== null);
      expect(dates).toHaveLength(daysInMonth(2026, m));
      expect(dates[0]).toBe(`2026-${String(m + 1).padStart(2, '0')}-01`);
      expect(dates[dates.length - 1]?.slice(8)).toBe(String(daysInMonth(2026, m)));
    }
  });

  it('handles February in a leap year end to end', () => {
    const dates = monthMatrix(2028, 1).flat().filter(Boolean);
    expect(dates).toHaveLength(29);
    expect(dates[28]).toBe('2028-02-29');
  });

  it('produces no duplicate or skipped dates', () => {
    const dates = monthMatrix(2026, 2).flat().filter((d): d is string => d !== null);
    expect(new Set(dates).size).toBe(dates.length);
    // March contains a DST transition; the grid must still be 31 unique days.
    expect(dates).toHaveLength(31);
    expect(dates).toContain('2026-03-08');
  });

  it('crosses a year boundary correctly', () => {
    const dec = monthMatrix(2026, 11).flat().filter(Boolean);
    expect(dec[dec.length - 1]).toBe('2026-12-31');
  });
});

describe('weekOf', () => {
  it('returns seven days starting Sunday', () => {
    // 2026-07-29 is a Wednesday.
    const week = weekOf(new Date(2026, 6, 29));
    expect(week).toHaveLength(7);
    expect(week[0]).toBe('2026-07-26'); // Sunday
    expect(week[6]).toBe('2026-08-01'); // crosses the month boundary
  });

  it('is stable across a DST boundary', () => {
    const week = weekOf(new Date(2026, 2, 10));
    expect(week).toHaveLength(7);
    expect(new Set(week).size).toBe(7);
    expect(week).toContain('2026-03-08');
  });
});

describe('shiftDate', () => {
  it('moves by whole calendar days across DST and month ends', () => {
    expect(shiftDate('2026-03-07', 2)).toBe('2026-03-09');
    expect(shiftDate('2026-07-31', 1)).toBe('2026-08-01');
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
  });
});

/* ---------- TEST 2: density strip ---------- */

describe('2 — density strip', () => {
  const now = new Date(2026, 6, 29, 12); // 2026-07-29

  it('maps exactly 28 trailing local days, oldest first', () => {
    const strip = densityStrip([], now);
    expect(strip).toHaveLength(28);
    expect(strip[0]?.localDate).toBe('2026-07-02');
    expect(strip[27]?.localDate).toBe('2026-07-29');

    const dates = strip.map((c) => c.localDate);
    expect(new Set(dates).size).toBe(28);
    expect([...dates].sort()).toEqual(dates); // ascending
  });

  it('renders gaps as empty cells rather than omitting them', () => {
    const strip = densityStrip(
      [
        session({ id: 'a', localDate: '2026-07-29' }),
        session({ id: 'b', localDate: '2026-07-24' }),
      ],
      now,
    );

    expect(strip).toHaveLength(28);
    const empties = strip.filter((c) => c.sessions.length === 0);
    expect(empties).toHaveLength(26);

    // The four-day gap between the two sessions is present as four cells.
    const start = strip.findIndex((c) => c.localDate === '2026-07-24');
    expect(strip.slice(start + 1, start + 5).every((c) => c.sessions.length === 0)).toBe(true);
  });

  it('excludes sessions outside the window', () => {
    const strip = densityStrip([session({ id: 'old', localDate: '2026-07-01' })], now);
    expect(strip.every((c) => c.sessions.length === 0)).toBe(true);
  });

  it('keeps multiple sessions on one day in the same cell', () => {
    const strip = densityStrip(
      [
        session({ id: 'a', localDate: '2026-07-20', ts: 1 }),
        session({ id: 'b', localDate: '2026-07-20', ts: 2 }),
      ],
      now,
    );
    const cell = strip.find((c) => c.localDate === '2026-07-20');
    expect(cell?.sessions).toHaveLength(2);
  });

  it('spans a DST boundary with exactly 28 distinct days', () => {
    const strip = densityStrip([], new Date(2026, 2, 20, 12));
    expect(strip).toHaveLength(28);
    expect(new Set(strip.map((c) => c.localDate)).size).toBe(28);
    expect(strip[0]?.localDate).toBe('2026-02-21');
  });
});

/* ---------- TEST 3: dot state mapping ---------- */

describe('3 — dot state mapping', () => {
  it.each([
    ['done', 'done'],
    ['planned', 'planned'],
    ['missed', 'missed'],
    ['deferred', 'deferred'],
  ] as Array<[SessionStatus, string]>)('%s -> %s', (status, expected) => {
    expect(dotState(status)).toBe(expected);
  });

  it('done is solid in the session colour', () => {
    expect(DOT_STYLE.done).toEqual({ colorVar: null, filled: true });
  });

  it('planned is a hollow ring in the session colour', () => {
    expect(DOT_STYLE.planned).toEqual({ colorVar: null, filled: false });
  });

  it('missed is solid --alert', () => {
    expect(DOT_STYLE.missed).toEqual({ colorVar: '--alert', filled: true });
  });

  it('deferred is solid --text-faint', () => {
    expect(DOT_STYLE.deferred).toEqual({ colorVar: '--text-faint', filled: true });
  });

  it('no dot state uses --brand', () => {
    for (const style of Object.values(DOT_STYLE)) {
      expect(style.colorVar ?? '').not.toContain('--brand');
    }
  });

  it('covers every status with no gaps', () => {
    expect(Object.keys(DOT_STYLE).sort()).toEqual(['deferred', 'done', 'missed', 'planned']);
  });
});

describe('groupByDate', () => {
  it('groups and orders sessions within a day by ts', () => {
    const grouped = groupByDate([
      session({ id: 'late', localDate: '2026-07-20', ts: 200 }),
      session({ id: 'early', localDate: '2026-07-20', ts: 100 }),
      session({ id: 'other', localDate: '2026-07-21', ts: 50 }),
    ]);
    expect(grouped.get('2026-07-20')?.map((s) => s.id)).toEqual(['early', 'late']);
    expect(grouped.get('2026-07-21')).toHaveLength(1);
  });
});
