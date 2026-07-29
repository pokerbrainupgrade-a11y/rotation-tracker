import { describe, expect, it } from 'vitest';
import {
  applyDeferral,
  daysSinceLastTrainingDay,
  layoffState,
  nextPosition,
} from '../../../src/engine/rotation';
import type { RotationPosition, ScheduledSession, SessionStatus } from '../../../src/types';
import { session } from '../factories';

const NOW = new Date(2026, 5, 15, 12, 0, 0); // 2026-06-15

let day = 0;
function done(position: RotationPosition, status: SessionStatus = 'done'): ScheduledSession {
  day += 1;
  const d = new Date(2026, 4, day); // May 1st onwards, deterministic
  return session({
    id: `s${day}-${position}`,
    localDate: `2026-05-${String(day).padStart(2, '0')}`,
    ts: d.getTime(),
    position,
    status,
  });
}
function reset(): void {
  day = 0;
}

/* ---------- 15 ---------- */

describe('15 — empty history', () => {
  it('starts at TD1 under 3:1', () => {
    expect(nextPosition([], '3:1')).toBe('TD1');
  });
  it('starts at TD-A under 2:1', () => {
    expect(nextPosition([], '2:1')).toBe('TD-A');
  });
  it('starts fresh when history contains only incomplete sessions', () => {
    reset();
    expect(nextPosition([done('TD1', 'planned'), done('TD2', 'missed')], '3:1')).toBe('TD1');
  });
});

/* ---------- 16 ---------- */

describe('16 — 3:1 cycle', () => {
  it('advances through all four positions and wraps', () => {
    reset();
    const h: ScheduledSession[] = [];
    const seen: RotationPosition[] = [];
    for (let i = 0; i < 5; i++) {
      const next = nextPosition(h, '3:1');
      seen.push(next);
      h.push(done(next));
    }
    expect(seen).toEqual(['TD1', 'TD2', 'TD3', 'RD', 'TD1']);
  });

  it('is order-independent of array insertion — sorts chronologically', () => {
    reset();
    const a = done('TD1');
    const b = done('TD2');
    expect(nextPosition([b, a], '3:1')).toBe('TD3');
  });

  it('breaks same-day ties on ts, so two sessions on one date order correctly', () => {
    const early = session({
      id: 'e', localDate: '2026-06-10', ts: new Date(2026, 5, 10, 6).getTime(),
      position: 'TD1', status: 'done',
    });
    const late = session({
      id: 'l', localDate: '2026-06-10', ts: new Date(2026, 5, 10, 18).getTime(),
      position: 'TD2', status: 'done',
    });
    // Whichever order they arrive in, TD2 is the later session -> next is TD3.
    expect(nextPosition([early, late], '3:1')).toBe('TD3');
    expect(nextPosition([late, early], '3:1')).toBe('TD3');
  });
});

/* ---------- 17 ---------- */

describe('17 — 2:1 supercycle', () => {
  it('alternates TD-B: STR then ESD then STR', () => {
    reset();
    const h: ScheduledSession[] = [];
    const seen: RotationPosition[] = [];
    for (let i = 0; i < 7; i++) {
      const next = nextPosition(h, '2:1');
      seen.push(next);
      h.push(done(next));
    }
    expect(seen).toEqual([
      'TD-A', 'TD-B-STR', 'RD', 'TD-A', 'TD-B-ESD', 'RD', 'TD-A',
    ]);
  });

  it('after TD-B-ESD the next B variant is STR again', () => {
    reset();
    const h = [done('TD-A'), done('TD-B-ESD'), done('RD'), done('TD-A')];
    expect(nextPosition(h, '2:1')).toBe('TD-B-STR');
  });

  it('restarts the supercycle if the history holds a 3:1 position', () => {
    reset();
    expect(nextPosition([done('TD2')], '2:1')).toBe('TD-A');
  });

  it('restarts the 3:1 cycle if the history holds a 2:1 position', () => {
    reset();
    expect(nextPosition([done('TD-B-STR')], '3:1')).toBe('TD1');
  });
});

