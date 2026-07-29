import { describe, expect, it } from 'vitest';
import {
  daysAgoLocal,
  daysBetweenLocal,
  isValidLocalDate,
  isWithinLast,
  lastNLocalDates,
  parseLocalDate,
  toLocalDate,
} from '../../src/data/dates';

// TZ is pinned to America/New_York by vitest.config.ts.
// 2026 US DST: spring forward Sun Mar 8, fall back Sun Nov 1.

describe('toLocalDate', () => {
  it('uses local calendar fields, not UTC', () => {
    // 2026-03-10T02:30Z is still 2026-03-09 in New York (21:30 EST/EDT).
    expect(toLocalDate(new Date('2026-03-10T02:30:00Z'))).toBe('2026-03-09');
  });

  it('zero-pads month and day', () => {
    expect(toLocalDate(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });
});

/* ---------- ACCEPTANCE TEST 11: local date at midnight ---------- */

describe('acceptance 11 — local date at midnight', () => {
  it('23:58 and 00:02 local land on different localDate values', () => {
    const before = new Date(2026, 4, 20, 23, 58, 0); // May 20 23:58 local
    const after = new Date(2026, 4, 21, 0, 2, 0);    // May 21 00:02 local

    expect(toLocalDate(before)).toBe('2026-05-20');
    expect(toLocalDate(after)).toBe('2026-05-21');
    expect(toLocalDate(before)).not.toBe(toLocalDate(after));
  });

  it('holds on the spring-forward night too', () => {
    const before = new Date(2026, 2, 7, 23, 58, 0);
    const after = new Date(2026, 2, 8, 0, 2, 0);
    expect(toLocalDate(before)).toBe('2026-03-07');
    expect(toLocalDate(after)).toBe('2026-03-08');
  });

  it('a session logged just before midnight does not count as the next day', () => {
    const now = new Date(2026, 4, 21, 9, 0, 0); // morning of the 21st
    expect(isWithinLast(1, '2026-05-20', now)).toBe(false); // yesterday
    expect(isWithinLast(1, '2026-05-21', now)).toBe(true);  // today
    expect(isWithinLast(2, '2026-05-20', now)).toBe(true);
  });
});

/* ---------- ACCEPTANCE TEST 10: local date across DST ---------- */

describe('acceptance 10 — DST boundaries', () => {
  it('spring forward: 28 days back yields 28 distinct calendar days', () => {
    const now = new Date(2026, 2, 20, 12, 0, 0); // Mar 20, window covers Mar 8
    const days = lastNLocalDates(28, now);
    expect(days).toHaveLength(28);
    expect(new Set(days).size).toBe(28); // no duplicated or skipped day
    expect(days[27]).toBe('2026-03-20');
    expect(days[0]).toBe('2026-02-21');
    expect(days).toContain('2026-03-08'); // the 23-hour day
  });

  it('fall back: 28 days back yields 28 distinct calendar days', () => {
    const now = new Date(2026, 10, 10, 12, 0, 0); // Nov 10, window covers Nov 1
    const days = lastNLocalDates(28, now);
    expect(days).toHaveLength(28);
    expect(new Set(days).size).toBe(28);
    expect(days[27]).toBe('2026-11-10');
    expect(days[0]).toBe('2026-10-14');
    expect(days).toContain('2026-11-01'); // the 25-hour day
  });

  it('daysAgoLocal is exact across the spring-forward 23-hour day', () => {
    const now = new Date(2026, 2, 9, 12, 0, 0); // Mar 9, day after DST
    expect(daysAgoLocal(0, now)).toBe('2026-03-09');
    expect(daysAgoLocal(1, now)).toBe('2026-03-08');
    expect(daysAgoLocal(2, now)).toBe('2026-03-07');
  });

  it('daysAgoLocal is exact across the fall-back 25-hour day', () => {
    const now = new Date(2026, 10, 2, 12, 0, 0); // Nov 2, day after DST
    expect(daysAgoLocal(0, now)).toBe('2026-11-02');
    expect(daysAgoLocal(1, now)).toBe('2026-11-01');
    expect(daysAgoLocal(2, now)).toBe('2026-10-31');
  });

  it('a naive epoch-subtraction window would disagree — proving the guard works', () => {
    // The bug this module prevents: subtracting n * 86_400_000 ms assumes every
    // day is 24 hours. When a DST transition falls inside the window, the result
    // drifts by an hour — which silently changes the CALENDAR DAY whenever the
    // clock is within that hour of midnight. Logging a session at 00:30 is
    // ordinary, so this is a real failure mode, not a contrived one.
    //
    // (At midday the same drift is invisible, which is exactly why this bug
    // survives casual testing and needs a regression test pinned to it.)
    const now = new Date(2026, 2, 20, 0, 30, 0); // Mar 20, 00:30 EDT
    const naive = new Date(now.getTime() - 27 * 86_400_000);

    expect(daysAgoLocal(27, now)).toBe('2026-02-21'); // correct calendar day
    expect(toLocalDate(naive)).toBe('2026-02-20');    // an hour short → prior day
    expect(toLocalDate(naive)).not.toBe(daysAgoLocal(27, now));
  });

  it('the 28-day window is stable regardless of time of day', () => {
    // Same calendar day, different clock times, crossing a DST boundary:
    // the window must not move.
    const early = new Date(2026, 2, 20, 0, 30, 0);
    const late = new Date(2026, 2, 20, 23, 30, 0);
    expect(lastNLocalDates(28, early)).toEqual(lastNLocalDates(28, late));
  });

  it('isWithinLast honours the DST-crossing boundary exactly', () => {
    const now = new Date(2026, 2, 20, 12, 0, 0);
    expect(isWithinLast(28, '2026-02-21', now)).toBe(true);  // oldest in window
    expect(isWithinLast(28, '2026-02-20', now)).toBe(false); // one day too old
    expect(isWithinLast(28, '2026-03-20', now)).toBe(true);  // today
    expect(isWithinLast(28, '2026-03-21', now)).toBe(false); // future
  });
});

describe('isWithinLast', () => {
  it('window is inclusive of today and spans exactly n days', () => {
    const now = new Date(2026, 5, 15, 8, 0, 0);
    expect(isWithinLast(1, '2026-06-15', now)).toBe(true);
    expect(isWithinLast(1, '2026-06-14', now)).toBe(false);
    expect(isWithinLast(7, '2026-06-09', now)).toBe(true);
    expect(isWithinLast(7, '2026-06-08', now)).toBe(false);
  });

  it('rejects non-positive windows', () => {
    const now = new Date(2026, 5, 15);
    expect(isWithinLast(0, '2026-06-15', now)).toBe(false);
    expect(isWithinLast(-3, '2026-06-15', now)).toBe(false);
  });
});

describe('daysBetweenLocal', () => {
  it('counts whole calendar days across DST', () => {
    expect(daysBetweenLocal('2026-03-07', '2026-03-09')).toBe(2); // 23-hour day
    expect(daysBetweenLocal('2026-10-31', '2026-11-02')).toBe(2); // 25-hour day
  });

  it('is negative when the target is earlier', () => {
    expect(daysBetweenLocal('2026-03-09', '2026-03-07')).toBe(-2);
  });
});

describe('parseLocalDate / isValidLocalDate', () => {
  it('round-trips', () => {
    expect(toLocalDate(parseLocalDate('2026-11-01'))).toBe('2026-11-01');
  });

  it('rejects malformed and impossible dates', () => {
    expect(isValidLocalDate('2026-2-01')).toBe(false);
    expect(isValidLocalDate('not-a-date')).toBe(false);
    expect(isValidLocalDate('2026-02-30')).toBe(false); // rolls into March
    expect(isValidLocalDate('2026-02-28')).toBe(true);
  });

  it('throws on malformed input', () => {
    expect(() => parseLocalDate('2026/01/01')).toThrow(/Malformed/);
  });
});
