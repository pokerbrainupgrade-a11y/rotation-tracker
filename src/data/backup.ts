import {
  SCHEMA_VERSION,
  SEED_VERSION,
  USER_STORES,
  type BackupFile,
  type EsdLog,
  type MaxRecord,
  type Profile,
  type ScheduledSession,
  type SetLog,
  type TestResult,
} from '../types';
import { APP_VERSION } from '../version';
import { getDb } from './db';
import { toLocalDate } from './dates';

export const BACKUP_FORMAT = 'rotation-tracker-backup';

export class BackupError extends Error {
  readonly problems: string[];
  constructor(message: string, problems: string[] = []) {
    super(problems.length ? `${message}\n  - ${problems.join('\n  - ')}` : message);
    this.name = 'BackupError';
    this.problems = problems;
  }
}

/* ---------------- export ---------------- */

/**
 * Snapshot the user stores. Static stores are deliberately excluded — they are
 * reseeded from code on import, which keeps backups small and lands a restore
 * on the current program definition.
 */
export async function exportBackup(now: Date = new Date()): Promise<BackupFile> {
  const db = await getDb();

  const tx = db.transaction(USER_STORES, 'readonly');
  const [profile, maxes, scheduled, setLogs, esdLogs, tests] = await Promise.all([
    tx.objectStore('profile').get('me'),
    tx.objectStore('maxes').getAll(),
    tx.objectStore('scheduled').getAll(),
    tx.objectStore('setLogs').getAll(),
    tx.objectStore('esdLogs').getAll(),
    tx.objectStore('tests').getAll(),
  ]);
  await tx.done;

  if (!profile) {
    throw new BackupError('Nothing to export — the profile has not been created yet.');
  }

  const exportedAt = now.toISOString();
  const exportedProfile: Profile = { ...profile, lastExport: exportedAt };

  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    seedVersion: SEED_VERSION,
    appVersion: APP_VERSION,
    exportedAt,
    counts: {
      profile: 1,
      maxes: maxes.length,
      scheduled: scheduled.length,
      setLogs: setLogs.length,
      esdLogs: esdLogs.length,
      tests: tests.length,
    },
    data: {
      profile: exportedProfile,
      maxes,
      scheduled,
      setLogs,
      esdLogs,
      tests,
    },
  };

  // Record the export only after the snapshot succeeded.
  const wtx = db.transaction('profile', 'readwrite');
  await wtx.store.put(exportedProfile);
  await wtx.done;

  return backup;
}

export function backupFilename(now: Date = new Date()): string {
  return `rotation-tracker-${toLocalDate(now)}.json`;
}

/**
 * Save a backup to the device. Prefers the native share sheet (the only way to
 * get a file into iCloud/Files reliably from iOS standalone PWAs) and falls
 * back to an anchor download.
 */
export async function downloadBackup(now: Date = new Date()): Promise<'shared' | 'downloaded'> {
  const backup = await exportBackup(now);
  const json = JSON.stringify(backup, null, 2);
  const filename = backupFilename(now);
  const blob = new Blob([json], { type: 'application/json' });

  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data?: ShareData) => Promise<void>;
  };

  if (typeof File !== 'undefined' && nav.canShare && nav.share) {
    const file = new File([blob], filename, { type: 'application/json' });
    if (nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: filename });
        return 'shared';
      } catch (err) {
        // AbortError = user dismissed the sheet; that is not a failure to
        // fall back from, so surface it rather than silently downloading.
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        // Anything else: fall through to the anchor download.
      }
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return 'downloaded';
}

/* ---------------- backup-envelope migrations ---------------- */

type RawBackup = Omit<BackupFile, 'schemaVersion'> & { schemaVersion: number };

/**
 * Migrations for the BACKUP ENVELOPE, distinct from the IndexedDB migrations
 * in migrations.ts. Key `n` upgrades an envelope at version `n-1` to `n`.
 *
 * A restore from an old device must not lose fields, so every entry backfills
 * defaults rather than dropping unknown data.
 */
