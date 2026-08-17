import { afterEach, describe, expect, it } from 'vitest';
import { closeDb, deleteDatabase, getDb } from '../../src/data/db';
import { pendingMigrations } from '../../src/data/migrations';
import { SCHEMA_VERSION, STATIC_STORES, USER_STORES } from '../../src/types';
import { freshDb } from './helpers';
import { session, setLog } from './factories';

afterEach(async () => {
  await closeDb();
});

/* ---------- ACCEPTANCE TEST 4: migration integrity ---------- */

describe('acceptance 4 — migration integrity', () => {
  it('migrating a v0 (nonexistent) database to v1 creates every store', async () => {
    await deleteDatabase(); // v0 == no database at all
    const db = await getDb();

    expect(db.version).toBe(SCHEMA_VERSION);
    for (const name of [...USER_STORES, ...STATIC_STORES]) {
      expect([...db.objectStoreNames]).toContain(name);
    }
  });

  it('creates every index named in the schema', async () => {
    const db = await freshDb();
    const tx = db.transaction(['scheduled', 'setLogs', 'esdLogs', 'tests'], 'readonly');

    expect([...tx.objectStore('scheduled').indexNames].sort()).toEqual([
      'blockId', 'localDate', 'status',
    ]);
    expect([...tx.objectStore('setLogs').indexNames].sort()).toEqual([
      'exerciseId', 'scheduledId',
    ]);
    expect([...tx.objectStore('esdLogs').indexNames].sort()).toEqual([
      'scheduledId', 'type',
    ]);
    expect([...tx.objectStore('tests').indexNames].sort()).toEqual([
      'localDate', 'testId',
    ]);
    await tx.done;
  });

  it('uses the documented key paths', async () => {
    const db = await freshDb();
    const tx = db.transaction(['profile', 'maxes', 'scheduled'], 'readonly');
    expect(tx.objectStore('profile').keyPath).toBe('id');
    expect(tx.objectStore('maxes').keyPath).toBe('liftId');
    expect(tx.objectStore('scheduled').keyPath).toBe('id');
    await tx.done;
  });

  it('reopening an existing database loses no data', async () => {
    const db = await freshDb();
    await db.put('scheduled', session());
    await db.put('setLogs', setLog());
    await closeDb();

    const reopened = await getDb();
    expect(await reopened.count('scheduled')).toBe(1);
    expect(await reopened.count('setLogs')).toBe(1);
    expect((await reopened.get('scheduled', 'sess-1'))?.templateId).toBe(
      'TD2',
    );
  });
});

/* ---------- schema v2: the framework's first real use ---------- */

describe('v1 -> v2 backfills session runner fields', () => {
  it('adds checklist and activeTimer to rows written before v2 existed', async () => {
    await deleteDatabase();

    // Open at v1 with only migration 1, and write a row that has neither of
    // the v2 fields — exactly what an installed app from Phase 4 holds.
    const { openDB } = await import('idb');
    const v1 = await openDB('rotationTracker', 1, {
      upgrade(db) {
        const s = db.createObjectStore('scheduled', { keyPath: 'id' });
        s.createIndex('localDate', 'localDate');
        s.createIndex('status', 'status');
        s.createIndex('blockId', 'blockId');
      },
    });
    const legacy = { ...session({ id: 'legacy' }) } as Record<string, unknown>;
    delete legacy['checklist'];
    delete legacy['activeTimer'];
    await v1.put('scheduled', legacy as never);
    v1.close();

    // Reopening at the current version runs migration 2.
    const db = await getDb();
    expect(db.version).toBe(SCHEMA_VERSION);

    const row = await db.get('scheduled', 'legacy');
    expect(row?.checklist).toEqual([]);
    expect(row?.activeTimer).toBeNull();
    // No reader should ever see undefined where it expects an array.
    expect(Array.isArray(row?.checklist)).toBe(true);
  });

  it('leaves already-migrated rows untouched', async () => {
    const db = await freshDb();
    await db.put('scheduled', session({ id: 'a', checklist: ['x'] }));
    await closeDb();

    const reopened = await getDb();
    expect((await reopened.get('scheduled', 'a'))?.checklist).toEqual(['x']);
  });
});

describe('pendingMigrations', () => {
  it('selects only migrations in the open interval (old, new]', () => {
    expect(pendingMigrations(0, 1)).toEqual([1]);
    expect(pendingMigrations(1, 1)).toEqual([]);
    expect(pendingMigrations(1, 2)).toEqual([2]);
    expect(pendingMigrations(0, 2)).toEqual([1, 2]);
  });

  it('returns them in ascending order', () => {
    const out = pendingMigrations(0, 99);
    expect(out).toEqual([...out].sort((a, b) => a - b));
  });
});
