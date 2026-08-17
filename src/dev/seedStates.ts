/**
 * DEV-ONLY visual state seeder.
 *
 * Stripped from production by the `import.meta.env.DEV` guard at every call
 * site, so none of this ships. It exists because verifying "the VO2max row
 * below floor with three missed exposures" by hand-logging sessions is slow
 * enough that in practice you skip it — and then ship a state you never looked
 * at.
 *
 * Usage: append `?scenario=<name>` to the URL.
 */
import { addDaysLocal, toLocalDate } from '../data/dates';
import { getDb } from '../data/db';
import { ensureProfile } from '../data/repo';
import { programSeed } from '../data/seed';
import { SEED_VERSION, type EsdLog, type ScheduledSession, type SetLog } from '../types';

export type ScenarioName =
  | 'healthy'
  | 'below-velocity'
  | 'below-prime'
  | 'below-vo2max'
  | 'below-zone2'
  | 'below-training-days'
  | 'vo2max-missed'
  | 'unscheduled'
  | 'export-overdue'
  | 'export-never'
  | 'warn-td1-not-off-rd'
  | 'warn-double-maxintent'
  | 'warn-esd-after-rd'
  | 'warn-vo2-adjacent'
  | 'warn-cns-ascent'
  | 'warn-gap-4d'
  | 'warn-ledger-floor'
  | 'calendar'
  | 'calendar-empty'
  | 'session-ready'
  | 'session-midway'
  | 'session-stale'
  | 'session-td3'
  | 'session-at-cap'
  | 'session-history'
  | 'setup'
  | 'setup-fail'
  | 'deload-position'
  | 'battery-due'
  | 'battery-fresh'
  | 'db-error'
  | 'no-profile';

export interface DevScenario {
  name: ScenarioName | null;
  /** Force the blocking storage-error screen without breaking real storage. */
  forceDbError: boolean;
}

export function readScenario(search: string = location.search): DevScenario {
  const name = new URLSearchParams(search).get('scenario') as ScenarioName | null;
  return { name, forceDbError: name === 'db-error' };
}

const STABLE_NOW = Date.now();

let id = 0;
const nextId = (): string => `dev-${++id}`;

interface Built {
  scheduled: ScheduledSession[];
  setLogs: SetLog[];
  esdLogs: EsdLog[];
}

const TEMPLATE_BY_POSITION = new Map(
  programSeed.sessionTemplates.map((t) => [t.position, t]),
);

/** A completed session `daysAgo` back, optionally with its defining block logged. */
function session(
  position: ScheduledSession['position'],
  daysAgo: number,
  today: string,
  over: Partial<ScheduledSession> = {},
): ScheduledSession {
  const template = TEMPLATE_BY_POSITION.get(position);
  const localDate = addDaysLocal(today, -daysAgo);
  return {
    id: nextId(),
    localDate,
    ts: new Date(`${localDate}T12:00:00`).getTime(),
    templateId: template?.id ?? 'tmpl.td2-strength',
    position,
    blockId: programSeed.blocks[0]?.id ?? 'block.accumulation',
    rotationNumber: 2,
    status: 'done',
    compressionLevel: 100,
    deload: false,
    substituted: false,
    substitutionNote: null,
    metDosingSignature: null,
    startedAt: null,
    completedAt: null,
    seedVersionAtLog: SEED_VERSION,
    checklist: [],
    activeTimer: null,
    ...over,
  };
}

function maxIntentSet(scheduledId: string, ts: number): SetLog {
  return {
    id: nextId(), scheduledId, exerciseId: 'ex.broad-jump', setIndex: 0, side: null,
    load: null, unit: null, reps: 3, rpe: null, velocity: null, distance: 280,
    contacts: null, completed: true, note: null, ts,
  };
}

function primeSet(scheduledId: string, ts: number): SetLog {
  return { ...maxIntentSet(scheduledId, ts), id: nextId(), exerciseId: 'ex.med-ball-throw' };
}

function vo2(scheduledId: string, ts: number, counted: boolean): EsdLog {
  return {
    id: nextId(), scheduledId, type: 'vo2max', minutes: 24, avgHr: 158, peakHr: 181,
    intervalsCompleted: counted ? 4 : 2, counted, modality: 'bike', ts,
  };
}

