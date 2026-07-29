import { groupByDate, weekOf } from '../../lib/calendarGrid';
import { SessionChip } from '../../components/SessionChip';
import { toLocalDate } from '../../data/dates';
import type { ScheduledSession, SessionTemplate } from '../../types';

interface WeekViewProps {
  anchor: Date;
  sessions: ScheduledSession[];
  templates: SessionTemplate[];
  now: Date;
  onOpenDay: (localDate: string) => void;
  onSchedule: (localDate: string) => void;
}

export function WeekView({
  anchor, sessions, templates, now, onOpenDay, onSchedule,
}: WeekViewProps) {
  const days = weekOf(anchor);
  const byDate = groupByDate(sessions);
  const today = toLocalDate(now);
  const nameById = new Map(templates.map((t) => [t.id, t.name]));

  return (
    <div class="week" data-testid="week-view">
      {days.map((localDate) => {
        const daySessions = byDate.get(localDate) ?? [];
        const dayNum = localDate.slice(8);
        return (
          <div key={localDate} class="week__row" data-date={localDate}>
            <div
              class="week__gutter num"
              data-today={localDate === today ? 'true' : undefined}
            >
              {dayNum}
            </div>

            {daySessions.length === 0 ? (
              <button
                type="button"
                class="week__empty"
                aria-label={`Schedule a session on ${localDate}`}
                onClick={() => onSchedule(localDate)}
              >
                +
              </button>
            ) : (
              <div class="week__sessions">
                {daySessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    class="week__session"
                    data-session-id={s.id}
                    onClick={() => onOpenDay(localDate)}
                  >
                    <SessionChip position={s.position} />
                    <span class="week__name">{nameById.get(s.templateId) ?? 'Session'}</span>
                    <span class="status-chip" data-status={s.status}>
                      {s.status.toUpperCase()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