export const backupMigrations: Record<number, (b: RawBackup) => RawBackup> = {
  1: (b) => ({
    ...b,
    schemaVersion: 1,
    seedVersion: b.seedVersion ?? 0,
    data: {
      ...b.data,
      scheduled: (b.data.scheduled ?? []).map((s) => ({
        ...s,
        // Fields introduced at schema v1.
        seedVersionAtLog: s.seedVersionAtLog ?? 0,
        metDosingSignature: s.metDosingSignature ?? null,
        substitutionNote: s.substitutionNote ?? null,
        startedAt: s.startedAt ?? null,
        completedAt: s.completedAt ?? null,
      })),
    },
  }),
  /**
   * v2 — session runner fields. A backup taken at v1 has no checklist or
   * activeTimer on its sessions; both are backfilled so a v1 restore lands on
   * a database a v2 reader can use without special-casing.
   */
  2: (b) => ({
    ...b,
    schemaVersion: 2,
    data: {
      ...b.data,
      scheduled: (b.data.scheduled ?? []).map((s) => ({
        ...s,
        checklist: s.checklist ?? [],
        activeTimer: s.activeTimer ?? null,
      })),
    },
  }),
};

function migrateBackup(raw: RawBackup): RawBackup {
  let out = raw;
  for (const v of Object.keys(backupMigrations)
    .map(Number)
    .sort((a, b) => a - b)) {
    if (v > out.schemaVersion && v <= SCHEMA_VERSION) {
      const migrate = backupMigrations[v];
      if (migrate) out = migrate(out);
    }
  }
  return out;
}

/* ---------------- import ---------------- */

export interface ImportPlan {
  /** Records currently in the database that a commit would destroy. */
  destroys: Record<string, number>;
  /** Records the backup would write. */
  incoming: Record<string, number>;
  backup: BackupFile;
  /** True when the envelope was upgraded from an older schema on read. */
  migrated: boolean;
}

async function readRaw(input: unknown): Promise<unknown> {
  if (typeof input === 'string') return JSON.parse(input) as unknown;
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return JSON.parse(await input.text()) as unknown;
  }
  return input;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Validate a backup and report exactly what a commit would destroy — without
 * writing anything. The confirm dialog is built from this.
 */