/* ---------- 18: REST MUST NOT BANK ---------- */

describe('18 — consecutive Recovery Days do not bank', () => {
  it('three RDs in a row still yield exactly one TD1', () => {
    reset();
    const h = [done('TD1'), done('TD2'), done('TD3'), done('RD'), done('RD'), done('RD')];
    expect(nextPosition(h, '3:1')).toBe('TD1');
  });

  it('ten RDs still yield one TD1', () => {
    reset();
    const h = Array.from({ length: 10 }, () => done('RD'));
    expect(nextPosition(h, '3:1')).toBe('TD1');
  });

  it('holds under 2:1 as well', () => {
    reset();
    const h = [done('RD'), done('RD'), done('RD')];
    expect(nextPosition(h, '2:1')).toBe('TD-A');
  });

  it('after the single TD1, the cycle resumes normally rather than repeating', () => {
    reset();
    const h = [done('RD'), done('RD'), done('RD'), done('TD1')];
    expect(nextPosition(h, '3:1')).toBe('TD2');
  });
});

/* ---------- 19 ---------- */

describe('19 — incomplete sessions do not advance the cycle', () => {
  it.each(['planned', 'missed', 'deferred'] as const)('%s is ignored', (status) => {
    reset();
    const h = [done('TD1'), done('TD2', status)];
    expect(nextPosition(h, '3:1')).toBe('TD2');
  });

  it('a missed TD1 does not consume the position', () => {
    reset();
    expect(nextPosition([done('TD1', 'missed')], '3:1')).toBe('TD1');
  });
});

/* ---------- 20 & 21: deferral ---------- */

describe('20 — deferral', () => {
  const schedule: ScheduledSession[] = [
    session({ id: 'a', localDate: '2026-06-01', ts: new Date(2026, 5, 1, 6, 30).getTime() }),
    session({ id: 'b', localDate: '2026-06-03', ts: new Date(2026, 5, 3, 6, 30).getTime() }),
    session({ id: 'c', localDate: '2026-06-06', ts: new Date(2026, 5, 6, 6, 30).getTime() }),
  ];

  it('shifts every session on or after the date and preserves spacing', () => {
    const out = applyDeferral(schedule, '2026-06-03', 2);
    expect(out.map((s) => s.localDate)).toEqual(['2026-06-01', '2026-06-05', '2026-06-08']);

    // Gaps between the shifted pair are unchanged (2 then 3 days).
    expect(out[0]?.localDate).toBe('2026-06-01');
    const gap = (x: string, y: string) =>
      (new Date(y).getTime() - new Date(x).getTime()) / 86_400_000;
    expect(gap('2026-06-05', '2026-06-08')).toBe(3);
  });

  it('leaves earlier sessions untouched, object-identical', () => {
    const out = applyDeferral(schedule, '2026-06-03', 2);
    expect(out[0]).toBe(schedule[0]);
  });

  it('doubles nothing onto a single date', () => {
    const out = applyDeferral(schedule, '2026-06-01', 3);
    expect(new Set(out.map((s) => s.localDate)).size).toBe(out.length);
  });

  it('keeps local time-of-day, so ts and localDate stay consistent', () => {
    const out = applyDeferral(schedule, '2026-06-01', 1);
    for (const s of out) {
      const d = new Date(s.ts);
      expect(d.getHours()).toBe(6);
      expect(d.getMinutes()).toBe(30);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      expect(iso).toBe(s.localDate);
    }
  });

  it('a zero-day deferral changes nothing', () => {
    expect(applyDeferral(schedule, '2026-06-01', 0)).toEqual(schedule);
  });

  it('preserves local time across a spring-forward shift', () => {
    const s = [
      session({ id: 'x', localDate: '2026-03-07', ts: new Date(2026, 2, 7, 6, 30).getTime() }),
    ];
    const out = applyDeferral(s, '2026-03-07', 2); // crosses Mar 8
    expect(out[0]?.localDate).toBe('2026-03-09');
    expect(new Date(out[0]?.ts ?? 0).getHours()).toBe(6); // still 06:30 local
  });
});

