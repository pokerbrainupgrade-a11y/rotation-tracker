import { getProfile, putProfile } from './repo';

export interface StorageStatus {
  /**
   * true  = the browser granted persistent storage (survives eviction pressure)
   * false = best-effort only (the browser may evict under pressure)
   * null  = the browser does not implement the API, so durability is unknown
   */
  persisted: boolean | null;
  supported: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
}

function storageManager(): StorageManager | null {
  if (typeof navigator === 'undefined') return null;
  const s = navigator.storage;
  return s && typeof s.persist === 'function' ? s : null;
}

/**
 * Ask the browser for persistent storage and record the honest answer.
 *
 * Never overstate durability. If the request is denied, or the API does not
 * exist, the recorded state says exactly that — the settings screen shows the
 * user what they actually have, not what we hoped for.
 */
export async function requestPersistence(): Promise<boolean | null> {
  const sm = storageManager();
  if (!sm) {
    await recordPersisted(null);
    return null;
  }

  try {
    // Don't re-prompt if it is already granted.
    const already =
      typeof sm.persisted === 'function' ? await sm.persisted() : false;
    const granted = already || (await sm.persist());
    await recordPersisted(granted);
    return granted;
  } catch {
    await recordPersisted(null);
    return null;
  }
}

/** Current durability + usage, without requesting anything. */
export async function getStorageStatus(): Promise<StorageStatus> {
  const sm = storageManager();
  if (!sm) {
    return { persisted: null, supported: false, usageBytes: null, quotaBytes: null };
  }

  let persisted: boolean | null;
  try {
    persisted = typeof sm.persisted === 'function' ? await sm.persisted() : null;
  } catch {
    persisted = null;
  }

  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  try {
    if (typeof sm.estimate === 'function') {
      const est = await sm.estimate();
      usageBytes = est.usage ?? null;
      quotaBytes = est.quota ?? null;
    }
  } catch {
    // Estimate is advisory; its absence is not an error.
  }

  return { persisted, supported: true, usageBytes, quotaBytes };
}

/** Human-readable durability label. Deliberately not reassuring when unsure. */
export function describePersistence(status: StorageStatus): string {
  if (!status.supported) return 'Unknown — this browser does not report storage durability';
  if (status.persisted === true) return 'Persistent — protected from automatic eviction';
  if (status.persisted === false) return 'Best-effort — the browser may evict this data';
  return 'Unknown — durability could not be determined';
}

async function recordPersisted(value: boolean | null): Promise<void> {
  try {
    const profile = await getProfile();
    if (!profile || profile.storagePersisted === value) return;
    await putProfile({ ...profile, storagePersisted: value });
  } catch {
    // The profile may not exist yet on first launch; the value is re-recorded
    // the next time persistence is requested.
  }
}
