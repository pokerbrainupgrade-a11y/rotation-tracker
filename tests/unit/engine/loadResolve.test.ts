import { describe, expect, it } from 'vitest';
import {
  STALE_MAX_DAYS,
  maxAge,
  plateDeltaLine,
  plateLine,
  resolveLoad,
} from '../../../src/engine/loadResolve';
import { DELOAD_TABLE, isDeloadPosition, resolveDose } from '../../../src/engine/blocks';
import { resolveCompression } from '../../../src/engine/compression';
import type {
  Block, Exercise, LoadSpec, MaxRecord, Profile, SessionTemplate,
} from '../../../src/types';

const RX = {
  sets: 4, reps: 3, perSide: false, restSec: 180,
  restPurpose: 'x', intent: 'x', terminationRule: 'x',
  source: 'x', regression: 'x', progression: 'x',
  decayFloorFactor: null, decayMetric: null,
} as const;

const spec = (over: Partial<LoadSpec>): LoadSpec => ({
  type: 'bodyweight', pctLow: null, pctHigh: null, velocityTarget: null,
  rpeTarget: null, rirTarget: null, fixedLow: null, fixedHigh: null,
  hrPctLow: null, hrPctHigh: null, ...over,
});

const ex = (over: Partial<Exercise>): Exercise => ({
  id: 'ex.x', name: 'X', liftRef: null, tags: [], maxIntent: false,
  ...RX, load: spec({}), deloadElement: 'grind', ...over,
});

const profile: Pick<Profile, 'units' | 'hrMax' | 'barWeight' | 'plateInventory'> = {
  units: 'lb', hrMax: 190, barWeight: 45,
  plateInventory: [45, 45, 45, 25, 10, 10, 5, 2.5],
};

const max = (over: Partial<MaxRecord> = {}): MaxRecord => ({
  liftId: 'lift.squat', e1rm: 300, unit: 'lb', testedOn: '2026-06-01',
  method: 'tested', ...over,
});

/* ---------- TEST 1 ---------- */

describe('1 — pct1rm resolves the midpoint, rounded to the bar increment', () => {
  it('rounds to 5 lb', () => {
    // 300 * 85% = 255, already on a 5 lb boundary.
    const out = resolveLoad(
      ex({ liftRef: 'lift.squat', load: spec({ type: 'pct1rm', pctLow: 82, pctHigh: 88 }) }),
      profile, [max()],
    );
    expect(out.target).toBe(255);
    expect(out.primary).toBe('255 LB');
    expect(out.secondary).toBe('82–88%');
  });

  it('rounds to 2.5 kg', () => {
    const out = resolveLoad(
      ex({ liftRef: 'lift.squat', load: spec({ type: 'pct1rm', pctLow: 82, pctHigh: 88 }) }),
      { ...profile, units: 'kg', barWeight: 20, plateInventory: [25, 20, 15, 10, 5, 2.5, 1.25] },
      [max({ e1rm: 140, unit: 'kg' })],
    );
    // 140 * 85% = 119 -> nearest 2.5 = 120
    expect(out.target).toBe(120);
    expect(out.primary).toBe('120 KG');
  });

  it('velocity shows the m/s floor primary and the weight secondary', () => {
    const out = resolveLoad(
      ex({
        liftRef: 'lift.squat',
        load: spec({ type: 'velocity', pctLow: 78, pctHigh: 82, velocityTarget: 0.35 }),
      }),
      profile, [max()],
    );
    expect(out.primary).toBe('≥0.35 m/s');
    expect(out.secondary).toContain('78–82%');
    expect(out.secondary).toContain('LB');
    expect(out.plates).not.toBeNull();
  });

  it('fixed comes from the seed with no computation', () => {
    const out = resolveLoad(
      ex({ load: spec({ type: 'fixed', fixedLow: 8, fixedHigh: 12 }) }), profile, [],
    );
    expect(out.primary).toBe('8–12 LB');
    expect(out.plates).toBeNull();
  });

  it('bodyweight resolves to nothing at all', () => {
    const out = resolveLoad(ex({ load: spec({ type: 'bodyweight' }) }), profile, []);
    expect(out.primary).toBeNull();
    expect(out.secondary).toBeNull();
  });
});

/* ---------- TEST 2 ---------- */

