import { useState } from 'preact/hooks';
import { SetRow, type SetDraft } from './SetRow';
import { Sheet } from './Sheet';
import type { Exercise, SetLog, Units } from '../types';

interface ExerciseCardProps {
  exercise: Exercise;
  units: Units;
  sessionColor: string;
  logs: SetLog[];
  drafts: Record<number, Record<string, SetDraft>>;
  onDraft: (setIndex: number, sideKey: string, patch: Partial<SetDraft>) => void;
  onComplete: (setIndex: number) => void;
  onReopen: (setIndex: number) => void;
}

export function ExerciseCard({
  exercise, units, sessionColor, logs, drafts, onDraft, onComplete, onReopen,
}: ExerciseCardProps) {
  const [info, setInfo] = useState(false);

  const doseLine = `${exercise.sets} × ${exercise.reps}${exercise.perSide ? ' / side' : ''}`;

  return (
    <article class="exercise" data-testid="exercise-card" data-exercise-id={exercise.id}>
      <header class="exercise__head">
        <h3 class="exercise__name">{exercise.name}</h3>
        <button
          type="button"
          class="exercise__info"
          aria-label={`Regression and progression for ${exercise.name}`}
          onClick={() => setInfo(true)}
        >
          i
        </button>
      </header>

      <p class="exercise__dose num">{doseLine}</p>

      <p class="exercise__load num">
        {/* Resolved weight needs the load calculator (Phase 6) and dose data
            that does not exist yet. An em-dash is honest; a number would not be. */}
        <span style={{ color: sessionColor }}>—</span>
        {exercise.restSec > 0 && <> · REST {exercise.restSec}s</>}
      </p>

      {/* Intent and the termination rule are ALWAYS visible, never behind a
          tap. They are what replaces a movement demo video. */}
      <p class="exercise__intent">{exercise.intent}</p>
      <p class="exercise__termination">⚠ {exercise.terminationRule}</p>

      <div class="exercise__sets">
        {Array.from({ length: exercise.sets }, (_, i) => (
          <SetRow
            key={i}
            exercise={exercise}
            setIndex={i}
            units={units}
            logs={logs.filter((l) => l.setIndex === i)}
            draft={drafts[i] ?? {}}
            onDraft={(sideKey, patch) => onDraft(i, sideKey, patch)}
            onComplete={() => onComplete(i)}
            onReopen={() => onReopen(i)}
          />
        ))}
      </div>

      <p class="exercise__source">{exercise.source}</p>

      {info && (
        <Sheet title={exercise.name} onClose={() => setInfo(false)} testId="info-sheet">
          <p class="sheet__label">REGRESSION</p>
          <p class="info__text">{exercise.regression}</p>
          <p class="sheet__label">PROGRESSION</p>
          <p class="info__text">{exercise.progression}</p>
          <button type="button" class="btn btn--secondary sheet__cancel" onClick={() => setInfo(false)}>
            CLOSE
          </button>
        </Sheet>
      )}
    </article>
  );
}
