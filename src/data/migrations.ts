import type { IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import type { RotationDB } from './schema';
import type { ScheduledSession } from '../types';

export type MigrationDb = IDBPDatabase<RotationDB>;
export type MigrationTx = IDBPTransaction<
  RotationDB,
  ArrayLike<StoreNames<RotationDB>>,
  'versionchange'
>;

export type Migration = (db: MigrationDb, tx: MigrationTx) => void | Promise<void>;

/**
 * Versioned migration registry. Key `n` upgrades a database at version `n-1`
 * to version `n`. Migrations run in ascending order.
 *
 * RULES — these protect training history that cannot be recreated:
 *  1. Migrations must be idempotent. Guard every create with an existence check;
 *     a half-applied upgrade that reruns must not throw.
 *  2. Never drop or rename a store or index without first copying data forward.
 *  3. Any migration that adds a field must backfill a default on existing
 *     records, so no reader ever sees `undefined` where it expects a value.
 *  4. Never edit a migration that has shipped. Add a new one.
 *
 * The framework exists at v1 deliberately. Retrofitting migrations after real
 * data exists is how people lose their history.
 */
export const migrations: Record<number, Migration> = {
  1: (db) => {
    // --- user stores ---
    if (!db.objectStoreNames.contains('profile')) {
      db.createObjectStore('profile', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('maxes')) {
      db.createObjectStore('maxes', { keyPath: 'liftId' });
    }
    if (!db.objectStoreNames.contains('scheduled')) {
      const s = db.createObjectStore('scheduled', { keyPath: 'id' });
      s.createIndex('localDate', 'localDate');
      s.createIndex('status', 'status');
      s.createIndex('blockId', 'blockId');
    }
    if (!db.objectStoreNames.contains('setLogs')) {
      const s = db.createObjectStore('setLogs', { keyPath: 'id' });
      s.createIndex('scheduledId', 'scheduledId');
      s.createIndex('exerciseId', 'exerciseId');
    }
    if (!db.objectStoreNames.contains('esdLogs')) {
      const s = db.createObjectStore('esdLogs', { keyPath: 'id' });
      s.createIndex('scheduledId', 'scheduledId');
      s.createIndex('type', 'type');
    }
    if (!db.objectStoreNames.contains('tests')) {
      const s = db.createObjectStore('tests', { keyPath: 'id' });
      s.createIndex('localDate', 'localDate');
      s.createIndex('testId', 'testId');
    }

    // --- static stores (reseeded from code; never exported) ---
    for (const name of [
      'lifts',
      'exercises',
      'sessionTemplates',
      'blocks',
      'substitutionTags',
      'testDefs',
    ] as const) {
      if (!db.objectStoreNames.contains(name)) {
        db.createObjectStore(name, { keyPath: 'id' });
      }
    }
  },

  /**
   * v2 — session runner state on the scheduled record.
   *
   * Adds `checklist` (completed Pillar/Movement Prep item ids) and
   * `activeTimer` (a persisted rest timer, so a mid-rest app kill restores
   * it). Both are BACKFILLED on every existing row: a reader that expects an
   * array must never find `undefined`.
   *
   * Idempotent — re-running only fills rows that are still missing the fields.
   */
  2: async (_db, tx) => {
    const store = tx.objectStore('scheduled');
    let cursor = await store.openCursor();
    while (cursor) {
      const value = cursor.value as Partial<ScheduledSession>;
      if (value.checklist === undefined || value.activeTimer === undefined) {
        await cursor.update({
          ...value,
          checklist: value.checklist ?? [],
          activeTimer: value.activeTimer ?? null,
        } as ScheduledSession);
      }
      cursor = await cursor.continue();
    }
  },
};

/** Migration keys that apply when going from `oldVersion` to `newVersion`. */
export function pendingMigrations(oldVersion: number, newVersion: number): number[] {
  return Object.keys(migrations)
    .map(Number)
    .filter((v) => v > oldVersion && v <= newVersion)
    .sort((a, b) => a - b);
}

export async function runMigrations(
  db: MigrationDb,
  tx: MigrationTx,
  oldVersion: number,
  newVersion: number,
): Promise<void> {
  for (const v of pendingMigrations(oldVersion, newVersion)) {
    const migration = migrations[v];
    if (!migration) continue;
    await migration(db, tx);
  }
}