export async function prepareImport(input: unknown): Promise<ImportPlan> {
  const parsed = await readRaw(input);

  if (!isRecord(parsed)) {
    throw new BackupError('That file is not a Rotation Tracker backup.');
  }
  if (parsed['format'] !== BACKUP_FORMAT) {
    throw new BackupError(
      `That file is not a Rotation Tracker backup (format was ${String(parsed['format'])}).`,
    );
  }

  const schemaVersion = parsed['schemaVersion'];
  if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion)) {
    throw new BackupError('Backup is missing a valid schemaVersion.');
  }
  if (schemaVersion > SCHEMA_VERSION) {
    throw new BackupError(
      `This backup was made by a newer version of Rotation Tracker ` +
        `(schema ${schemaVersion}; this app understands ${SCHEMA_VERSION}). ` +
        `Update the app before restoring — importing it here could silently drop data.`,
    );
  }

  // Structure must be sound before migrating — a migration that runs on a
  // malformed envelope throws a TypeError instead of a useful message.
  if (!isRecord(parsed['data'])) {
    throw new BackupError('Backup is missing its data section.');
  }

  const migrated = schemaVersion < SCHEMA_VERSION;
  const backup = migrateBackup(parsed as unknown as RawBackup) as BackupFile;

  const problems: string[] = [];
  const d = backup.data;
  if (!isRecord(d.profile)) problems.push('missing profile');

  const arrays: Array<[string, unknown]> = [
    ['maxes', d.maxes],
    ['scheduled', d.scheduled],
    ['setLogs', d.setLogs],
    ['esdLogs', d.esdLogs],
    ['tests', d.tests],
  ];
  for (const [name, value] of arrays) {
    if (!Array.isArray(value)) problems.push(`${name} is not an array`);
  }
  if (problems.length) throw new BackupError('Backup is structurally invalid.', problems);

  // --- integrity: declared counts must match actual records ---
  const actual: Record<string, number> = {
    profile: 1,
    maxes: d.maxes.length,
    scheduled: d.scheduled.length,
    setLogs: d.setLogs.length,
    esdLogs: d.esdLogs.length,
    tests: d.tests.length,
  };
  const declared = backup.counts ?? {};
  for (const [store, n] of Object.entries(actual)) {
    const claim = declared[store];
    if (claim === undefined) {
      problems.push(`counts is missing "${store}"`);
    } else if (claim !== n) {
      problems.push(`counts.${store} says ${claim} but the file holds ${n}`);
    }
  }
  if (problems.length) {
    throw new BackupError(
      'Backup failed its integrity check — it may be truncated or edited.',
      problems,
    );
  }

  // --- integrity: referential ---
  const scheduledIds = new Set(d.scheduled.map((s) => s.id));
  for (const log of d.setLogs) {
    if (!scheduledIds.has(log.scheduledId)) {
      problems.push(`setLog "${log.id}" references missing session "${log.scheduledId}"`);
    }
  }
  // Orphaned ESD logs corrupt the ledger exactly as badly as orphaned sets,
  // so they are checked too even though the spec only names setLogs.
  for (const log of d.esdLogs) {
    if (!scheduledIds.has(log.scheduledId)) {
      problems.push(`esdLog "${log.id}" references missing session "${log.scheduledId}"`);
    }
  }

  // Static FKs resolve against the seeded program definition, which is code.
  const db = await getDb();
  const [exerciseIds, liftIds, testDefIds] = await Promise.all([
    db.getAllKeys('exercises').then((k) => new Set(k.map(String))),
    db.getAllKeys('lifts').then((k) => new Set(k.map(String))),
    db.getAllKeys('testDefs').then((k) => new Set(k.map(String))),
  ]);

  if (exerciseIds.size > 0) {
    for (const log of d.setLogs) {
      if (!exerciseIds.has(log.exerciseId)) {
        problems.push(`setLog "${log.id}" references unknown exercise "${log.exerciseId}"`);
      }
    }
  }
  if (liftIds.size > 0) {
    for (const m of d.maxes) {
      if (!liftIds.has(m.liftId)) {
        problems.push(`max references unknown lift "${m.liftId}"`);
      }
    }
  }
  if (testDefIds.size > 0) {
    for (const t of d.tests) {
      if (!testDefIds.has(t.testId)) {
        problems.push(`test "${t.id}" references unknown test definition "${t.testId}"`);
      }
    }
  }

  if (problems.length) {
    throw new BackupError('Backup failed referential integrity.', problems);
  }

  // --- what a commit would destroy ---
  const ctx = db.transaction(USER_STORES, 'readonly');
  const [pCount, mCount, sCount, slCount, eCount, tCount] = await Promise.all([
    ctx.objectStore('profile').count(),
    ctx.objectStore('maxes').count(),
    ctx.objectStore('scheduled').count(),
    ctx.objectStore('setLogs').count(),
    ctx.objectStore('esdLogs').count(),
    ctx.objectStore('tests').count(),
  ]);
  await ctx.done;

  return {
    destroys: {
      profile: pCount,
      maxes: mCount,
      scheduled: sCount,
      setLogs: slCount,
      esdLogs: eCount,
      tests: tCount,
    },
    incoming: actual,
    backup,
    migrated,
  };
}

