import { describe, expect, it } from 'vitest';
import {
  RATIO_THRESHOLD_PCT,
  contralateralRatio,
  decayView,
  isBelowFloor,
  ratioColorVar,
  ratioLabel,
  ratioStatus,
  sessionTotals,
  volumeView,
} from '../../../src/engine/instrumentation';
import type { Exercise, SetLog, VolumeCap } from '../../../src/types';
import { setLog } from '../factories';

const RX = {
  sets: 4, reps: 3, perSide: false, restSec: 180,
  restPurpose: 'TEST', intent: 'i', terminationRule: 't',
  source: 's', regression: 'r', progression: 'p',
} as const;

const throwEx: Exercise = {
  id: 'ex.throw', name: 'Throw', liftRef: null, tags: [], maxIntent: true,
  ...RX, decayFloorFactor: 0.95, decayMetric: 'distance',
};

const squatEx: Exercise = {
  id: 'ex.squat', name: 'Squat', liftRef: 'lift.squat', tags: [], maxIntent: false,
  ...RX, decayFloorFactor: null, decayMetric: null,
};

const plyoEx: Exercise = {
  id: 'ex.plyo', name: 'Pogo', liftRef: null, tags: [], maxIntent: false,
  ...RX, decayFloorFactor: null, decayMetric: null,
};

const rep = (
  exerciseId: string, setIndex: number, distance: number | null, over: Partial<SetLog> = {},
): SetLog =>
  setLog({
    id: `${exerciseId}-${setIndex}-${distance ?? 'x'}-${Math.random()}`,
    exerciseId, setIndex, distance, load: null, reps: 1, completed: true, ...over,
  });

/* ---------- TEST 1 ---------- */

describe('1 — decay floor is current-set best x 0.95, and resets per set', () => {
  it('computes the floor from the best rep in this set', () => {
    // Set 0 best 24.1 -> floor 22.9 (24.1 * 0.95 = 22.895 -> 22.9)
    const logs = [rep('ex.throw', 0, 24.1), rep('ex.throw', 0, 23.4)];
    const view = decayView(throwEx, logs, 0);
    expect(view.setBest).toBe(24.1);
    expect(view.floor).toBe(22.9);
  });

  it('resets the floor on the next set rather than carrying the old best', () => {
    const logs = [
      rep('ex.throw', 0, 25.0), // strong first set
      rep('ex.throw', 1, 20.0), // weaker second set
    ];
    const set0 = decayView(throwEx, logs, 0);
    const set1 = decayView(throwEx, logs, 1);

    expect(set0.floor).toBe(23.8); // 25.0 * 0.95
    expect(set1.floor).toBe(19.0); // 20.0 * 0.95, NOT 23.8
    expect(set1.floor).toBeLessThan(set0.floor ?? 0);
  });

  it('returns nothing for an exercise with no decay rule', () => {
    const logs = [rep('ex.squat', 0, 100)];
    expect(decayView(squatEx, logs, 0)).toEqual({
      setBest: null, floor: null, sessionBest: null, belowFloorCount: 0,
    });
  });

  it('is empty before anything is logged', () => {
    expect(decayView(throwEx, [], 0).floor).toBeNull();
  });

  it('ignores reps with no metric recorded', () => {
    const logs = [rep('ex.throw', 0, null), rep('ex.throw', 0, 22.0)];
    expect(decayView(throwEx, logs, 0).setBest).toBe(22.0);
  });

  it('flags a rep below the floor without prescribing anything', () => {
    const logs = [rep('ex.throw', 0, 24.0), rep('ex.throw', 0, 21.0)];
    expect(isBelowFloor(throwEx, logs, 0)).toBe(true);
    // The return type is a boolean for styling — there is no action to take.
    expect(typeof isBelowFloor(throwEx, logs, 0)).toBe('boolean');
  });

  it('does not flag a set whose reps all hold above the floor', () => {
    const logs = [rep('ex.throw', 0, 24.0), rep('ex.throw', 0, 23.5)];
    expect(isBelowFloor(throwEx, logs, 0)).toBe(false);
  });
});

/* ---------- TEST 2 ---------- */

