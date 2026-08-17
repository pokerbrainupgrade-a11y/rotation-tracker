import { useCallback, useEffect, useState } from 'preact/hooks';

interface UpdateState {
  available: boolean;
  swFailed: boolean;
  dismiss: () => void;
  apply: () => Promise<void>;
}

/**
 * Service-worker update lifecycle.
 *
 * `registerType: 'prompt'` (Phase 0) means a new build installs and WAITS
 * rather than swapping under you mid-session. This wires the prompt.
 *
 * Applying calls skipWaiting, then reloads on controllerchange — which is what
 * removes the old workaround of deleting and re-adding the home screen icon to
 * pick up a new version.
 */
export function useAppUpdate(): UpdateState {
  const [available, setAvailable] = useState(false);
  const [swFailed, setSwFailed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // DEV-only injection so the banner and its export prompt are reachable in
    // tests; there is no service worker on the dev server.
    if (import.meta.env.DEV) {
      const forced = (globalThis as { __forceUpdateAvailable?: boolean })
        .__forceUpdateAvailable;
      if (forced) {
        setAvailable(true);
        return;
      }
    }

    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    let cancelled = false;

    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (cancelled || !reg) return;

        if (reg.waiting) setAvailable(true);

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // `controller` present means this is an update, not a first install.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setAvailable(true);
            }
          });
        });
      })
      .catch(() => {
        // Registration failed: the app still works, offline does not.
        if (!cancelled) setSwFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const apply = useCallback(async () => {
    if (import.meta.env.DEV) {
      const forced = (globalThis as { __forceUpdateAvailable?: boolean })
        .__forceUpdateAvailable;
      if (forced) {
        (globalThis as { __updateApplied?: boolean }).__updateApplied = true;
        setAvailable(false);
        return;
      }
    }

    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg?.waiting) {
      location.reload();
      return;
    }

    // Reload once the new worker takes control, rather than immediately —
    // reloading first would just re-serve the old cached shell.
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => location.reload(),
      { once: true },
    );
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  }, []);

  return {
    available: available && !dismissed,
    swFailed,
    // Session-only: a dismissed update should reappear next launch, because
    // running an old build indefinitely is how version skew happens.
    dismiss: () => setDismissed(true),
    apply,
  };
}
