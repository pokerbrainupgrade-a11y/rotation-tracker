import { daysBetweenLocal, toLocalDate } from '../data/dates';
import type { ScheduledSession, TestDef, TestResult } from '../types';

/**
 * Testing-battery arithmetic. Pure, clock injected.
 *
 * Everything here reports a STATUS. Nothing returns a gate, a permission, or
 * an instruction — the progression gate and the regression flag are readings
 * on an instrument, and the protocol's response to them stays the athlete's.
 */

export const FULL_TRAINING_DAY_THRESHOLD = 24;
export const FULL_CALENDAR_DAY_THRESHOLD = 45;
export const MINI_TRAINING_DAY_THRESHOLD = 9;

export const FULL_MARKER_ID = 'test.battery-full-complete';
export const MINI_MARKER_ID = 'test.battery-mini-complete';

/** Marker definitions are bookkeeping, never rendered as test rows. */
export function isMarker(testId: string): boolean {
  return testId === FULL_MARKER_ID || testId === MINI_MARKER_ID;
}

/* ---------------- deltas ---------------- */

export type DeltaDirection = 'improved' | 'regressed' | 'flat';

export interface Delta {
  pct: number;
  direction: DeltaDirection;
}

/**
 * Percentage change from `previous` to `latest`, with direction judged by the
 * test's own `higherIsBetter`.
 *
 * A drop-jump ground contact time that falls has IMPROVED. Judging direction
 * by sign alone would paint that red — a silently wrong colour on a number you
 * are reading to make a decision.
 */
export function computeDelta(
  latest: number,
  previous: number,
  higherIsBetter: boolean,
): Delta | null {
  if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }
  const pct = Number((((latest - previous) / Math.abs(previous)) * 100).toFixed(1));
  if (pct === 0) return { pct: 0, direction: 'flat' };

  const better = higherIsBetter ? pct > 0 : pct < 0;
  return { pct, direction: better ? 'improved' : 'regressed' };
}

export function deltaColorVar(direction: DeltaDirection): string {
  switch (direction) {
    case 'improved':
      return '--velocity';
    case 'regressed':
      return '--alert';
    case 'flat':
      return '--text-dim';
  }
}

/** `+4.2%` / `−1.8%`. Sign reflects the raw change, colour reflects direction. */
export function deltaLabel(delta: Delta): string {
  const sign = delta.pct > 0 ? '+' : delta.pct < 0 ? '−' : '';
  return `${sign}${Math.abs(delta.pct)}%`;
}

/* ---------------- series ---------------- */

export interface SeriesPoint {
  localDate: string;
  value: number;
}

/** One value per date for a test, oldest first. Bilateral sides are averaged. */
export function seriesFor(results: TestResult[], testId: string): SeriesPoint[] {
  const byDate = new Map<string, number[]>();
  for (const r of results) {
    if (r.testId !== testId) continue;
    const bucket = byDate.get(r.localDate);
    if (bucket) bucket.push(r.value);
    else byDate.set(r.localDate, [r.value]);
  }
  return [...byDate.entries()]
    .map(([localDate, values]) => ({
      localDate,
      value: values.reduce((a, b) => a + b, 0) / values.length,
    }))
    .sort((a, b) => (a.localDate < b.localDate ? -1 : 1));
}

/** One value per date for a single side. */
export function sideSeriesFor(
  results: TestResult[], testId: string, side: 'L' | 'R',
): SeriesPoint[] {
  return results
    .filter((r) => r.testId === testId && r.side === side)
    .map((r) => ({ localDate: r.localDate, value: r.value }))
    .sort((a, b) => (a.localDate < b.localDate ? -1 : 1));
}

/**
 * Contralateral asymmetry per test date, as its own series.
 *
 * Asymmetry over time is more informative than either side alone: both sides
 * improving together tells you less than the gap between them widening.
 */
export function ratioSeries(results: TestResult[], testId: string): SeriesPoint[] {
  const byDate = new Map<string, { L?: number; R?: number }>();
  for (const r of results) {
    if (r.testId !== testId || (r.side !== 'L' && r.side !== 'R')) continue;
    const entry = byDate.get(r.localDate) ?? {};
    entry[r.side] = r.value;
    byDate.set(r.localDate, entry);
  }

  const out: SeriesPoint[] = [];
  for (const [localDate, { L, R }] of byDate) {
    if (L === undefined || R === undefined) continue;
    const max = Math.max(L, R);
    out.push({
      localDate,
      value: max === 0 ? 0 : Number(((Math.abs(L - R) / max) * 100).toFixed(1)),
    });
  }
  return out.sort((a, b) => (a.localDate < b.localDate ? -1 : 1));
}

export function ratioColorVar(pct: number): string {
  if (pct > 15) return '--alert';
  if (pct > 10) return '--strength';
  return '--text-dim';
}

/* ---------------- chart tiers ---------------- */

export type ChartTier = 'none' | 'value' | 'sparse' | 'full';

/**
 * How much chart a result count earns.
 *
 * Two points do not need axis labels, and one point is not a trend. Drawing a
 * full chart over three results implies a precision the data does not have.
 */
export function chartTier(count: number): ChartTier {
  if (count <= 0) return 'none';
  if (count === 1) return 'value';
  if (count <= 3) return 'sparse';
  return 'full';
}

/* ---------------- cadence counters ---------------- */

export interface BatteryCadence {
  trainingDaysSinceFull: number;
  calendarDaysSinceFull: number;
  trainingDaysSinceMini: number;
  fullDue: boolean;
  miniDue: boolean;
  /** Which full-battery counter is proportionally closer to its threshold. */
  leadingFull: 'training' | 'calendar';
}

