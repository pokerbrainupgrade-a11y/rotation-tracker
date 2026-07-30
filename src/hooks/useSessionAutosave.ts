import { useCallback, useMemo } from 'preact/hooks';
import {
  deleteSetLog,
  getScheduled,
  getSetLogsByScheduled,
  putScheduled,
  putSetLog,
} from '../data/repo';
import type { ActiveTimer, ScheduledSession, SetLog } from '../types';

export interface SessionAutosave {
  logSet: (log: SetLog) => Promise<void>;
  removeSet: (id: string) => Promise<void>;
  setChecklist: (ids: string[]) => Promise<void>;
  setTimer: (timer: ActiveTimer | null) => Promise<void>;
  patchSession: (patch: Partial<ScheduledSession>) => Promise<ScheduledSession | null>;
  loadSets: () => Promise<SetLog[]>;
}

/**
 * Every mutation awaits its IndexedDB transaction before resolving.
 *
 * NO DEBOUNCE, NO BATCHING — deliberately. A debounce window is a window in
 * which a force-quit loses the set you just did, and this is the one screen
 * where that is guaranteed to eventually happen: phones get dropped, apps get
 * killed, batteries die mid-rest. The write is cheap; the loss is not
 * recoverable.
 */
export function useSessionAutosave(sessionId: string): SessionAutosave {
  const patchSession = useCallback(
    async (patch: Partial<ScheduledSession>): Promise<ScheduledSession | null> => {
      // Read-modify-write against the stored record rather than a stale copy
      // held in component state.
      const current = await getScheduled(sessionId);
      if (!current) return null;
      const next: ScheduledSession = { ...current, ...patch, id: current.id };
      await putScheduled(next);
      return next;
    },
    [sessionId],
  );

  const logSet = useCallback(async (log: SetLog) => {
    await putSetLog(log);
  }, []);

  const removeSet = useCallback(async (id: string) => {
    await deleteSetLog(id);
  }, []);

  const setChecklist = useCallback(
    async (ids: string[]) => {
      await patchSession({ checklist: ids });
    },
    [patchSession],
  );

  const setTimer = useCallback(
    async (timer: ActiveTimer | null) => {
      await patchSession({ activeTimer: timer });
    },
    [patchSession],
  );

  const loadSets = useCallback(() => getSetLogsByScheduled(sessionId), [sessionId]);

  // MEMOISED. Returning a fresh object literal would change identity on every
  // render, and any effect depending on it — including the runner's initial
  // load — would re-run and cancel its own async work forever.
  return useMemo(
    () => ({ logSet, removeSet, setChecklist, setTimer, patchSession, loadSets }),
    [logSet, removeSet, setChecklist, setTimer, patchSession, loadSets],
  );
}
