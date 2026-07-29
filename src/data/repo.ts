import {
  SCHEMA_VERSION,
  SEED_VERSION,
  type Block,
  type EsdLog,
  type Exercise,
  type Lift,
  type MaxRecord,
  type Profile,
  type ScheduledSession,
  type SessionStatus,
  type SessionTemplate,
  type SetLog,
  type SubstitutionTag,
  type TestDef,
  type TestResult,
} from '../types';
import { getDb } from './db';

/* ---------------- profile ---------------- */

export function defaultProfile(blockId: string): Profile {
  return {
    id: 'me',
    units: 'lb',
    bodyweight: null,
    hrMax: null,
    barWeight: 45,
    plateInventory: [45, 35, 25, 10, 5, 2.5],
    lastExport: null,
    storagePersisted: null,
    currentBlockId: blockId,
    rotationNumber: 1,
    wakeLockEnabled: true,
    audioCueEnabled: true,
    schemaVersion: SCHEMA_VERSION,
    seedVersion: SEED_VERSION,
  };
}

export async function getProfile(): Promise<Profile | undefined> {
  const db = await getDb();
  return db.get('profile', 'me');
}

export async function putProfile(profile: Profile): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('profile', 'readwrite');
  await tx.store.put(profile);
  await tx.done;
}

/** Read-modify-write the profile inside one transaction. */
export async function updateProfile(
  patch: Partial<Omit<Profile, 'id'>>,
): Promise<Profile> {
  const db = await getDb();
  const tx = db.transaction('profile', 'readwrite');
  const current = await tx.store.get('me');
  if (!current) {
    await tx.done;
    throw new Error('Cannot update profile before it exists.');
  }
  const next: Profile = { ...current, ...patch, id: 'me' };
  await tx.store.put(next);
  await tx.done;
  return next;
}

/** Create the profile if absent. Returns the profile either way. */
export async function ensureProfile(blockId: string): Promise<Profile> {
  const db = await getDb();
  const tx = db.transaction('profile', 'readwrite');
  const existing = await tx.store.get('me');
  if (existing) {
    await tx.done;
    return existing;
  }
  const created = defaultProfile(blockId);
  await tx.store.put(created);
  await tx.done;
  return created;
}

/* ---------------- maxes ---------------- */

export async function listMaxes(): Promise<MaxRecord[]> {
  const db = await getDb();
  return db.getAll('maxes');
}

export async function getMax(liftId: string): Promise<MaxRecord | undefined> {
  const db = await getDb();
  return db.get('maxes', liftId);
}

export async function putMax(record: MaxRecord): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('maxes', 'readwrite');
  await tx.store.put(record);
  await tx.done;
}

export async function deleteMax(liftId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('maxes', 'readwrite');
  await tx.store.delete(liftId);
  await tx.done;
}

/* ---------------- scheduled sessions ---------------- */

export async function listScheduled(): Promise<ScheduledSession[]> {
  const db = await getDb();
  return db.getAll('scheduled');
}

export async function getScheduled(id: string): Promise<ScheduledSession | undefined> {
  const db = await getDb();
  return db.get('scheduled', id);
}

export async function getScheduledByLocalDate(
  localDate: string,
): Promise<ScheduledSession[]> {
  const db = await getDb();
  return db.getAllFromIndex('scheduled', 'localDate', localDate);
}

export async function getScheduledInRange(
  fromLocalDate: string,
  toLocalDate: string,
): Promise<ScheduledSession[]> {
  const db = await getDb();
  return db.getAllFromIndex(
    'scheduled',
    'localDate',
    IDBKeyRange.bound(fromLocalDate, toLocalDate),
  );
}

export async function getScheduledByStatus(
  status: SessionStatus,
): Promise<ScheduledSession[]> {
  const db = await getDb();
  return db.getAllFromIndex('scheduled', 'status', status);
}

export async function getScheduledByBlock(blockId: string): Promise<ScheduledSession[]> {
  const db = await getDb();
  return db.getAllFromIndex('scheduled', 'blockId', blockId);
}

export async function putScheduled(session: ScheduledSession): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('scheduled', 'readwrite');
  await tx.store.put(session);
  await tx.done;
}

/**
 * Write many sessions atomically.
 *
 * Deferral rewrites the whole forward sequence. Persisting that one record at a
 * time would leave the schedule half-shifted if anything failed partway —
 * which looks fine until the rotation is quietly wrong two weeks later.
 */
export async function putScheduledMany(sessions: ScheduledSession[]): Promise<void> {
  if (sessions.length === 0) return;
  const db = await getDb();
  const tx = db.transaction('scheduled', 'readwrite');
  await Promise.all([...sessions.map((s) => tx.store.put(s)), tx.done]);
}

/**
 * What a cascade delete would destroy, WITHOUT destroying it.
 *
 * The confirmation names real counts from the database rather than an
 * estimate — "14 logged sets" has to be true, or the confirmation is theatre.
 */
export async function cascadeCounts(id: string): Promise<{
  setLogs: number;
  esdLogs: number;
}> {
  const db = await getDb();
  const tx = db.transaction(['setLogs', 'esdLogs'], 'readonly');
  const [setLogs, esdLogs] = await Promise.all([
    tx.objectStore('setLogs').index('scheduledId').count(id),
    tx.objectStore('esdLogs').index('scheduledId').count(id),
  ]);
  await tx.done;
  return { setLogs, esdLogs };
}