describe('2 — hr resolves to a bpm range from profile.hrMax', () => {
  it('computes real bpm, not just percentages', () => {
    const out = resolveLoad(
      ex({ load: spec({ type: 'hr', hrPctLow: 90, hrPctHigh: 95 }) }), profile, [],
    );
    // 190 * 90% = 171; 190 * 95% = 180.5 -> 181 (rounded)
    expect(out.primary).toBe('171–181 BPM');
    expect(out.secondary).toBe('90–95% HRmax');
  });

  it('scales with a different HRmax', () => {
    const out = resolveLoad(
      ex({ load: spec({ type: 'hr', hrPctLow: 90, hrPctHigh: 95 }) }),
      { ...profile, hrMax: 200 }, [],
    );
    expect(out.primary).toBe('180–190 BPM');
  });

  it('falls back to the percentage band when HRmax is unknown', () => {
    const out = resolveLoad(
      ex({ load: spec({ type: 'hr', hrPctLow: 90, hrPctHigh: 95 }) }),
      { ...profile, hrMax: null }, [],
    );
    expect(out.primary).toBeNull();
    expect(out.secondary).toBe('90–95% HRmax');
  });
});

/* ---------- TEST 3 ---------- */

describe('3 — rpe renders no computed weight', () => {
  it('shows RPE and RIR only', () => {
    const out = resolveLoad(
      ex({
        liftRef: 'lift.squat',
        load: spec({ type: 'rpe', rpeTarget: 8, rirTarget: 2 }),
      }),
      profile, [max()],
    );
    expect(out.primary).toBe('RPE 8');
    expect(out.secondary).toBe('2 RIR');
    // Even with a max available, no weight is computed.
    expect(out.target).toBeNull();
    expect(out.plates).toBeNull();
  });

  it('omits RIR when the seed does not specify one', () => {
    const out = resolveLoad(
      ex({ load: spec({ type: 'rpe', rpeTarget: 9 }) }), profile, [],
    );
    expect(out.primary).toBe('RPE 9');
    expect(out.secondary).toBeNull();
  });
});

/* ---------- TEST 4 ---------- */

describe('4 — an untested liftRef yields null, never 0 or a fabrication', () => {
  it('flags needsMax and computes nothing', () => {
    const out = resolveLoad(
      ex({ liftRef: 'lift.squat', load: spec({ type: 'pct1rm', pctLow: 82, pctHigh: 88 }) }),
      profile, [], // no maxes at all
    );
    expect(out.needsMax).toBe(true);
    expect(out.missingLiftId).toBe('lift.squat');
    expect(out.primary).toBeNull();
    expect(out.target).toBeNull();
    expect(out.plates).toBeNull();
    // The percentage band still shows — it is real program data.
    expect(out.secondary).toBe('82–88%');
  });

  it('treats a zero or nonsense e1rm as untested rather than computing from it', () => {
    for (const e1rm of [0, -100, Number.NaN]) {
      const out = resolveLoad(
        ex({ liftRef: 'lift.squat', load: spec({ type: 'pct1rm', pctLow: 80, pctHigh: 80 }) }),
        profile, [max({ e1rm })],
      );
      expect(out.needsMax).toBe(true);
      expect(out.target).toBeNull();
    }
  });

  it('does not flag when the max exists', () => {
    const out = resolveLoad(
      ex({ liftRef: 'lift.squat', load: spec({ type: 'pct1rm', pctLow: 80, pctHigh: 80 }) }),
      profile, [max()],
    );
    expect(out.needsMax).toBe(false);
    expect(out.missingLiftId).toBeNull();
  });
});

/* ---------- TEST 5 & 6 ---------- */

describe('5 — an unreachable target reports a non-zero delta', () => {
  it('flags the shortfall rather than silently returning the nearest load', () => {
    // Only 45s available: 45 + 2*45 = 135, 45 + 4*45 = 225.
    const out = resolveLoad(
      ex({ liftRef: 'lift.squat', load: spec({ type: 'pct1rm', pctLow: 60, pctHigh: 60 }) }),
      { ...profile, plateInventory: [45, 45] },
      [max({ e1rm: 300 })], // 60% of 300 = 180
    );
    expect(out.target).toBe(180);
    expect(out.plates?.exact).toBe(false);
    expect(out.plates?.delta).not.toBe(0);

    const line = plateDeltaLine(out.plates!, out.target!, 'lb');
    expect(line).toContain('TARGET 180');
    expect(line).toMatch(/[+−]/);
  });

  it('renders no delta line when the target is hit exactly', () => {
    const out = resolveLoad(
      ex({ liftRef: 'lift.squat', load: spec({ type: 'pct1rm', pctLow: 75, pctHigh: 75 }) }),
      profile, [max({ e1rm: 300 })], // 225 exactly
    );
    expect(out.plates?.exact).toBe(true);
    expect(plateDeltaLine(out.plates!, out.target!, 'lb')).toBeNull();
  });
});

