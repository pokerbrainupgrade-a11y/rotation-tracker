import type { LedgerKey } from '../types';
import type { LedgerRow } from '../engine/ledger';

/**
 * Ledger bar geometry. Pure arithmetic, kept out of the component so it can be
 * tested directly — the bar is the instrument the athlete actually reads, and
 * a fill that is quietly a few percent wrong is worse than one that is
 * obviously broken.
 */

export interface BarGeometry {
  /** Denominator for every percentage below. */
  barMax: number;
  /** Solid fill, 0–100. */
  fillPct: number;
  /** Floor tick position, 0–100. */
  floorPct: number;
  /** Hatched miss segment continuing past the fill, 0–100. */
  hatchPct: number;
  belowFloor: boolean;
}

const clamp = (n: number): number => Math.min(100, Math.max(0, n));

/**
 * `barMax = ceiling ?? max(floor * 2, count, missed)`.
 *
 * Fixed per row so the bar does not rescale as counts change — a scale that
 * moves under you makes two glances incomparable, which defeats the point.
 *
 * `missed` is in the denominator because a block may legitimately set a floor
 * of 0 — the Baseline block sets every velocity and VO2max floor to 0 while
 * you calibrate. Without it, `max` collapses to 0, the geometry short-circuits,
 * and a logged miss renders as nothing at all: the one outcome this instrument
 * exists to make visible.
 */
export function barMax(
  row: Pick<LedgerRow, 'ceiling' | 'floor' | 'count' | 'missed'>,
): number {
  return row.ceiling ?? Math.max(row.floor * 2, row.count, row.missed);
}

export function barGeometry(
  row: Pick<LedgerRow, 'count' | 'missed' | 'floor' | 'ceiling' | 'belowFloor'>,
): BarGeometry {
  const max = barMax(row);

  // A zero denominator is reachable (floor 0, count 0) and must not produce
  // NaN widths.
  if (!Number.isFinite(max) || max <= 0) {
    return { barMax: 0, fillPct: 0, floorPct: 0, hatchPct: 0, belowFloor: row.belowFloor };
  }

  const fillPct = clamp((row.count / max) * 100);
  const floorPct = clamp((row.floor / max) * 100);

  // The hatch continues PAST the fill, so it can only occupy what the fill
  // left behind.
  const rawHatch = clamp((row.missed / max) * 100);
  const hatchPct = Math.min(rawHatch, 100 - fillPct);

  return { barMax: max, fillPct, floorPct, hatchPct, belowFloor: row.belowFloor };
}

/** Row display labels, in ledger order. */
export const ROW_LABEL: Record<LedgerKey, string> = {
  velocityFull: 'MAX-INTENT VELOCITY',
  velocityPrime: 'VELOCITY PRIME',
  vo2max: 'VO2MAX',
  zone2Min: 'ZONE 2 MINUTES',
  trainingDays: 'TRAINING DAYS',
};

/** Row colours. Secondary qualities read at 60% so the primaries lead. */
export const ROW_COLOR_VAR: Record<LedgerKey, string> = {
  velocityFull: '--velocity',
  velocityPrime: '--velocity-60',
  vo2max: '--aerobic',
  zone2Min: '--aerobic-60',
  trainingDays: '--text-dim',
};

export function rowColor(key: LedgerKey): string {
  return `var(${ROW_COLOR_VAR[key] ?? '--text-dim'})`;
}

/**
 * Sub-label under the bar. Below floor it is replaced outright rather than
 * appended — "2 BELOW FLOOR" is the thing to read, not a footnote.
 */
export function subLabel(row: Pick<LedgerRow, 'count' | 'floor' | 'belowFloor'>): string {
  if (row.belowFloor) return `${row.floor - row.count} BELOW FLOOR`;
  return `${row.count} / floor ${row.floor}`;
}
