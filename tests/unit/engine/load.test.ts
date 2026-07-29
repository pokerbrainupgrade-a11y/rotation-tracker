import { describe, expect, it } from 'vitest';
import { platePlan, resolveTarget, roundToIncrement } from '../../../src/engine/load';

/* ---------- 27 ---------- */

describe('27 — rounding at increment boundaries', () => {
  it.each([
    [302, 300], [303, 305], [302.5, 305], [297.5, 300], [0, 0], [2.4, 0], [2.6, 5],
  ])('lb: %s -> %s', (input, expected) => {
    expect(roundToIncrement(input, 'lb')).toBe(expected);
  });

  it.each([
    [101, 100], [101.25, 102.5], [98.75, 100], [1.2, 0], [1.3, 2.5],
  ])('kg: %s -> %s', (input, expected) => {
    expect(roundToIncrement(input, 'kg')).toBe(expected);
  });

  it('rounds both directions from the same midpoint', () => {
    expect(roundToIncrement(102.4, 'lb')).toBe(100);
    expect(roundToIncrement(102.6, 'lb')).toBe(105);
  });

  it('is free of floating-point noise', () => {
    expect(roundToIncrement(0.1 + 0.2, 'kg')).toBe(0);
    expect(roundToIncrement(2.5000000001, 'kg')).toBe(2.5);
  });
});

describe('resolveTarget', () => {
  it('uses the range midpoint', () => {
    // 400 * 72.5% = 290 -> already on a 5 lb boundary
    expect(resolveTarget(400, 70, 75, 'lb').target).toBe(290);
  });

  it('rounds the midpoint to the bar increment', () => {
    // 405 * 72.5% = 293.625 -> 295
    expect(resolveTarget(405, 70, 75, 'lb').target).toBe(295);
    // 100 * 72.5% = 72.5 -> already on a 2.5 kg boundary
    expect(resolveTarget(100, 70, 75, 'kg').target).toBe(72.5);
  });

  it('labels the prescribed range, not the midpoint', () => {
    expect(resolveTarget(400, 70, 75, 'lb').pctLabel).toBe('70–75%');
  });

  it('labels a single percentage without a range', () => {
    expect(resolveTarget(400, 80, 80, 'lb').pctLabel).toBe('80%');
  });

  it('tolerates a reversed range', () => {
    expect(resolveTarget(400, 75, 70, 'lb')).toEqual(resolveTarget(400, 70, 75, 'lb'));
  });

  it('degrades to 0 for a missing or invalid e1rm rather than NaN', () => {
    expect(resolveTarget(0, 70, 75, 'lb').target).toBe(0);
    expect(resolveTarget(Number.NaN, 70, 75, 'lb').target).toBe(0);
    expect(resolveTarget(-100, 70, 75, 'lb').target).toBe(0);
  });
});

/* ---------- 28 ---------- */

describe('28 — plate math with a standard inventory', () => {
  const standard = [45, 45, 45, 25, 10, 10, 5, 2.5];

  it('hits 315 exactly on a 45 lb bar', () => {
    const p = platePlan(315, 45, standard, 'lb');
    expect(p.achieved).toBe(315);
    expect(p.delta).toBe(0);
    expect(p.exact).toBe(true);
    expect(p.perSide).toEqual([45, 45, 45]);
  });

  it('hits 225 exactly', () => {
    const p = platePlan(225, 45, standard, 'lb');
    expect(p.achieved).toBe(225);
    expect(p.exact).toBe(true);
    expect(p.perSide).toEqual([45, 45]);
  });

  it('hits the bar alone when the target is the bar', () => {
    const p = platePlan(45, 45, standard, 'lb');
    expect(p.perSide).toEqual([]);
    expect(p.achieved).toBe(45);
    expect(p.exact).toBe(true);
  });

  it('works in kg', () => {
    const kg = [20, 20, 15, 10, 5, 2.5, 1.25];
    const p = platePlan(100, 20, kg, 'kg');
    expect(p.achieved).toBe(100);
    expect(p.exact).toBe(true);
    expect(p.perSide).toEqual([20, 20]);
  });
});

