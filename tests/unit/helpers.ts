import { deleteDatabase, getDb, type RotationDatabase } from '../../src/data/db';
import { applySeed, programSeed } from '../../src/data/seed';
import { ensureProfile } from '../../src/data/repo';
import type { ProgramSeed } from '../../src/types';

/** Drop everything and reopen an empty, migrated database. */
export async function freshDb(): Promise<RotationDatabase> {
  await deleteDatabase();
  return getDb();
}

/** Fresh database with the static stores seeded and a profile created. */
export async function seededDb(seed: ProgramSeed = programSeed): Promise<RotationDatabase> {
  const db = await freshDb();
  await applySeed(db, seed);
  await ensureProfile('block.accumulation');
  return db;
}

/** Deep clone through JSON, the way a real backup file round-trips. */
export function throughJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
