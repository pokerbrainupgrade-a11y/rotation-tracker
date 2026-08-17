import { SCHEMA_VERSION } from '../types';
import { DB_NAME } from './schema';

/**
 * Version skew guard.
 *
 * Runs on boot, BEFORE any UI renders and before the app opens the database
 * for writing. If the stored data was written by a newer build, this refuses to
 * proceed — an older reader that writes to newer data can drop fields it does
 * not know about, and the loss is silent and permanent.
 *
 * There is deliberately no "continue anyway".
 */

export type SkewState =
  | { kind: 'ok'; dataVersion: number | null }
  | { kind: 'newer'; dataVersion: number; appVersion: number }
  | { kind: 'unavailable'; reason: string };

/**
 * Read the stored schema version WITHOUT triggering a migration.
 *
 * Opening at `SCHEMA_VERSION` would throw `VersionError` when the stored
 * version is higher, and opening at the stored version would run our
 * migrations against data we do not understand. A version-less open attaches to
 * whatever exists and touches nothing.
 */
export async function readDataSchemaVersion(): Promise<number | null> {
  if (typeof indexedDB === 'undefined' || indexedDB === null) {
    throw new Error('IndexedDB is not available in this context.');
  }

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('open failed'));
    request.onblocked = () => reject(new Error('Database open blocked by another tab.'));
  });

  try {
    // First run: no profile store yet, so nothing has been written by anyone.
    if (!db.objectStoreNames.contains('profile')) return null;

    const profile = await new Promise<{ schemaVersion?: number } | undefined>(
      (resolve, reject) => {
        const tx = db.transaction('profile', 'readonly');
        const request = tx.objectStore('profile').get('me');
        request.onsuccess = () => resolve(request.result as { schemaVersion?: number } | undefined);
        request.onerror = () => reject(request.error ?? new Error('read failed'));
      },
    );

    const stored = profile?.schemaVersion;
    return typeof stored === 'number' && Number.isFinite(stored) ? stored : null;
  } finally {
    db.close();
  }
}

export async function checkSkew(): Promise<SkewState> {
  try {
    const dataVersion = await readDataSchemaVersion();
    if (dataVersion !== null && dataVersion > SCHEMA_VERSION) {
      return { kind: 'newer', dataVersion, appVersion: SCHEMA_VERSION };
    }
    // dataVersion < SCHEMA_VERSION is the normal upgrade path: migrations run
    // as built in Phase 1.
    return { kind: 'ok', dataVersion };
  } catch (err) {
    return {
      kind: 'unavailable',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ---------------- eviction canary ---------------- */

export const CANARY_KEY = 'rt_initialized';

/** Written on the first successful profile write. */
export function setCanary(): void {
  try {
    localStorage.setItem(CANARY_KEY, '1');
  } catch {
    // Private mode. Eviction detection is best-effort by design.
  }
}

export function hasCanary(): boolean {
  try {
    return localStorage.getItem(CANARY_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Best-effort eviction detection: the canary says this device once had a
 * profile, but IndexedDB now has none.
 *
 * NOTE: iOS usually evicts localStorage and IndexedDB together, so this will
 * miss the common case. It catches the partial eviction, which is the one that
 * otherwise looks like "the app forgot everything for no reason".
 */
export function looksEvicted(hasProfile: boolean): boolean {
  return hasCanary() && !hasProfile;
}
