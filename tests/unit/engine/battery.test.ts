import { afterEach, describe, expect, it } from 'vitest';
import {
  FULL_MARKER_ID,
  MINI_MARKER_ID,
  batteryCadence,
  chartTier,
  computeDelta,
  deltaColorVar,
  deltaLabel,
  progressionGate,
  ratioColorVar,
  ratioSeries,
  regressionFlags,
  seriesFor,
} from '../../../src/engine/battery';
import { evaluateConstraints } from '../../../src/engine/constraints';
import { closeDb } from '../../../src/data/db';
import { applySeed, ensureSeeded, programSeed } from '../../../src/data/seed';
import { SEED_VERSION, SCHEMA_VERSION, type ScheduledSession, type TestDef, type TestResult } from '../../../src/types';
import { seededDb, throughJson } from '../helpers';
import { session, testResult } from '../factories';

afterEach(async () => {
  await closeDb();
});

const def = (over: Partial<TestDef>): TestDef => ({
  id: 't', name: 'T', unit: 'cm', battery: 'full', bilateral: false,
  higherIsBetter: true, group: null, powerMetric: false, kind: 'numeric', ...over,
});

const res = (over: Partial<TestResult>): TestResult =>
  testResult({ id: `r-${Math.random()}`, ...over });

/* ---------- TEST 1: version separation ---------- */

describe('1 — a SEED_VERSION bump reseeds test definitions and keeps results', () => {
  it('replaces testDefs while every TestResult survives', async () => {
    const db = await seededDb();

    // Log results against the shipped definitions.
    const logged: TestResult[] = [
      res({ id: 'keep-1', testId: 't_cmj', value: 41.5, localDate: '2026-06-01' }),
      res({ id: 'keep-2', testId: 't_cmj', value: 43.0, localDate: '2026-07-01' }),
      res({ id: 'keep-3', testId: 'test.grip', value: 52, side: 'L', localDate: '2026-07-01' }),
    ];
    for (const r of logged) await db.put('tests', r);

    const before = await db.getAll('tests');
    expect(before).toHaveLength(3);
    const versionBefore = db.version;

    // Bump the seed and change a definition.
    const v3 = throughJson(programSeed);
    v3.seedVersion = SEED_VERSION + 1;
    const cmj = v3.testDefs.find((t) => t.id === 't_cmj');
    expect(cmj).toBeDefined();
    if (cmj) cmj.name = 'CMJ (renamed)';

    expect(await ensureSeeded(v3, SEED_VERSION + 1)).toBe(true);

    // Definitions replaced...
    expect((await db.get('testDefs', 't_cmj'))?.name).toBe('CMJ (renamed)');
    // ...results untouched, byte for byte.
    expect(await db.getAll('tests')).toEqual(before);
    // ...and no schema migration happened.
    expect(db.version).toBe(versionBefore);
    expect(db.version).toBe(SCHEMA_VERSION);
  });

  it('leaves every other user store alone too', async () => {
    const db = await seededDb();
    await db.put('scheduled', session({ id: 's-1' }));
    await db.put('tests', res({ id: 'r-1', testId: 't_cmj' }));

    const before = {
      scheduled: await db.getAll('scheduled'),
      tests: await db.getAll('tests'),
      profile: await db.get('profile', 'me'),
    };

    const v3 = throughJson(programSeed);
    v3.seedVersion = SEED_VERSION + 1;
    await ensureSeeded(v3, SEED_VERSION + 1);

    expect(await db.getAll('scheduled')).toEqual(before.scheduled);
    expect(await db.getAll('tests')).toEqual(before.tests);
    expect(await db.get('profile', 'me')).toEqual({ ...before.profile, seedVersion: SEED_VERSION + 1 });
  });

  it('the shipped seed carries the new fields on every definition', async () => {
    const db = await seededDb();
    await applySeed(db);
    for (const d of await db.getAll('testDefs')) {
      expect(typeof d.higherIsBetter).toBe('boolean');
      expect(typeof d.powerMetric).toBe('boolean');
      expect(['numeric', 'passfail']).toContain(d.kind);
      expect(d.group === null || typeof d.group === 'string').toBe(true);
    }
  });
});

