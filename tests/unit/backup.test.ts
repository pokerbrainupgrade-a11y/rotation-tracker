import { afterEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../../src/data/db';
import {
  BackupError,
  commitImport,
  exportBackup,
  exportBatteryCsv,
  exportSessionLogsCsv,
  importBackup,
  prepareImport,
} from '../../src/data/backup';
import { applySeed } from '../../src/data/seed';
import { ensureProfile } from '../../src/data/repo';
import { SCHEMA_VERSION, type BackupFile } from '../../src/types';
import { freshDb, seededDb, throughJson } from './helpers';
import { esdLog, maxRecord, session, setLog, testResult } from './factories';

afterEach(async () => {
  await closeDb();
});

/** Populate every user store with deterministic, interlinked records. */
async function populate(): Promise<void> {
  const db = await seededDb();
  await db.put('scheduled', session({ id: 'sess-1', localDate: '2026-03-08' }));
  await db.put('scheduled', session({ id: 'sess-2', localDate: '2026-11-01' }));
  await db.put('setLogs', setLog({ id: 'set-1', scheduledId: 'sess-1' }));
  await db.put('setLogs', setLog({
    id: 'set-2', scheduledId: 'sess-2', exerciseId: 'ex.back-squat',
    setIndex: 1, side: 'L', load: 225, reps: 5, rpe: 7.5, note: 'felt "sharp", 2nd',
  }));
  await db.put('esdLogs', esdLog({ id: 'esd-1', scheduledId: 'sess-2' }));
  await db.put('maxes', maxRecord());
  await db.put('maxes', maxRecord({ liftId: 'lift.back-squat', e1rm: 355 }));
  await db.put('tests', testResult());
  await db.put('tests', testResult({
    id: 'test-2', testId: 'test.single-leg-hop', side: 'R', value: 168, unit: 'cm',
  }));
}

/* ---------- ACCEPTANCE TEST 1: round trip ---------- */

describe('acceptance 1 — lossless round trip', () => {
  it('export → wipe → import restores every record byte-identically', async () => {
    await populate();
    const exported = await exportBackup(new Date('2026-06-01T12:00:00Z'));

    // Serialize exactly as the file on disk would be.
    const onDisk = JSON.stringify(exported, null, 2);

    // Nuke everything, then rebuild the static stores from code as a real
    // restore onto a fresh install would.
    const db = await freshDb();
    await applySeed(db);
    expect(await db.count('scheduled')).toBe(0);

    await importBackup(onDisk);

    const restored = {
      profile: await db.get('profile', 'me'),
      maxes: await db.getAll('maxes'),
      scheduled: await db.getAll('scheduled'),
      setLogs: await db.getAll('setLogs'),
      esdLogs: await db.getAll('esdLogs'),
      tests: await db.getAll('tests'),
    };

    const expected = throughJson(exported).data;
    expect(restored.profile).toEqual(expected.profile);
    expect(restored.maxes).toEqual(expect.arrayContaining(expected.maxes));
    expect(restored.maxes).toHaveLength(expected.maxes.length);
    expect(restored.scheduled).toEqual(expect.arrayContaining(expected.scheduled));
    expect(restored.scheduled).toHaveLength(expected.scheduled.length);
    expect(restored.setLogs).toEqual(expect.arrayContaining(expected.setLogs));
    expect(restored.setLogs).toHaveLength(expected.setLogs.length);
    expect(restored.esdLogs).toEqual(expected.esdLogs);
    expect(restored.tests).toEqual(expect.arrayContaining(expected.tests));
    expect(restored.tests).toHaveLength(expected.tests.length);
  });

  it('a second export of restored data matches the first', async () => {
    await populate();
    const first = await exportBackup(new Date('2026-06-01T12:00:00Z'));

    const db = await freshDb();
    await applySeed(db);
    await importBackup(JSON.stringify(first));

    const second = await exportBackup(new Date('2026-06-02T12:00:00Z'));

    expect(second.counts).toEqual(first.counts);
    // lastExport legitimately moves; everything else must be identical.
    expect({ ...second.data.profile, lastExport: null }).toEqual({
      ...first.data.profile, lastExport: null,
    });
  });

  it('preserves null vs 0 and quoted strings through JSON', async () => {
    await populate();
    const exported = throughJson(await exportBackup());
    const zeroed = exported.data.setLogs.find((l) => l.id === 'set-1');
    expect(zeroed?.setIndex).toBe(0);
    expect(zeroed?.velocity).toBeNull();
    expect(exported.data.setLogs.find((l) => l.id === 'set-2')?.note)
      .toBe('felt "sharp", 2nd');
  });

  it('records lastExport on the profile', async () => {
    await populate();
    const when = new Date('2026-06-01T12:00:00Z');
    await exportBackup(when);
    const db = await getDb();
    expect((await db.get('profile', 'me'))?.lastExport).toBe(when.toISOString());
  });

  it('exports user stores only — no program definition rides along', async () => {
    await populate();
    const exported = await exportBackup();
    expect(Object.keys(exported.data).sort()).toEqual([
      'esdLogs', 'maxes', 'profile', 'scheduled', 'setLogs', 'tests',
    ]);
  });
});

/* ---------- ACCEPTANCE TEST 5: reject a future schema ---------- */

describe('acceptance 5 — import rejects a newer schema', () => {
  it('refuses and leaves the database untouched', async () => {
    await populate();
    const good = throughJson(await exportBackup());
    const future = { ...good, schemaVersion: 99 };

    const db = await getDb();
    const before = await db.getAll('scheduled');

    await expect(importBackup(future)).rejects.toThrow(BackupError);
    await expect(importBackup(future)).rejects.toThrow(/newer version/i);

    expect(await db.getAll('scheduled')).toEqual(before);
  });
});

/* ---------- ACCEPTANCE TEST 6: migrate an older schema ---------- */

describe('acceptance 6 — import migrates an older schema', () => {
  it('backfills fields added since, and keeps the data intact', async () => {
    await populate();
    const current = throughJson(await exportBackup());

    // Simulate a v0 envelope: fields introduced at v1 are absent.
    const legacy = {
      ...current,
      schemaVersion: 0,
      data: {
        ...current.data,
        scheduled: current.data.scheduled.map((s) => {
          const copy: Record<string, unknown> = { ...s };
          delete copy['seedVersionAtLog'];
          delete copy['metDosingSignature'];
          return copy;
        }),
      },
    };

    const db = await freshDb();
    await applySeed(db);

    const plan = await prepareImport(legacy);
    expect(plan.migrated).toBe(true);
    await commitImport(plan);

    const restored = await db.getAll('scheduled');
    expect(restored).toHaveLength(current.data.scheduled.length);
    for (const s of restored) {
      expect(s.seedVersionAtLog).toBe(0); // backfilled default
      expect(s.metDosingSignature).toBeNull();
      expect(s.templateId).toBe('tmpl.td2-strength'); // original data intact
    }
    expect(await db.count('setLogs')).toBe(current.counts['setLogs']);
  });
});

/* ---------- ACCEPTANCE TEST 7: count mismatch ---------- */

describe('acceptance 7 — count mismatch is caught', () => {
  it('rejects a backup whose counts disagree with its contents', async () => {
    await populate();
    const tampered = throughJson(await exportBackup());
    tampered.counts['setLogs'] = 99;

    await expect(importBackup(tampered)).rejects.toThrow(/integrity/i);
    await expect(importBackup(tampered)).rejects.toThrow(/counts.setLogs says 99/);
  });

  it('rejects a truncated record list even when counts look plausible', async () => {
    await populate();
    const tampered = throughJson(await exportBackup());
    tampered.data.setLogs = tampered.data.setLogs.slice(0, 1); // counts unchanged

    await expect(importBackup(tampered)).rejects.toThrow(/integrity/i);
  });

  it('rejects a missing counts entry', async () => {
    await populate();
    const tampered = throughJson(await exportBackup()) as BackupFile;
    delete tampered.counts['tests'];
    await expect(importBackup(tampered)).rejects.toThrow(/missing "tests"/);
  });
});

/* ---------- ACCEPTANCE TEST 8: referential integrity ---------- */

describe('acceptance 8 — referential integrity is caught', () => {
  it('rejects a setLog pointing at a nonexistent session', async () => {
    await populate();
    const tampered = throughJson(await exportBackup());
    const first = tampered.data.setLogs[0];
    if (first) first.scheduledId = 'sess-ghost';

    await expect(importBackup(tampered)).rejects.toThrow(/referential integrity/i);
    await expect(importBackup(tampered)).rejects.toThrow(/missing session "sess-ghost"/);
  });

  it('rejects a setLog pointing at a nonexistent exercise', async () => {
    await populate();
    const tampered = throughJson(await exportBackup());
    const first = tampered.data.setLogs[0];
    if (first) first.exerciseId = 'ex.ghost';

    await expect(importBackup(tampered)).rejects.toThrow(/unknown exercise "ex.ghost"/);
  });

  it('rejects an orphaned esdLog', async () => {
    await populate();
    const tampered = throughJson(await exportBackup());
    const first = tampered.data.esdLogs[0];
    if (first) first.scheduledId = 'sess-ghost';

    await expect(importBackup(tampered)).rejects.toThrow(/esdLog .* missing session/);
  });

  it('rejects a max pointing at a nonexistent lift', async () => {
    await populate();
    const tampered = throughJson(await exportBackup());
    const first = tampered.data.maxes[0];
    if (first) first.liftId = 'lift.ghost';

    await expect(importBackup(tampered)).rejects.toThrow(/unknown lift "lift.ghost"/);
  });

  it('a rejected import destroys nothing', async () => {
    await populate();
    const db = await getDb();
    const before = {
      scheduled: await db.getAll('scheduled'),
      setLogs: await db.getAll('setLogs'),
    };

    const tampered = throughJson(await exportBackup());
    const first = tampered.data.setLogs[0];
    if (first) first.scheduledId = 'sess-ghost';
    await expect(importBackup(tampered)).rejects.toThrow();

    expect(await db.getAll('scheduled')).toEqual(before.scheduled);
    expect(await db.getAll('setLogs')).toEqual(before.setLogs);
  });
});

/* ---------- envelope + confirm-dialog surface ---------- */

describe('backup envelope', () => {
  it('rejects a file that is not a Rotation Tracker backup', async () => {
    await seededDb();
    await expect(importBackup({ format: 'something-else' })).rejects.toThrow(
      /not a Rotation Tracker backup/,
    );
    await expect(importBackup('"just a string"')).rejects.toThrow(BackupError);
  });

  it('stamps schema, seed and app versions', async () => {
    await populate();
    const b = await exportBackup();
    expect(b.format).toBe('rotation-tracker-backup');
    expect(b.schemaVersion).toBe(SCHEMA_VERSION);
    expect(typeof b.appVersion).toBe('string');
  });

  it('refuses to export before a profile exists', async () => {
    await freshDb();
    await expect(exportBackup()).rejects.toThrow(/profile has not been created/);
  });
});

describe('prepareImport (confirm dialog)', () => {
  it('reports what would be destroyed without touching anything', async () => {
    await populate();
    const backup = throughJson(await exportBackup());

    const db = await getDb();
    const before = await db.getAll('setLogs');

    const plan = await prepareImport(backup);
    expect(plan.destroys).toEqual({
      profile: 1, maxes: 2, scheduled: 2, setLogs: 2, esdLogs: 1, tests: 2,
    });
    expect(plan.incoming).toEqual(plan.destroys);
    expect(plan.migrated).toBe(false);

    // Still a preview — nothing written.
    expect(await db.getAll('setLogs')).toEqual(before);
  });

  it('counts an empty database as destroying nothing', async () => {
    await populate();
    const backup = throughJson(await exportBackup());

    const db = await freshDb();
    await applySeed(db);
    await ensureProfile('block.accumulation');

    const plan = await prepareImport(backup);
    expect(plan.destroys['setLogs']).toBe(0);
    expect(plan.incoming['setLogs']).toBe(2);
  });
});

/* ---------- CSV ---------- */

describe('CSV export', () => {
  it('emits one row per set, joined to its session', async () => {
    await populate();
    const csv = await exportSessionLogsCsv();
    const lines = csv.split('\r\n');

    expect(lines[0]).toMatch(/^localDate,position,/);
    expect(lines).toHaveLength(3); // header + 2 sets
    expect(csv).toContain('ex.trap-bar-deadlift');
    expect(csv).toContain('Trap Bar Deadlift');
  });

  it('escapes quotes and commas', async () => {
    await populate();
    const csv = await exportSessionLogsCsv();
    expect(csv).toContain('"felt ""sharp"", 2nd"');
  });

  it('emits one row per test result', async () => {
    await populate();
    const csv = await exportBatteryCsv();
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('localDate,testId,testName,battery,side,value,unit,note,ts');
    expect(lines).toHaveLength(3);
    expect(csv).toContain('test.single-leg-hop');
  });
});
