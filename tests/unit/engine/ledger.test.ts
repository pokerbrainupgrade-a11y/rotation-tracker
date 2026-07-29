import { describe, expect, it } from 'vitest';
import { computeLedger, type LedgerRow } from '../../../src/engine/ledger';
import type { EsdLog, LedgerKey, ScheduledSession, SetLog } from '../../../src/types';
import { block, blockB, exercises, td1, templates } from './fixtures';
import { esdLog, session, setLog } from '../factories';

// TZ pinned to America/New_York by vitest.config.ts.
const NOW = new Date(2026, 5, 15, 12, 0, 0); // 2026-06-15

function ledger(
  over: {
    scheduled?: ScheduledSession[];
    setLogs?: SetLog[];
    esdLogs?: EsdLog[];
    now?: Date;
    blk?: ReturnType<typeof block>;
  } = {},
): LedgerRow[] {
  return computeLedger({
    scheduled: over.scheduled ?? [],
    setLogs: over.setLogs ?? [],
    esdLogs: over.esdLogs ?? [],
    templates,
    exercises,
    block: over.blk ?? block(),
    now: over.now ?? NOW,
  });
}

const row = (rows: LedgerRow[], key: LedgerKey): LedgerRow => {
  const r = rows.find((x) => x.key === key);
  if (!r) throw new Error(`missing row ${key}`);
  return r;
};

/** A completed TD1 with its power block actually logged. */
function td1Done(id: string, localDate: string): {
  s: ScheduledSession;
  sets: SetLog[];
} {
  return {
    s: session({ id, localDate, templateId: 'tmpl.td1', position: 'TD1', status: 'done' }),
    sets: [
      setLog({ id: `${id}-throw`, scheduledId: id, exerciseId: 'ex.throw', completed: true }),
    ],
  };
}

/* ---------- 1 ---------- */

describe('1 — empty history', () => {
  it('all counts 0 and every row below floor', () => {
    const rows = ledger();
    expect(rows.map((r) => r.key)).toEqual([
      'velocityFull', 'velocityPrime', 'vo2max', 'zone2Min', 'trainingDays',
    ]);
    for (const r of rows) {
      expect(r.count).toBe(0);
      expect(r.belowFloor).toBe(true);
    }
  });
});

/* ---------- 2 ---------- */

describe('2 — window boundary', () => {
  it('a session exactly 28 days ago is included; 29 days ago is excluded', () => {
    const inside = td1Done('in', '2026-05-19');  // 27 days before 06-15 -> day 28
    const outside = td1Done('out', '2026-05-18'); // day 29

    expect(row(ledger({ scheduled: [inside.s], setLogs: inside.sets }), 'velocityFull').count)
      .toBe(1);
    expect(row(ledger({ scheduled: [outside.s], setLogs: outside.sets }), 'velocityFull').count)
      .toBe(0);
  });

  it('excludes future-dated sessions', () => {
    const future = td1Done('f', '2026-06-16');
    expect(row(ledger({ scheduled: [future.s], setLogs: future.sets }), 'velocityFull').count)
      .toBe(0);
  });
});

/* ---------- 3 & 4: DST ---------- */

describe('3 — spring-forward inside the window', () => {
  it('counts correctly across the 23-hour day', () => {
    const now = new Date(2026, 2, 20, 12, 0, 0); // 2026-03-20; window back to 02-21
    const a = td1Done('a', '2026-03-08'); // the DST day itself
    const b = td1Done('b', '2026-03-07');
    const c = td1Done('c', '2026-02-21'); // oldest day in window
    const tooOld = td1Done('d', '2026-02-20');

    const rows = ledger({
      scheduled: [a.s, b.s, c.s, tooOld.s],
      setLogs: [...a.sets, ...b.sets, ...c.sets, ...tooOld.sets],
      now,
    });
    expect(row(rows, 'velocityFull').count).toBe(3);
  });
});

describe('4 — fall-back inside the window', () => {
  it('counts correctly across the 25-hour day', () => {
    const now = new Date(2026, 10, 10, 12, 0, 0); // 2026-11-10; window back to 10-14
    const a = td1Done('a', '2026-11-01'); // the DST day itself
    const b = td1Done('b', '2026-10-14'); // oldest day in window
    const tooOld = td1Done('c', '2026-10-13');

    const rows = ledger({
      scheduled: [a.s, b.s, tooOld.s],
      setLogs: [...a.sets, ...b.sets, ...tooOld.sets],
      now,
    });
    expect(row(rows, 'velocityFull').count).toBe(2);
  });
});

