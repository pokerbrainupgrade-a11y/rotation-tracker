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
import { SubstitutionSheet, type SubstitutionResult } from './session/SubstitutionSheet';
import { EsdSheet, type EsdResult } from './session/EsdSheet';
import { CompressionSheet } from './session/CompressionSheet';
import { SummarySheet, type LedgerDelta } from './session/SummarySheet';
import { doseFor, isCut, resolveCompression } from '../engine/compression';
import { sessionTotals, volumeView } from '../engine/instrumentation';
import { contralateralRatio } from '../engine/instrumentation';
import { sessionColor } from '../lib/sessionColor';
import { playRestComplete } from '../lib/audioCue';
import {
  getScheduled,
  getSetLogsByScheduled,
  getSetLogsByExercise,
  listExercises,
  listSessionTemplates,
  listSubstitutionTags,
  listScheduled,
  listSetLogs,
  putEsdLog,
  updateProfile,
  getProfile,
} from '../data/repo';
import type {
  CompressionLevel, EsdLog, Exercise, LedgerKey, Profile, ScheduledSession,
  SessionTemplate, SetLog, SubstitutionTag,
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
  const [esdLogs, setEsdLogs] = useState<EsdLog[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Record<string, SetDraft>>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [undo, setUndo] = useState<{ ids: string[]; label: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<SubstitutionTag[]>([]);
  const [subFor, setSubFor] = useState<Exercise | null>(null);
  const [esdFor, setEsdFor] = useState<{ exercise: Exercise; aborting: boolean } | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [summary, setSummary] = useState<{
    setsCompleted: number; setsPrescribed: number; tonnage: number;
    deltas: LedgerDelta[]; subs: Array<{ note: string; met: boolean }>;
  } | null>(null);
  const [ratioHistory, setRatioHistory] = useState<Record<string, Array<number | null>>>({});
  const [lastPerf, setLastPerf] = useState<Record<string, { load: number | null; reps: number | null }>>({});

  const save = useSessionAutosave(sessionId);

  /* ---- load ---- */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [s, templates, ex, p, existing, subTags] = await Promise.all([
        getScheduled(sessionId),
        listSessionTemplates(),
        listExercises(),
        getProfile(),
        getSetLogsByScheduled(sessionId),
        listSubstitutionTags(),
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
      setTags(subTags);
      setLoading(false);

      // Prior-session ratio history and last performance, for the two-tier
      // contralateral flag and the LAST chip. Read once — neither changes
      // mid-session.
      const tmpl = templates.find((t) => t.id === s.templateId);
      const bilateral = (tmpl?.sections ?? [])
        .flatMap((sec) => sec.exerciseIds)
        .filter((id) => ex.find((e) => e.id === id)?.perSide);
      if (bilateral.length > 0) {
        const [allSessions, allLogs] = await Promise.all([listScheduled(), listSetLogs()]);
        const priorDone = allSessions
          .filter((x) => x.status === 'done' && x.id !== s.id)
          .sort((a, b) => (a.localDate < b.localDate ? -1 : 1));
        const hist: Record<string, Array<number | null>> = {};
        for (const id of bilateral) {
          hist[id] = priorDone.map((ps) =>
            contralateralRatio(allLogs.filter((l) => l.scheduledId === ps.id), id),
          );
        }
        if (!cancelled) setRatioHistory(hist);
      }

      const perf: Record<string, { load: number | null; reps: number | null }> = {};
      for (const id of new Set((tmpl?.sections ?? []).flatMap((sec) => sec.exerciseIds))) {
        const history = (await getSetLogsByExercise(id))
          .filter((l) => l.scheduledId !== s.id && l.completed)
          .sort((a, b) => b.ts - a.ts);
        const latest = history[0];
        if (latest) perf[id] = { load: latest.load, reps: latest.reps };
      }
      if (!cancelled) setLastPerf(perf);

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
        const side = row[sideKey] ?? { load: null, reps: null, metric: null };
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
        const d = row[sideKey] ?? { load: null, reps: null, metric: null };
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
          // The decay metric goes to whichever column the exercise declares.
          velocity: exercise.decayMetric === 'velocity' ? d.metric : null,
          distance: exercise.decayMetric === 'distance' ? d.metric : null,
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

  /* ---- substitution ---- */
  const logSubstitution = useCallback(
    async (result: SubstitutionResult) => {
      if (!subFor) return;
      // Session-level, because that is what the ledger reads: a substituted
      // session is judged on the dosing-signature answer rather than on which
      // movements were logged.
      const next = await save.patchSession({
        substituted: true,
        metDosingSignature: result.metDosingSignature,
        substitutionNote: `${subFor.name}: ${result.note}`,
      });
      if (next) setSession(next);
      setSubFor(null);
    },
    [subFor, save],
  );

  /* ---- ESD ---- */
  const logEsd = useCallback(
    async (result: EsdResult) => {
      if (!esdFor) return;
      const log: EsdLog = {
        id: `esd-${Date.now().toString(36)}`,
        scheduledId: sessionId,
        type: 'vo2max',
        minutes: result.minutes,
        avgHr: result.avgHr,
        peakHr: result.peakHr,
        intervalsCompleted: result.intervalsCompleted,
        counted: result.counted,
        modality: result.modality,
        ts: Date.now(),
      };
      await putEsdLog(log);
      setEsdLogs((prev) => [...prev, log]);
      setEsdFor(null);
    },
    [esdFor, sessionId],
  );

  /* ---- compression ---- */
  const setCompression = useCallback(
    async (level: CompressionLevel) => {
      // Reversible: only the level changes, so every already-logged set
      // survives a compression change in either direction.
      const next = await save.patchSession({ compressionLevel: level });
      if (next) setSession(next);
      setCompressing(false);
    },
    [save],
  );

  /* ---- training mode ---- */
  const toggleTrainingMode = useCallback(async () => {
    if (!profile) return;
    const next = await updateProfile({ trainingMode: !profile.trainingMode });
    setProfile(next);
  }, [profile]);

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

  /* ---- finish ---- */
  const finish = useCallback(async () => {
    if (!session || !template) return;

    const prescribed = (template.sections ?? [])
      .flatMap((sec) => sec.exerciseIds)
      .filter((id) => !isCut(resolveCompression(template, session.compressionLevel), id))
      .reduce((sum, id) => sum + (exerciseById.get(id)?.sets ?? 0), 0);

    const totals = sessionTotals(logs, prescribed);

    // Deltas come from the REAL ledger engine against this session marked done,
    // so the summary cannot disagree with the Dashboard.
    const done: ScheduledSession = {
      ...session, status: 'done', completedAt: Date.now(), activeTimer: null,
    };
    const { computeLedger } = await import('../engine/ledger');
    const [blocks, allSessions, allSetLogs, allEsd] = await Promise.all([
      import('../data/repo').then((m) => m.listBlocks()),
      listScheduled(),
      listSetLogs(),
      import('../data/repo').then((m) => m.listEsdLogs()),
    ]);
    const block = blocks.find((b) => b.id === session.blockId) ?? blocks[0];

    const merge = <T extends { id: string }>(all: T[], mine: T[]): T[] => [
      ...all.filter((x) => !mine.some((m) => m.id === x.id)), ...mine,
    ];
    const scheduled = merge(allSessions, [done]);
    const setLogsAll = merge(allSetLogs, logs);
    const esdAll = merge(allEsd, esdLogs);

    const now = new Date();
    const before = block
      ? computeLedger({
          scheduled: allSessions, setLogs: allSetLogs, esdLogs: allEsd,
          templates: [template], exercises, block, now,
        })
      : [];
    const after = block
      ? computeLedger({
          scheduled, setLogs: setLogsAll, esdLogs: esdAll,
          templates: [template], exercises, block, now,
        })
      : [];

    const deltas: LedgerDelta[] = [];
    for (const row of after) {
      const prior = before.find((b) => b.key === row.key);
      const delta = row.count - (prior?.count ?? 0);
      const missedDelta = row.missed - (prior?.missed ?? 0);
      if (delta > 0) deltas.push({ key: row.key as LedgerKey, delta });
      else if (row.key === 'vo2max' && missedDelta > 0) {
        deltas.push({ key: 'vo2max', delta: 0, missed: true });
      }
    }

    await save.patchSession({
      status: 'done', completedAt: done.completedAt, activeTimer: null,
    });

    setSummary({
      setsCompleted: totals.setsCompleted,
      setsPrescribed: totals.setsPrescribed,
      tonnage: totals.tonnage,
      deltas,
      subs: session.substituted
        ? [{ note: session.substitutionNote ?? '', met: session.metDosingSignature === true }]
        : [],
    });
  }, [session, template, logs, esdLogs, exercises, exerciseById, save]);

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
  const compression = resolveCompression(template, session.compressionLevel);
  const primeIds = (template.sections ?? [])
    .map((s) => s.primeExerciseId)
    .filter((x): x is string => x !== null);
  const activeExercise = timer.active ? exerciseById.get(timer.active.exerciseId) : undefined;

  return (
    <main
      class="screen session"
      data-testid="session"
      data-session-id={session.id}
      data-training-mode={profile?.trainingMode ? 'true' : undefined}
    >
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

      <div class="session__controls">
        <button
          type="button"
          class="session__ctl"
          data-testid="compress-open"
          onClick={() => setCompressing(true)}
        >
          COMPRESS
        </button>
        {session.compressionLevel < 100 && (
          <span class="session__badge num" data-testid="compression-badge">
            {session.compressionLevel}%
          </span>
        )}
        <button
          type="button"
          class="session__ctl"
          aria-pressed={profile?.trainingMode ? 'true' : 'false'}
          data-testid="training-mode"
          onClick={() => void toggleTrainingMode()}
        >
          TRAINING MODE
        </button>
      </div>

      {compression.note && (
        <p class="session__compnote" data-testid="compression-note">{compression.note}</p>
      )}

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
              {template.volumeCap && exosSectionFor(template.volumeCap.section) === key && (() => {
                const v = volumeView(template.volumeCap, exercises, logs, primeIds);
                return (
                  <span
                    class="exos__cap num"
                    data-testid="volume-cap"
                    data-at-cap={v.atCap ? 'true' : undefined}
                    style={v.atCap ? { color: 'var(--alert)' } : undefined}
                  >
                    {v.label} {v.count} / {v.limit}
                  </span>
                );
              })()}
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
                          ratioHistory={ratioHistory[id] ?? []}
                          dose={doseFor(
                            compression,
                            id,
                            `${ex.sets} × ${ex.reps}${ex.perSide ? ' / side' : ''}`,
                          )}
                          cut={isCut(compression, id)}
                          substitutable={key === 'power' || key === 'esd'}
                          abortable={key === 'esd'}
                          lastPerformance={lastPerf[id] ?? null}
                          drafts={Object.fromEntries(
                            Array.from({ length: ex.sets }, (_, i) => [i, draftFor(id, i)]),
                          )}
                          onDraft={(setIndex, sideKey, patch) =>
                            onDraft(id, setIndex, sideKey, patch)
                          }
                          onComplete={(setIndex) => void completeSet(ex, setIndex)}
                          onReopen={(setIndex) => void reopenSet(ex, setIndex)}
                          onSubstitute={() => setSubFor(ex)}
                          onAbort={() => setEsdFor({ exercise: ex, aborting: true })}
                          onAdoptLast={(setIndex) => {
                            const last = lastPerf[id];
                            if (!last) return;
                            for (const sideKey of ex.perSide ? ['L', 'R'] : ['']) {
                              onDraft(id, setIndex, sideKey, {
                                load: last.load, reps: last.reps,
                              });
                            }
                          }}
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

      <button
        type="button"
        class="btn btn--primary session__finish"
        data-testid="finish-session"
        onClick={() => void finish()}
      >
        FINISH SESSION
      </button>

      {subFor && (
        <SubstitutionSheet
          exercise={subFor}
          tag={
            tags.find((t) => t.appliesTo.includes(subFor.id)) ??
            tags.find((t) => subFor.tags.includes(t.id)) ??
            null
          }
          onClose={() => setSubFor(null)}
          onLog={logSubstitution}
        />
      )}

      {esdFor && (
        <EsdSheet
          aborting={esdFor.aborting}
          onClose={() => setEsdFor(null)}
          onLog={logEsd}
        />
      )}

      {compressing && (
        <CompressionSheet
          template={template}
          current={session.compressionLevel}
          onClose={() => setCompressing(false)}
          onSelect={setCompression}
        />
      )}

      {summary && (
        <SummarySheet
          setsCompleted={summary.setsCompleted}
          setsPrescribed={summary.setsPrescribed}
          tonnage={summary.tonnage}
          units={profile?.units ?? 'lb'}
          compressionLevel={session.compressionLevel}
          substitutions={summary.subs}
          deltas={summary.deltas}
          onDone={onExit}
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
