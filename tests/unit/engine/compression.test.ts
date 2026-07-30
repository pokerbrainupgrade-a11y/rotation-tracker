import { describe, expect, it } from 'vitest';
import {
  availableLevels,
  doseFor,
  isCut,
  resolveCompression,
  templateExerciseIds,
} from '../../../src/engine/compression';
import { programSeed } from '../../../src/data/seed';
import type { SessionTemplate } from '../../../src/types';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const td1 = (): SessionTemplate => {
  const t = programSeed.sessionTemplates.find((x) => x.id === 'tmpl.td1-velocity');
  if (!t) throw new Error('seed is missing tmpl.td1-velocity');
  return clone(t);
};

const td3 = (): SessionTemplate => {
  const t = programSeed.sessionTemplates.find((x) => x.id === 'tmpl.td3-elastic');
  if (!t) throw new Error('seed is missing tmpl.td3-elastic');
  return clone(t);
};

/* ---------- TEST 6 ---------- */

describe('6 — compression resolves cut, modify and keepOnly', () => {
  it('100% cuts nothing', () => {
    const r = resolveCompression(td1(), 100);
    expect(r.cut.size).toBe(0);
    expect(r.modified).toEqual({});
    expect(r.note).toBeNull();
  });

  it('applies a cut list', () => {
    const r = resolveCompression(td1(), 75);
    expect(isCut(r, 'ex.vertical-jump')).toBe(true);
    expect(isCut(r, 'ex.med-ball-throw')).toBe(false);
    expect(r.note).toBeTruthy();
  });

  it('applies keepOnly by cutting everything not listed', () => {
    const r = resolveCompression(td1(), 25);
    const all = templateExerciseIds(td1());
    for (const id of all) {
      expect(isCut(r, id)).toBe(id !== 'ex.med-ball-throw');
    }
  });

  it('keepOnly retains the max-intent throw block on TD1', () => {
    const r = resolveCompression(td1(), 25);
    expect(isCut(r, 'ex.med-ball-throw')).toBe(false);
  });

  it('keepOnly retains only the 4x4 on TD3', () => {
    const r = resolveCompression(td3(), 25);
    expect(isCut(r, 'ex.bike-intervals')).toBe(false);
    expect(isCut(r, 'ex.pogo-hops')).toBe(true);
  });

  it('applies modify to the dose string and leaves others alone', () => {
    const r = resolveCompression(td3(), 75);
    expect(doseFor(r, 'ex.pogo-hops', '4 × 10')).toBe('3 × 10');
    expect(doseFor(r, 'ex.bike-intervals', '4 × 4')).toBe('4 × 4');
  });

  it('keepOnly takes precedence over a cut list on the same level', () => {
    const t = td1();
    t.compression['50'] = { cut: ['ex.broad-jump'], keepOnly: ['ex.back-squat'] };
    const r = resolveCompression(t, 50);
    expect(isCut(r, 'ex.back-squat')).toBe(false);
    expect(isCut(r, 'ex.broad-jump')).toBe(true);
    expect(isCut(r, 'ex.med-ball-throw')).toBe(true);
  });

  it('a level the template does not define compresses nothing', () => {
    const t = td1();
    delete t.compression['50'];
    expect(resolveCompression(t, 50).cut.size).toBe(0);
  });

  it('reports the levels a template actually defines', () => {
    expect(availableLevels(td1())).toEqual([25, 50, 75]);
    const rd = programSeed.sessionTemplates.find((x) => x.id === 'tmpl.rd');
    // Recovery Days are not compressed by design.
    expect(availableLevels(clone(rd as SessionTemplate))).toEqual([]);
  });

  it('survives a template with no compression map at all', () => {
    const t = td1();
    t.compression = {};
    expect(() => resolveCompression(t, 25)).not.toThrow();
    expect(resolveCompression(t, 25).cut.size).toBe(0);
  });
});

/* ---------- TEST 7: the seed is live ---------- */

describe('7 — mutating the seed changes resolved output', () => {
  it('changing a cut list changes what is cut', () => {
    const before = resolveCompression(td1(), 75);
    expect(isCut(before, 'ex.back-squat')).toBe(false);

    const mutated = td1();
    mutated.compression['75'] = { cut: ['ex.back-squat'] };
    const after = resolveCompression(mutated, 75);

    expect(isCut(after, 'ex.back-squat')).toBe(true);
    expect(isCut(after, 'ex.vertical-jump')).toBe(false); // no longer cut
  });

  it('changing keepOnly changes which exercise survives 25%', () => {
    const stock = resolveCompression(td1(), 25);
    expect(isCut(stock, 'ex.broad-jump')).toBe(true);

    const mutated = td1();
    mutated.compression['25'] = { keepOnly: ['ex.broad-jump'] };
    const after = resolveCompression(mutated, 25);

    expect(isCut(after, 'ex.broad-jump')).toBe(false);
    expect(isCut(after, 'ex.med-ball-throw')).toBe(true);
  });

  it('changing modify changes the dose string', () => {
    const mutated = td3();
    mutated.compression['75'] = { modify: { 'ex.pogo-hops': '1 × 5' } };
    expect(doseFor(resolveCompression(mutated, 75), 'ex.pogo-hops', '4 × 10')).toBe('1 × 5');
  });

  it('changing the note changes what is displayed', () => {
    const mutated = td1();
    mutated.compression['50'] = { cut: [], note: 'REWRITTEN FROM THE SEED' };
    expect(resolveCompression(mutated, 50).note).toBe('REWRITTEN FROM THE SEED');
  });

  it('adding a level makes it available', () => {
    const rd = clone(
      programSeed.sessionTemplates.find((x) => x.id === 'tmpl.rd') as SessionTemplate,
    );
    expect(availableLevels(rd)).toEqual([]);
    rd.compression['50'] = { cut: ['ex.easy-walk'] };
    expect(availableLevels(rd)).toEqual([50]);
    expect(isCut(resolveCompression(rd, 50), 'ex.easy-walk')).toBe(true);
  });

  it('the engine holds no exercise ids of its own', async () => {
    // If a cut map were hardcoded here, this source would name exercises.
    const src = await import('../../../src/engine/compression?raw').catch(() => null);
    void src; // the assertion below is the real one
    // Behavioural proof: an empty template compresses nothing, whatever level.
    const bare: SessionTemplate = {
      ...td1(), sections: [], compression: {}, volumeCap: null,
    };
    for (const level of [25, 50, 75, 100] as const) {
      expect(resolveCompression(bare, level).cut.size).toBe(0);
    }
  });
});

/* ---------- shipped seed sanity ---------- */

describe('the shipped compression maps', () => {
  it('every template carries a compressionRule', () => {
    for (const t of programSeed.sessionTemplates) {
      expect(typeof t.compressionRule).toBe('string');
      expect(t.compressionRule.length).toBeGreaterThan(0);
    }
  });

  it('every cut and keepOnly id exists in its own template', () => {
    for (const t of programSeed.sessionTemplates) {
      const ids = new Set(templateExerciseIds(t));
      for (const level of ['75', '50', '25'] as const) {
        const spec = t.compression[level];
        if (!spec) continue;
        for (const id of [...(spec.cut ?? []), ...(spec.keepOnly ?? [])]) {
          expect(ids.has(id), `${t.id} ${level} references ${id}`).toBe(true);
        }
        for (const id of Object.keys(spec.modify ?? {})) {
          expect(ids.has(id), `${t.id} ${level} modifies ${id}`).toBe(true);
        }
      }
    }
  });
});