/* ---------- 5 ---------- */

describe('5 — 23:58 and 00:02 local', () => {
  it('land on different localDate values and count as different days', () => {
    // Same wall-clock minutes apart, but either side of midnight.
    const late = session({
      id: 'late', localDate: '2026-06-14', ts: new Date(2026, 5, 14, 23, 58).getTime(),
      templateId: 'tmpl.td2', position: 'TD2', status: 'done',
    });
    const early = session({
      id: 'early', localDate: '2026-06-15', ts: new Date(2026, 5, 15, 0, 2).getTime(),
      templateId: 'tmpl.td2', position: 'TD2', status: 'done',
    });

    expect(late.localDate).not.toBe(early.localDate);
    expect(row(ledger({ scheduled: [late, early] }), 'trainingDays').count).toBe(2);
  });
});

/* ---------- 6 & 7: THE PROTOCOL RULE ---------- */

describe('6 — TD1 with throw sets logged', () => {
  it('counts velocityFull', () => {
    const a = td1Done('a', '2026-06-10');
    expect(row(ledger({ scheduled: [a.s], setLogs: a.sets }), 'velocityFull').count).toBe(1);
  });
});

describe('7 — TD1 with the throw block cut', () => {
  it('does NOT count, even though the session is done against a TD1 template', () => {
    const s = session({
      id: 'cut', localDate: '2026-06-10', templateId: 'tmpl.td1',
      position: 'TD1', status: 'done',
    });
    // Only the strength block was logged; no max-intent set exists.
    const sets = [
      setLog({ id: 'sq', scheduledId: 'cut', exerciseId: 'ex.squat', completed: true }),
    ];

    const rows = ledger({ scheduled: [s], setLogs: sets });
    expect(row(rows, 'velocityFull').count).toBe(0);
    expect(row(rows, 'velocityPrime').count).toBe(0);
    // It was still a training day — it just was not a TD1.
    expect(row(rows, 'trainingDays').count).toBe(1);
  });

  it('does not count max-intent sets that were not completed', () => {
    const s = session({
      id: 'x', localDate: '2026-06-10', templateId: 'tmpl.td1',
      position: 'TD1', status: 'done',
    });
    const sets = [
      setLog({ id: 't', scheduledId: 'x', exerciseId: 'ex.throw', completed: false }),
    ];
    expect(row(ledger({ scheduled: [s], setLogs: sets }), 'velocityFull').count).toBe(0);
  });

  it('velocityFull can be earned by a non-prime max-intent exercise', () => {
    const s = session({
      id: 'x', localDate: '2026-06-10', templateId: 'tmpl.td1',
      position: 'TD1', status: 'done',
    });
    // ex.jump is maxIntent and in the power section, but is NOT the prime.
    const sets = [
      setLog({ id: 'j', scheduledId: 'x', exerciseId: 'ex.jump', completed: true }),
    ];
    const rows = ledger({ scheduled: [s], setLogs: sets });
    expect(row(rows, 'velocityFull').count).toBe(1);
    expect(row(rows, 'velocityPrime').count).toBe(0);
  });

  it('a template with no ledger eligibility never contributes', () => {
    const s = session({
      id: 'x', localDate: '2026-06-10', templateId: 'tmpl.td2',
      position: 'TD2', status: 'done',
    });
    const sets = [
      setLog({ id: 't', scheduledId: 'x', exerciseId: 'ex.throw', completed: true }),
    ];
    expect(row(ledger({ scheduled: [s], setLogs: sets }), 'velocityFull').count).toBe(0);
  });

  it('a power section with no named prime can still earn velocityFull', () => {
    // velocityPrime is unearnable without a prime; velocityFull is not.
    const noPrime = {
      ...td1,
      id: 'tmpl.noprime',
      sections: [
        {
          id: 'sec.p', label: 'Power', role: 'power' as const,
          exerciseIds: ['ex.throw'], primeExerciseId: null,
        },
      ],
    };
    const s = session({
      id: 'x', localDate: '2026-06-10', templateId: 'tmpl.noprime',
      position: 'TD1', status: 'done',
    });
    const sets = [
      setLog({ id: 't', scheduledId: 'x', exerciseId: 'ex.throw', completed: true }),
    ];
    const rows = computeLedger({
      scheduled: [s], setLogs: sets, esdLogs: [],
      templates: [noPrime], exercises, block: block(), now: NOW,
    });
    expect(row(rows, 'velocityFull').count).toBe(1);
    expect(row(rows, 'velocityPrime').count).toBe(0);
  });

  it('an unknown templateId contributes nothing rather than throwing', () => {
    const s = session({
      id: 'x', localDate: '2026-06-10', templateId: 'tmpl.ghost',
      position: 'TD1', status: 'done',
    });
    expect(() => ledger({ scheduled: [s] })).not.toThrow();
    expect(row(ledger({ scheduled: [s] }), 'velocityFull').count).toBe(0);
  });
});

