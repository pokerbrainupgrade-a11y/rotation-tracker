import { afterEach, describe, expect, it } from 'vitest';
import { closeDb } from '../../src/data/db';
import {
  deleteScheduledCascade,
  ensureProfile,
  getEsdLogsByScheduled,
  getScheduledByStatus,
  getScheduledInRange,
  getSetLogsByExercise,
  getSetLogsByScheduled,
  listEsdLogs,
  listSetLogs,
  putEsdLog,
  putScheduled,
  putSetLog,
  putSetLogs,
  updateProfile,
} from '../../src/data/repo';
import { seededDb } from './helpers';
import { esdLog, session, setLog } from './factories';

afterEach(async () => {
  await closeDb();
});

/* ---------- ACCEPTANCE TEST 9: cascade delete ---------- */

describe('acceptance 9 — cascade delete', () => {
  it('deleting a session removes its setLogs and esdLogs, leaving no orphans', async () => {
    await seededDb();

    await putScheduled(session({ id: 'sess-1' }));
    await putScheduled(session({ id: 'sess-2', localDate: '2026-03-12' }));

    await putSetLogs([
      setLog({ id: 'a1', scheduledId: 'sess-1' }),
      setLog({ id: 'a2', scheduledId: 'sess-1', setIndex: 1 }),
      setLog({ id: 'b1', scheduledId: 'sess-2' }),
    ]);
    await putEsdLog(esdLog({ id: 'e1', scheduledId: 'sess-1' }));
    await putEsdLog(esdLog({ id: 'e2', scheduledId: 'sess-2' }));

    const removed = await deleteScheduledCascade('sess-1');
    expect(removed).toEqual({ setLogs: 2, esdLogs: 1 });

    expect(await getSetLogsByScheduled('sess-1')).toEqual([]);
    expect(await getEsdLogsByScheduled('sess-1')).toEqual([]);

    // The other session is untouched.
    expect(await getSetLogsByScheduled('sess-2')).toHaveLength(1);
    expect(await getEsdLogsByScheduled('sess-2')).toHaveLength(1);

    // Nothing anywhere still points at the deleted session.
    const orphanSets = (await listSetLogs()).filter((l) => l.scheduledId === 'sess-1');
    const orphanEsd = (await listEsdLogs()).filter((l) => l.scheduledId === 'sess-1');
    expect(orphanSets).toEqual([]);
    expect(orphanEsd).toEqual([]);
  });

  it('is a no-op for a session that does not exist', async () => {
    await seededDb();
    await putScheduled(session());
    await putSetLog(setLog());

    const removed = await deleteScheduledCascade('nope');
    expect(removed).toEqual({ setLogs: 0, esdLogs: 0 });
    expect(await listSetLogs()).toHaveLength(1);
  });
});

describe('indexed lookups', () => {
  it('queries scheduled sessions by status and by date range', async () => {
    await seededDb();
    await putScheduled(session({ id: 's1', localDate: '2026-03-01', status: 'done' }));
    await putScheduled(session({ id: 's2', localDate: '2026-03-15', status: 'planned' }));
    await putScheduled(session({ id: 's3', localDate: '2026-04-01', status: 'missed' }));

    expect((await getScheduledByStatus('planned')).map((s) => s.id)).toEqual(['s2']);

    const inRange = await getScheduledInRange('2026-03-01', '2026-03-31');
    expect(inRange.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('queries set logs by exercise', async () => {
    await seededDb();
    await putScheduled(session());
    await putSetLogs([
      setLog({ id: 'x1', exerciseId: 'ex.back-squat' }),
      setLog({ id: 'x2', exerciseId: 'ex.bench-press' }),
      setLog({ id: 'x3', exerciseId: 'ex.back-squat', setIndex: 1 }),
    ]);

    const squats = await getSetLogsByExercise('ex.back-squat');
    expect(squats.map((s) => s.id).sort()).toEqual(['x1', 'x3']);
  });
});

describe('profile', () => {
  it('ensureProfile creates once and is stable thereafter', async () => {
    await seededDb();
    const a = await ensureProfile('block.accumulation');
    const b = await ensureProfile('block.intensification');
    expect(b).toEqual(a); // second call must not overwrite
  });

  it('updateProfile patches without dropping fields', async () => {
    await seededDb();
    const before = await ensureProfile('block.accumulation');
    const after = await updateProfile({ units: 'kg', bodyweight: 84.5 });

    expect(after.units).toBe('kg');
    expect(after.bodyweight).toBe(84.5);
    expect(after.barWeight).toBe(before.barWeight);
    expect(after.id).toBe('me');
  });
});