function lastMarkerDate(results: TestResult[], markerId: string): string | null {
  const dates = results
    .filter((r) => r.testId === markerId)
    .map((r) => r.localDate)
    .sort();
  return dates[dates.length - 1] ?? null;
}

/** Distinct training days (completed, non-RD) strictly after `since`. */
function trainingDaysAfter(
  sessions: ScheduledSession[], since: string | null, today: string,
): number {
  const dates = new Set(
    sessions
      .filter((s) => s.status === 'done' && s.position !== 'RD')
      .filter((s) => s.localDate <= today)
      .filter((s) => since === null || s.localDate > since)
      .map((s) => s.localDate),
  );
  return dates.size;
}

/**
 * Both full-battery counters run independently, and whichever trips first
 * triggers. Rotation counts drift against calendar time — a light month passes
 * 45 days without passing 24 training days, and a heavy one does the reverse.
 * One counter would miss half the cases.
 */
export function batteryCadence(
  results: TestResult[],
  sessions: ScheduledSession[],
  now: Date,
): BatteryCadence {
  const today = toLocalDate(now);
  const lastFull = lastMarkerDate(results, FULL_MARKER_ID);
  const lastMini = lastMarkerDate(results, MINI_MARKER_ID);

  const trainingDaysSinceFull = trainingDaysAfter(sessions, lastFull, today);
  const calendarDaysSinceFull =
    lastFull === null ? Number.POSITIVE_INFINITY : daysBetweenLocal(lastFull, today);
  const trainingDaysSinceMini = trainingDaysAfter(sessions, lastMini, today);

  const trainingRatio = trainingDaysSinceFull / FULL_TRAINING_DAY_THRESHOLD;
  const calendarRatio =
    calendarDaysSinceFull === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : calendarDaysSinceFull / FULL_CALENDAR_DAY_THRESHOLD;

  return {
    trainingDaysSinceFull,
    calendarDaysSinceFull:
      calendarDaysSinceFull === Number.POSITIVE_INFINITY ? -1 : calendarDaysSinceFull,
    trainingDaysSinceMini,
    fullDue:
      trainingDaysSinceFull >= FULL_TRAINING_DAY_THRESHOLD ||
      calendarRatio >= 1,
    miniDue: trainingDaysSinceMini >= MINI_TRAINING_DAY_THRESHOLD,
    leadingFull: calendarRatio > trainingRatio ? 'calendar' : 'training',
  };
}

/* ---------------- progression gate ---------------- */

export type GateStatus = 'pass' | 'fail-screen' | 'fail-power';

export interface ProgressionGate {
  status: GateStatus;
  /** Power metrics that regressed against the previous battery. */
  regressedPower: string[];
  label: string;
}

/**
 * The protocol's gate: a block does not advance if the movement screen fails,
 * or if two or more power metrics regressed against the previous battery.
 *
 * DISPLAY ONLY. This returns a status and a label. It does not block block
 * advancement, prompt a deload, or ask a question — the protocol says these
 * trigger a response, and the app's job is to make the trigger visible rather
 * than to enact it.
 */
export function progressionGate(
  defs: TestDef[],
  results: TestResult[],
): ProgressionGate {
  const screen = defs.find((d) => d.kind === 'passfail' && !isMarker(d.id));
  if (screen) {
    const series = seriesFor(results, screen.id);
    const latest = series[series.length - 1];
    // Pass/fail is stored as 1 / 0.
    if (latest && latest.value === 0) {
      return {
        status: 'fail-screen',
        regressedPower: [],
        label: 'PROGRESSION GATE: FAIL — MOVEMENT SCREEN',
      };
    }
  }

  const regressedPower: string[] = [];
  for (const def of defs.filter((d) => d.powerMetric)) {
    const series = seriesFor(results, def.id);
    if (series.length < 2) continue;
    const latest = series[series.length - 1];
    const previous = series[series.length - 2];
    if (!latest || !previous) continue;
    const delta = computeDelta(latest.value, previous.value, def.higherIsBetter);
    if (delta?.direction === 'regressed') regressedPower.push(def.name);
  }

  if (regressedPower.length >= 2) {
    return {
      status: 'fail-power',
      regressedPower,
      label: `PROGRESSION GATE: FAIL — ${regressedPower.length} POWER METRICS REGRESSED`,
    };
  }

  return { status: 'pass', regressedPower, label: 'PROGRESSION GATE: PASS' };
}

/* ---------------- regression flag ---------------- */

export interface RegressionFlag {
  testId: string;
  name: string;
  consecutive: number;
  label: string;
}

/**
 * Any quality below its prior tested value on TWO CONSECUTIVE measurements.
 *
 * One down result is noise; a clean measurement between two down ones resets
 * the count. Display only, like everything else here.
 */
export function regressionFlags(
  defs: TestDef[],
  results: TestResult[],
): RegressionFlag[] {
  const out: RegressionFlag[] = [];

  for (const def of defs) {
    if (def.kind === 'passfail' || isMarker(def.id)) continue;
    const series = seriesFor(results, def.id);
    if (series.length < 3) continue;

    // Walk backwards while each measurement regressed against the one before.
    let consecutive = 0;
    for (let i = series.length - 1; i >= 1; i--) {
      const current = series[i];
      const prior = series[i - 1];
      if (!current || !prior) break;
      const delta = computeDelta(current.value, prior.value, def.higherIsBetter);
      if (delta?.direction === 'regressed') consecutive++;
      else break;
    }

    if (consecutive >= 2) {
      out.push({
        testId: def.id,
        name: def.name,
        consecutive,
        label: `REGRESSION: ${def.name.toUpperCase()} · ${consecutive} CONSECUTIVE`,
      });
    }
  }

  return out;
}
