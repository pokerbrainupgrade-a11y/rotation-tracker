import type {
  CompressionLevel,
  CompressionSpec,
  SessionTemplate,
} from '../types';

/**
 * Compression resolution. Pure.
 *
 * THE CUT MAPS LIVE IN THE SEED, NOT HERE. This module knows how to apply
 * `cut`, `modify` and `keepOnly`; it does not know which exercises any
 * particular session drops. Hardcoding that would mean the program definition
 * and the app could disagree, with the app silently winning.
 */

export interface ResolvedCompression {
  level: CompressionLevel;
  /** Exercise ids that are cut: struck through, non-interactive, not counted. */
  cut: Set<string>;
  /** Exercise id -> replacement dose string. */
  modified: Record<string, string>;
  /** Shown at the top of the section. */
  note: string | null;
}

const EMPTY: ResolvedCompression = {
  level: 100,
  cut: new Set(),
  modified: {},
  note: null,
};

/** The seed key for a level. 100% has no entry — nothing is compressed. */
function specFor(
  template: SessionTemplate,
  level: CompressionLevel,
): CompressionSpec | undefined {
  if (level === 100) return undefined;
  return template.compression?.[String(level) as '75' | '50' | '25'];
}

/** Every exercise id the template references, in section order. */
export function templateExerciseIds(template: SessionTemplate): string[] {
  const out: string[] = [];
  for (const section of template.sections ?? []) {
    for (const id of section.exerciseIds) if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function resolveCompression(
  template: SessionTemplate,
  level: CompressionLevel,
): ResolvedCompression {
  const spec = specFor(template, level);
  if (!spec) return { ...EMPTY, level };

  const all = templateExerciseIds(template);
  const cut = new Set<string>();

  // keepOnly takes precedence: everything NOT listed is cut. Expressing a deep
  // cut as a keep-list is safer than a cut-list, because adding an exercise to
  // the template later cannot silently survive a 25% compression.
  if (spec.keepOnly) {
    const keep = new Set(spec.keepOnly);
    for (const id of all) if (!keep.has(id)) cut.add(id);
  } else if (spec.cut) {
    for (const id of spec.cut) cut.add(id);
  }

  return {
    level,
    cut,
    modified: { ...(spec.modify ?? {}) },
    note: spec.note ?? null,
  };
}

/** Levels this template actually defines, ascending. */
export function availableLevels(template: SessionTemplate): CompressionLevel[] {
  const out: CompressionLevel[] = [];
  for (const level of [25, 50, 75] as const) {
    if (template.compression?.[String(level) as '75' | '50' | '25']) out.push(level);
  }
  return out;
}

/** Dose string for an exercise under a resolved compression. */
export function doseFor(
  resolved: ResolvedCompression,
  exerciseId: string,
  defaultDose: string,
): string {
  return resolved.modified[exerciseId] ?? defaultDose;
}

export function isCut(resolved: ResolvedCompression, exerciseId: string): boolean {
  return resolved.cut.has(exerciseId);
}
