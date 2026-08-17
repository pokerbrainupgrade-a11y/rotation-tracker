import { platePlan, resolveTarget, type PlatePlan } from './load';
import type { Exercise, MaxRecord, Profile, Units } from '../types';

/**
 * Resolve an exercise's displayed load. Pure.
 *
 * NO PROGRESSION LOGIC. Nothing here suggests, prompts or applies an increase.
 * Targets move only when an e1RM changes in Settings — that is the entire
 * mechanism, deliberately.
 *
 * All arithmetic delegates to load.ts (`resolveTarget`, `platePlan`). This
 * module only decides WHICH question to ask per loadType.
 */

export interface ResolvedLoad {
  /** Large, session-coloured line. null when nothing can be computed. */
  primary: string | null;
  /** Small dim line beneath it. */
  secondary: string | null;
  /** Plate breakdown, when a barbell weight was resolved. */
  plates: PlatePlan | null;
  /** The numeric target the plates aim at. */
  target: number | null;
  /**
   * True when the exercise needs an e1RM that has not been tested. The UI
   * renders SET MAX rather than 0 or a fabricated number.
   */
  needsMax: boolean;
  /** The lift whose max is missing, for routing to the Maxes screen. */
  missingLiftId: string | null;
}

const NONE: ResolvedLoad = {
  primary: null, secondary: null, plates: null,
  target: null, needsMax: false, missingLiftId: null,
};

function band(low: number | null, high: number | null, suffix: string): string | null {
  if (low === null && high === null) return null;
  if (low === null || high === null) return `${low ?? high}${suffix}`;
  return low === high ? `${low}${suffix}` : `${low}–${high}${suffix}`;
}

export function resolveLoad(
  exercise: Exercise,
  profile: Pick<Profile, 'units' | 'hrMax' | 'barWeight' | 'plateInventory'>,
  maxes: MaxRecord[],
): ResolvedLoad {
  const spec = exercise.load;
  if (!spec) return NONE;

  const units: Units = profile.units;

  switch (spec.type) {
    case 'bodyweight':
      return NONE;

    case 'fixed': {
      const label = band(spec.fixedLow, spec.fixedHigh, ` ${units.toUpperCase()}`);
      return { ...NONE, primary: label };
    }

    case 'rpe': {
      // Seed only — no computed weight, by design.
      const primary = spec.rpeTarget === null ? null : `RPE ${spec.rpeTarget}`;
      const secondary = spec.rirTarget === null ? null : `${spec.rirTarget} RIR`;
      return { ...NONE, primary, secondary };
    }

    case 'hr': {
      // Resolving 90–95% HRmax into actual bpm is the difference between a
      // prescription you can act on mid-interval and arithmetic you have to do
      // while your heart rate is 175.
      const hrMax = profile.hrMax;
      const pct = band(spec.hrPctLow, spec.hrPctHigh, '% HRmax');
      if (hrMax === null || !Number.isFinite(hrMax) || hrMax <= 0) {
        return { ...NONE, primary: null, secondary: pct };
      }
      const lo = spec.hrPctLow === null ? null : Math.round((hrMax * spec.hrPctLow) / 100);
      const hi = spec.hrPctHigh === null ? null : Math.round((hrMax * spec.hrPctHigh) / 100);
      return { ...NONE, primary: band(lo, hi, ' BPM'), secondary: pct };
    }

    case 'pct1rm':
    case 'velocity': {
      const liftId = exercise.liftRef;
      const max = liftId === null ? undefined : maxes.find((m) => m.liftId === liftId);

      // An untested lift yields SET MAX. Never 0, never a fabricated number —
      // a plausible-looking weight on an untested lift is worse than no number.
      if (!max || !Number.isFinite(max.e1rm) || max.e1rm <= 0) {
        return {
          ...NONE,
          needsMax: true,
          missingLiftId: liftId,
          secondary:
            spec.type === 'velocity'
              ? band(spec.velocityTarget, spec.velocityTarget, ' m/s')
              : band(spec.pctLow, spec.pctHigh, '%'),
        };
      }

      const { target, pctLabel } = resolveTarget(
        max.e1rm, spec.pctLow ?? 0, spec.pctHigh ?? 0, units,
      );
      const plates = platePlan(target, profile.barWeight, profile.plateInventory, units);
      const weight = `${target} ${units.toUpperCase()}`;

      if (spec.type === 'velocity') {
        return {
          primary: spec.velocityTarget === null ? weight : `≥${spec.velocityTarget} m/s`,
          secondary: `${pctLabel} · ${weight}`,
          plates, target, needsMax: false, missingLiftId: null,
        };
      }

      return {
        primary: weight,
        secondary: pctLabel,
        plates, target, needsMax: false, missingLiftId: null,
      };
    }
  }
}

/** `BAR 45 + 45 · 45 · 25 · 2.5` per side. */
export function plateLine(plan: PlatePlan, barWeight: number): string {
  if (plan.perSide.length === 0) return `BAR ${barWeight}`;
  return `BAR ${barWeight}  +  ${plan.perSide.join(' · ')}`;
}

/**
 * `245 LB · TARGET 247.5 · −2.5` when the target is not exactly achievable.
 *
 * Never silently returns the nearest load: an unflagged 2.5 lb drift compounds
 * invisibly across a block.
 */
export function plateDeltaLine(
  plan: PlatePlan, target: number, units: Units,
): string | null {
  if (plan.exact) return null;
  const sign = plan.delta > 0 ? '+' : '−';
  return `${plan.achieved} ${units.toUpperCase()}  ·  TARGET ${target}  ·  ${sign}${Math.abs(plan.delta)}`;
}

/* ---------------- max staleness ---------------- */

export const STALE_MAX_DAYS = 60;

export interface MaxAge {
  days: number;
  stale: boolean;
  label: string;
}

/**
 * How old a max is.
 *
 * DISPLAY ONLY. With no progression automation, a stale e1RM biases every
 * computed load in the same direction and nothing corrects it. Stating the age
 * is a fact; it must not prompt or suggest a retest.
 */
export function maxAge(
  record: Pick<MaxRecord, 'testedOn' | 'method'>,
  now: Date,
): MaxAge {
  const [y, m, d] = record.testedOn.split('-').map(Number);
  const tested = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.max(0, Math.round((today.getTime() - tested.getTime()) / 86_400_000));

  return {
    days,
    stale: days > STALE_MAX_DAYS,
    label: `${record.method.toUpperCase()} ${days} DAY${days === 1 ? '' : 'S'} AGO`,
  };
}
