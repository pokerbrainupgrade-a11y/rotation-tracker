import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { TabBar } from './components/TabBar';
import { Skeleton } from './components/Skeleton';
import { ErrorScreen } from './components/ErrorScreen';
import { Placeholder } from './screens/Placeholder';
import { Dashboard } from './screens/Dashboard';
import { Calendar } from './screens/Calendar';
import { Session } from './screens/Session';
import { ResumeSheet } from './screens/session/ResumeSheet';
import {
  deleteSetLog, findUnfinishedSessions, getSetLogsByScheduled, putScheduled,
} from './data/repo';
import type { ScheduledSession } from './types';
import { SCREEN_COPY } from './screens';
import { useDashboard } from './hooks/useDashboard';
import { toLocalDate } from './data/dates';
import { hashFor, initialRoute, parseHash, type Route } from './lib/route';
import { ensureProfile } from './data/repo';
import { programSeed } from './data/seed';
import type { TabId } from './types';

export function App() {
  const [route, setRoute] = useState<Route>(() => initialRoute());
  const { state, error, data, reload } = useDashboard();
  const [exporting, setExporting] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [resume, setResume] = useState<{ session: ScheduledSession; setCount: number } | null>(null);
  const [resumeChecked, setResumeChecked] = useState(false);

  // Dashboard is the landing route on every launch, so the hash is normalised
  // once on mount rather than restored from wherever the app was last closed.
  useEffect(() => {
    history.replaceState(null, '', hashFor(initialRoute()));
    const onHash = (): void => setRoute(parseHash(location.hash));
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((next: Route) => {
    location.hash = hashFor(next);
  }, []);

  // Refetch when returning to the Dashboard.
  //
  // Scheduling happens on the Calendar tab, but its consequences — warnings,
  // ledger counts, the next position — are read on the Dashboard. Without this
  // the Dashboard keeps whatever it loaded at launch, so a violation you were
  // just warned about appears to have vanished. Only on transition INTO the
  // route, so the initial mount is not loaded twice.
  const prevRoute = useRef<Route>(route);
  useEffect(() => {
    if (prevRoute.current !== 'dashboard' && route === 'dashboard') reload();
    prevRoute.current = route;
  }, [route, reload]);

  const onExport = useCallback(() => {
    setExporting(true);
    void (async () => {
      try {
        const { downloadBackup } = await import('./data/backup');
        await downloadBackup();
      } catch {
        // Nothing more to offer here — the error screen already says storage
        // is broken, and a failed export must not mask that.
      } finally {
        setExporting(false);
      }
    })();
  }, []);

  // Resume detection on launch: a session with startedAt set and completedAt
  // null is one that was interrupted, and the interruption is usually a
  // force-quit mid-workout.
  useEffect(() => {
    if (state !== 'ready' || resumeChecked) return;
    setResumeChecked(true);
    void (async () => {
      const unfinished = await findUnfinishedSessions();
      const first = unfinished[0];
      if (!first) return;
      const sets = await getSetLogsByScheduled(first.id);
      setResume({ session: first, setCount: sets.length });
    })();
  }, [state, resumeChecked]);

  const discardSession = useCallback(async () => {
    if (!resume) return;
    const sets = await getSetLogsByScheduled(resume.session.id);
    for (const s of sets) await deleteSetLog(s.id);
    await putScheduled({
      ...resume.session,
      startedAt: null,
      activeTimer: null,
      checklist: [],
      status: 'planned',
    });
    setResume(null);
    reload();
  }, [resume, reload]);

  const markComplete = useCallback(async () => {
    if (!resume) return;
    // Keeps whatever was logged. The ledger then judges it on merit, which may
    // correctly mean it does not count as a TD1.
    await putScheduled({
      ...resume.session,
      completedAt: Date.now(),
      status: 'done',
      activeTimer: null,
    });
    setResume(null);
    reload();
  }, [resume, reload]);

  const createProfile = useCallback(() => {
    void (async () => {
      const first = programSeed.blocks[0];
      if (first) await ensureProfile(first.id);
      reload();
    })();
  }, [reload]);

  // --- four explicit app states, no flash of empty content ---

  if (state === 'opening') {
    return (
      <>
        <Skeleton />
        <TabBar active="dashboard" onSelect={() => undefined} />
      </>
    );
  }

  if (state === 'error') {
    // Blocking on purpose. Never silently degrade around broken storage.
    return (
      <ErrorScreen
        code={error?.code ?? 'UNKNOWN'}
        message={error?.message ?? 'The database could not be opened.'}
        onExport={onExport}
        exportBusy={exporting}
      />
    );
  }

  if (state === 'no-profile') {
    return (
      <>
        <main class="screen" data-testid="setup">
          <h1 class="screen__title">Setup</h1>
          <p class="screen__note">
            First launch. The guided setup lands in Phase 6 — for now this
            creates a default profile so the rest of the app has something to
            read.
          </p>
          <button type="button" class="btn btn--primary" onClick={createProfile}>
            CREATE PROFILE
          </button>
        </main>
        <TabBar active="dashboard" onSelect={() => undefined} />
      </>
    );
  }

  const activeTab: TabId =
    route === 'settings' || route === 'setup' || route === 'session'
      ? 'dashboard'
      : route;

  if (runningId) {
    return (
      <Session
        sessionId={runningId}
        onExit={() => {
          setRunningId(null);
          reload();
        }}
      />
    );
  }

  return (
    <>
      {resume && (
        <ResumeSheet
          session={resume.session}
          setCount={resume.setCount}
          now={Date.now()}
          onResume={() => {
            setRunningId(resume.session.id);
            setResume(null);
          }}
          onMarkComplete={markComplete}
          onDiscard={discardSession}
        />
      )}

      {route === 'dashboard' && data && (
        <Dashboard
          data={data}
          today={toLocalDate(new Date())}
          onOpenSettings={() => go('settings')}
          onStart={(id) => setRunningId(id)}
        />
      )}

      {route === 'calendar' && <Calendar onStart={(id) => setRunningId(id)} />}

      {route === 'settings' && (
        <Placeholder
          title="Settings"
          note="Units, maxes, storage and backup land in Phase 6."
        />
      )}

      {route !== 'dashboard' && route !== 'settings' && route !== 'calendar' && (
        <Placeholder title={SCREEN_COPY[activeTab].title} note={SCREEN_COPY[activeTab].note} />
      )}

      <TabBar active={activeTab} onSelect={(id) => go(id)} />
    </>
  );
}
