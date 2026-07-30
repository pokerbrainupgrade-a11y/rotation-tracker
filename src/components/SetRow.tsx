import { NumberStepper } from './NumberStepper';
import type { Exercise, SetLog, Units } from '../types';

export interface SetDraft {
  load: number | null;
  reps: number | null;
  /**
   * The exercise's decay metric (velocity m/s or distance). Without a field for
   * it the decay floor could never display, because nothing would ever record
   * the number it reads.
   */
  metric: number | null;
}

interface SetRowProps {
  exercise: Exercise;
  setIndex: number;
  units: Units;
  /** Existing logs for this set index, keyed by side ('' for bilateral-agnostic). */
  logs: SetLog[];
  draft: Record<string, SetDraft>;
  /** A rep in this set landed below the decay floor. Styling only. */
  belowFloor?: boolean;
  lastPerformance?: { load: number | null; reps: number | null } | null;
  onAdoptLast?: () => void;
  onDraft: (sideKey: string, patch: Partial<SetDraft>) => void;
  onComplete: () => void;
  onReopen: () => void;
}

/**
 * The most-touched element in the app.
 *
 * The whole row is the completion target — 56px minimum, so a wet thumb landing
 * anywhere in the row logs the set. The steppers stop propagation so adjusting
 * a value never completes the set by accident.
 *
 * Bilateral exercises log L and R as SEPARATE records in one row. One field for
 * both would make a left/right asymmetry — the thing the test battery exists to
 * detect — permanently invisible.
 */
export function SetRow({
  exercise, setIndex, units, logs, draft, belowFloor = false,
  lastPerformance = null, onAdoptLast, onDraft, onComplete, onReopen,
}: SetRowProps) {
  const sides: Array<{ key: string; label: string | null }> = exercise.perSide
    ? [{ key: 'L', label: 'L' }, { key: 'R', label: 'R' }]
    : [{ key: '', label: null }];

  const done = logs.length > 0 && logs.every((l) => l.completed);

  return (
    <div
      class="setrow"
      data-testid="set-row"
      data-set-index={setIndex}
      data-done={done ? 'true' : 'false'}
      data-below-floor={belowFloor ? 'true' : undefined}
      role="button"
      tabIndex={0}
      aria-label={`Set ${setIndex + 1}${done ? ', logged' : ''}`}
      onClick={() => (done ? onReopen() : onComplete())}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (done) onReopen();
          else onComplete();
        }
      }}
    >
      <span class="setrow__label num">SET {setIndex + 1}</span>

      <span class="setrow__fields">
        {sides.map(({ key, label }) => {
          const values = draft[key] ?? { load: null, reps: null, metric: null };
          return (
            <span class="setrow__side" key={key || 'bilateral'} data-side={key || undefined}>
              {label && <span class="setrow__sidelabel">{label}</span>}
              <NumberStepper
                label={`Set ${setIndex + 1}${label ? ` ${label}` : ''} load`}
                value={values.load}
                step={units === 'kg' ? 2.5 : 5}
                suffix={units}
                disabled={done}
                onChange={(n) => onDraft(key, { load: n })}
              />
              <NumberStepper
                label={`Set ${setIndex + 1}${label ? ` ${label}` : ''} reps`}
                value={values.reps}
                disabled={done}
                onChange={(n) => onDraft(key, { reps: n })}
              />
              {exercise.decayMetric !== null && (
                <NumberStepper
                  label={`Set ${setIndex + 1}${label ? ` ${label}` : ''} ${exercise.decayMetric}`}
                  value={values.metric}
                  step={exercise.decayMetric === 'velocity' ? 0.05 : 0.5}
                  suffix={exercise.decayMetric === 'velocity' ? 'm/s' : 'm'}
                  disabled={done}
                  onChange={(n) => onDraft(key, { metric: n })}
                />
              )}
            </span>
          );
        })}
      </span>

      {lastPerformance && !done && (
        <button
          type="button"
          class="setrow__last num"
          data-testid="last-chip"
          aria-label="Adopt last session values"
          onClick={(e) => {
            e.stopPropagation();
            onAdoptLast?.();
          }}
        >
          LAST: {lastPerformance.load ?? '—'} × {lastPerformance.reps ?? '—'}
        </button>
      )}

      {/*
        A dedicated completion control as well as the row-level tap.
        The steppers occupy the middle of the row and stop propagation, so
        "tap the row" in practice only works at its edges — which is not good
        enough for the one control you hit twenty times with wet hands. This
        is a real 56px target that always completes.
      */}
      <button
        type="button"
        class="setrow__check"
        data-testid="set-complete"
        aria-label={done ? `Reopen set ${setIndex + 1}` : `Complete set ${setIndex + 1}`}
        onClick={(e) => {
          e.stopPropagation();
          if (done) onReopen();
          else onComplete();
        }}
      >
        {done ? '✓' : '○'}
      </button>
    </div>
  );
}
