import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  applyAdjustment,
  elapsedFraction,
  formatMMSS,
  remainingSec,
} from '../engine/timer';
import type { ActiveTimer } from '../types';

const TICK_MS = 250;

export interface TimerView {
  active: ActiveTimer | null;
  remaining: number;
  fraction: number;
  label: string;
  complete: boolean;
  start: (exerciseId: string, durationSec: number) => void;
  adjust: (deltaSec: number) => void;
  skip: () => void;
  dismiss: () => void;
}

/**
 * Rest timer. Every value is recomputed from `Date.now()` — on a 250ms tick,
 * on `visibilitychange`, and on mount. Nothing accumulates, so being
 * backgrounded or locked for the whole interval still yields the right answer
 * on return.
 */
export function useTimer(
  initial: ActiveTimer | null,
  onPersist: (timer: ActiveTimer | null) => Promise<void>,
): TimerView {
  const [active, setActive] = useState<ActiveTimer | null>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);
  const persist = useRef(onPersist);
  persist.current = onPersist;

  // Adopt a restored timer when the session loads.
  useEffect(() => {
    setActive(initial);
  }, [initial]);

  useEffect(() => {
    if (!active) return;

    const sync = (): void => setNow(Date.now());
    sync(); // on mount, and whenever the active timer changes

    const id = setInterval(sync, TICK_MS);
    // Recompute the instant we come back — the ticks that "should" have fired
    // while backgrounded never did, and that is fine because we never counted
    // them in the first place.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    addEventListener('focus', sync);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      removeEventListener('focus', sync);
    };
  }, [active]);

  const start = useCallback((exerciseId: string, durationSec: number) => {
    const timer: ActiveTimer = {
      startedAt: Date.now(),
      durationSec,
      adjustmentSec: 0,
      exerciseId,
    };
    setActive(timer);
    setDismissed(false);
    setNow(Date.now());
    void persist.current(timer);
  }, []);

  const adjust = useCallback((deltaSec: number) => {
    setActive((prev) => {
      if (!prev) return prev;
      const next: ActiveTimer = {
        ...prev,
        adjustmentSec: applyAdjustment(prev.durationSec, prev.adjustmentSec, deltaSec),
      };
      void persist.current(next);
      return next;
    });
    setNow(Date.now());
  }, []);

  const clear = useCallback(() => {
    setActive(null);
    setDismissed(false);
    void persist.current(null);
  }, []);

  const remaining = active
    ? remainingSec(active.startedAt, active.durationSec, now, active.adjustmentSec)
    : 0;
  const fraction = active
    ? elapsedFraction(active.startedAt, active.durationSec, now, active.adjustmentSec)
    : 0;

  return {
    active: dismissed ? null : active,
    remaining,
    fraction,
    label: formatMMSS(remaining),
    complete: active !== null && remaining === 0,
    start,
    adjust,
    skip: clear,
    dismiss: () => {
      setDismissed(true);
      void persist.current(null);
    },
  };
}