/**
 * Delete a scheduled session AND every log that hangs off it, in ONE
 * transaction. Orphaned logs silently corrupt every ledger count, so this is
 * the only supported way to remove a session.
 */
export async function deleteScheduledCascade(id: string): Promise<{
  setLogs: number;
  esdLogs: number;
}> {
  const db = await getDb();
  const tx = db.transaction(['scheduled', 'setLogs', 'esdLogs'], 'readwrite');

  const setKeys = await tx
    .objectStore('setLogs')
    .index('scheduledId')
    .getAllKeys(id);
  const esdKeys = await tx
    .objectStore('esdLogs')
    .index('scheduledId')
    .getAllKeys(id);

  await Promise.all([
    ...setKeys.map((k) => tx.objectStore('setLogs').delete(k)),
    ...esdKeys.map((k) => tx.objectStore('esdLogs').delete(k)),
    tx.objectStore('scheduled').delete(id),
  ]);
  await tx.done;

  return { setLogs: setKeys.length, esdLogs: esdKeys.length };
}

/**
 * Sessions started but never finished. Drives the launch resume sheet.
 */
export async function findUnfinishedSessions(): Promise<ScheduledSession[]> {
  const db = await getDb();
  const all = await db.getAll('scheduled');
  return all
    .filter((s) => s.startedAt !== null && s.completedAt === null)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

/* ---------------- set logs ---------------- */

export async function listSetLogs(): Promise<SetLog[]> {
  const db = await getDb();
  return db.getAll('setLogs');
}

export async function getSetLogsByScheduled(scheduledId: string): Promise<SetLog[]> {
  const db = await getDb();
  return db.getAllFromIndex('setLogs', 'scheduledId', scheduledId);
}

export async function getSetLogsByExercise(exerciseId: string): Promise<SetLog[]> {
  const db = await getDb();
  return db.getAllFromIndex('setLogs', 'exerciseId', exerciseId);
}

export async function putSetLog(log: SetLog): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('setLogs', 'readwrite');
  await tx.store.put(log);
  await tx.done;
}

/** Write many sets atomically — a partially saved session is not acceptable. */
export async function putSetLogs(logs: SetLog[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('setLogs', 'readwrite');
  await Promise.all([...logs.map((l) => tx.store.put(l)), tx.done]);
}

export async function deleteSetLog(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('setLogs', 'readwrite');
  await tx.store.delete(id);
  await tx.done;
}

/* ---------------- ESD logs ---------------- */

export async function listEsdLogs(): Promise<EsdLog[]> {
  const db = await getDb();
  return db.getAll('esdLogs');
}

export async function getEsdLogsByScheduled(scheduledId: string): Promise<EsdLog[]> {
  const db = await getDb();
  return db.getAllFromIndex('esdLogs', 'scheduledId', scheduledId);
}

export async function getEsdLogsByType(type: EsdLog['type']): Promise<EsdLog[]> {
  const db = await getDb();
  return db.getAllFromIndex('esdLogs', 'type', type);
}

export async function putEsdLog(log: EsdLog): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('esdLogs', 'readwrite');
  await tx.store.put(log);
  await tx.done;
}

export async function deleteEsdLog(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('esdLogs', 'readwrite');
  await tx.store.delete(id);
  await tx.done;
}

/* ---------------- test results ---------------- */

export async function listTestResults(): Promise<TestResult[]> {
  const db = await getDb();
  return db.getAll('tests');
}

export async function getTestResultsByDate(localDate: string): Promise<TestResult[]> {
  const db = await getDb();
  return db.getAllFromIndex('tests', 'localDate', localDate);
}

export async function getTestResultsByTest(testId: string): Promise<TestResult[]> {
  const db = await getDb();
  return db.getAllFromIndex('tests', 'testId', testId);
}

export async function putTestResult(result: TestResult): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('tests', 'readwrite');
  await tx.store.put(result);
  await tx.done;
}

export async function deleteTestResult(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('tests', 'readwrite');
  await tx.store.delete(id);
  await tx.done;
}

/* ---------------- static stores (read-only at runtime) ---------------- */

export async function listLifts(): Promise<Lift[]> {
  const db = await getDb();
  return db.getAll('lifts');
}

export async function getLift(id: string): Promise<Lift | undefined> {
  const db = await getDb();
  return db.get('lifts', id);
}

export async function listExercises(): Promise<Exercise[]> {
  const db = await getDb();
  return db.getAll('exercises');
}

export async function getExercise(id: string): Promise<Exercise | undefined> {
  const db = await getDb();
  return db.get('exercises', id);
}

export async function listSessionTemplates(): Promise<SessionTemplate[]> {
  const db = await getDb();
  return db.getAll('sessionTemplates');
}

export async function getSessionTemplate(
  id: string,
): Promise<SessionTemplate | undefined> {
  const db = await getDb();
  return db.get('sessionTemplates', id);
}

export async function listBlocks(): Promise<Block[]> {
  const db = await getDb();
  return db.getAll('blocks');
}

export async function getBlock(id: string): Promise<Block | undefined> {
  const db = await getDb();
  return db.get('blocks', id);
}

export async function listSubstitutionTags(): Promise<SubstitutionTag[]> {
  const db = await getDb();
  return db.getAll('substitutionTags');
}

export async function listTestDefs(): Promise<TestDef[]> {
  const db = await getDb();
  return db.getAll('testDefs');
}

export async function getTestDef(id: string): Promise<TestDef | undefined> {
  const db = await getDb();
  return db.get('testDefs', id);
}