/* ---------- TEST 2: delta direction ---------- */

describe('2 — delta direction follows higherIsBetter', () => {
  it('a rise is an improvement when higher is better', () => {
    const d = computeDelta(43, 41.5, true);
    expect(d?.pct).toBeCloseTo(3.6, 1);
    expect(d?.direction).toBe('improved');
    expect(deltaColorVar(d!.direction)).toBe('--velocity');
  });

  it('a FALL is an improvement when lower is better — the GCT case', () => {
    // Drop-jump ground contact time 210ms -> 195ms is faster, so better.
    const d = computeDelta(195, 210, false);
    expect(d?.pct).toBeCloseTo(-7.1, 1);
    expect(d?.direction).toBe('improved');
    expect(deltaColorVar(d!.direction)).toBe('--velocity');
    // The sign still reflects the raw change; only the colour flips.
    expect(deltaLabel(d!)).toBe('−7.1%');
  });

  it('a rise is a regression when lower is better', () => {
    const d = computeDelta(230, 210, false);
    expect(d?.direction).toBe('regressed');
    expect(deltaColorVar(d!.direction)).toBe('--alert');
  });

  it('a fall is a regression when higher is better', () => {
    expect(computeDelta(38, 41.5, true)?.direction).toBe('regressed');
  });

  it('no change is flat in either direction', () => {
    expect(computeDelta(40, 40, true)?.direction).toBe('flat');
    expect(computeDelta(40, 40, false)?.direction).toBe('flat');
    expect(deltaColorVar('flat')).toBe('--text-dim');
  });

  it('returns null rather than dividing by zero or NaN', () => {
    expect(computeDelta(40, 0, true)).toBeNull();
    expect(computeDelta(Number.NaN, 40, true)).toBeNull();
  });

  it('the shipped GCT definition is lower-is-better', () => {
    const gct = programSeed.testDefs.find((t) => t.id === 't_dropjump_gct');
    expect(gct?.higherIsBetter).toBe(false);
  });
});

/* ---------- TEST 3: contralateral ratio ---------- */

describe('3 — contralateral ratio has its own history', () => {
  const results = [
    res({ testId: 'test.grip', side: 'L', value: 50, localDate: '2026-05-01' }),
    res({ testId: 'test.grip', side: 'R', value: 50, localDate: '2026-05-01' }),
    res({ testId: 'test.grip', side: 'L', value: 43, localDate: '2026-06-01' }),
    res({ testId: 'test.grip', side: 'R', value: 50, localDate: '2026-06-01' }),
  ];

  it('computes |L−R| / max × 100 per date', () => {
    const series = ratioSeries(results, 'test.grip');
    expect(series).toHaveLength(2);
    expect(series[0]).toEqual({ localDate: '2026-05-01', value: 0 });
    expect(series[1]).toEqual({ localDate: '2026-06-01', value: 14 });
  });

  it('is a trend, not a single number', () => {
    const series = ratioSeries(results, 'test.grip');
    expect(series.map((p) => p.localDate)).toEqual(['2026-05-01', '2026-06-01']);
  });

  it('skips dates missing a side', () => {
    const partial = [res({ testId: 'test.grip', side: 'L', value: 50, localDate: '2026-07-01' })];
    expect(ratioSeries(partial, 'test.grip')).toHaveLength(0);
  });

  it('colours by severity: >10% strength, >15% alert', () => {
    expect(ratioColorVar(6.2)).toBe('--text-dim');
    expect(ratioColorVar(14)).toBe('--strength');
    expect(ratioColorVar(16)).toBe('--alert');
  });

  it('averages both sides for the main series', () => {
    const series = seriesFor(results, 'test.grip');
    expect(series[1]?.value).toBe(46.5);
  });
});

