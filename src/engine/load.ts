import type { Units } from '../types';

/**
 * Load resolution, rounding and plate math. Pure.
 *
 * NO PROGRESSION LOGIC LIVES HERE. Nothing in this module suggests, prompts or
 * applies a load increase. Updating an e1rm in Settings is the entire
 * mechanism — that is deliberate, and adding "smart" progression would quietly
 * change the training model.
 */

/** Bar increments: nearest 5 lb, nearest 2.5 kg. */
export const INCREMENT: Record<Units, number> = { lb: 5, kg: 2.5 };

export function roundToIncrement(value: number, units: Units): number {
  const step = INCREMENT[units];
  // Round half up, then strip float noise (0.1 + 0.2 style drift).
  return Number((Math.round(value / step) * step).toFixed(4));
}

export interface ResolvedTarget {
  target: number;
  pctLabel: string;
}

/**
 * Resolve a %1RM range to a single loadable number: range midpoint, rounded to
 * the bar increment. The label keeps the prescribed RANGE, because that is what
 * the athlete was given — collapsing it to a midpoint in the UI would hide the
 * latitude the program intends.
 */
export function resolveTarget(
  e1rm: number,
  pctLow: number,
  pctHigh: number,
  units: Units,
): ResolvedTarget {
  const low = Math.min(pctLow, pctHigh);
  const high = Math.max(pctLow, pctHigh);
  const midpoint = (low + high) / 2;

  const safeE1rm = Number.isFinite(e1rm) && e1rm > 0 ? e1rm : 0;
  const target = roundToIncrement((safeE1rm * midpoint) / 100, units);

  return {
    target,
    pctLabel: low === high ? `${trim(low)}%` : `${trim(low)}–${trim(high)}%`,
  };
}

function trim(n: number): string {
  return Number(n.toFixed(2)).toString();
}

export interface PlatePlan {
  perSide: number[];
  achieved: number;
  delta: number; // achieved - target; signed
  exact: boolean;
}

/**
 * Nearest achievable barbell load.
 *
 * `inventoryPerSide` is a MULTISET of physical plates available on one side —
 * `[45, 45, 25, 10]` means two 45s, one 25, one 10. Repeat a denomination to
 * express having several.
 *
 * Greedy descending, then a one-step overshoot check: greedy alone always lands
 * at or below target, but the nearest achievable load is sometimes the one just
 * above it. Every edge case returns a plan — nothing here throws.
 */
export function platePlan(
  target: number,
  barWeight: number,
  inventoryPerSide: number[],
  units: Units,
): PlatePlan {
  const bar = Number.isFinite(barWeight) ? barWeight : 0;
  const plates = (Array.isArray(inventoryPerSide) ? inventoryPerSide : [])
    .filter((p) => Number.isFinite(p) && p > 0)
    .sort((a, b) => b - a);

  const empty = (): PlatePlan => finish([], target, bar, units);

  // Target at or below the bar: the bar alone is the nearest achievable load.
  if (!Number.isFinite(target) || target <= bar || plates.length === 0) {
    return empty();
  }

  const perSideTarget = (target - bar) / 2;

  // Greedy descending: never overshoots.
  const chosen: number[] = [];
  let remaining = perSideTarget;
  const unused: number[] = [];
  for (const plate of plates) {
    if (plate <= remaining + 1e-9) {
      chosen.push(plate);
      remaining -= plate;
    } else {
      unused.push(plate);
    }
  }

  const under = finish(chosen, target, bar, units);
  if (under.exact) return under;

  // One-step overshoot: add the smallest unused plate that clears the gap and
  // keep whichever result sits closer to the target.
  const smallestOver = unused.length > 0 ? Math.min(...unused) : undefined;
  if (smallestOver === undefined) return under;

  const over = finish([...chosen, smallestOver], target, bar, units);
  return Math.abs(over.delta) < Math.abs(under.delta) ? over : under;
}

function finish(
  perSide: number[],
  target: number,
  bar: number,
  units: Units,
): PlatePlan {
  const achieved = Number((bar + 2 * perSide.reduce((a, b) => a + b, 0)).toFixed(4));
  const safeTarget = Number.isFinite(target) ? target : achieved;
  const delta = Number((achieved - safeTarget).toFixed(4));
  return {
    perSide: [...perSide].sort((a, b) => b - a),
    achieved,
    delta,
    // Exactness is judged against the increment's float noise, not ===.
    exact: Math.abs(delta) < INCREMENT[units] / 1000,
  };
}