function zone2(scheduledId: string, ts: number, minutes: number): EsdLog {
  return {
    id: nextId(), scheduledId, type: 'zone2', minutes, avgHr: 128, peakHr: 140,
    intervalsCompleted: null, counted: true, modality: 'bike', ts,
  };
}

/**
 * A comfortably-above-floor 28 days. Every other scenario is this, weakened in
 * one specific way, so a single row moving below floor is unambiguous.
 */
function healthy(today: string): Built {
  const scheduled: ScheduledSession[] = [];
  const setLogs: SetLog[] = [];
  const esdLogs: EsdLog[] = [];

  // 3:1 rotation across 28 days: TD1, TD2, TD3, RD repeating.
  const cycle = ['TD1', 'TD2', 'TD3', 'RD'] as const;
  for (let d = 27; d >= 0; d--) {
    const position = cycle[(27 - d) % 4];
    if (!position) continue;
    const s = session(position, d, today);
    scheduled.push(s);
    if (position === 'TD1') {
      setLogs.push(maxIntentSet(s.id, s.ts), primeSet(s.id, s.ts + 1000));
    }
    if (position === 'TD3') esdLogs.push(vo2(s.id, s.ts, true));
    if (position === 'RD') esdLogs.push(zone2(s.id, s.ts, 45));
  }
  return { scheduled, setLogs, esdLogs };
}

