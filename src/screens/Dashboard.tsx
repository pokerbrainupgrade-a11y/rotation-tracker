import { useCallback, useMemo, useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ExportStatus } from '../components/ExportStatus';
import { LedgerPanel } from '../components/LedgerPanel';
import { RecentRow } from '../components/RecentRow';
import { StatPill } from '../components/StatPill';
import { WarningList } from '../components/WarningList';
import { sessionColor } from '../lib/sessionColor';
import { metabolicLoad, neuralLoad } from '../lib/sessionMeta';
import { loadDismissed, saveDismissed } from '../lib/dismissals';
import type { DashboardData } from '../hooks/useDashboard';

interface DashboardProps {
  data: DashboardData;
  today: string;
  onOpenSettings: () => void;
  onStart: (sessionId: string) => void;
}

export function Dashboard({ data, today, onOpenSettings, onStart }: DashboardProps) {
  const [dismissed, setDismissed] = useState<string[]>(() => loadDismissed(today));
  const [exporting, setExporting] = useState(false);

  const dismiss = useCallback(
    (id: string) => {
      setDismissed((prev) => {
        if (prev.includes(id)) return prev;
        const next = [...prev, id];
        saveDismissed(today, next);
        return next;
      });
    },
    [today],
  );

  const visibleWarnings = useMemo(
    () => data.warnings.filter((w) => !(w.dismissible && dismissed.includes(w.id))),
    [data.warnings, dismissed],
  );

  const onExport = useCallback(() => {
    setExporting(true);
    void (async () => {
      try {
        const { downloadBackup } = await import('../data/backup');
        await downloadBackup();
      } catch {
        // A cancelled share sheet is not a failure worth shouting about; the
        // status line simply stays stale, which is the honest outcome.
      } finally {
        setExporting(false);
      }
    })();
  }, []);

  const { next } = data;
  const color = sessionColor(next.position);

  return (
    <main class="screen dashboard" data-testid="dashboard">
      <div class="dashboard__mesh" aria-hidden="true" />

      {/* 1 — header strip */}
      <header class="dash-header">
        <span class="dash-header__block">{data.blockLine}</span>
        <span class="dash-header__date">{data.todayLabel}</span>
        <button
          type="button"
          class="dash-header__gear"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <circle cx="10" cy="10" r="3" fill="none" stroke="currentColor" stroke-width="1.4" />
            <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.4"
              stroke-dasharray="2.6 2.2" />
          </svg>
        </button>
      </header>

      {/* 2 — next session */}
      <Card accent={color} class="next-card">
        <div class="next-card__pos num" style={{ color }} data-testid="next-position">
          {next.position}
        </div>
        <div class="next-card__name">{next.template?.name ?? 'Session'}</div>
        <div class="next-card__pills">
          <StatPill label="NEURAL" value={neuralLoad(next.position)} />
          <StatPill label="METABOLIC" value={metabolicLoad(next.position)} />
        </div>
        <div
          class="next-card__date"
          data-unscheduled={next.scheduled ? undefined : 'true'}
        >
          {next.scheduled ? next.scheduled.localDate : 'UNSCHEDULED'}
        </div>
        <Button
          variant="primary"
          class="next-card__start"
          disabled={!next.scheduled}
          onClick={() => { if (next.scheduled) onStart(next.scheduled.id); }}
        >
          START SESSION
        </Button>
        <div class="next-card__links">
          <Button variant="ghost">Schedule</Button>
          <Button variant="ghost">Defer</Button>
        </div>
      </Card>

      {/* 3 — ledger */}
      <LedgerPanel rows={data.ledger} windowLabel={data.windowLabel} />

      {/* 4 — warnings (absent when empty, never empty-stated) */}
      <WarningList warnings={visibleWarnings} onDismiss={dismiss} />

      {/* 5 — recent */}
      {data.recent.length > 0 && (
        <section class="section" data-testid="recent">
          <div class="section__head">
            <h2 class="section__title">Recent</h2>
          </div>
          <div class="recent">
            {data.recent.map(({ session, name }) => (
              <RecentRow key={session.id} session={session} name={name} />
            ))}
          </div>
        </section>
      )}

      {/* 6 — export status */}
      <ExportStatus info={data.exportInfo} onExport={onExport} busy={exporting} />
    </main>
  );
}
