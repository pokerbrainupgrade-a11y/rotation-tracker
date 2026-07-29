import { useCallback, useEffect, useState } from 'preact/hooks';
import { TabBar } from './components/TabBar';
import { Skeleton } from './components/Skeleton';
import { ErrorScreen } from './components/ErrorScreen';
import { Placeholder } from './screens/Placeholder';
import { Dashboard } from './screens/Dashboard';
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
    route === 'settings' || route === 'setup' ? 'dashboard' : route;

  return (
    <>
      {route === 'dashboard' && data && (
        <Dashboard
          data={data}
          today={toLocalDate(new Date())}
          onOpenSettings={() => go('settings')}
        />
      )}

      {route === 'settings' && (
        <Placeholder
          title="Settings"
          note="Units, maxes, storage and backup land in Phase 6."
        />
      )}

      {route !== 'dashboard' && route !== 'settings' && (
        <Placeholder title={SCREEN_COPY[activeTab].title} note={SCREEN_COPY[activeTab].note} />
      )}

      <TabBar active={activeTab} onSelect={(id) => go(id)} />
    </>
  );
}