describe('2 — session best is tracked independently of set best', () => {
  it('keeps the session best from an earlier, better set', () => {
    const logs = [
      rep('ex.throw', 0, 25.0),
      rep('ex.throw', 1, 20.0),
      rep('ex.throw', 1, 19.0),
    ];
    const view = decayView(throwEx, logs, 1);
    expect(view.setBest).toBe(20.0);
    expect(view.sessionBest).toBe(25.0);
    expect(view.sessionBest).not.toBe(view.setBest);
  });

  it('session best does not lower the current set floor', () => {
    const logs = [rep('ex.throw', 0, 25.0), rep('ex.throw', 1, 20.0)];
    // Floor follows the SET, so it must be 19.0 even though 25.0 exists.
    expect(decayView(throwEx, logs, 1).floor).toBe(19.0);
  });

  it('set best equals session best on the first set', () => {
    const logs = [rep('ex.throw', 0, 24.0)];
    const view = decayView(throwEx, logs, 0);
    expect(view.setBest).toBe(view.sessionBest);
  });

  it('ignores other exercises when computing either best', () => {
    const logs = [rep('ex.throw', 0, 20.0), rep('ex.other', 0, 99.0)];
    expect(decayView(throwEx, logs, 0).sessionBest).toBe(20.0);
  });
});

/* ---------- TEST 5 ---------- */

describe('5 — volume cap counts only qualifying sets, per seed', () => {
  const cap: VolumeCap = {
    label: 'THROWS', limit: 36, countOf: 'maxIntent', section: 'power',
  };
  const exercises = [throwEx, squatEx, plyoEx];

  it('counts reps from max-intent exercises only', () => {
    const logs = [
      rep('ex.throw', 0, 20, { reps: 3 }),
      rep('ex.throw', 1, 20, { reps: 3 }),
      rep('ex.squat', 0, null, { reps: 5 }), // not max-intent: excluded
    ];
    const view = volumeView(cap, exercises, logs);
    expect(view.count).toBe(6);
    expect(view.label).toBe('THROWS');
    expect(view.limit).toBe(36);
    expect(view.atCap).toBe(false);
  });

  it('ignores incomplete sets', () => {
    const logs = [rep('ex.throw', 0, 20, { reps: 3, completed: false })];
    expect(volumeView(cap, exercises, logs).count).toBe(0);
  });

  it('goes to atCap at the limit and stays truthful past it', () => {
    const many = Array.from({ length: 13 }, (_, i) => rep('ex.throw', i, 20, { reps: 3 }));
    const view = volumeView(cap, exercises, many);
    expect(view.count).toBe(39);
    expect(view.atCap).toBe(true);
    // Nothing here can block: the view exposes no gate.
    expect(Object.keys(view).sort()).toEqual(['atCap', 'count', 'label', 'limit']);
  });

  it('reads the limit from the passed cap, not a constant', () => {
    const tighter: VolumeCap = { ...cap, limit: 6 };
    const logs = [rep('ex.throw', 0, 20, { reps: 3 }), rep('ex.throw', 1, 20, { reps: 3 })];
    expect(volumeView(tighter, exercises, logs).atCap).toBe(true);
    expect(volumeView(cap, exercises, logs).atCap).toBe(false);
  });

  it('counts prime sets when countOf is prime', () => {
    const primeCap: VolumeCap = {
      label: 'PRIME SETS', limit: 12, countOf: 'prime', section: 'strength',
    };
    const logs = [
      rep('ex.squat', 0, null, { reps: 3 }),
      rep('ex.throw', 0, 20, { reps: 3 }),
    ];
    expect(volumeView(primeCap, exercises, logs, ['ex.squat']).count).toBe(3);
  });

  it('counts contacts when countOf is contacts', () => {
    const contactCap: VolumeCap = {
      label: 'CONTACTS', limit: 90, countOf: 'contacts', section: 'plyo',
    };
    const logs = [
      rep('ex.plyo', 0, null, { contacts: 20, reps: 10 }),
      rep('ex.plyo', 1, null, { contacts: 20, reps: 10 }),
    ];
    expect(volumeView(contactCap, exercises, logs).count).toBe(40);
  });
});

/* ---------- TEST 3 ---------- */

