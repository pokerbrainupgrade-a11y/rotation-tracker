import * as repo from './repo';
import { checkStorage } from './db';
import { ensureSeeded, programSeed } from './seed';
import { ensureProfile, getProfile } from './repo';
import { getStorageStatus, requestPersistence } from './persistence';

export interface BootResult {
  ok: boolean;
  seeded: boolean;
  persisted: boolean | null;
  error: { code: string; message: string } | null;
}

let bootPromise: Promise<BootResult> | null = null;

/**
 * Bring the data layer up on launch: open + migrate the database, seed the
 * static stores, create the profile, and request persistent storage.
 *
 * Phase 1 has no UI, so this is deliberately silent. It still runs on every
 * launch because a data layer that has only ever been type-checked is not a
 * data layer that works — iOS standalone PWAs have their own IndexedDB quirks,
 * and this is what surfaces them.
 *
 * Never throws. A storage failure is recorded and returned so a later phase can
 * render the STORAGE UNAVAILABLE state instead of the app dying at startup.
 */
export async function boot(): Promise<BootResult> {
  const health = await checkStorage();
  if (!health.ok) {
    console.error('[rotation-tracker] storage unavailable:', health.message);
    return {
      ok: false,
      seeded: false,
      persisted: null,
      error: { code: health.code, message: health.message },
    };
  }

  try {
    const firstBlock = programSeed.blocks[0];
    if (!firstBlock) throw new Error('Seed defines no blocks.');

    const seeded = await ensureSeeded();
    await ensureProfile(firstBlock.id);
    const persisted = await requestPersistence();

    return { ok: true, seeded, persisted, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rotation-tracker] data layer boot failed:', message);
    return {
      ok: false,
      seeded: false,
      persisted: null,
      error: { code: 'BOOT_FAILED', message },
    };
  }
}

/** Boot once per page load. */
export function ensureBooted(): Promise<BootResult> {
  bootPromise ??= boot();
  return bootPromise;
}

/**
 * Attach a console handle for manual verification.
 *
 * Phase 1 ships no Settings screen, so this is the only way to run the §5
 * on-device checks (seed on first launch, storage durability, export share
 * sheet, import round trip) from Safari Web Inspector against the installed
 * PWA. Replace these calls with real UI in a later phase; keep the handle —
 * being able to export from a console is a genuine recovery path when a screen
 * is broken.
 */
export function attachDebugHandle(): void {
  Object.defineProperty(globalThis, '__rotation', {
    value: {
      boot: ensureBooted,
      storage: { status: getStorageStatus, request: requestPersistence, check: checkStorage },
      profile: getProfile,
      repo,
      // Lazy: keeps backup/CSV out of the launch path. Console usage is
      //   const b = await __rotation.backup(); await b.downloadBackup();
      backup: () => import('./backup'),
    },
    writable: false,
    configurable: true,
  });
}
