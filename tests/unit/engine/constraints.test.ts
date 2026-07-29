import { describe, expect, it } from 'vitest';
import { NEURAL_LOAD, evaluateConstraints } from '../../../src/engine/constraints';
import type { LedgerRow } from '../../../src/engine/ledger';
import type { RotationPosition, ScheduledSession } from '../../../src/types';
import { templates } from './fixtures';
import { session } from '../factories';

const NOW = new Date(2026, 5, 15, 12, 0, 0);

const TEMPLATE_FOR: Record<string, string> = {
  TD1: 'tmpl.td1', TD2: 'tmpl.td2', TD3: 'tmpl.td3', RD: 'tmpl.rd',
  'TD-A': 'tmpl.td1', 'TD-B-STR': 'tmpl.td2', 'TD-B-ESD': 'tmpl.td3',
};

function at(localDate: string, position: RotationPosition): ScheduledSession {
  return session({
    id: `${localDate}-${position}`,
    localDate,
    ts: new Date(`${localDate}T12:00:00`).getTime(),
    position,
    templateId: TEMPLATE_FOR[position] ?? 'tmpl.td2',
    status: 'done',
  });
}

function run(schedule: ScheduledSession[], ledger: LedgerRow[] = []): string[] {
  return evaluateConstraints({ schedule, ledger, templates, now: NOW }).map((w) => w.id);
}

const floorRow: LedgerRow = {
  key: 'velocityFull', count: 1, missed: 0, floor: 4, ceiling: null, belowFloor: true,
};

/* ---------- 23 ---------- */

describe('23 — each warning fires on its trigger', () => {
  it('TD1_NOT_OFF_RD when TD1 does not follow a Recovery Day', () => {
    expect(run([at('2026-06-10', 'TD2'), at('2026-06-11', 'TD1')]))
      .toContain('TD1_NOT_OFF_RD');
  });

  it('DOUBLE_MAXINTENT for two max-intent sessions inside 48h', () => {
    expect(run([at('2026-06-10', 'TD1'), at('2026-06-11', 'TD1')]))
      .toContain('DOUBLE_MAXINTENT');
  });

  it('ESD_AFTER_RD when conditioning takes the fresh slot', () => {
    expect(run([at('2026-06-10', 'RD'), at('2026-06-11', 'TD3')]))
      .toContain('ESD_AFTER_RD');
  });

  it('VO2_ADJACENT for VO2max sessions on consecutive training days', () => {
    expect(run([at('2026-06-10', 'TD3'), at('2026-06-11', 'TD3')]))
      .toContain('VO2_ADJACENT');
  });

  it('CNS_ASCENT when neural load rises with no RD between', () => {
    // TD3 (4) -> TD2 (7) is an ascent.
    expect(run([at('2026-06-10', 'TD3'), at('2026-06-11', 'TD2')]))
      .toContain('CNS_ASCENT');
  });

  it('GAP_4D for four or more empty days between training days', () => {
    expect(run([at('2026-06-01', 'TD2'), at('2026-06-06', 'TD2')]))
      .toContain('GAP_4D');
  });

  it('GAP_4D for an open gap running up to today', () => {
    expect(run([at('2026-06-01', 'TD2')])).toContain('GAP_4D');
  });

  it('LEDGER_FLOOR when a row is below its floor', () => {
    expect(run([], [floorRow])).toContain('LEDGER_FLOOR');
  });

  it('LEDGER_FLOOR names the quality, count and floor', () => {
    const w = evaluateConstraints({ schedule: [], ledger: [floorRow], templates, now: NOW });
    expect(w[0]?.message).toBe('Velocity (full) below 28-day floor: 1 of 4.');
  });
});

/* ---------- 24 ---------- */