function build(name: ScenarioName, today: string): Built {
  const base = healthy(today);

  switch (name) {
    case 'healthy':
      return base;

    // Strip EVERY max-intent set: the TD1s still happened, but the defining
    // block did not — exactly the case the ledger rule exists to catch.
    // Both jump and throw have to go: velocityFull is earned by ANY max-intent
    // exercise in a power section, not only the prime.
    case 'below-velocity':
      return {
        ...base,
        setLogs: base.setLogs.filter(
          (l) => l.exerciseId !== 'ex.broad-jump' && l.exerciseId !== 'ex.med-ball-throw',
        ),
      };

    // Prime only. velocityFull survives on the jump, velocityPrime does not —
    // the two rows should visibly disagree here.
    case 'below-prime':
      return { ...base, setLogs: base.setLogs.filter((l) => l.exerciseId !== 'ex.med-ball-throw') };

    case 'below-vo2max':
      return { ...base, esdLogs: base.esdLogs.filter((l) => l.type !== 'vo2max') };

    // Alternate by index, not by timestamp parity: every session is stamped at
    // noon, so parity is constant and would produce no misses at all.
    case 'vo2max-missed': {
      let n = 0;
      return {
        ...base,
        esdLogs: base.esdLogs.map((l) =>
          l.type === 'vo2max' ? { ...l, counted: n++ % 2 === 0 } : l,
        ),
      };
    }

    case 'below-zone2':
      return {
        ...base,
        esdLogs: base.esdLogs.map((l) => (l.type === 'zone2' ? { ...l, minutes: 5 } : l)),
      };

    case 'below-training-days':
    case 'warn-gap-4d':
      return {
        scheduled: base.scheduled.filter((_s, i) => i % 7 === 0),
        setLogs: [], esdLogs: [],
      };

    case 'warn-ledger-floor':
      return { scheduled: [], setLogs: [], esdLogs: [] };

    case 'calendar-empty':
      return { scheduled: [], setLogs: [], esdLogs: [] };

    // A TD3 planned for today, for the ESD abort and TD3 compression paths.
    case 'session-td3':
      return {
        scheduled: [session('TD3', 0, today, { id: 'run-1', status: 'planned' })],
        setLogs: [], esdLogs: [],
      };

    // A TD1 already at its 36-throw cap, so the counter starts amber.
    case 'session-at-cap': {
      const s = session('TD1', 0, today, { id: 'run-1', status: 'planned' });
      return {
        scheduled: [s],
        setLogs: Array.from({ length: 12 }, (_, i) => ({
          ...maxIntentSet(s.id, s.ts + i * 1000),
          id: `cap-${i}`,
          exerciseId: 'ex.med-ball-throw',
          setIndex: i % 4,
          side: (i % 2 === 0 ? 'L' : 'R') as 'L' | 'R',
          reps: 3,
        })),
        esdLogs: [],
      };
    }

    // A completed TD1 last week plus today's planned one, so the LAST chip and
    // the prior-session ratio history both have something to read.
    case 'session-history': {
      const past = session('TD1', 7, today, { id: 'past-1' });
      const todaySession = session('TD1', 0, today, { id: 'run-1', status: 'planned' });
      return {
        scheduled: [past, todaySession],
        setLogs: [
          { ...maxIntentSet(past.id, past.ts), id: 'h-1', reps: 3, load: 12, distance: 24.0 },
          { ...maxIntentSet(past.id, past.ts + 1000), id: 'h-2', setIndex: 1, reps: 3, load: 12, distance: 23.0 },
        ],
        esdLogs: [],
      };
    }

    // A TD1 planned for today, never started. The runner's clean entry point.
    // Rotation 4 is block.accumulation's programmed deload position.
    case 'deload-position':
      return {
        scheduled: [session('TD1', 0, today, { id: 'run-1', status: 'planned', rotationNumber: 4 })],
        setLogs: [], esdLogs: [],
      };

    // No battery marker at all plus plenty of training days -> full battery due.
    case 'battery-due':
      return {
        scheduled: Array.from({ length: 26 }, (_, i) =>
          session('TD2', 26 - i, today, { id: `bd-${i}` }),
        ),
        setLogs: [], esdLogs: [],
      };

    case 'battery-fresh':
      return {
        scheduled: [session('TD2', 1, today, { id: 'bf-1' })],
        setLogs: [], esdLogs: [],
      };

    case 'session-ready':
      return {
        scheduled: [session('TD1', 0, today, { id: 'run-1', status: 'planned' })],
        setLogs: [], esdLogs: [],
      };

    // Started an hour ago with six sets down — the force-quit-mid-workout case.
    case 'session-midway':
    case 'session-stale': {
      const hoursAgo = name === 'session-stale' ? 13 : 1;
      const started = session('TD1', 0, today, {
        id: 'run-1',
        status: 'planned',
        startedAt: STABLE_NOW - hoursAgo * 3_600_000,
      });
      const logs: SetLog[] = Array.from({ length: 6 }, (_, i) => ({
        ...maxIntentSet(started.id, started.ts + i * 1000),
        id: `log-${i}`,
        setIndex: i % 4,
      }));
      return { scheduled: [started], setLogs: logs, esdLogs: [] };
    }

    // A schedule with forward planned sessions at KNOWN spacings, so a
    // deferral's effect on spacing is checkable rather than eyeballed.
    // Planned at +1, +3, +6, +10 days; one past session carrying logs so the
    // delete cascade has something real to destroy.
    case 'calendar': {
      const past = session('TD2', 2, today);
      const scheduled = [
        past,
        session('TD1', -1, today, { status: 'planned' }),
        session('TD2', -3, today, { status: 'planned' }),
        session('TD3', -6, today, { status: 'planned' }),
        session('RD', -10, today, { status: 'planned' }),
      ];
      return {
        scheduled,
        setLogs: [
          maxIntentSet(past.id, past.ts),
          primeSet(past.id, past.ts + 1000),
          { ...maxIntentSet(past.id, past.ts + 2000), id: nextId() },
        ],
        esdLogs: [vo2(past.id, past.ts + 3000, true)],
      };
    }

    case 'unscheduled':
    case 'export-overdue':
    case 'export-never':
      return base;

    case 'warn-td1-not-off-rd':
      return { scheduled: [session('TD2', 2, today), session('TD1', 1, today)], setLogs: [], esdLogs: [] };

    case 'warn-double-maxintent':
      return { scheduled: [session('TD1', 2, today), session('TD1', 1, today)], setLogs: [], esdLogs: [] };

    case 'warn-esd-after-rd':
      return { scheduled: [session('RD', 2, today), session('TD3', 1, today)], setLogs: [], esdLogs: [] };

    case 'warn-vo2-adjacent':
      return { scheduled: [session('TD3', 2, today), session('TD3', 1, today)], setLogs: [], esdLogs: [] };

    case 'warn-cns-ascent':
      return { scheduled: [session('TD3', 2, today), session('TD2', 1, today)], setLogs: [], esdLogs: [] };

    default:
      return base;
  }
}

