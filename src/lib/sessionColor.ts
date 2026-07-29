import type { RotationPosition } from '../types';

/**
 * SINGLE SOURCE OF TRUTH for position -> colour.
 *
 * Every component that shows a session reference reads from here. No local
 * mappings anywhere — a second mapping is how a chip and a card end up
 * disagreeing about what colour TD2 is.
 */
export const SESSION_COLOR_VAR: Record<RotationPosition, string> = {
  TD1: '--velocity',
  'TD-A': '--velocity',
  TD2: '--strength',
  'TD-B-STR': '--strength',
  TD3: '--aerobic',
  'TD-B-ESD': '--aerobic',
  RD: '--recovery',
};

/** A `var(--…)` reference for the given position. */
export function sessionColor(position: RotationPosition): string {
  const name = SESSION_COLOR_VAR[position];
  // Unknown positions fall back to the recovery grey rather than throwing —
  // a dashboard must not blank out because of one odd record.
  return `var(${name ?? '--recovery'})`;
}
