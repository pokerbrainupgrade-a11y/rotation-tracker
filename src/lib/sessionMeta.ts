import type { RotationPosition } from '../types';
import { NEURAL_LOAD } from '../engine/constraints';

export { NEURAL_LOAD };

/**
 * Metabolic load per position, 0–10.
 *
 * ⚠️ PLACEHOLDER VALUES. Neural load is specified by the protocol and lives in
 * the engine; metabolic load has never been supplied. These are shaped to the
 * obvious ordering (conditioning high, max-intent low) purely so the second
 * stat pill renders. Replace alongside the real program definition — and note
 * that unlike NEURAL_LOAD, nothing computes off these, so a wrong value here
 * misinforms but does not miscount.
 */
export const METABOLIC_LOAD: Record<RotationPosition, number> = {
  TD1: 3,
  'TD-A': 4,
  TD2: 4,
  'TD-B-STR': 4,
  TD3: 9,
  'TD-B-ESD': 9,
  RD: 2,
};

export function neuralLoad(position: RotationPosition): number {
  return NEURAL_LOAD[position] ?? 0;
}

export function metabolicLoad(position: RotationPosition): number {
  return METABOLIC_LOAD[position] ?? 0;
}
