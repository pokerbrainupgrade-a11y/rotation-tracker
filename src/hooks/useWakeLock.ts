import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}

interface WakeLockNavigator {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
}

/**
 * Screen wake lock for the duration of a session.
 *
 * Feature-detected — never throws where unsupported (which today includes some
 * iOS versions). Browsers auto-release on background, so it is re-acquired on
 * every return to the foreground; without that, the screen sleeps the first
 * time you check a message mid-session.
 */
export function useWakeLock(enabled: boolean): { active: boolean; supported: boolean } {
  const [active, setActive] = useState(false);
  const sentinel = useRef<WakeLockSentinelLike | null>(null);

  const supported =
    typeof navigator !== 'undefined' &&
    typeof (navigator as WakeLockNavigator).wakeLock?.request === 'function';

  const acquire = useCallback(async () => {
    if (!enabled || !supported) return;
    try {
      const lock = await (navigator as WakeLockNavigator).wakeLock!.request('screen');
      sentinel.current = lock;
      setActive(true);
      lock.addEventListener('release', () => setActive(false));
    } catch {
      // Denied (low battery, unsupported context). Not fatal to the session.
      setActive(false);
    }
  }, [enabled, supported]);

  const release = useCallback(async () => {
    const lock = sentinel.current;
    sentinel.current = null;
    setActive(false);
    if (lock && !lock.released) {
      try {
        await lock.release();
      } catch {
        // Already gone.
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled || !supported) {
      void release();
      return;
    }
    void acquire();

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);

    // Released on unmount: navigating away from the runner must not leave the
    // screen pinned awake.
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void release();
    };
  }, [enabled, supported, acquire, release]);

  return { active, supported };
}