describe('6 — plate math across the default lb and kg inventories', () => {
  it('lb: 45 bar, 315 target', () => {
    const out = resolveLoad(
      ex({ liftRef: 'lift.squat', load: spec({ type: 'pct1rm', pctLow: 90, pctHigh: 90 }) }),
      profile, [max({ e1rm: 350 })], // 315
    );
    expect(out.target).toBe(315);
    expect(out.plates?.perSide).toEqual([45, 45, 45]);
    expect(plateLine(out.plates!, 45)).toBe('BAR 45  +  45 · 45 · 45');
  });

  it('kg: 20 bar, 100 target', () => {
    const kg = {
      units: 'kg' as const, hrMax: 190, barWeight: 20,
      plateInventory: [25, 20, 20, 15, 10, 5, 2.5, 1.25],
    };
    const out = resolveLoad(
      ex({ liftRef: 'lift.squat', load: spec({ type: 'pct1rm', pctLow: 100, pctHigh: 100 }) }),
      kg, [max({ e1rm: 100, unit: 'kg' })],
    );
    expect(out.target).toBe(100);
    expect(out.plates?.achieved).toBe(100);
    expect(out.plates?.exact).toBe(true);
  });

  it('a target below the bar returns the bar with a positive delta', () => {
    const out = resolveLoad(
      ex({ liftRef: 'lift.squat', load: spec({ type: 'pct1rm', pctLow: 10, pctHigh: 10 }) }),
      profile, [max({ e1rm: 200 })], // 20 lb, below a 45 lb bar
    );
    expect(out.plates?.achieved).toBe(45);
    expect(out.plates?.exact).toBe(false);
    expect(plateLine(out.plates!, 45)).toBe('BAR 45');
  });
});

/* ---------- TEST 7 ---------- */

describe('7 — max staleness boundary at 60 days', () => {
  const now = new Date(2026, 7, 1); // 2026-08-01

  it('is not stale at exactly 60 days', () => {
    const age = maxAge({ testedOn: '2026-06-02', method: 'tested' }, now);
    expect(age.days).toBe(60);
    expect(age.stale).toBe(false);
  });

  it('is stale at 61 days', () => {
    const age = maxAge({ testedOn: '2026-06-01', method: 'tested' }, now);
    expect(age.days).toBe(61);
    expect(age.stale).toBe(true);
  });

  it('labels the method and the age', () => {
    expect(maxAge({ testedOn: '2026-07-29', method: 'tested' }, now).label)
      .toBe('TESTED 3 DAYS AGO');
    expect(maxAge({ testedOn: '2026-07-31', method: 'estimated' }, now).label)
      .toBe('ESTIMATED 1 DAY AGO');
  });

  it('handles a max tested today', () => {
    const age = maxAge({ testedOn: '2026-08-01', method: 'tested' }, now);
    expect(age.days).toBe(0);
    expect(age.stale).toBe(false);
  });

  it('uses the documented threshold constant', () => {
    expect(STALE_MAX_DAYS).toBe(60);
  });
});

/* ---------- TEST 8 ---------- */

const block = (over: Partial<Block> = {}): Block => ({
  id: 'block.a', name: 'Accumulation', weeks: 4,
  deloadRotation: 4, multipliers: { volume: 1, intensity: 1 },
  floors: {
    velocityFull: { floor: 4, ceiling: null },
    velocityPrime: { floor: 6, ceiling: null },
    vo2max: { floor: 4, ceiling: 6 },
    zone2Min: { floor: 180, ceiling: null },
    trainingDays: { floor: 16, ceiling: 22 },
  },
  ...over,
});

describe('8 — deload-position detection matches block.deloadRotation', () => {
  it('is true only on the block’s programmed rotation', () => {
    expect(isDeloadPosition(block({ deloadRotation: 4 }), 4)).toBe(true);
    expect(isDeloadPosition(block({ deloadRotation: 4 }), 3)).toBe(false);
    expect(isDeloadPosition(block({ deloadRotation: 4 }), 5)).toBe(false);
  });

  it('follows the block, not a constant', () => {
    expect(isDeloadPosition(block({ deloadRotation: 2 }), 2)).toBe(true);
    expect(isDeloadPosition(block({ deloadRotation: 2 }), 4)).toBe(false);
  });

  it('returns a boolean and nothing else — it applies nothing', () => {
    expect(typeof isDeloadPosition(block(), 4)).toBe('boolean');
  });

  it('is false when the block defines no deload rotation', () => {
    expect(isDeloadPosition({ ...block(), deloadRotation: undefined as never }, 4)).toBe(false);
  });
});

/* ---------- TEST 9 ---------- */

const template = (): SessionTemplate => ({
  id: 'tmpl.t', name: 'T', position: 'TD1',
  sections: [{
    id: 's', label: 'S', role: 'power',
    exerciseIds: ['ex.throw', 'ex.grind'], primeExerciseId: 'ex.throw',
  }],
  ledger: {},
  compression: { '50': { cut: ['ex.grind'] }, '25': { keepOnly: ['ex.throw'] } },
  compressionRule: 'r', volumeCap: null,
});

