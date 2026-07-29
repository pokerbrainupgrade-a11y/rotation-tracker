import { afterEach, describe, expect, it } from 'vitest';
import { closeDb } from '../../src/data/db';
import {
  SeedValidationError,
  applySeed,
  ensureSeeded,
  programSeed,
  validateSeed,
} from '../../src/data/seed';
import { STATIC_STORES, type ProgramSeed } from '../../src/types';
import { freshDb, seededDb, throughJson } from './helpers';
import { esdLog, maxRecord, session, setLog, testResult } from './factories';

afterEach(async () => {
  await closeDb();
});

const clone = (): ProgramSeed => throughJson(programSeed);

describe('the shipped seed', () => {
  it('is referentially valid', () => {
    expect(validateSeed(programSeed)).toEqual([]);
  });

  it('covers every rotation position', () => {
    const positions = new Set(programSeed.sessionTemplates.map((t) => t.position));
    for (const p of ['TD1', 'TD2', 'TD3', 'TD-A', 'TD-B-STR', 'TD-B-ESD', 'RD']) {
      expect(positions).toContain(p);
    }
  });
});

/* ---------- ACCEPTANCE TEST 2: seed idempotency ---------- */

describe('acceptance 2 — seed idempotency', () => {
  it('running seed twice produces identical state with no duplicates', async () => {
    const db = await freshDb();

    await applySeed(db);
    const first = await Promise.all(STATIC_STORES.map((s) => db.getAll(s)));

    await applySeed(db);
    const second = await Promise.all(STATIC_STORES.map((s) => db.getAll(s)));

    expect(second).toEqual(first);
    expect(await db.count('exercises')).toBe(programSeed.exercises.length);
    expect(await db.count('sessionTemplates')).toBe(programSeed.sessionTemplates.length);
  });

  it('removes entries that no longer exist in the seed', async () => {
    const db = await freshDb();
    await applySeed(db);

    const trimmed = clone();
    trimmed.exercises = trimmed.exercises.filter((e) => e.id !== 'ex.easy-walk');
    trimmed.substitutionTags = trimmed.substitutionTags.map((t) => ({
      ...t,
      appliesTo: t.appliesTo.filter((id) => id !== 'ex.easy-walk'),
    }));
    trimmed.sessionTemplates = trimmed.sessionTemplates.map((t) => ({
      ...t,
      sections: t.sections.map((s) => ({
        ...s,
        exerciseIds: s.exerciseIds.filter((id) => id !== 'ex.easy-walk'),
      })),
    }));

    await applySeed(db, trimmed);
    expect(await db.get('exercises', 'ex.easy-walk')).toBeUndefined();
  });
});

/* ---------- ACCEPTANCE TEST 3: seed update isolation ---------- */