describe('21 — deferral across a month boundary', () => {
  it('rolls into the next month correctly', () => {
    const s = [
      session({ id: 'a', localDate: '2026-06-29', ts: new Date(2026, 5, 29, 7).getTime() }),
      session({ id: 'b', localDate: '2026-06-30', ts: new Date(2026, 5, 30, 7).getTime() }),
    ];
    const out = applyDeferral(s, '2026-06-29', 3);
    expect(out.map((x) => x.localDate)).toEqual(['2026-07-02', '2026-07-03']);
  });

  it('rolls across a year boundary', () => {
    const s = [
      session({ id: 'a', localDate: '2026-12-30', ts: new Date(2026, 11, 30, 7).getTime() }),
    ];
    expect(applyDeferral(s, '2026-12-30', 3)[0]?.localDate).toBe('2027-01-02');
  });

  it('handles February in a leap year', () => {
    const s = [
      session({ id: 'a', localDate: '2028-02-28', ts: new Date(2028, 1, 28, 7).getTime() }),
    ];
    expect(applyDeferral(s, '2028-02-28', 1)[0]?.localDate).toBe('2028-02-29');
  });
});

/* ---------- 22 ---------- */

describe('22 — layoff and re-entry', () => {
  it('5 consecutive rest days requires re-entry at 85%', () => {
    // Last training day 2026-06-10; now 2026-06-15 -> 06-11..06-15 = 5 rest days.
    const h = [session({ id: 'a', localDate: '2026-06-10', position: 'TD2', status: 'done' })];
    const state = layoffState(h, NOW);
    expect(state.consecutiveRestDays).toBe(5);
    expect(state.requiresReentry).toBe(true);
    expect(state.loadMultiplier).toBe(0.85);
  });

  it('4 rest days is under the threshold', () => {
    const h = [session({ id: 'a', localDate: '2026-06-11', position: 'TD2', status: 'done' })];
    const state = layoffState(h, NOW);
    expect(state.consecutiveRestDays).toBe(4);
    expect(state.requiresReentry).toBe(false);
    expect(state.loadMultiplier).toBe(1);
  });

  it('training today means zero rest days', () => {
    const h = [session({ id: 'a', localDate: '2026-06-15', position: 'TD1', status: 'done' })];
    expect(layoffState(h, NOW).consecutiveRestDays).toBe(0);
  });

  it('a logged Recovery Day is rest, not training, and is not double-counted', () => {
    const h = [
      session({ id: 'a', localDate: '2026-06-13', position: 'TD2', status: 'done' }),
      session({ id: 'r', localDate: '2026-06-14', position: 'RD', status: 'done' }),
    ];
    // 06-14 and 06-15 are rest -> exactly 2, not 3.
    expect(layoffState(h, NOW).consecutiveRestDays).toBe(2);
  });

  it('incomplete sessions do not break a layoff streak', () => {
    const h = [
      session({ id: 'a', localDate: '2026-06-10', position: 'TD2', status: 'done' }),
      session({ id: 'p', localDate: '2026-06-14', position: 'TD1', status: 'planned' }),
    ];
    expect(layoffState(h, NOW).requiresReentry).toBe(true);
  });

  it('an empty history is a layoff, and terminates rather than spinning', () => {
    const state = layoffState([], NOW);
    expect(state.requiresReentry).toBe(true);
    expect(state.consecutiveRestDays).toBeGreaterThan(4);
    expect(Number.isFinite(state.consecutiveRestDays)).toBe(true);
  });
});

describe('daysSinceLastTrainingDay', () => {
  it('returns null when nothing has been trained', () => {
    expect(daysSinceLastTrainingDay([], NOW)).toBeNull();
  });
  it('counts calendar days from the most recent training day', () => {
    const h = [session({ id: 'a', localDate: '2026-06-12', position: 'TD2', status: 'done' })];
    expect(daysSinceLastTrainingDay(h, NOW)).toBe(3);
  });
});