describe('9 — resolution order is block → deload → compression', () => {
  const throwEx = ex({ id: 'ex.throw', sets: 4, reps: 6, deloadElement: 'maxIntentThrow' });
  const grindEx = ex({ id: 'ex.grind', sets: 5, reps: 10, deloadElement: 'grind' });
  const none = resolveCompression(template(), 100);

  it('applies block multipliers first', () => {
    const doubled = block({ multipliers: { volume: 2, intensity: 1 } });
    const out = resolveDose(throwEx, doubled, false, none);
    expect(out.sets).toBe(8);
    expect(out.applied[0]).toMatch(/^block /);
  });

  it('applies the deload after the block multiplier, not before', () => {
    // volume x0.5 -> 2 sets; ballistic deload halves sets again -> 1.
    const halved = block({ multipliers: { volume: 0.5, intensity: 1 } });
    const ballistic = ex({ id: 'ex.b', sets: 4, reps: 3, deloadElement: 'ballistic' });
    const out = resolveDose(ballistic, halved, true, none);
    expect(out.sets).toBe(1);
    expect(out.applied[0]).toMatch(/^block /);
    expect(out.applied[1]).toMatch(/^deload/);
  });

  it('applies compression last, and it wins outright', () => {
    const out = resolveDose(grindEx, block(), true, resolveCompression(template(), 25));
    expect(out.cut).toBe(true);
    expect(out.applied[out.applied.length - 1]).toMatch(/^compression/);
  });

  it('records the three steps in order when all three apply', () => {
    const out = resolveDose(
      grindEx,
      block({ multipliers: { volume: 1.5, intensity: 0.9 } }),
      true,
      resolveCompression(template(), 50),
    );
    expect(out.applied.map((a) => a.split(' ')[0])).toEqual([
      'block', 'deload:', 'compression',
    ]);
  });

  it('a compression modify string overrides the computed label', () => {
    const t = template();
    t.compression['75'] = { modify: { 'ex.grind': '2 × 5' } };
    const out = resolveDose(grindEx, block(), false, resolveCompression(t, 75));
    expect(out.label).toBe('2 × 5');
  });
});

describe('the deload treatment table', () => {
  it('halves throw volume and leaves intent and load alone', () => {
    const t = DELOAD_TABLE.maxIntentThrow;
    expect(t.volumeFactor).toBe(0.5);
    expect(t.loadChanges).toBe(false);
    expect(t.topSetCap).toBe(1);

    const out = resolveDose(
      ex({ sets: 4, reps: 6, deloadElement: 'maxIntentThrow' }),
      block(), true, resolveCompression(template(), 100),
    );
    expect(out.sets).toBe(4);   // sets unchanged
    expect(out.reps).toBe(3);   // volume halved
    expect(out.topSetCap).toBe(1);
  });

  it('caps a grind top set at 80% and takes volume to 60%', () => {
    const out = resolveDose(
      ex({ sets: 5, reps: 10, deloadElement: 'grind' }),
      block(), true, resolveCompression(template(), 100),
    );
    expect(out.reps).toBe(6);
    expect(out.topSetCap).toBe(0.8);
  });

  it('halves ballistic sets and leaves load unchanged', () => {
    const out = resolveDose(
      ex({ sets: 4, reps: 3, deloadElement: 'ballistic' }),
      block(), true, resolveCompression(template(), 100),
    );
    expect(out.sets).toBe(2);
    expect(out.reps).toBe(3);
    expect(DELOAD_TABLE.ballistic.loadChanges).toBe(false);
  });

  it('halves plyo contacts', () => {
    const out = resolveDose(
      ex({ sets: 4, reps: 20, deloadElement: 'plyo' }),
      block(), true, resolveCompression(template(), 100),
    );
    expect(out.contacts).toBe(10);
  });

  it('takes VO2max to 3 x 4', () => {
    const out = resolveDose(
      ex({ sets: 4, reps: 4, deloadElement: 'vo2max' }),
      block(), true, resolveCompression(template(), 100),
    );
    expect(out.sets).toBe(3);
    expect(out.reps).toBe(4);
  });

  it('leaves Zone 2 and Recovery Days unchanged', () => {
    for (const element of ['zone2', 'recovery'] as const) {
      const out = resolveDose(
        ex({ sets: 3, reps: 30, deloadElement: element }),
        block(), true, resolveCompression(template(), 100),
      );
      expect(out.sets).toBe(3);
      expect(out.reps).toBe(30);
      expect(out.deloaded).toBe(false);
    }
  });

  it('changes nothing at all when deload is off', () => {
    const out = resolveDose(
      ex({ sets: 5, reps: 10, deloadElement: 'grind' }),
      block(), false, resolveCompression(template(), 100),
    );
    expect(out.sets).toBe(5);
    expect(out.reps).toBe(10);
    expect(out.deloaded).toBe(false);
    expect(out.topSetCap).toBe(1);
  });
});
