import type { Exercise, SetLog, VolumeCap } from '../types';

/**
 * Tier 2 instrumentation. Pure, and DISPLAY-ONLY BY CONSTRUCTION.
 *
 * Every function here returns a number or a label. None returns an action, a
 * recommendation, a boolean gate, or anything a caller could mistake for
 * permission. That is the product boundary: the athlete reads the instrument
 * and decides. A prompt at the moment of fatigue is a decision made for you by
 * software that cannot see you.
 */

/* ---------------- 4.1 decay floor ---------------- */

export interface DecayView {
  /** Best rep in the CURRENT set. */
  setBest: number | null;
  /** setBest x factor. Resets every set. */
  floor: number | null;
  /** Best across the whole session, for cross-set context only. */
  sessionBest: number | null;
  /** Reps in this set that landed below the floor. Informational. */
  belowFloorCount: number;
}

const EMPTY_DECAY: DecayView = {
  setBest: null,
  floor: null,
  sessionBest: null,
  belowFloorCount: 0,
};

function metricOf(log: SetLog, metric: 'velocity' | 'distance'): number | null {
  const raw = metric === 'velocity' ? log.velocity : log.distance;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * The operative floor is the best rep IN THIS SET times the decay factor.
 *
 * Per-set, not per-session: the protocol's rule is "terminate the set on 5%
 * decay from the best rep", and a session-wide floor would make a genuinely
 * good later set look like a failure just because an earlier one was better.
 */
export function decayView(
  exercise: Exercise,
  sessionLogs: SetLog[],
  setIndex: number,
): DecayView {
  const factor = exercise.decayFloorFactor;
  const metric = exercise.decayMetric;
  if (factor === null || metric === null) return EMPTY_DECAY;

  const own = sessionLogs.filter((l) => l.exerciseId === exercise.id);

  const values = (logs: SetLog[]): number[] =>
    logs.map((l) => metricOf(l, metric)).filter((n): n is number => n !== null);

  const thisSet = values(own.filter((l) => l.setIndex === setIndex));
  const all = values(own);

  const setBest = thisSet.length > 0 ? Math.max(...thisSet) : null;
  const sessionBest = all.length > 0 ? Math.max(...all) : null;
  const floor = setBest === null ? null : round1(setBest * factor);

  return {
    setBest,
    floor,
    sessionBest,
    belowFloorCount: floor === null ? 0 : thisSet.filter((v) => v < floor).length,
  };
}

/** Did this specific rep land below its set's floor? Flags the row, nothing more. */
export function isBelowFloor(
  exercise: Exercise,
  sessionLogs: SetLog[],
  setIndex: number,
): boolean {
  return decayView(exercise, sessionLogs, setIndex).belowFloorCount > 0;
}

function round1(n: number): number {
  return Number(n.toFixed(1));
}

/* ---------------- 4.2 volume caps ---------------- */

export interface VolumeView {
  label: string;
  count: number;
  limit: number;
  atCap: boolean;
}

/**
 * Live counter for a section. `atCap` is a COLOUR, not a gate — logging past
 * the cap works, because sometimes the right call is to keep going and the app
 * does not get a vote.
 */
export function volumeView(
  cap: VolumeCap,
  exercises: Exercise[],
  sessionLogs: SetLog[],
  primeIds: string[] = [],
): VolumeView {
  const byId = new Map(exercises.map((e) => [e.id, e]));

  const qualifies = (log: SetLog): boolean => {
    const ex = byId.get(log.exerciseId);
    if (!ex) return false;
    switch (cap.countOf) {
      case 'maxIntent':
        return ex.maxIntent;
      case 'prime':
        return primeIds.includes(ex.id);
      case 'contacts':
        return log.contacts !== null;
    }
  };

  let count = 0;
  for (const log of sessionLogs) {
    if (!log.completed || !qualifies(log)) continue;
    // Contacts caps count contacts; everything else counts reps.
    count += cap.countOf === 'contacts' ? (log.contacts ?? 0) : (log.reps ?? 0);
  }

  return { label: cap.label, count, limit: cap.limit, atCap: count >= cap.limit };
}

/* ---------------- 4.3 contralateral ratio ---------------- */

export type RatioStatus = 'ok' | 'watch' | 'flag';

export interface RatioView {
  /** Percent asymmetry, or null when a side is missing. */
  ratio: number | null;
  status: RatioStatus;
  /** Consecutive sessions above threshold, including this one. */
  consecutive: number;
}

export const RATIO_THRESHOLD_PCT = 10;

/**
 * Asymmetry from SESSION MEANS per side, not best reps.
 *
 * Best-rep ratios are dominated by single-rep variance, which makes them noise
 * dressed as a signal. Means across the session are what the protocol's
 * programming flag is actually about.
 */
export function contralateralRatio(logs: SetLog[], exerciseId: string): number | null {
  const own = logs.filter((l) => l.exerciseId === exerciseId && l.completed);

  const meanOf = (side: 'L' | 'R'): number | null => {
    const values = own
      .filter((l) => l.side === side)
      .map((l) => l.load ?? l.distance ?? l.velocity ?? l.reps)
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  };

  const left = meanOf('L');
  const right = meanOf('R');
  if (left === null || right === null) return null;

  const max = Math.max(left, right);
  if (max === 0) return 0;
  return round1((Math.abs(left - right) / max) * 100);
}

/**
 * Escalation from a session history, oldest first, current session LAST.
 *
 * Only two consecutive sessions above threshold is the protocol's programming
 * flag. A single excursion is normal variance and must not escalate — an alert
 * that fires on noise stops being read.
 */
export function ratioStatus(
  history: Array<number | null>,
  threshold: number = RATIO_THRESHOLD_PCT,
): RatioView {
  const current = history[history.length - 1] ?? null;

  // Walk backwards while each session is above threshold. A clean session
  // between two bad ones resets the count.
  let consecutive = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const value = history[i];
    if (value !== null && value !== undefined && value > threshold) consecutive++;
    else break;
  }

  const status: RatioStatus =
    consecutive >= 2 ? 'flag' : consecutive === 1 ? 'watch' : 'ok';

  return { ratio: current, status, consecutive };
}

export function ratioColorVar(status: RatioStatus): string {
  switch (status) {
    case 'ok':
      return '--text-dim';
    case 'watch':
      return '--strength';
    case 'flag':
      return '--alert';
  }
}

export function ratioLabel(view: RatioView): string {
  if (view.ratio === null) return '';
  const base = `L/R Δ ${view.ratio}%`;
  return view.status === 'flag' ? `${base} · ${view.consecutive} SESSIONS` : base;
}

/* ---------------- 6. completion summary ---------------- */

export interface SessionTotals {
  setsCompleted: number;
  setsPrescribed: number;
  tonnage: number;
}

export function sessionTotals(
  logs: SetLog[],
  prescribedSets: number,
): SessionTotals {
  const completed = logs.filter((l) => l.completed);
  const tonnage = completed.reduce(
    (sum, l) => sum + (l.load ?? 0) * (l.reps ?? 0),
    0,
  );
  return {
    setsCompleted: completed.length,
    setsPrescribed: prescribedSets,
    tonnage: Number(tonnage.toFixed(1)),
  };
}
