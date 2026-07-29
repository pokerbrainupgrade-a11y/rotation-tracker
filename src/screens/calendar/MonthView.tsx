import {
  DOT_STYLE, densityStrip, dotState, groupByDate, monthLabel, monthMatrix, WEEKDAY_LABELS,
} from '../../lib/calendarGrid';
import { sessionColor } from '../../lib/sessionColor';
import { toLocalDate } from '../../data/dates';
import type { ScheduledSession } from '../../types';

interface MonthViewProps {
  anchor: Date;
  sessions: ScheduledSession[];
  now: Date;
  onOpenDay: (localDate: string) => void;
  onStep: (months: number) => void;
}

function Dot({ session }: { session: ScheduledSession }) {
  const style = DOT_STYLE[dotState(session.status)];
  const color = style.colorVar ? `var(${style.colorVar})` : sessionColor(session.position);
  return (
    <span
      class="dot"
      data-state={dotState(session.status)}
      style={
        style.filled
          ? { background: color, borderColor: color }
          : { background: 'transparent', borderColor: color }
      }
    />
  );
}

export function MonthView({ anchor, sessions, now, onOpenDay, onStep }: MonthViewProps) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const rows = monthMatrix(year, month);
  const byDate = groupByDate(sessions);
  const today = toLocalDate(now);
  const strip = densityStrip(sessions, now);

  return (
    <div class="month" data-testid="month-view">
      <header class="month__header">
        <button type="button" class="day__chev" aria-label="Previous month" onClick={() => onStep(-1)}>
          ‹
        </button>
        <span class="month__label">{monthLabel(year, month)}</span>
        <button type="button" class="day__chev" aria-label="Next month" onClick={() => onStep(1)}>
          ›
        </button>
      </header>

      {/* No weekend shading anywhere below: this program has no weekdays, so
          privileging Saturday and Sunday would contradict the model. */}
      <div class="month__weekdays">
        {WEEKDAY_LABELS.map((label, i) => (
          <span key={i} class="month__weekday">{label}</span>
        ))}
      </div>

      <div class="month__grid">
        {rows.flat().map((localDate, i) =>
          localDate === null ? (
            <div key={`blank-${i}`} class="month__cell month__cell--blank" />
          ) : (
            <button
              key={localDate}
              type="button"
              class="month__cell"
              data-date={localDate}
              data-today={localDate === today ? 'true' : undefined}
              onClick={() => onOpenDay(localDate)}
            >
              <span class="month__num num">{Number(localDate.slice(8))}</span>
              <span class="month__dots">
                {(byDate.get(localDate) ?? []).slice(0, 2).map((s) => (
                  <Dot key={s.id} session={s} />
                ))}
              </span>
            </button>
          ),
        )}
      </div>

      {/* The actual instrument on this screen: gaps and clustering are
          readable at a glance, which the grid above cannot show. */}
      <p class="strip__label">TRAILING 28 DAYS</p>
      <div class="strip" data-testid="density-strip">
        {strip.map((cell) => {
          const first = cell.sessions[0];
          return (
            <span
              key={cell.localDate}
              class="strip__cell"
              data-date={cell.localDate}
              data-empty={first ? undefined : 'true'}
              style={{
                background: first ? sessionColor(first.position) : 'var(--surface-2)',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