/* ---------- 8 & 9: substitution ---------- */

describe('8 / 9 — substituted sessions', () => {
  const base = (metDosingSignature: boolean | null): ScheduledSession =>
    session({
      id: 'sub', localDate: '2026-06-10', templateId: 'tmpl.td1', position: 'TD1',
      status: 'done', substituted: true, metDosingSignature,
      substitutionNote: 'no med balls',
    });

  it('8 — metDosingSignature true counts, with no template sets logged', () => {
    expect(row(ledger({ scheduled: [base(true)] }), 'velocityFull').count).toBe(1);
    expect(row(ledger({ scheduled: [base(true)] }), 'velocityPrime').count).toBe(1);
  });

  it('9 — metDosingSignature false does not count', () => {
    expect(row(ledger({ scheduled: [base(false)] }), 'velocityFull').count).toBe(0);
  });

  it('null metDosingSignature does not count', () => {
    expect(row(ledger({ scheduled: [base(null)] }), 'velocityFull').count).toBe(0);
  });

  it('a substitution that met the signature counts even if logged sets would not', () => {
    const s = base(true);
    const sets = [
      setLog({ id: 's', scheduledId: 'sub', exerciseId: 'ex.squat', completed: true }),
    ];
    expect(row(ledger({ scheduled: [s], setLogs: sets }), 'velocityFull').count).toBe(1);
  });
});

/* ---------- 10 ---------- */

describe('10 — VO2max misses are tracked, not dropped', () => {
  it('counted:false increments missed and leaves count unchanged', () => {
    const s = session({
      id: 'v', localDate: '2026-06-10', templateId: 'tmpl.td3',
      position: 'TD3', status: 'done',
    });
    const rows = ledger({
      scheduled: [s],
      esdLogs: [esdLog({ id: 'e', scheduledId: 'v', type: 'vo2max', counted: false })],
    });
    expect(row(rows, 'vo2max').count).toBe(0);
    expect(row(rows, 'vo2max').missed).toBe(1);
  });

  it('distinguishes attempted-and-qualified from attempted-and-missed', () => {
    const mk = (id: string, d: string, counted: boolean) => ({
      s: session({ id, localDate: d, templateId: 'tmpl.td3', position: 'TD3', status: 'done' }),
      e: esdLog({ id: `${id}-e`, scheduledId: id, type: 'vo2max' as const, counted }),
    });
    const a = mk('a', '2026-06-01', true);
    const b = mk('b', '2026-06-03', true);
    const c = mk('c', '2026-06-05', false);
    const d = mk('d', '2026-06-07', false);

    const rows = ledger({
      scheduled: [a.s, b.s, c.s, d.s],
      esdLogs: [a.e, b.e, c.e, d.e],
    });
    expect(row(rows, 'vo2max').count).toBe(2);
    expect(row(rows, 'vo2max').missed).toBe(2);
  });

  it('missed is 0 on every non-vo2max row', () => {
    for (const r of ledger()) {
      if (r.key !== 'vo2max') expect(r.missed).toBe(0);
    }
  });
});

/* ---------- 11 ---------- */

describe('11 — two sessions on one date', () => {
  it('counts one training day, not two', () => {
    const a = session({
      id: 'a', localDate: '2026-06-10', templateId: 'tmpl.td2', position: 'TD2', status: 'done',
    });
    const b = session({
      id: 'b', localDate: '2026-06-10', ts: a.ts + 3600_000,
      templateId: 'tmpl.td3', position: 'TD3', status: 'done',
    });
    expect(row(ledger({ scheduled: [a, b] }), 'trainingDays').count).toBe(1);
  });

  it('excludes Recovery Days from training days', () => {
    const rdSession = session({
      id: 'r', localDate: '2026-06-11', templateId: 'tmpl.rd', position: 'RD', status: 'done',
    });
    expect(row(ledger({ scheduled: [rdSession] }), 'trainingDays').count).toBe(0);
  });
});

/* ---------- 12 ---------- */