/* ---------- 29 ---------- */

describe('29 — odd inventory returns the nearest achievable', () => {
  it('reports the nearest load with a signed delta and exact false', () => {
    // Only 45s: per-side options are 0, 45, 90 -> loads 45, 135, 225.
    // Per-side target is 70. Greedy alone stops at 135 (-50), but 225 is +40,
    // so the nearest achievable is the OVERSHOOT. Greedy-only would be wrong.
    const p = platePlan(185, 45, [45, 45], 'lb');
    expect(p.exact).toBe(false);
    expect(p.achieved).toBe(225);
    expect(p.delta).toBe(40);
    expect(p.perSide).toEqual([45, 45]);
  });

  it('stays under when under is nearer', () => {
    // Per-side target 47.5 -> 135 is -25, 225 is +65. Under wins.
    const p = platePlan(160, 45, [45, 45], 'lb');
    expect(p.achieved).toBe(135);
    expect(p.delta).toBe(-25);
  });

  it('overshoots when overshooting is nearer', () => {
    // per-side target 47.5; options 45 (-5 total) or 50 (+5) — tie, greedy wins.
    const p = platePlan(140, 45, [45, 5], 'lb');
    expect(p.achieved).toBe(135);
    expect(p.delta).toBe(-5);

    // per-side target 48; 45 is -6, 50 is +4 -> the overshoot is nearer.
    const q = platePlan(141, 45, [45, 5], 'lb');
    expect(q.achieved).toBe(145);
    expect(q.delta).toBe(4);
    expect(q.perSide).toEqual([45, 5]);
  });

  it('an empty inventory yields the bar alone', () => {
    const p = platePlan(225, 45, [], 'lb');
    expect(p.perSide).toEqual([]);
    expect(p.achieved).toBe(45);
    expect(p.delta).toBe(-180);
    expect(p.exact).toBe(false);
  });

  it('ignores nonsense entries in the inventory', () => {
    const p = platePlan(135, 45, [45, 0, -10, Number.NaN, 45], 'lb');
    expect(p.achieved).toBe(135);
    expect(p.exact).toBe(true);
  });

  it('never returns more plates than the inventory holds', () => {
    const p = platePlan(500, 45, [45, 25], 'lb');
    expect(p.perSide).toEqual([45, 25]);
    expect(p.achieved).toBe(185);
    expect(p.exact).toBe(false);
  });
});

/* ---------- 30 ---------- */

describe('30 — target below bar weight is handled, not thrown', () => {
  it('returns the bar with a positive delta', () => {
    const p = platePlan(30, 45, [45, 25, 10], 'lb');
    expect(() => platePlan(30, 45, [45], 'lb')).not.toThrow();
    expect(p.perSide).toEqual([]);
    expect(p.achieved).toBe(45);
    expect(p.delta).toBe(15);
    expect(p.exact).toBe(false);
  });

  it('handles a zero or negative target', () => {
    expect(platePlan(0, 45, [45], 'lb').achieved).toBe(45);
    expect(platePlan(-50, 45, [45], 'lb').achieved).toBe(45);
  });

  it('handles a non-finite target', () => {
    expect(() => platePlan(Number.NaN, 45, [45], 'lb')).not.toThrow();
    expect(platePlan(Number.NaN, 45, [45], 'lb').achieved).toBe(45);
  });

  it('handles a non-finite bar weight', () => {
    expect(() => platePlan(135, Number.NaN, [45], 'lb')).not.toThrow();
  });

  it('handles a non-array inventory', () => {
    expect(platePlan(135, 45, null as never, 'lb').achieved).toBe(45);
  });
});

describe('no progression logic exists in this module', () => {
  it('exports only resolution, rounding and plate math', async () => {
    const mod = await import('../../../src/engine/load');
    const fns = Object.keys(mod).filter((k) => typeof (mod as Record<string, unknown>)[k] === 'function');
    expect(fns.sort()).toEqual(['platePlan', 'resolveTarget', 'roundToIncrement']);
    expect(fns.join(' ')).not.toMatch(/progress|increase|bump|suggest|next/i);
  });
});
