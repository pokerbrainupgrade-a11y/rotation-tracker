import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { ExerciseCard } from '../components/ExerciseCard';
import { RestTimerBar } from '../components/RestTimerBar';
import { UndoChip } from '../components/UndoChip';
import { Skeleton } from '../components/Skeleton';
import type { SetDraft } from '../components/SetRow';
import { useTimer } from '../hooks/useTimer';
import { useWakeLock } from '../hooks/useWakeLock';
import { useSessionAutosave } from '../hooks/useSessionAutosave';
import { EXOS_LABEL, EXOS_ORDER, exosSectionFor, isChecklist, type ExosSection } from '../lib/exosSections';
import { sessionColor } from '../lib/sessionColor';
import { playRestComplete } from '../lib/audioCue';
import {
  getScheduled,
  getSetLogsByScheduled,
  listExercises,
  listSessionTemplates,
  getProfile,
} from '../data/repo';
import type {
  Exercise, Profile, ScheduledSession, SessionTemplate, SetLog,
} from '../types';

interface SessionProps {
  sessionId: string;
  onExit: () => void;
}

let seq = 0;
const newId = (): string => `set-${Date.now().toString(36)}-${++seq}`;

export function Session({ sessionId, onExit }: SessionProps) {
  const [session, setSession] = useState<ScheduledSession | null>(null);
  const [template, setTemplate] = useState<SessionTemplate | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [logs, setLogs] = useState<SetLog[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Record<string, SetDraft>>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [undo, setUndo] = useState<{ ids: string[]; label: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const save = useSessionAutosave(sessionId);

  /* ---- load ---- */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [s, templates, ex, p, existing] = await Promise.all([
        getScheduled(sessionId),
        listSessionTemplates(),
        listExercises(),
        getProfile(),
        getSetLogsByScheduled(sessionId),
      ]);
      if (cancelled || !s) {
        setLoading(false);
        return;
      }
      setSession(s);
      setTemplate(templates.find((t) => t.id === s.templateId) ?? null);
      setExercises(ex);
      setProfile(p ?? null);
      setLogs(existing);
      setLoading(false);

      // Mark the session started on first entry. status stays `planned` until
      // completion — an in-progress session is not a done session.
      if (s.startedAt === null) {
        const next = await save.patchSession({ startedAt: Date.now() });
        if (next && !cancelled) setSession(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, save]);

  const persistTimer = useCallback(
    async (timer: Parameters<typeof save.setTimer>[0]) => {
      await save.setTimer(timer);
    },
    [save],
  );

  const timer = useTimer(session?.activeTimer ?? null, persistTimer);
  const wake = useWakeLock(profile?.wakeLockEnabled !== false);

  // One tone when the interval empties, if enabled.
  const [tonePlayed, setTonePlayed] = useState(false);
  useEffect(() => {
    if (timer.complete && !tonePlayed) {
      setTonePlayed(true);
      if (profile?.audioCueEnabled) playRestComplete();
    }
    if (!timer.complete && tonePlayed) setTonePlayed(false);
  }, [timer.complete, tonePlayed, profile]);

  const exerciseById = useMemo(
    () => new Map(exercises.map((e) => [e.id, e])),
    [exercises],
  );

  /* ---- section assembly: fixed Exos order ---- */
  const sections = useMemo(() => {
    const out = new Map<ExosSection, string[]>();
    for (const key of EXOS_ORDER) out.set(key, []);
    for (const s of template?.sections ?? []) {
      const key = exosSectionFor(s.role);
      out.get(key)?.push(...s.exerciseIds);
    }
    return out;
  }, [template]);

  const draftFor = useCallback(
    (exerciseId: string, setIndex: number): Record<string, SetDraft> =>
      drafts[`${exerciseId}:${setIndex}`] ?? {},
    [drafts],
  );

  const onDraft = useCallback(
    (exerciseId: string, setIndex: number, sideKey: string, patch: Partial<SetDraft>) => {
      setDrafts((prev) => {
        const key = `${exerciseId}:${setIndex}`;
        const row = prev[key] ?? {};
        const side = row[sideKey] ?? { load: null, reps: null };
        return { ...prev, [key]: { ...row, [sideKey]: { ...side, ...patch } } };
      });
    },
    [],
  );

  /* ---- set completion: AWAIT the write before the UI advances ---- */
  const completeSet = useCallback(
    async (exercise: Exercise, setIndex: number) => {
      const row = draftFor(exercise.id, setIndex);
      const sides = exercise.perSide ? ['L', 'R'] : [''];
      const ts = Date.now();

      const written: SetLog[] = sides.map((sideKey) => {
        const d = row[sideKey] ?? { load: null, reps: null };
        return {
          id: newId(),
          scheduledId: sessionId,
          exerciseId: exercise.id,
          setIndex,
          side: sideKey === '' ? null : (sideKey as 'L' | 'R'),
          load: d.load,
          unit: d.load === null ? null : (profile?.units ?? 'lb'),
          reps: d.reps ?? exercise.reps,
          rpe: null,
          velocity: null,
          distance: null,
          contacts: null,
          completed: true,
          note: null,
          ts,
        };
      });

      // Sequential awaits, no batching: each set is durable the moment it is
      // tapped, not when some flush window closes.
      for (const log of written) await save.logSet(log);

      setLogs((prev) => [...prev, ...written]);
      setUndo({ ids: written.map((w) => w.id), label: `SET ${setIndex + 1} LOGGED` });

      if (exercise.restSec > 0) timer.start(exercise.id, exercise.restSec);
    },
    [draftFor, profile, save, sessionId, timer],
  );

  const reopenSet = useCallback(
    async (exercise: Exercise, setIndex: number) => {
      const target = logs.filter(
        (l) => l.exerciseId === exercise.id && l.setIndex === setIndex,
      );
      for (const l of target) await save.removeSet(l.id);
      setLogs((prev) => prev.filter((l) => !target.some((t) => t.id === l.id)));
    },
    [logs, save],
  );

  const doUndo = useCallback(async () => {
    if (!undo) return;
    for (const id of undo.ids) await save.removeSet(id);
    setLogs((prev) => prev.filter((l) => !undo.ids.includes(l.id)));
    setUndo(null);
    timer.skip();
  }, [undo, save, timer]);

  /* ---- checklist ---- */
  const toggleCheck = useCallback(
    async (itemId: string) => {
      if (!session) return;
      const has = session.checklist.includes(itemId);
      const next = has
        ? session.checklist.filter((x) => x !== itemId)
        : [...session.checklist, itemId];
      setSession({ ...session, checklist: next });
      await save.setChecklist(next);
    },
    [session, save],
  );

  if (loading) return <Skeleton />;
  if (!session || !template) {
    return (
      <main class="screen" data-testid="session-missing">
        <h1 class="screen__title">Session not found</h1>
        <button type="button" class="btn btn--secondary" onClick={onExit}>BACK</button>
      </main>
    );
  }

  const color = sessionColor(session.position);
  const activeExercise = timer.active ? exerciseById.get(timer.active.exerciseId) : undefined;

  return (
    <main class="screen session" data-testid="session" data-session-id={session.id}>
      <header class="session__header">
        <button type="button" class="session__exit" aria-label="Leave session" onClick={onExit}>
          ‹
        </button>
        <span class="session__pos num" style={{ color }}>{session.position}</span>
        <span class="session__name">{template.name}</span>
        {wake.active && (
          <span class="session__wake" data-testid="wake-indicator">SCREEN ON</span>
        )}
      </header>

      {EXOS_ORDER.map((key) => {
        const ids = sections.get(key) ?? [];
        if (ids.length === 0) return null;
        const checklist = isChecklist(key);
        const allChecked =
          checklist && ids.every((id) => session.checklist.includes(id));
        const isCollapsed = collapsed[key] ?? false;

        return (
          <section class="exos" key={key} data-section={key} data-complete={allChecked || undefined}>
            <button
              type="button"
              class="exos__head"
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((p) => ({ ...p, [key]: !isCollapsed }))}
            >
              <span class="exos__title">{EXOS_LABEL[key]}</span>
              {allChecked && <span class="exos__check">✓</span>}
            </button>

            {!isCollapsed && (
              <div class="exos__body">
                {checklist
                  ? ids.map((id) => {
                      const ex = exerciseById.get(id);
                      const checked = session.checklist.includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          class="check-row"
                          data-testid="check-row"
                          aria-pressed={checked}
                          onClick={() => void toggleCheck(id)}
                        >
                          <span class="check-row__box">{checked ? '✓' : ''}</span>
                          <span class="check-row__name">{ex?.name ?? id}</span>
                        </button>
                      );
                    })
                  : ids.map((id) => {
                      const ex = exerciseById.get(id);
                      if (!ex) return null;
                      return (
                        <ExerciseCard
                          key={id}
                          exercise={ex}
                          units={profile?.units ?? 'lb'}
                          sessionColor={color}
                          logs={logs.filter((l) => l.exerciseId === id)}
                          drafts={Object.fromEntries(
                            Array.from({ length: ex.sets }, (_, i) => [i, draftFor(id, i)]),
                          )}
                          onDraft={(setIndex, sideKey, patch) =>
                            onDraft(id, setIndex, sideKey, patch)
                          }
                          onComplete={(setIndex) => void completeSet(ex, setIndex)}
                          onReopen={(setIndex) => void reopenSet(ex, setIndex)}
                        />
                      );
                    })}
              </div>
            )}
          </section>
        );
      })}

      {undo && (
        <UndoChip
          key={undo.ids.join(',')}
          label={undo.label}
          onUndo={() => void doUndo()}
          onExpire={() => setUndo(null)}
        />
      )}

      <RestTimerBar
        timer={timer}
        purpose={activeExercise?.restPurpose ?? ''}
        color={color}
      />
    </main>
  );
}