describe('acceptance 3 — seed update isolation', () => {
  it('reseeding replaces static stores and leaves user stores untouched', async () => {
    const db = await seededDb();

    // Populate every user store.
    await db.put('scheduled', session());
    await db.put('setLogs', setLog());
    await db.put('esdLogs', esdLog());
    await db.put('maxes', maxRecord());
    await db.put('tests', testResult());

    const before = {
      profile: await db.get('profile', 'me'),
      maxes: await db.getAll('maxes'),
      scheduled: await db.getAll('scheduled'),
      setLogs: await db.getAll('setLogs'),
      esdLogs: await db.getAll('esdLogs'),
      tests: await db.getAll('tests'),
    };

    // Bump the seed: rename a label and add an exercise.
    const v2 = clone();
    v2.seedVersion = 2;
    const firstLift = v2.lifts[0];
    expect(firstLift).toBeDefined();
    if (firstLift) firstLift.name = 'Back Squat (High Bar)';
    v2.exercises.push({
      id: 'ex.hip-thrust',
      name: 'Hip Thrust',
      liftRef: null,
      tags: ['tag.hinge'],
      maxIntent: false,
      sets: 3, reps: 8, perSide: false, restSec: 90,
      restPurpose: 'LOCAL RECOVERY', intent: 'test', terminationRule: 'test',
      source: 'test', regression: 'easier', progression: 'harder',
    });

    const didSeed = await ensureSeeded(v2, 2);
    expect(didSeed).toBe(true);

    // Static stores replaced.
    expect((await db.get('lifts', 'lift.back-squat'))?.name).toBe('Back Squat (High Bar)');
    expect(await db.get('exercises', 'ex.hip-thrust')).toBeDefined();

    // User stores untouched — counts and contents identical.
    expect(await db.getAll('maxes')).toEqual(before.maxes);
    expect(await db.getAll('scheduled')).toEqual(before.scheduled);
    expect(await db.getAll('setLogs')).toEqual(before.setLogs);
    expect(await db.getAll('esdLogs')).toEqual(before.esdLogs);
    expect(await db.getAll('tests')).toEqual(before.tests);

    // Only the recorded seedVersion moved on the profile.
    const after = await db.get('profile', 'me');
    expect(after).toEqual({ ...before.profile, seedVersion: 2 });
  });

  it('does not reseed when the stored version already matches', async () => {
    await seededDb();
    expect(await ensureSeeded(programSeed, 1)).toBe(false);
  });

  it('reseeds when static stores are empty even at a matching version', async () => {
    const db = await seededDb();
    await db.clear('exercises');
    expect(await ensureSeeded(programSeed, 1)).toBe(true);
    expect(await db.count('exercises')).toBe(programSeed.exercises.length);
  });
});

/* ---------- ACCEPTANCE TEST 12: seed validation ---------- */

describe('acceptance 12 — seed validation', () => {
  it('throws when a template references a nonexistent exercise', async () => {
    const bad = clone();
    const tmpl = bad.sessionTemplates[0];
    expect(tmpl).toBeDefined();
    const section = tmpl?.sections[0];
    expect(section).toBeDefined();
    if (section) section.exerciseIds = ['ex.does-not-exist'];

    expect(() => validateSeed(bad)).not.toThrow();
    expect(validateSeed(bad).join()).toMatch(/unknown exercise "ex.does-not-exist"/);

    const db = await freshDb();
    await expect(applySeed(db, bad)).rejects.toThrow(SeedValidationError);
  });

  it('throws when an exercise references a nonexistent lift', () => {
    const bad = clone();
    const ex = bad.exercises[0];
    if (ex) ex.liftRef = 'lift.nope';
    expect(validateSeed(bad).join()).toMatch(/unknown lift "lift.nope"/);
  });

  it('throws when a substitution tag applies to a nonexistent exercise', () => {
    const bad = clone();
    const tag = bad.substitutionTags[0];
    if (tag) tag.appliesTo = ['ex.ghost'];
    expect(validateSeed(bad).join()).toMatch(/applies to unknown exercise "ex.ghost"/);
  });

  it('catches duplicate ids', () => {
    const bad = clone();
    const first = bad.exercises[0];
    if (first) bad.exercises.push({ ...first });
    expect(validateSeed(bad).join()).toMatch(/duplicate exercise id/);
  });

  it('reports every problem at once rather than only the first', () => {
    const bad = clone();
    const ex = bad.exercises[0];
    if (ex) ex.liftRef = 'lift.nope';
    const tag = bad.substitutionTags[0];
    if (tag) tag.appliesTo = ['ex.ghost'];
    expect(validateSeed(bad).length).toBeGreaterThanOrEqual(2);
  });

  it('a bad seed leaves the static stores untouched', async () => {
    const db = await freshDb();
    await applySeed(db);
    const before = await db.getAll('exercises');

    const bad = clone();
    const section = bad.sessionTemplates[0]?.sections[0];
    if (section) section.exerciseIds = ['ex.missing'];

    await expect(applySeed(db, bad)).rejects.toThrow(SeedValidationError);
    expect(await db.getAll('exercises')).toEqual(before);
  });
});