/** Wipe user data and write the scenario. Returns false when nothing applied. */
export async function applyScenario(name: ScenarioName, now: Date = new Date()): Promise<boolean> {
  if (name === 'db-error') return false;

  const db = await getDb();
  const today = toLocalDate(now);

  const tx = db.transaction(['scheduled', 'setLogs', 'esdLogs'], 'readwrite');
  await Promise.all([
    tx.objectStore('scheduled').clear(),
    tx.objectStore('setLogs').clear(),
    tx.objectStore('esdLogs').clear(),
  ]);
  await tx.done;

  if (name === 'setup' || name === 'setup-fail') {
    const ptx = db.transaction('profile', 'readwrite');
    await ptx.store.clear();
    await ptx.done;
    (globalThis as { __failProfileWrite?: boolean }).__failProfileWrite =
      name === 'setup-fail';
    return true;
  }

  if (name === 'no-profile') {
    const ptx = db.transaction('profile', 'readwrite');
    await ptx.store.clear();
    await ptx.done;
    return true;
  }

  const first = programSeed.blocks[0];
  const profile = await ensureProfile(first?.id ?? 'block.accumulation');

  const lastExport =
    name === 'export-never'
      ? null
      : name === 'export-overdue'
        ? new Date(now.getTime() - 22 * 86_400_000).toISOString()
        : now.toISOString();
  // Rotation 2 by default so the deload-position chip is NOT showing; the
  // deload-position scenario is the only one that lands on it.
  await db.put('profile', {
    ...profile,
    lastExport,
    rotationNumber: name === 'deload-position' ? 4 : 2,
  });

  // A recent completion marker keeps the battery counters low. 'healthy' needs
  // one too: 28 training days with no battery ever logged is genuinely due, so
  // without this the "no warnings at all" scenario would carry one.
  if (name === 'battery-fresh' || name === 'healthy') {
    const ttx = db.transaction('tests', 'readwrite');
    await ttx.store.clear();
    // Both markers: a full battery does not reset the mini counter, so a
    // scenario meaning "nothing is due" has to carry each one.
    await ttx.store.put({
      id: 'marker-full', localDate: today, testId: 'test.battery-full-complete',
      side: null, value: 1, unit: 'marker', battery: 'full' as const,
      note: null, ts: now.getTime(),
    });
    await ttx.store.put({
      id: 'marker-mini', localDate: today, testId: 'test.battery-mini-complete',
      side: null, value: 1, unit: 'marker', battery: 'mini' as const,
      note: null, ts: now.getTime(),
    });
    await ttx.done;
  } else {
    const ttx = db.transaction('tests', 'readwrite');
    await ttx.store.clear();
    await ttx.done;
  }

  const built = build(name, today);

  const wtx = db.transaction(['scheduled', 'setLogs', 'esdLogs'], 'readwrite');
  await Promise.all([
    ...built.scheduled.map((s) => wtx.objectStore('scheduled').put(s)),
    ...built.setLogs.map((s) => wtx.objectStore('setLogs').put(s)),
    ...built.esdLogs.map((s) => wtx.objectStore('esdLogs').put(s)),
    wtx.done,
  ]);

  // `unscheduled` deliberately leaves nothing planned, so the next-session
  // card has to render its UNSCHEDULED state.
  if (
    name !== 'unscheduled' &&
    name !== 'warn-ledger-floor' &&
    name !== 'calendar' &&
    name !== 'calendar-empty' &&
    name !== 'session-ready' &&
    name !== 'session-midway' &&
    name !== 'session-stale' &&
    name !== 'session-td3' &&
    name !== 'session-at-cap' &&
    name !== 'session-history' &&
    name !== 'deload-position' &&
    name !== 'battery-due' &&
    name !== 'battery-fresh'
  ) {
    const planned = session('TD1', -1, today, { status: 'planned' });
    await db.put('scheduled', planned);
  }

  return true;
}