describe('3 — contralateral ratio uses session means, not best reps', () => {
  it('averages across the session per side', () => {
    // L mean = (10 + 20) / 2 = 15; R mean = (20 + 20) / 2 = 20 -> 25%
    const logs = [
      rep('ex.uni', 0, null, { side: 'L', load: 10, reps: 1 }),
      rep('ex.uni', 1, null, { side: 'L', load: 20, reps: 1 }),
      rep('ex.uni', 0, null, { side: 'R', load: 20, reps: 1 }),
      rep('ex.uni', 1, null, { side: 'R', load: 20, reps: 1 }),
    ];
    expect(contralateralRatio(logs, 'ex.uni')).toBe(25);
  });

  it('differs from a best-rep ratio, which is the point', () => {
    const logs = [
      rep('ex.uni', 0, null, { side: 'L', load: 10, reps: 1 }),
      rep('ex.uni', 1, null, { side: 'L', load: 20, reps: 1 }),
      rep('ex.uni', 0, null, { side: 'R', load: 20, reps: 1 }),
      rep('ex.uni', 1, null, { side: 'R', load: 20, reps: 1 }),
    ];
    // Best-rep would be |20-20|/20 = 0%, hiding a real 25% mean asymmetry.
    expect(contralateralRatio(logs, 'ex.uni')).not.toBe(0);
  });

  it('is null when one side has nothing logged', () => {
    const logs = [rep('ex.uni', 0, null, { side: 'L', load: 10 })];
    expect(contralateralRatio(logs, 'ex.uni')).toBeNull();
  });

  it('is 0 for symmetric work', () => {
    const logs = [
      rep('ex.uni', 0, null, { side: 'L', load: 20, reps: 1 }),
      rep('ex.uni', 0, null, { side: 'R', load: 20, reps: 1 }),
    ];
    expect(contralateralRatio(logs, 'ex.uni')).toBe(0);
  });

  it('ignores incomplete sets and other exercises', () => {
    const logs = [
      rep('ex.uni', 0, null, { side: 'L', load: 20, reps: 1 }),
      rep('ex.uni', 0, null, { side: 'R', load: 20, reps: 1 }),
      rep('ex.uni', 1, null, { side: 'R', load: 99, reps: 1, completed: false }),
      rep('ex.other', 0, null, { side: 'R', load: 99, reps: 1 }),
    ];
    expect(contralateralRatio(logs, 'ex.uni')).toBe(0);
  });
});

/* ---------- TEST 4 ---------- */

describe('4 — ratio escalation only on two consecutive sessions', () => {
  it('a single excursion is watch, not flag', () => {
    const view = ratioStatus([4, 12.6]);
    expect(view.status).toBe('watch');
    expect(view.consecutive).toBe(1);
    expect(ratioColorVar(view.status)).toBe('--strength');
  });

  it('two consecutive excursions escalate to flag', () => {
    const view = ratioStatus([4, 11.2, 12.6]);
    expect(view.status).toBe('flag');
    expect(view.consecutive).toBe(2);
    expect(ratioColorVar(view.status)).toBe('--alert');
    expect(ratioLabel(view)).toBe('L/R Δ 12.6% · 2 SESSIONS');
  });

  it('a clean session between two bad ones resets the count', () => {
    const view = ratioStatus([12.0, 4.0, 12.6]);
    expect(view.consecutive).toBe(1);
    expect(view.status).toBe('watch');
  });

  it('stays ok below the threshold', () => {
    const view = ratioStatus([4.1]);
    expect(view.status).toBe('ok');
    expect(ratioColorVar('ok')).toBe('--text-dim');
    expect(ratioLabel(view)).toBe('L/R Δ 4.1%');
  });

  it('exactly at the threshold is not an excursion', () => {
    expect(ratioStatus([RATIO_THRESHOLD_PCT]).status).toBe('ok');
    expect(ratioStatus([RATIO_THRESHOLD_PCT + 0.1]).status).toBe('watch');
  });

  it('a missing session breaks the streak rather than extending it', () => {
    expect(ratioStatus([12.0, null, 12.6]).consecutive).toBe(1);
  });

  it('three consecutive still reads as a flag', () => {
    const view = ratioStatus([11, 12, 13]);
    expect(view.status).toBe('flag');
    expect(view.consecutive).toBe(3);
  });

  it('an empty history is ok and renders nothing', () => {
    const view = ratioStatus([]);
    expect(view.status).toBe('ok');
    expect(ratioLabel(view)).toBe('');
  });
});

/* ---------- totals ---------- */

describe('sessionTotals', () => {
  it('sums load x reps across completed sets', () => {
    const logs = [
      rep('ex.squat', 0, null, { load: 100, reps: 5 }),
      rep('ex.squat', 1, null, { load: 100, reps: 3 }),
      rep('ex.squat', 2, null, { load: 100, reps: 3, completed: false }),
    ];
    const totals = sessionTotals(logs, 10);
    expect(totals.setsCompleted).toBe(2);
    expect(totals.setsPrescribed).toBe(10);
    expect(totals.tonnage).toBe(800);
  });

  it('treats unloaded work as zero tonnage rather than NaN', () => {
    const logs = [rep('ex.throw', 0, 20, { load: null, reps: 3 })];
    expect(sessionTotals(logs, 4).tonnage).toBe(0);
  });
});
