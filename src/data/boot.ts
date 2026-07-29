import * as repo from './repo';
import { checkStorage } from './db';
import { ensureSeeded, programSeed } from './seed';
import { getProfile } from './repo';
import { getStorageStatus, requestPersistence } from './persistence';

export interface BootResult {
  ok: boolean;
  seeded: boolean;
  persisted: boolean | null;
  /** True while the shipped program definition is still the placeholder. */
  placeholderSeed: boolean;
  error: { code: string; message: string } | null;
}

/**
 * The seed ships with `_placeholder: true` until the real program lands.
 * Exercise ids become a permanent foreign key the moment a set is logged
 * against them, so this is worth saying out loud on every launch rather than
 * discovering it after a month of training history is pinned to throwaway ids.
 */
export function isPlaceholderSeed(): boolean {
  return (programSeed as unknown as { _placeholder?: boolean })._placeholder === true;
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
      placeholderSeed: isPlaceholderSeed(),
      error: { code: health.code, message: health.message },
    };
  }

  try {
    if (!programSeed.blocks[0]) throw new Error('Seed defines no blocks.');

    const seeded = await ensureSeeded();
    // The profile is NOT created here. First launch has to be distinguishable
    // from a returning launch so the app can route to setup; auto-creating one
    // would make that state unreachable. Creation happens in the setup flow.
    const persisted = await requestPersistence();

    const placeholderSeed = isPlaceholderSeed();
    if (placeholderSeed) {
      console.warn(
        '[rotation-tracker] PLACEHOLDER PROGRAM SEED is active. Exercise ids ' +
          'become a permanent foreign key once a set is logged against them. ' +
          'Replace src/data/program.seed.json before logging real training.',
      );
    }

    return { ok: true, seeded, persisted, placeholderSeed, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rotation-tracker] data layer boot failed:', message);
    return {
      ok: false,
      seeded: false,
      persisted: null,
      placeholderSeed: isPlaceholderSeed(),
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