/* ---------- TEST 4: chart tiers ---------- */

describe('4 — chart tier by result count', () => {
  it.each([
    [0, 'none'], [1, 'value'], [2, 'sparse'], [3, 'sparse'], [4, 'full'], [12, 'full'],
  ] as Array<[number, string]>)('%i results -> %s', (count, tier) => {
    expect(chartTier(count)).toBe(tier);
  });

  it('treats a negative count as none rather than throwing', () => {
    expect(chartTier(-1)).toBe('none');
  });
});

/* ---------- TEST 5 & 6: cadence ---------- */

const trainingDays = (dates: string[]): ScheduledSession[] =>
  dates.map((d, i) => session({ id: `s${i}`, localDate: d, position: 'TD2', status: 'done' }));

describe('5 — both full-battery counters run independently', () => {
  const now = new Date(2026, 7, 1); // 2026-08-01

  it('trips on training days while the calendar count is still low', () => {
    const dates = Array.from({ length: 24 }, (_, i) => `2026-07-${String(i + 2).padStart(2, '0')}`);
    const cadence = batteryCadence(
      [res({ testId: FULL_MARKER_ID, localDate: '2026-07-01', value: 1 })],
      trainingDays(dates),
      now,
    );
    expect(cadence.trainingDaysSinceFull).toBe(24);
    expect(cadence.calendarDaysSinceFull).toBe(31);
    expect(cadence.fullDue).toBe(true);
    expect(cadence.leadingFull).toBe('training');
  });

  it('trips on calendar days while the training count is still low', () => {
    const cadence = batteryCadence(
      [res({ testId: FULL_MARKER_ID, localDate: '2026-06-01', value: 1 })],
      trainingDays(['2026-06-10', '2026-06-20']),
      now,
    );
    expect(cadence.trainingDaysSinceFull).toBe(2);
    expect(cadence.calendarDaysSinceFull).toBe(61);
    expect(cadence.fullDue).toBe(true);
    expect(cadence.leadingFull).toBe('calendar');
  });

  it('is not due when both counters are under threshold', () => {
    const cadence = batteryCadence(
      [res({ testId: FULL_MARKER_ID, localDate: '2026-07-20', value: 1 })],
      trainingDays(['2026-07-22', '2026-07-25']),
      now,
    );
    expect(cadence.fullDue).toBe(false);
  });

  it('drives BATTERY_DUE_FULL as a non-dismissible warning', () => {
    const cadence = batteryCadence(
      [res({ testId: FULL_MARKER_ID, localDate: '2026-06-01', value: 1 })], [], now,
    );
    const warnings = evaluateConstraints({
      schedule: [], ledger: [], templates: [], now, cadence,
    });
    const full = warnings.find((w) => w.id === 'BATTERY_DUE_FULL');
    expect(full).toBeDefined();
    expect(full?.severity).toBe('alert');
    expect(full?.dismissible).toBe(false);
    expect(full?.message).toMatch(/training days/);
  });

  it('mini battery warns at 9 training days and stays dismissible', () => {
    const dates = Array.from({ length: 9 }, (_, i) => `2026-07-${String(i + 2).padStart(2, '0')}`);
    const cadence = batteryCadence(
      [res({ testId: MINI_MARKER_ID, localDate: '2026-07-01', value: 1 })],
      trainingDays(dates), now,
    );
    expect(cadence.miniDue).toBe(true);

    const warnings = evaluateConstraints({
      schedule: [], ledger: [], templates: [], now, cadence,
    });
    const mini = warnings.find((w) => w.id === 'BATTERY_DUE_MINI');
    expect(mini?.severity).toBe('warn');
    expect(mini?.dismissible).toBe(true);
  });

  it('emits no battery warnings when no cadence is supplied', () => {
    const warnings = evaluateConstraints({ schedule: [], ledger: [], templates: [], now });
    expect(warnings.some((w) => w.id.startsWith('BATTERY_'))).toBe(false);
  });
});

