import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { TabBar } from './components/TabBar';
import { Skeleton } from './components/Skeleton';
import {
  Banner, EvictedScreen, SeedInvalidScreen, SkewScreen, StorageUnavailableScreen,
} from './components/FailureScreens';
import { UpdatePrompt } from './components/UpdatePrompt';
import { useAppUpdate } from './hooks/useAppUpdate';
import { checkSkew, type SkewState } from './data/skew';
import { Placeholder } from './screens/Placeholder';
import { Dashboard } from './screens/Dashboard';
import { Calendar } from './screens/Calendar';
import { Tests } from './screens/Tests';
import { Session } from './screens/Session';
import { Setup } from './screens/Setup';
import { Maxes } from './screens/Maxes';
import { Settings } from './screens/Settings';
import { ResumeSheet } from './screens/session/ResumeSheet';
import {
  deleteSetLog, findUnfinishedSessions, getSetLogsByScheduled, putScheduled,
} from './data/repo';
import type { ScheduledSession } from './types';
import { SCREEN_COPY } from './screens';
import { useDashboard } from './hooks/useDashboard';
import { toLocalDate } from './data/dates';
import { hashFor, initialRoute, parseHash, type Route } from './lib/route';
import type { TabId } from './types';

export function App() {
  const [route, setRoute] = useState<Route>(() => initialRoute());
  const { state, error, data, reload, seedProblems, evicted } = useDashboard();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [resume, setResume] = useState<{ session: ScheduledSession; setCount: number } | null>(null);
  const [resumeChecked, setResumeChecked] = useState(false);
  const [focusLift, setFocusLift] = useState<string | null>(null);
  const [skew, setSkew] = useState<SkewState | null>(null);
  const [showUpdate, setShowUpdate] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const update = useAppUpdate();

  // Version skew runs BEFORE anything else touches the database.
  useEffect(() => {
    void checkSkew().then(setSkew);
  }, []);

  // A quota failure anywhere must surface, not vanish into a console.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent): void => {
      const reason = e.reason as { name?: string; message?: string } | undefined;
      if (reason?.name === 'QuotaExceededError') {
        setQuotaError(reason.message ?? 'The device is out of storage.');
      }
    };
    addEventListener('unhandledrejection', onRejection);
    return () => removeEventListener('unhandledrejection', onRejection);
  }, []);

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

  // --- blocking states first: nothing below may touch the database ---

  if (skew === null) {
    // Still checking. Showing the skeleton rather than the app avoids a frame
    // of normal UI over data we may not be allowed to write.
    return <Skeleton />;
  }

  if (skew.kind === 'newer') {
    return <SkewScreen dataVersion={skew.dataVersion} appVersion={skew.appVersion} />;
  }

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
    // A broken program definition is a build defect, and naming the broken
    // reference is the only thing that makes it fixable.
    if (seedProblems && seedProblems.length > 0) {
      return <SeedInvalidScreen problems={seedProblems} />;
    }
    // Blocking on purpose. Never silently degrade around broken storage.
    return (
      <StorageUnavailableScreen
        code={error?.code ?? 'UNKNOWN'}
        message={error?.message ?? 'The database could not be opened.'}
        onRetry={() => location.reload()}
      />
    );
  }

  // Best-effort eviction detection: this device held a profile once, and now
  // does not. Offer the only thing that helps.
  if (state === 'no-profile' && evicted) {
    return <EvictedScreen onImport={() => go('settings')} />;
  }

  if (state === 'no-profile') {
    return <Setup onComplete={reload} />;
  }

  const activeTab: TabId =
    route === 'settings' || route === 'setup' || route === 'session' ||
    route === 'maxes'
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
        onSetMax={(liftId) => {
          setFocusLift(liftId);
          setRunningId(null);
          go('maxes');
        }}
      />
    );
  }

  return (
    <>
      {update.available && (
        <Banner
          id="update"
          tone="warn"
          message="UPDATE AVAILABLE"
          actionLabel="Update"
          onAction={() => setShowUpdate(true)}
          onDismiss={update.dismiss}
        />
      )}

      {update.swFailed && (
        <Banner
          id="sw-failed"
          tone="warn"
          message="Offline mode is unavailable this session — the service worker did not register."
        />
      )}

      {quotaError && (
        <Banner
          id="quota"
          tone="alert"
          message={`Write failed — the device is out of storage. Your last change was NOT saved. Export and free space. (${quotaError})`}
          onDismiss={() => setQuotaError(null)}
        />
      )}

      {showUpdate && (
        <UpdatePrompt
          profile={data?.profile ?? null}
          onCancel={() => setShowUpdate(false)}
          onApply={async () => {
            await update.apply();
            setShowUpdate(false);
          }}
        />
      )}

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

      {route === 'tests' && <Tests />}

      {route === 'maxes' && (
        <Maxes
          focusLiftId={focusLift}
          onBack={() => {
            setFocusLift(null);
            go('settings');
          }}
        />
      )}

      {route === 'settings' && <Settings onOpenMaxes={() => go('maxes')} />}

      {route !== 'dashboard' && route !== 'settings' && route !== 'calendar' &&
        route !== 'maxes' && route !== 'tests' && (
        <Placeholder title={SCREEN_COPY[activeTab].title} note={SCREEN_COPY[activeTab].note} />
      )}

      <TabBar active={activeTab} onSelect={(id) => go(id)} />
    </>
  );
}