/** Replace all user stores with the plan's contents, in ONE transaction. */
export async function commitImport(plan: ImportPlan): Promise<ImportPlan> {
  const db = await getDb();
  const d = plan.backup.data;

  const tx = db.transaction(USER_STORES, 'readwrite');
  await Promise.all([
    tx.objectStore('profile').clear(),
    tx.objectStore('maxes').clear(),
    tx.objectStore('scheduled').clear(),
    tx.objectStore('setLogs').clear(),
    tx.objectStore('esdLogs').clear(),
    tx.objectStore('tests').clear(),
  ]);
  await Promise.all([
    tx.objectStore('profile').put({ ...d.profile, id: 'me' as const }),
    ...d.maxes.map((r: MaxRecord) => tx.objectStore('maxes').put(r)),
    ...d.scheduled.map((r: ScheduledSession) => tx.objectStore('scheduled').put(r)),
    ...d.setLogs.map((r: SetLog) => tx.objectStore('setLogs').put(r)),
    ...d.esdLogs.map((r: EsdLog) => tx.objectStore('esdLogs').put(r)),
    ...d.tests.map((r: TestResult) => tx.objectStore('tests').put(r)),
    tx.done,
  ]);

  return plan;
}

/**
 * Validate and restore in one call.
 *
 * The UI should use `prepareImport` first to show the destructive-replace
 * confirmation, then `commitImport`. This convenience wrapper exists for tests
 * and scripted restores; it destroys existing data without asking.
 */
export async function importBackup(input: unknown): Promise<ImportPlan> {
  const plan = await prepareImport(input);
  return commitImport(plan);
}

/* ---------------- CSV ---------------- */

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: unknown[][]): string {
  return [header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n');
}

/** One row per logged set, joined to its session. */
export async function exportSessionLogsCsv(): Promise<string> {
  const db = await getDb();
  const tx = db.transaction(['setLogs', 'scheduled', 'exercises'], 'readonly');
  const [setLogs, scheduled, exercises] = await Promise.all([
    tx.objectStore('setLogs').getAll(),
    tx.objectStore('scheduled').getAll(),
    tx.objectStore('exercises').getAll(),
  ]);
  await tx.done;

  const sessions = new Map(scheduled.map((s) => [s.id, s]));
  const exNames = new Map(exercises.map((e) => [e.id, e.name]));

  const sorted = [...setLogs].sort((a, b) => a.ts - b.ts || a.setIndex - b.setIndex);

  return toCsv(
    [
      'localDate', 'position', 'blockId', 'rotationNumber', 'sessionStatus',
      'compressionLevel', 'deload', 'substituted', 'exerciseId', 'exerciseName',
      'setIndex', 'side', 'load', 'unit', 'reps', 'rpe', 'velocity', 'distance',
      'contacts', 'completed', 'note', 'ts',
    ],
    sorted.map((l) => {
      const s = sessions.get(l.scheduledId);
      return [
        s?.localDate ?? '', s?.position ?? '', s?.blockId ?? '',
        s?.rotationNumber ?? '', s?.status ?? '', s?.compressionLevel ?? '',
        s?.deload ?? '', s?.substituted ?? '',
        l.exerciseId, exNames.get(l.exerciseId) ?? '', l.setIndex, l.side,
        l.load, l.unit, l.reps, l.rpe, l.velocity, l.distance, l.contacts,
        l.completed, l.note, l.ts,
      ];
    }),
  );
}

/** One row per test result. */
export async function exportBatteryCsv(): Promise<string> {
  const db = await getDb();
  const tx = db.transaction(['tests', 'testDefs'], 'readonly');
  const [tests, defs] = await Promise.all([
    tx.objectStore('tests').getAll(),
    tx.objectStore('testDefs').getAll(),
  ]);
  await tx.done;

  const defNames = new Map(defs.map((d) => [d.id, d.name]));
  const sorted = [...tests].sort((a, b) => a.ts - b.ts);

  return toCsv(
    ['localDate', 'testId', 'testName', 'battery', 'side', 'value', 'unit', 'note', 'ts'],
    sorted.map((t) => [
      t.localDate, t.testId, defNames.get(t.testId) ?? '', t.battery,
      t.side, t.value, t.unit, t.note, t.ts,
    ]),
  );
}
