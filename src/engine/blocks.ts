import { isCut, type ResolvedCompression } from './compression';
import type {
  Block,
  CompressionLevel,
  DeloadElement,
  Exercise,
  ResolvedDose,
} from '../types';

/**
 * Dose resolution. Pure.
 *
 * RESOLUTION ORDER IS ENFORCED AND FIXED:
 *   1. block multipliers
 *   2. deload treatment
 *   3. compression cut map
 *
 * Order matters because the steps are not commutative: a deload computed from
 * an already-compressed dose halves something that was already cut, and a block
 * multiplier applied last would silently undo the deload's cap. Test 9 pins it.
 *
 * DELOAD IS MANUAL. Nothing in this module reads a date, a rotation number, or
 * a fatigue signal. `deload` arrives as an argument because a human toggled it.
 */

/** The protocol's deload treatment table. */
export interface DeloadTreatment {
  /** Multiplier on prescribed sets. */
  setFactor: number;
  /** Multiplier on prescribed volume (reps or contacts). */
  volumeFactor: number;
  /** Cap on the top set's intensity, 1 = uncapped. */
  topSetCap: number;
  /** False when the treatment deliberately leaves load alone. */
  loadChanges: boolean;
  note: string;
}

export const DELOAD_TABLE: Record<DeloadElement, DeloadTreatment> = {
  // Volume -50%, intent unchanged. Intent is the dose for max-intent work, so
  // reducing it would change what the session trains, not just how much.
  maxIntentThrow: {
    setFactor: 1, volumeFactor: 0.5, topSetCap: 1, loadChanges: false,
    note: 'Volume −50%, intent unchanged',
  },
  // 60% of block volume, top set capped at 80%.
  grind: {
    setFactor: 1, volumeFactor: 0.6, topSetCap: 0.8, loadChanges: true,
    note: 'Volume 60%, top set capped at 80%',
  },
  // Sets halved, load unchanged.
  ballistic: {
    setFactor: 0.5, volumeFactor: 1, topSetCap: 1, loadChanges: false,
    note: 'Sets halved, load unchanged',
  },
  // Contacts -50%, ground contact time standard unchanged.
  plyo: {
    setFactor: 1, volumeFactor: 0.5, topSetCap: 1, loadChanges: false,
    note: 'Contacts −50%, GCT standard unchanged',
  },
  // One session, 3x4 instead of 4x4.
  vo2max: {
    setFactor: 0.75, volumeFactor: 1, topSetCap: 1, loadChanges: false,
    note: '3 × 4 instead of 4 × 4',
  },
  zone2: {
    setFactor: 1, volumeFactor: 1, topSetCap: 1, loadChanges: false,
    note: 'Unchanged',
  },
  recovery: {
    setFactor: 1, volumeFactor: 1, topSetCap: 1, loadChanges: false,
    note: 'Density unchanged',
  },
};

function doseLabel(sets: number, reps: number, perSide: boolean): string {
  return `${sets} × ${reps}${perSide ? ' / side' : ''}`;
}

/**
 * Resolve an exercise's dose for a block, deload state and compression.
 *
 * `compression` is the already-resolved map from compression.ts, so this
 * module never re-reads the seed's cut lists — one resolver, one source.
 */
export function resolveDose(
  exercise: Exercise,
  block: Block,
  deload: boolean,
  compression: ResolvedCompression,
): ResolvedDose {
  const applied: string[] = [];

  // --- 1. block multipliers ---
  const mult = block.multipliers ?? { volume: 1, intensity: 1 };
  let sets = exercise.sets * (Number.isFinite(mult.volume) ? mult.volume : 1);
  let reps = exercise.reps;
  let topSetCap = Number.isFinite(mult.intensity) ? mult.intensity : 1;
  if (mult.volume !== 1 || mult.intensity !== 1) {
    applied.push(`block ${block.name}: vol ×${mult.volume}, int ×${mult.intensity}`);
  }

  // --- 2. deload treatment ---
  const treatment = DELOAD_TABLE[exercise.deloadElement];
  let deloaded = false;
  let contacts: number | null = null;

  if (exercise.deloadElement === 'plyo') {
    contacts = exercise.reps * (deload ? treatment.volumeFactor : 1);
  }

  if (deload && treatment) {
    sets = Math.max(1, Math.round(sets * treatment.setFactor));
    // Plyo carries its volume on contacts, not reps.
    if (exercise.deloadElement !== 'plyo') {
      reps = Math.max(1, Math.round(reps * treatment.volumeFactor));
    }
    topSetCap = Math.min(topSetCap, treatment.topSetCap);
    deloaded =
      treatment.setFactor !== 1 ||
      treatment.volumeFactor !== 1 ||
      treatment.topSetCap !== 1;
    if (deloaded) applied.push(`deload: ${treatment.note}`);
  }

  sets = Math.max(1, Math.round(sets));

  // --- 3. compression ---
  const cut = isCut(compression, exercise.id);
  const modified = compression.modified[exercise.id];
  if (cut) applied.push(`compression ${compression.level}%: cut`);
  else if (modified) applied.push(`compression ${compression.level}%: ${modified}`);

  return {
    sets,
    reps,
    contacts,
    topSetCap,
    // A compression `modify` string wins the label outright: it is an explicit
    // override written in the program, not something to recompute.
    label: modified ?? doseLabel(sets, reps, exercise.perSide),
    deloaded,
    cut,
    applied,
  };
}

/**
 * Is this rotation the block's programmed deload position?
 *
 * DISPLAY ONLY. This states a fact about where you are in the block. It does
 * not apply the deload, does not prompt, and does not ask — same boundary as
 * the ledger. The instrument shows the reading; the call stays yours.
 */
export function isDeloadPosition(block: Block, rotationNumber: number): boolean {
  return (
    typeof block?.deloadRotation === 'number' &&
    block.deloadRotation === rotationNumber
  );
}

/** Compression levels are program data; re-exported for callers' convenience. */
export type { CompressionLevel };
