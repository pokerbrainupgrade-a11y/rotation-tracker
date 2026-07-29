import { useCallback, useMemo, useState } from 'preact/hooks';
import { DayView } from './calendar/DayView';
import { WeekView } from './calendar/WeekView';
import { MonthView } from './calendar/MonthView';
import { ScheduleSheet } from './calendar/ScheduleSheet';
import { DeferSheet } from './calendar/DeferSheet';
import { DeleteSheet } from './calendar/DeleteSheet';
import { Skeleton } from '../components/Skeleton';
import { useCalendar } from '../hooks/useCalendar';
import { groupByDate } from '../lib/calendarGrid';
import { toLocalDate } from '../data/dates';
import {
  deleteScheduledCascade,
  putScheduled,
  putScheduledMany,
} from '../data/repo';
import type { ScheduledSession } from '../types';

type ViewMode = 'month' | 'week' | 'day';

const VIEW_KEY = 'rotation-tracker:calendar-view';

function loadView(): ViewMode {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    return raw === 'month' || raw === 'week' || raw === 'day' ? raw : 'day';
  } catch {
    return 'day';
  }
}

function parseLocal(localDate: string): Date {
  const [y, m, d] = localDate.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function Calendar({ onStart }: { onStart: (sessionId: string) => void }) {
  const now = useMemo(() => new Date(), []);
  const { loading, data, reload } = useCalendar();

  const [view, setView] = useState<ViewMode>(loadView);
  const [selected, setSelected] = useState<string>(() => toLocalDate(new Date()));
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [deferring, setDeferring] = useState<ScheduledSession | null>(null);
  const [deleting, setDeleting] = useState<ScheduledSession | null>(null);

  const chooseView = useCallback((next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // View preference is not worth failing over.
    }
  }, []);

  const openDay = useCallback(
    (localDate: string) => {
      setSelected(localDate);
      chooseView('day');
    },
    [chooseView],
  );

  const stepMonth = useCallback(
    (months: number) => {
      const d = parseLocal(selected);
      setSelected(toLocalDate(new Date(d.getFullYear(), d.getMonth() + months, 1)));
    },
    [selected],
  );

  const saveSession = useCallback(
    async (session: ScheduledSession) => {
      await putScheduled(session);
      await reload();
      setScheduling(null);
    },
    [reload],
  );

  const confirmDefer = useCallback(
    async (moved: ScheduledSession[]) => {
      // One transaction: a half-shifted schedule is worse than none.
      await putScheduledMany(moved);
      await reload();
      setDeferring(null);
    },
    [reload],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    await deleteScheduledCascade(deleting.id);
    await reload();
    setDeleting(null);
  }, [deleting, reload]);

  if (loading || !data) {
    return <Skeleton />;
  }

  const byDate = groupByDate(data.scheduled);
  const anchor = parseLocal(selected);

  return (
    <main class="screen calendar" data-testid="calendar">
      <div class="segmented" role="tablist" aria-label="Calendar view">
        {(['month', 'week', 'day'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            class="segmented__btn"
            aria-selected={view === mode}
            data-view={mode}
            onClick={() => chooseView(mode)}
          >
            {mode.toUpperCase()}
          </button>
        ))}
      </div>

      {view === 'day' && (
        <DayView
          localDate={selected}
          sessions={byDate.get(selected) ?? []}
          templates={data.templates}
          exercises={data.exercises}
          now={now}
          onNavigate={setSelected}
          onSchedule={setScheduling}
          onDefer={setDeferring}
          onDelete={setDeleting}
          onStart={onStart}
        />
      )}

      {view === 'week' && (
        <WeekView
          anchor={anchor}
          sessions={data.scheduled}
          templates={data.templates}
          now={now}
          onOpenDay={openDay}
          onSchedule={setScheduling}
        />
      )}

      {view === 'month' && (
        <MonthView
          anchor={anchor}
          sessions={data.scheduled}
          now={now}
          onOpenDay={openDay}
          onStep={stepMonth}
        />
      )}

      {scheduling && (
        <ScheduleSheet
          localDate={scheduling}
          schedule={data.scheduled}
          templates={data.templates}
          profile={data.profile}
          now={now}
          onClose={() => setScheduling(null)}
          onSave={saveSession}
        />
      )}

      {deferring && (
        <DeferSheet
          fromLocalDate={deferring.localDate}
          schedule={data.scheduled}
          onClose={() => setDeferring(null)}
          onConfirm={confirmDefer}
        />
      )}

      {deleting && (
        <DeleteSheet
          session={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      )}
    </main>
  );
}
