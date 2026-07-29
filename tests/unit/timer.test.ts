import { describe, expect, it } from 'vitest';
import {
  RESUME_STALE_HOURS,
  applyAdjustment,
  classifyResume,
  elapsedFraction,
  formatMMSS,
  hoursSince,
  isComplete,
  remainingSec,
} from '../../src/engine/timer';

const T0 = 1_800_000_000_000; // fixed epoch; nothing here reads a real clock

/* ---------- TEST 1: the backgrounding case ---------- */

describe('1 — remainingSec across a simulated clock jump', () => {
  it('is correct after a 5-minute jump, as if backgrounded', () => {
    // 3-minute rest. The app is frozen for 5 minutes; no tick ever fires.
    const rest = 180;
    expect(remainingSec(T0, rest, T0, 0)).toBe(180);

    // 5 minutes later the interval is long over — and we know that purely from
    // the timestamps, which is the whole point.
    expect(remainingSec(T0, rest, T0 + 300_000, 0)).toBe(0);
  });

  it('a jump partway through reports the true remainder, not a tick count', () => {
    const rest = 180;
    // Backgrounded at 10s, returned at 130s: 50s should be left.
    expect(remainingSec(T0, rest, T0 + 130_000, 0)).toBe(50);
  });

  it('is identical whether or not intermediate ticks happened', () => {
    const rest = 300;
    const direct = remainingSec(T0, rest, T0 + 200_000, 0);

    // Simulate a tick-by-tick observer that was frozen for most of the window:
    // it can only ever recompute from the same two timestamps.
    let observed = 0;
    for (const t of [T0 + 1000, T0 + 2000, T0 + 200_000]) {
      observed = remainingSec(T0, rest, t, 0);
    }
    expect(observed).toBe(direct);
    expect(direct).toBe(100);
  });

  it('survives a multi-hour freeze without going strange', () => {
    expect(remainingSec(T0, 180, T0 + 6 * 3_600_000, 0)).toBe(0);
  });
});

/* ---------- TEST 2: adjustments ---------- */

describe('2 — +30s / −30s adjustments', () => {
  it('extends the interval by the adjustment', () => {
    expect(remainingSec(T0, 180, T0, 30)).toBe(210);
    expect(remainingSec(T0, 180, T0 + 60_000, 30)).toBe(150);
  });

  it('shortens the interval by a negative adjustment', () => {
    expect(remainingSec(T0, 180, T0, -30)).toBe(150);
    expect(remainingSec(T0, 180, T0 + 60_000, -30)).toBe(90);
  });

  it('accumulates repeated taps', () => {
    let adj = 0;
    adj = applyAdjustment(180, adj, 30);
    adj = applyAdjustment(180, adj, 30);
    adj = applyAdjustment(180, adj, -30);
    expect(adj).toBe(30);
    expect(remainingSec(T0, 180, T0, adj)).toBe(210);
  });

  it('cannot be shortened below a zero-length interval', () => {
    // -30s on a 20s rest lands at 0, never at -10.
    const adj = applyAdjustment(20, 0, -30);
    expect(adj).toBe(-20);
    expect(remainingSec(T0, 20, T0, adj)).toBe(0);
  });

  it('an adjustment applied after the interval ended still reads 0', () => {
    expect(remainingSec(T0, 180, T0 + 400_000, -30)).toBe(0);
  });
});

/* ---------- TEST 3: clamping ---------- */

describe('3 — never negative', () => {
  it.each([0, 1, 60, 3600, 86_400])('clamps at 0 after %ss overrun', (over) => {
    expect(remainingSec(T0, 180, T0 + (180 + over) * 1000, 0)).toBe(0);
  });

  it('returns 0 rather than NaN for malformed input', () => {
    expect(remainingSec(Number.NaN, 180, T0, 0)).toBe(0);
    expect(remainingSec(T0, Number.NaN, T0, 0)).toBe(0);
    expect(remainingSec(T0, 180, Number.NaN, 0)).toBe(0);
  });

  it('handles a clock that moved backwards without exceeding the interval', () => {
    // NTP correction or a manual clock change: never report more than the
    // interval itself.
    expect(remainingSec(T0, 180, T0 - 60_000, 0)).toBe(240);
    expect(isComplete(T0, 180, T0 - 60_000, 0)).toBe(false);
  });

  it('a zero or negative duration is immediately complete', () => {
    expect(remainingSec(T0, 0, T0, 0)).toBe(0);
    expect(isComplete(T0, 0, T0, 0)).toBe(true);
  });
});

describe('elapsedFraction', () => {
  it('runs 0 → 1 and clamps at both ends', () => {
    expect(elapsedFraction(T0, 180, T0, 0)).toBe(0);
    expect(elapsedFraction(T0, 180, T0 + 90_000, 0)).toBeCloseTo(0.5, 5);
    expect(elapsedFraction(T0, 180, T0 + 999_000, 0)).toBe(1);
    expect(elapsedFraction(T0, 180, T0 - 999_000, 0)).toBe(0);
  });

  it('treats a zero-length interval as finished', () => {
    expect(elapsedFraction(T0, 0, T0, 0)).toBe(1);
  });
});

describe('formatMMSS', () => {
  it.each([
    [0, '0:00'], [5, '0:05'], [59, '0:59'], [60, '1:00'],
    [90, '1:30'], [180, '3:00'], [600, '10:00'],
  ])('%ss -> %s', (sec, expected) => {
    expect(formatMMSS(sec)).toBe(expected);
  });

  it('never renders a negative clock', () => {
    expect(formatMMSS(-30)).toBe('0:00');
  });
});

/* ---------- TEST 4: resume classification ---------- */

describe('4 — resume classification', () => {
  it('11 hours takes the fresh path', () => {
    expect(classifyResume(T0, T0 + 11 * 3_600_000)).toBe('fresh');
  });

  it('13 hours takes the stale path', () => {
    expect(classifyResume(T0, T0 + 13 * 3_600_000)).toBe('stale');
  });

  it('the boundary is exactly 12 hours, stale-inclusive', () => {
    const almost = T0 + RESUME_STALE_HOURS * 3_600_000 - 1000;
    const exact = T0 + RESUME_STALE_HOURS * 3_600_000;
    expect(classifyResume(T0, almost)).toBe('fresh');
    expect(classifyResume(T0, exact)).toBe('stale');
  });

  it('a session started seconds ago is fresh', () => {
    expect(classifyResume(T0, T0 + 5000)).toBe('fresh');
  });

  it('reports hours elapsed for the sheet copy', () => {
    expect(hoursSince(T0, T0 + 90 * 60_000)).toBeCloseTo(1.5, 5);
  });
});
