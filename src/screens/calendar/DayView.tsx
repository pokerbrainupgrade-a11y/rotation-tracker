import { longDate, shiftDate } from '../../lib/calendarGrid';
import { sessionColor } from '../../lib/sessionColor';
import { metabolicLoad, neuralLoad } from '../../lib/sessionMeta';
import { toLocalDate } from '../../data/dates';
import type { Exercise, ScheduledSession, SessionTemplate } from '../../types';

interface DayViewProps {
  localDate: string;
  sessions: ScheduledSession[];
  templates: SessionTemplate[];
  exercises: Exercise[];
  now: Date;
  onNavigate: (localDate: string) => void;
  onSchedule: (localDate: string) => void;
  onDefer: (session: ScheduledSession) => void;
  onDelete: (session: ScheduledSession) => void;
  onStart: (sessionId: string) => void;
}

export function DayView({
  localDate, sessions, templates, exercises, now,
  onNavigate, onSchedule, onDefer, onDelete, onStart,
}: DayViewProps) {
  const today = toLocalDate(now);
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  return (
    <div class="day" data-testid="day-view" data-date={localDate}>
      <header class="day__header">
        <button
          type="button"
          class="day__chev"
          aria-label="Previous day"
          onClick={() => onNavigate(shiftDate(localDate, -1))}
        >
          ‹
        </button>
        <span class="day__date">{longDate(localDate)}</span>
        <button
          type="button"
          class="day__chev"
          aria-label="Next day"
          onClick={() => onNavigate(shiftDate(localDate, 1))}
        >
          ›
        </button>
        {localDate !== today && (
          <button
            type="button"
            class="day__today"
            onClick={() => onNavigate(today)}
          >
            TODAY
          </button>
        )}
      </header>

      {sessions.length === 0 ? (
        <button
          type="button"
          class="btn btn--primary day__empty"
          data-testid="day-schedule"
          onClick={() => onSchedule(localDate)}
        >
          + SCHEDULE SESSION
        </button>
      ) : (
        sessions.map((session) => {
          const template = templates.find((t) => t.id === session.templateId);
          const color = sessionColor(session.position);
          return (
            <article
              key={session.id}
              class="day-card"
              data-testid="day-session"
              data-session-id={session.id}
              style={{ borderLeftColor: color }}
            >
              <div class="day-card__pos num" style={{ color }}>{session.position}</div>
              <div class="day-card__name">{template?.name ?? 'Session'}</div>

              <div class="day-card__pills">
                <span class="statpill">
                  NEURAL <span class="num">{neuralLoad(session.position)}</span>/
                  <span class="num">10</span>
                </span>
                <span class="statpill">
                  METABOLIC <span class="num">{metabolicLoad(session.position)}</span>/
                  <span class="num">10</span>
                </span>
              </div>

              <div class="day-card__meta num">
                {session.blockId.replace(/^block\./, '').toUpperCase()} · R{session.rotationNumber}
                <span class="status-chip" data-status={session.status}>
                  {session.status.toUpperCase()}
                </span>
              </div>

              {template && (
                <ul class="day-card__exercises">
                  {template.sections.flatMap((section) =>
                    section.exerciseIds.map((id) => (
                      <li key={`${section.id}-${id}`} class="exercise-row">
                        <span class="exercise-row__name">
                          {exerciseById.get(id)?.name ?? id}
                        </span>
                        {/*
                          Sets/reps and resolved load both depend on dose data
                          and the load calculator, neither of which exists yet
                          (blocks.ts is unbuilt, Phase 6 owns the calculator).
                          Rendering a plausible-looking number here would be
                          worse than rendering nothing.
                        */}
                        <span class="exercise-row__dose num">—</span>
                      </li>
                    )),
                  )}
                </ul>
              )}

              <div class="day-card__actions">
                <button
                  type="button"
                  class="btn btn--primary day-card__start"
                  data-testid="start-session"
                  onClick={() => onStart(session.id)}
                >
                  START
                </button>
                <div class="day-card__secondary">
                  <button type="button" class="btn btn--ghost">Edit</button>
                  <button
                    type="button"
                    class="btn btn--ghost"
                    data-testid="defer-open"
                    onClick={() => onDefer(session)}
                  >
                    Defer
                  </button>
                  <button
                    type="button"
                    class="btn btn--ghost"
                    data-testid="delete-open"
                    onClick={() => onDelete(session)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
          );
        })
      )}

      {sessions.length > 0 && (
        <button
          type="button"
          class="btn btn--secondary day__add"
          data-testid="day-schedule"
          onClick={() => onSchedule(localDate)}
        >
          + SCHEDULE SESSION
        </button>
      )}
    </div>
  );
}
