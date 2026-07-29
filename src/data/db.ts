import { openDB, deleteDB, type IDBPDatabase } from 'idb';
import { SCHEMA_VERSION } from '../types';
import { DB_NAME, type RotationDB } from './schema';
import { runMigrations } from './migrations';

/**
 * Hard failure state. If IndexedDB is unavailable or the open is blocked, the
 * app must say so loudly. There is deliberately NO localStorage fallback:
 * silently writing training history somewhere that holds ~5MB and gets evicted
 * without warning is worse than refusing to start.
 */
export class StorageUnavailableError extends Error {
  readonly code: 'INDEXEDDB_UNAVAILABLE' | 'INDEXEDDB_BLOCKED' | 'INDEXEDDB_OPEN_FAILED';
  override readonly cause?: unknown;

  constructor(
    code: 'INDEXEDDB_UNAVAILABLE' | 'INDEXEDDB_BLOCKED' | 'INDEXEDDB_OPEN_FAILED',
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'StorageUnavailableError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export type RotationDatabase = IDBPDatabase<RotationDB>;

let dbPromise: Promise<RotationDatabase> | null = null;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

async function open(): Promise<RotationDatabase> {
  if (!hasIndexedDb()) {
    throw new StorageUnavailableError(
      'INDEXEDDB_UNAVAILABLE',
      'IndexedDB is not available in this browser context. Rotation Tracker ' +
        'cannot store training data here.',
    );
  }

  try {
    return await openDB<RotationDB>(DB_NAME, SCHEMA_VERSION, {
      async upgrade(db, oldVersion, newVersion, tx) {
        await runMigrations(db, tx, oldVersion, newVersion ?? SCHEMA_VERSION);
      },
      blocked() {
        // Another tab holds an older version open and blocks the upgrade.
        console.warn(
          '[rotation-tracker] Database upgrade blocked by another open tab.',
        );
      },
      blocking() {
        // This tab is blocking a newer version elsewhere — release the handle
        // so the other context can upgrade rather than deadlock.
        console.warn('[rotation-tracker] Closing DB handle to unblock an upgrade.');
        void closeDb();
      },
      terminated() {
        // The browser killed the connection; drop the cache so the next call
        // reopens rather than reusing a dead handle.
        dbPromise = null;
        console.error('[rotation-tracker] Database connection terminated unexpectedly.');
      },
    });
  } catch (err) {
    throw new StorageUnavailableError(
      'INDEXEDDB_OPEN_FAILED',
      'Could not open the Rotation Tracker database. Storage may be full or ' +
        'blocked by private browsing.',
      err,
    );
  }
}

/** Open (or reuse) the database handle. Throws StorageUnavailableError. */
export function getDb(): Promise<RotationDatabase> {
  if (!dbPromise) {
    dbPromise = open().catch((err: unknown) => {
      dbPromise = null; // never cache a failure
      throw err;
    });
  }
  return dbPromise;
}

/** Close the cached handle. Safe to call when nothing is open. */
export async function closeDb(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (!p) return;
  try {
    (await p).close();
  } catch {
    // Already closed or never opened — nothing to release.
  }
}

/** Delete the whole database. Destructive; used by import and by tests. */
export async function deleteDatabase(): Promise<void> {
  await closeDb();
  await deleteDB(DB_NAME, {
    blocked() {
      console.warn('[rotation-tracker] Delete blocked by another open connection.');
    },
  });
}

/** Probe storage health without throwing — for the settings readout. */
export async function checkStorage(): Promise<
  { ok: true } | { ok: false; code: string; message: string }
> {
  try {
    await getDb();
    return { ok: true };
  } catch (err) {
    if (err instanceof StorageUnavailableError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return {
      ok: false,
      code: 'UNKNOWN',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
