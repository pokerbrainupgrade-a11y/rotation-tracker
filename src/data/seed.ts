import { SEED_VERSION, STATIC_STORES, type ProgramSeed } from '../types';
import { getDb, type RotationDatabase } from './db';
import rawSeed from './program.seed.json';

/**
 * A structurally invalid seed is a hard failure. A silently bad seed produces
 * wrong prescriptions, which is worse than not starting.
 */
export class SeedValidationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid program seed:\n  - ${problems.join('\n  - ')}`);
    this.name = 'SeedValidationError';
    this.problems = problems;
  }
}

/** The seed compiled into the bundle. */
export const programSeed = rawSeed as unknown as ProgramSeed;

/**
 * Validate referential integrity across the seed. Returns every problem found
 * rather than the first, so a broken seed is fixed in one pass.
 */
export function validateSeed(seed: ProgramSeed): string[] {
  const problems: string[] = [];

  const liftIds = new Set(seed.lifts.map((l) => l.id));
  const exerciseIds = new Set(seed.exercises.map((e) => e.id));
  const tagIds = new Set(seed.substitutionTags.map((t) => t.id));

  const dupes = (ids: string[], label: string): void => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`duplicate ${label} id "${id}"`);
      seen.add(id);
    }
  };
  dupes(seed.lifts.map((l) => l.id), 'lift');
  dupes(seed.exercises.map((e) => e.id), 'exercise');
  dupes(seed.sessionTemplates.map((t) => t.id), 'sessionTemplate');
  dupes(seed.blocks.map((b) => b.id), 'block');
  dupes(seed.substitutionTags.map((t) => t.id), 'substitutionTag');
  dupes(seed.testDefs.map((t) => t.id), 'testDef');

  // every exercise.liftRef resolves to a real lift
  for (const ex of seed.exercises) {
    if (ex.liftRef !== null && !liftIds.has(ex.liftRef)) {
      problems.push(`exercise "${ex.id}" references unknown lift "${ex.liftRef}"`);
    }
    for (const tag of ex.tags) {
      if (!tagIds.has(tag)) {
        problems.push(`exercise "${ex.id}" references unknown tag "${tag}"`);
      }
    }
  }

  // every sessionTemplate.sections[*] exercise ID resolves to a real exercise
  for (const tmpl of seed.sessionTemplates) {
    if (tmpl.sections.length === 0) {
      problems.push(`sessionTemplate "${tmpl.id}" has no sections`);
    }
    for (const section of tmpl.sections) {
      if (section.exerciseIds.length === 0) {
        problems.push(`section "${section.id}" in "${tmpl.id}" has no exercises`);
      }
      for (const exId of section.exerciseIds) {
        if (!exerciseIds.has(exId)) {
          problems.push(
            `sessionTemplate "${tmpl.id}" section "${section.id}" references ` +
              `unknown exercise "${exId}"`,
          );
        }
      }
    }
  }

  // every substitutionTag.appliesTo resolves
  for (const tag of seed.substitutionTags) {
    for (const exId of tag.appliesTo) {
      if (!exerciseIds.has(exId)) {
        problems.push(`substitutionTag "${tag.id}" applies to unknown exercise "${exId}"`);
      }
    }
  }

  if (seed.blocks.length === 0) problems.push('seed defines no blocks');

  return problems;
}

/** Validate or throw. */
export function assertValidSeed(seed: ProgramSeed): void {
  const problems = validateSeed(seed);
  if (problems.length > 0) throw new SeedValidationError(problems);
}

/**
 * Replace the static stores with `seed`. Idempotent: running twice produces
 * identical state, because each store is cleared then rewritten.
 *
 * NEVER touches user stores. Program definition is code; training history is
 * data, and the two must move independently.
 */
export async function applySeed(
  db: RotationDatabase,
  seed: ProgramSeed = programSeed,
): Promise<void> {
  assertValidSeed(seed);

  const tx = db.transaction(STATIC_STORES, 'readwrite');
  await Promise.all([
    (async () => {
      const s = tx.objectStore('lifts');
      await s.clear();
      for (const r of seed.lifts) await s.put(r);
    })(),
    (async () => {
      const s = tx.objectStore('exercises');
      await s.clear();
      for (const r of seed.exercises) await s.put(r);
    })(),
    (async () => {
      const s = tx.objectStore('sessionTemplates');
      await s.clear();
      for (const r of seed.sessionTemplates) await s.put(r);
    })(),
    (async () => {
      const s = tx.objectStore('blocks');
      await s.clear();
      for (const r of seed.blocks) await s.put(r);
    })(),
    (async () => {
      const s = tx.objectStore('substitutionTags');
      await s.clear();
      for (const r of seed.substitutionTags) await s.put(r);
    })(),
    (async () => {
      const s = tx.objectStore('testDefs');
      await s.clear();
      for (const r of seed.testDefs) await s.put(r);
    })(),
    tx.done,
  ]);
}

/**
 * Ensure the static stores match the compiled seed.
 *
 * Reseeds when the stored seedVersion is behind, or when the static stores are
 * empty (fresh install, or a restore that only carried user data). Returns
 * whether a reseed happened.
 */
export async function ensureSeeded(
  seed: ProgramSeed = programSeed,
  seedVersion: number = SEED_VERSION,
): Promise<boolean> {
  const db = await getDb();

  const profile = await db.get('profile', 'me');
  const storedVersion = profile?.seedVersion ?? -1;
  const exerciseCount = await db.count('exercises');

  const needsSeed = storedVersion < seedVersion || exerciseCount === 0;
  if (!needsSeed) return false;

  await applySeed(db, seed);

  if (profile) {
    await db.put('profile', { ...profile, seedVersion });
  }
  return true;
}
