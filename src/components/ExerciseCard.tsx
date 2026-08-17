import { useState } from 'preact/hooks';
import { SetRow, type SetDraft } from './SetRow';
import { Sheet } from './Sheet';
import {
  contralateralRatio,
  decayView,
  isBelowFloor,
  ratioColorVar,
  ratioLabel,
  ratioStatus,
} from '../engine/instrumentation';
import { plateDeltaLine, plateLine, resolveLoad } from '../engine/loadResolve';
import type { Exercise, MaxRecord, Profile, SetLog, Units } from '../types';

interface ExerciseCardProps {
  exercise: Exercise;
  units: Units;
  sessionColor: string;
  logs: SetLog[];
  /** This exercise's ratio in prior sessions, oldest first. */
  ratioHistory: Array<number | null>;
  dose: string;
  cut: boolean;
  substitutable: boolean;
  abortable: boolean;
  drafts: Record<number, Record<string, SetDraft>>;
  /** Most recent completed set for this exercise, from an earlier session. */
  lastPerformance: { load: number | null; reps: number | null } | null;
  profile: Pick<Profile, 'units' | 'hrMax' | 'barWeight' | 'plateInventory'>;
  maxes: MaxRecord[];
  onSetMax: (liftId: string) => void;
  onDraft: (setIndex: number, sideKey: string, patch: Partial<SetDraft>) => void;
  onComplete: (setIndex: number) => void;
  onReopen: (setIndex: number) => void;
  onSubstitute: () => void;
  onAbort: () => void;
  onAdoptLast: (setIndex: number) => void;
}

export function ExerciseCard({
  exercise, units, sessionColor, logs, ratioHistory, dose, cut,
  substitutable, abortable, drafts, lastPerformance, profile, maxes, onSetMax,
  onDraft, onComplete, onReopen, onSubstitute, onAbort, onAdoptLast,
}: ExerciseCardProps) {
  const [info, setInfo] = useState(false);

  // Instrumentation, all of it DISPLAY ONLY: nothing below prompts, gates or
  // recommends. The numbers appear; the athlete decides.
  const ratio = ratioStatus([...ratioHistory, contralateralRatio(logs, exercise.id)]);

  return (
    <article
      class="exercise"
      data-testid="exercise-card"
      data-exercise-id={exercise.id}
      data-cut={cut ? 'true' : undefined}
      aria-disabled={cut ? 'true' : undefined}
    >
      <header class="exercise__head">
        <h3 class="exercise__name">{exercise.name}</h3>
        {substitutable && !cut && (
          <button
            type="button"
            class="exercise__sub"
            data-testid="sub-open"
            aria-label={`Substitute ${exercise.name}`}
            onClick={onSubstitute}
          >
            SUB ⇄
          </button>
        )}
        <button
          type="button"
          class="exercise__info"
          aria-label={`Regression and progression for ${exercise.name}`}
          onClick={() => setInfo(true)}
        >
          i
        </button>
      </header>

      <p class="exercise__dose num">{dose}</p>

      {(() => {
        const load = resolveLoad(exercise, profile, maxes);
        return (
          <>
            <p class="exercise__load num" data-testid="load-line">
              {load.needsMax ? (
                // Never 0, never a fabricated number: an untested lift gets a
                // link to the place that fixes it.
                <button
                  type="button"
                  class="exercise__setmax"
                  data-testid="set-max"
                  style={{ color: sessionColor }}
                  onClick={() => load.missingLiftId && onSetMax(load.missingLiftId)}
                >
                  SET MAX
                </button>
              ) : (
                <span style={{ color: sessionColor }} data-testid="load-primary">
                  {load.primary ?? '—'}
                </span>
              )}
              {load.secondary && (
                <span class="exercise__loadsub" data-testid="load-secondary">
                  {' '}{load.secondary}
                </span>
              )}
              {exercise.restSec > 0 && <> · REST {exercise.restSec}s</>}
            </p>
            {load.plates && load.target !== null && (
              <>
                <p class="exercise__plates num" data-testid="plate-line">
                  {plateLine(load.plates, profile.barWeight)}
                  <span class="exercise__perside"> per side</span>
                </p>
                {plateDeltaLine(load.plates, load.target, profile.units) && (
                  <p class="exercise__delta num" data-testid="plate-delta">
                    {plateDeltaLine(load.plates, load.target, profile.units)}
                  </p>
                )}
              </>
            )}
          </>
        );
      })()}

      {exercise.perSide && ratio.ratio !== null && (
        <p
          class="exercise__ratio num"
          data-testid="ratio"
          data-status={ratio.status}
          style={{ color: `var(${ratioColorVar(ratio.status)})` }}
        >
          {ratioLabel(ratio)}
        </p>
      )}

      <p class="exercise__intent">{exercise.intent}</p>
      <p class="exercise__termination">⚠ {exercise.terminationRule}</p>

      {!cut && (
        <div class="exercise__sets">
          {Array.from({ length: exercise.sets }, (_, i) => {
            const decay = decayView(exercise, logs, i);
            return (
              <div key={i} class="setblock">
                {decay.floor !== null && (
                  <p class="decay num" data-testid="decay-floor">
                    BEST {decay.setBest} · FLOOR {decay.floor}
                    {decay.sessionBest !== null && decay.sessionBest !== decay.setBest && (
                      <span class="decay__session"> · SESSION BEST {decay.sessionBest}</span>
                    )}
                  </p>
                )}
                <SetRow
                  exercise={exercise}
                  setIndex={i}
                  units={units}
                  logs={logs.filter((l) => l.setIndex === i)}
                  draft={drafts[i] ?? {}}
                  belowFloor={isBelowFloor(exercise, logs, i)}
                  lastPerformance={lastPerformance}
                  onDraft={(sideKey, patch) => onDraft(i, sideKey, patch)}
                  onComplete={() => onComplete(i)}
                  onReopen={() => onReopen(i)}
                  onAdoptLast={() => onAdoptLast(i)}
                />
              </div>
            );
          })}
        </div>
      )}

      {abortable && !cut && (
        <button
          type="button"
          class="btn btn--destructive exercise__abort"
          data-testid="esd-abort"
          onClick={onAbort}
        >
          ABORT — LOG AS MISSED
        </button>
      )}

      <p class="exercise__source">{exercise.source}</p>

      {info && (
        <Sheet title={exercise.name} onClose={() => setInfo(false)} testId="info-sheet">
          <p class="sheet__label">REGRESSION</p>
          <p class="info__text">{exercise.regression}</p>
          <p class="sheet__label">PROGRESSION</p>
          <p class="info__text">{exercise.progression}</p>
          <button
            type="button"
            class="btn btn--secondary sheet__cancel"
            onClick={() => setInfo(false)}
          >
            CLOSE
          </button>
        </Sheet>
      )}
    </article>
  );
}
