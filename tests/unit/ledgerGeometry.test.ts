import { describe, expect, it } from 'vitest';
import { barGeometry, barMax, rowColor, subLabel } from '../../src/lib/ledgerGeometry';
import { SESSION_COLOR_VAR, sessionColor } from '../../src/lib/sessionColor';
import type { LedgerRow } from '../../src/engine/ledger';
import type { RotationPosition } from '../../src/types';

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  key: 'velocityFull',
  count: 5,
  missed: 0,
  floor: 5,
  ceiling: null,
  belowFloor: false,
  ...over,
});

/* ---------- TEST 1: bar geometry ---------- */

describe('1 — bar geometry for a known input set', () => {
  it('computes fill, floor tick and hatch from barMax', () => {
    // ceiling 6 -> barMax 6. count 3 -> 50%. floor 4 -> 66.67%. missed 2 -> 33.3%.
    const geo = barGeometry(row({ key: 'vo2max', count: 3, missed: 2, floor: 4, ceiling: 6 }));
    expect(geo.barMax).toBe(6);
    expect(geo.fillPct).toBeCloseTo(50, 5);
    expect(geo.floorPct).toBeCloseTo(66.6667, 3);
    expect(geo.hatchPct).toBeCloseTo(33.3333, 3);
  });

  it('the hatch continues past the fill without overflowing the track', () => {
    // fill 80% + raw hatch 40% would be 120%; the hatch is clipped to 20%.
    const geo = barGeometry(row({ count: 8, missed: 4, floor: 5, ceiling: 10 }));
    expect(geo.fillPct).toBe(80);
    expect(geo.hatchPct).toBe(20);
    expect(geo.fillPct + geo.hatchPct).toBeLessThanOrEqual(100);
  });

  it('no hatch when nothing was missed', () => {
    expect(barGeometry(row({ missed: 0 })).hatchPct).toBe(0);
  });

  it('clamps a count above barMax to a full bar', () => {
    expect(barGeometry(row({ count: 99, floor: 5, ceiling: 10 })).fillPct).toBe(100);
  });

  it('a zero denominator yields zeroes, not NaN', () => {
    const geo = barGeometry(row({ count: 0, floor: 0, ceiling: null, missed: 0 }));
    expect(geo.barMax).toBe(0);
    expect(geo.fillPct).toBe(0);
    expect(geo.floorPct).toBe(0);
    expect(Number.isNaN(geo.fillPct)).toBe(false);
  });
});

/* ---------- TEST 2: barMax rule ---------- */

describe('2 — barMax when ceiling is null', () => {
  it('uses max(floor * 2, count)', () => {
    expect(barMax({ ceiling: null, floor: 5, count: 3 })).toBe(10);
    expect(barMax({ ceiling: null, floor: 5, count: 14 })).toBe(14);
    expect(barMax({ ceiling: null, floor: 0, count: 0 })).toBe(0);
  });

  it('prefers the ceiling when one is set', () => {
    expect(barMax({ ceiling: 6, floor: 5, count: 20 })).toBe(6);
  });

  it('a full bar at floor sits the tick at the halfway mark', () => {
    // floor*2 scaling means "at floor" is always the midpoint — a fixed,
    // readable reference rather than a scale that shifts with the count.
    const geo = barGeometry(row({ count: 5, floor: 5, ceiling: null }));
    expect(geo.floorPct).toBe(50);
    expect(geo.fillPct).toBe(50);
  });

  it('the scale does not move as the count changes', () => {
    const a = barGeometry(row({ count: 2, floor: 5, ceiling: null }));
    const b = barGeometry(row({ count: 7, floor: 5, ceiling: null }));
    expect(a.barMax).toBe(10);
    // Only once the count exceeds floor*2 does the bar have to grow.
    expect(b.barMax).toBe(10);
    expect(a.floorPct).toBe(b.floorPct);
  });
});

/* ---------- TEST 3: session colour ---------- */

describe('3 — sessionColor covers all seven positions', () => {
  it.each([
    ['TD1', '--velocity'],
    ['TD-A', '--velocity'],
    ['TD2', '--strength'],
    ['TD-B-STR', '--strength'],
    ['TD3', '--aerobic'],
    ['TD-B-ESD', '--aerobic'],
    ['RD', '--recovery'],
  ] as Array<[RotationPosition, string]>)('%s -> %s', (position, expected) => {
    expect(sessionColor(position)).toBe(`var(${expected})`);
    expect(SESSION_COLOR_VAR[position]).toBe(expected);
  });

  it('maps every position with no gaps', () => {
    expect(Object.keys(SESSION_COLOR_VAR)).toHaveLength(7);
  });

  it('never returns --brand — red is primary actions only', () => {
    for (const position of Object.keys(SESSION_COLOR_VAR) as RotationPosition[]) {
      expect(sessionColor(position)).not.toContain('--brand');
    }
  });

  it('falls back to recovery grey for an unknown position rather than throwing', () => {
    expect(sessionColor('NOPE' as RotationPosition)).toBe('var(--recovery)');
  });
});

/* ---------- TEST 4: below-floor state ---------- */

describe('4 — below floor flips count, fill and sub-label to --alert', () => {
  it('reports belowFloor through the geometry', () => {
    expect(barGeometry(row({ count: 3, floor: 5, belowFloor: true })).belowFloor).toBe(true);
  });

  it('replaces the sub-label with the shortfall', () => {
    expect(subLabel({ count: 3, floor: 5, belowFloor: true })).toBe('2 BELOW FLOOR');
  });

  it('shows count / floor when at or above floor', () => {
    expect(subLabel({ count: 5, floor: 5, belowFloor: false })).toBe('5 / floor 5');
  });

  it('row colours never use --brand or --alert as their resting colour', () => {
    for (const key of [
      'velocityFull', 'velocityPrime', 'vo2max', 'zone2Min', 'trainingDays',
    ] as const) {
      const c = rowColor(key);
      expect(c).not.toContain('--brand');
      expect(c).not.toContain('--alert');
    }
  });

  it('secondary rows are the 60% variants', () => {
    expect(rowColor('velocityPrime')).toBe('var(--velocity-60)');
    expect(rowColor('zone2Min')).toBe('var(--aerobic-60)');
  });
});