describe('24 — a clean 3:1 sequence fires nothing', () => {
  it('produces no warnings', () => {
    // RD -> TD1(9) -> TD2(7) -> TD3(4): descending, TD1 off an RD, no gaps.
    const clean = [
      at('2026-06-11', 'RD'),
      at('2026-06-12', 'TD1'),
      at('2026-06-13', 'TD2'),
      at('2026-06-14', 'TD3'),
      at('2026-06-15', 'RD'),
    ];
    expect(run(clean)).toEqual([]);
  });

  it('a clean 2:1 sequence fires nothing', () => {
    const clean = [
      at('2026-06-12', 'RD'),
      at('2026-06-13', 'TD-A'),
      at('2026-06-14', 'TD-B-STR'),
      at('2026-06-15', 'RD'),
    ];
    expect(run(clean)).toEqual([]);
  });

  it('the first session in a history cannot violate an ordering rule', () => {
    expect(run([at('2026-06-15', 'TD1')])).toEqual([]);
  });

  it('a rise straight out of a Recovery Day is not a CNS ascent', () => {
    expect(run([at('2026-06-14', 'RD'), at('2026-06-15', 'TD1')]))
      .not.toContain('CNS_ASCENT');
  });
});

/* ---------- 25 ---------- */

describe('25 — dismissibility', () => {
  it('LEDGER_FLOOR is not dismissible', () => {
    const w = evaluateConstraints({ schedule: [], ledger: [floorRow], templates, now: NOW });
    expect(w.every((x) => x.id === 'LEDGER_FLOOR')).toBe(true);
    expect(w.every((x) => x.dismissible === false)).toBe(true);
  });

  it('every other warning is dismissible', () => {
    const schedule = [
      at('2026-06-01', 'TD2'),
      at('2026-06-10', 'RD'),
      at('2026-06-11', 'TD3'),
      at('2026-06-12', 'TD1'),
      at('2026-06-13', 'TD1'),
      at('2026-06-14', 'TD2'),
    ];
    const w = evaluateConstraints({ schedule, ledger: [], templates, now: NOW });
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((x) => x.dismissible)).toBe(true);
  });

  it('severities match the specification', () => {
    const w = evaluateConstraints({
      schedule: [at('2026-06-10', 'TD2'), at('2026-06-11', 'TD1')],
      ledger: [floorRow],
      templates,
      now: NOW,
    });
    const sev = Object.fromEntries(w.map((x) => [x.id, x.severity]));
    expect(sev['TD1_NOT_OFF_RD']).toBe('alert');
    expect(sev['LEDGER_FLOOR']).toBe('alert');
    expect(sev['CNS_ASCENT']).toBe('warn');
  });
});

/* ---------- 26 ---------- */

describe('26 — always an array, never a throw, never a gate', () => {
  it('returns an array for well-formed empty input', () => {
    const out = evaluateConstraints({ schedule: [], ledger: [], templates, now: NOW });
    expect(Array.isArray(out)).toBe(true);
    expect(typeof out).not.toBe('boolean');
  });

  it.each([
    ['null schedule', { schedule: null }],
    ['string schedule', { schedule: 'nope' }],
    ['null ledger', { ledger: null }],
    ['null templates', { templates: null }],
    ['null now', { now: null }],
    ['everything missing', {}],
    ['null input', null],
    ['undefined input', undefined],
  ])('survives %s', (_label, patch) => {
    const input = {
      schedule: [], ledger: [], templates, now: NOW,
      ...(patch ?? {}),
    } as never;
    let out: unknown;
    expect(() => { out = evaluateConstraints(patch === null || patch === undefined ? (patch as never) : input); })
      .not.toThrow();
    expect(Array.isArray(out)).toBe(true);
  });

  it('survives malformed session records mixed with valid ones', () => {
    const input = {
      schedule: [null, { id: 'x' }, at('2026-06-15', 'TD1'), undefined] as never,
      ledger: [null, floorRow] as never,
      templates,
      now: NOW,
    };
    const out = evaluateConstraints(input);
    expect(Array.isArray(out)).toBe(true);
    expect(out.some((w) => w.id === 'LEDGER_FLOOR')).toBe(true);
  });
});

describe('neural loads', () => {
  it('match the specified values', () => {
    expect(NEURAL_LOAD).toEqual({
      TD1: 9, 'TD-A': 9, TD2: 7, 'TD-B-STR': 7, TD3: 4, 'TD-B-ESD': 4, RD: 1,
    });
  });
});