describe('12 — non-done statuses never count', () => {
  it.each(['planned', 'missed', 'deferred'] as const)('%s contributes nothing', (status) => {
    const s = session({
      id: 's', localDate: '2026-06-10', templateId: 'tmpl.td1', position: 'TD1', status,
    });
    const sets = [
      setLog({ id: 't', scheduledId: 's', exerciseId: 'ex.throw', completed: true }),
    ];
    const rows = ledger({ scheduled: [s], setLogs: sets });
    expect(row(rows, 'velocityFull').count).toBe(0);
    expect(row(rows, 'trainingDays').count).toBe(0);
  });

  it('a missed session with a vo2max log does not count as missed either', () => {
    const s = session({
      id: 'v', localDate: '2026-06-10', templateId: 'tmpl.td3', position: 'TD3',
      status: 'missed',
    });
    const rows = ledger({
      scheduled: [s],
      esdLogs: [esdLog({ id: 'e', scheduledId: 'v', type: 'vo2max', counted: false })],
    });
    expect(row(rows, 'vo2max').missed).toBe(0);
  });
});

/* ---------- 13 ---------- */

describe('13 — floors come from the active block', () => {
  it('the same history yields different belowFloor across two blocks', () => {
    const a = td1Done('a', '2026-06-10');
    const b = td1Done('b', '2026-06-11');
    const args = { scheduled: [a.s, b.s], setLogs: [...a.sets, ...b.sets] };

    const strict = ledger({ ...args, blk: block() });   // velocityFull floor 4
    const loose = ledger({ ...args, blk: blockB });     // velocityFull floor 1

    expect(row(strict, 'velocityFull').floor).toBe(4);
    expect(row(strict, 'velocityFull').belowFloor).toBe(true);

    expect(row(loose, 'velocityFull').floor).toBe(1);
    expect(row(loose, 'velocityFull').belowFloor).toBe(false);
  });

  it('carries ceilings through from the block', () => {
    expect(row(ledger({ blk: block() }), 'vo2max').ceiling).toBe(6);
    expect(row(ledger({ blk: blockB }), 'vo2max').ceiling).toBe(3);
    expect(row(ledger(), 'velocityFull').ceiling).toBeNull();
  });

  it('a block missing floors degrades to 0 rather than throwing', () => {
    const broken = block({ floors: {} as never });
    const rows = ledger({ blk: broken });
    expect(rows.every((r) => r.floor === 0)).toBe(true);
    expect(rows.every((r) => r.belowFloor === false)).toBe(true);
  });
});

/* ---------- 14 ---------- */

describe('14 — zone 2 minutes', () => {
  it('sums minutes across multiple RDs in the window', () => {
    const days = ['2026-06-02', '2026-06-06', '2026-06-11'];
    const sessions = days.map((d, i) =>
      session({ id: `r${i}`, localDate: d, templateId: 'tmpl.rd', position: 'RD', status: 'done' }),
    );
    const logs = sessions.map((s, i) =>
      esdLog({ id: `e${i}`, scheduledId: s.id, type: 'zone2', minutes: 30 + i * 10 }),
    );

    expect(row(ledger({ scheduled: sessions, esdLogs: logs }), 'zone2Min').count).toBe(120);
  });

  it('ignores zone 2 logs outside the window', () => {
    const old = session({
      id: 'o', localDate: '2026-05-01', templateId: 'tmpl.rd', position: 'RD', status: 'done',
    });
    const logs = [esdLog({ id: 'e', scheduledId: 'o', type: 'zone2', minutes: 999 })];
    expect(row(ledger({ scheduled: [old], esdLogs: logs }), 'zone2Min').count).toBe(0);
  });

  it('ignores a non-finite minutes value rather than producing NaN', () => {
    const s = session({
      id: 'r', localDate: '2026-06-10', templateId: 'tmpl.rd', position: 'RD', status: 'done',
    });
    const logs = [
      esdLog({ id: 'e', scheduledId: 'r', type: 'zone2', minutes: Number.NaN }),
      esdLog({ id: 'e2', scheduledId: 'r', type: 'zone2', minutes: 20 }),
    ];
    expect(row(ledger({ scheduled: [s], esdLogs: logs }), 'zone2Min').count).toBe(20);
  });

  it('orphaned logs whose session is outside the window are ignored', () => {
    const logs = [esdLog({ id: 'e', scheduledId: 'nonexistent', type: 'zone2', minutes: 50 })];
    expect(row(ledger({ esdLogs: logs }), 'zone2Min').count).toBe(0);
  });
});