describe('6 — only a completed battery resets the counters', () => {
  const now = new Date(2026, 7, 1);
  // 12 training days early in July, plus three AFTER the later marker date so
  // a reset is observable rather than trivially zero.
  const dates = [
    ...Array.from({ length: 12 }, (_, i) => `2026-07-${String(i + 2).padStart(2, '0')}`),
    '2026-07-29', '2026-07-30', '2026-07-31',
  ];

  it('individually logged results do not reset anything', () => {
    const cadence = batteryCadence(
      [
        res({ testId: FULL_MARKER_ID, localDate: '2026-07-01', value: 1 }),
        // Individual logs, including ones marked battery: 'full'.
        res({ testId: 't_cmj', localDate: '2026-07-20', value: 41, battery: 'full' }),
        res({ testId: 'test.grip', localDate: '2026-07-25', value: 50, battery: 'full' }),
      ],
      trainingDays(dates), now,
    );
    // Still counted from the marker on 07-01, not from the 07-25 log.
    expect(cadence.trainingDaysSinceFull).toBe(15);
  });

  it('a completed battery marker resets the count', () => {
    const cadence = batteryCadence(
      [
        res({ testId: FULL_MARKER_ID, localDate: '2026-07-01', value: 1 }),
        res({ testId: FULL_MARKER_ID, localDate: '2026-07-28', value: 1 }),
      ],
      trainingDays(dates), now,
    );
    // Only 07-29..07-31 remain after the newer marker.
    expect(cadence.trainingDaysSinceFull).toBe(3);
    expect(cadence.calendarDaysSinceFull).toBe(4);
    expect(cadence.fullDue).toBe(false);
  });

  it('a mini marker does not reset the full counters', () => {
    const cadence = batteryCadence(
      [
        res({ testId: FULL_MARKER_ID, localDate: '2026-07-01', value: 1 }),
        res({ testId: MINI_MARKER_ID, localDate: '2026-07-28', value: 1 }),
      ],
      trainingDays(dates), now,
    );
    expect(cadence.trainingDaysSinceFull).toBe(15);
    expect(cadence.trainingDaysSinceMini).toBe(3);
  });

  it('never-tested reads as due', () => {
    const cadence = batteryCadence([], trainingDays(dates), now);
    expect(cadence.fullDue).toBe(true);
    expect(cadence.calendarDaysSinceFull).toBe(-1); // rendered as an em-dash
  });
});

/* ---------- TEST 7: progression gate ---------- */

describe('7 — progression gate', () => {
  const power = (id: string, name: string): TestDef =>
    def({ id, name, powerMetric: true });
  const screen = def({ id: 'test.movement-screen', name: 'Movement Screen', kind: 'passfail' });

  const twoResults = (id: string, first: number, second: number): TestResult[] => [
    res({ testId: id, value: first, localDate: '2026-06-01' }),
    res({ testId: id, value: second, localDate: '2026-07-01' }),
  ];

  it('a failed movement screen fails the gate outright', () => {
    const gate = progressionGate(
      [screen, power('p1', 'CMJ')],
      [
        ...twoResults('p1', 40, 42),
        res({ testId: 'test.movement-screen', value: 0, localDate: '2026-07-01' }),
      ],
    );
    expect(gate.status).toBe('fail-screen');
    expect(gate.label).toBe('PROGRESSION GATE: FAIL — MOVEMENT SCREEN');
  });

  it('exactly one power regression still passes', () => {
    const gate = progressionGate(
      [power('p1', 'CMJ'), power('p2', 'Broad Jump')],
      [...twoResults('p1', 42, 40), ...twoResults('p2', 200, 210)],
    );
    expect(gate.regressedPower).toEqual(['CMJ']);
    expect(gate.status).toBe('pass');
    expect(gate.label).toBe('PROGRESSION GATE: PASS');
  });

  it('two power regressions fail', () => {
    const gate = progressionGate(
      [power('p1', 'CMJ'), power('p2', 'Broad Jump')],
      [...twoResults('p1', 42, 40), ...twoResults('p2', 210, 200)],
    );
    expect(gate.status).toBe('fail-power');
    expect(gate.regressedPower).toHaveLength(2);
    expect(gate.label).toBe('PROGRESSION GATE: FAIL — 2 POWER METRICS REGRESSED');
  });

  it('ignores non-power regressions entirely', () => {
    const gate = progressionGate(
      [power('p1', 'CMJ'), def({ id: 'n1', name: 'Grip' })],
      [...twoResults('p1', 42, 40), ...twoResults('n1', 60, 50)],
    );
    expect(gate.status).toBe('pass');
  });

  it('passes a clean battery', () => {
    const gate = progressionGate(
      [screen, power('p1', 'CMJ')],
      [
        ...twoResults('p1', 40, 42),
        res({ testId: 'test.movement-screen', value: 1, localDate: '2026-07-01' }),
      ],
    );
    expect(gate.status).toBe('pass');
  });

  it('returns a status and a label — never a permission', () => {
    const gate = progressionGate([], []);
    expect(Object.keys(gate).sort()).toEqual(['label', 'regressedPower', 'status']);
  });
});

/* ---------- TEST 8: regression flag ---------- */

describe('8 — the regression flag needs two consecutive measurements', () => {
  const d = def({ id: 'test.club-head-speed', name: 'Club Head Speed' });

  const series = (values: number[]): TestResult[] =>
    values.map((v, i) =>
      res({
        testId: 'test.club-head-speed',
        value: v,
        localDate: `2026-0${i + 1}-01`,
      }),
    );

  it('one down measurement does not flag', () => {
    expect(regressionFlags([d], series([100, 105, 103]))).toHaveLength(0);
  });

  it('two consecutive down measurements flag', () => {
    const flags = regressionFlags([d], series([100, 105, 103, 101]));
    expect(flags).toHaveLength(1);
    expect(flags[0]?.consecutive).toBe(2);
    expect(flags[0]?.label).toBe('REGRESSION: CLUB HEAD SPEED · 2 CONSECUTIVE');
  });

  it('a clean measurement between two down ones resets the count', () => {
    expect(regressionFlags([d], series([100, 98, 105, 103]))).toHaveLength(0);
  });

  it('three consecutive still flags, with the higher count', () => {
    const flags = regressionFlags([d], series([110, 108, 105, 100]));
    expect(flags[0]?.consecutive).toBe(3);
  });

  it('respects higherIsBetter — rising GCT is the regression', () => {
    const gct = def({ id: 't_dropjump_gct', name: 'Drop Jump GCT', higherIsBetter: false });
    const rising = [190, 200, 210].map((v, i) =>
      res({ testId: 't_dropjump_gct', value: v, localDate: `2026-0${i + 1}-01` }),
    );
    expect(regressionFlags([gct], rising)).toHaveLength(1);

    const falling = [210, 200, 190].map((v, i) =>
      res({ testId: 't_dropjump_gct', value: v, localDate: `2026-0${i + 1}-01` }),
    );
    expect(regressionFlags([gct], falling)).toHaveLength(0);
  });

  it('needs at least three results before it can flag anything', () => {
    expect(regressionFlags([d], series([100, 95]))).toHaveLength(0);
  });

  it('never flags pass/fail tests or markers', () => {
    const screen = def({ id: 'test.movement-screen', kind: 'passfail' });
    const marker = def({ id: FULL_MARKER_ID, kind: 'passfail' });
    const downs = [1, 0, 0].map((v, i) =>
      res({ testId: 'test.movement-screen', value: v, localDate: `2026-0${i + 1}-01` }),
    );
    expect(regressionFlags([screen, marker], downs)).toHaveLength(0);
  });
});
