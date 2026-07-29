import { isWithinLast } from '../data/dates';
import type {
  Block,
  CountableQuality,
  EsdLog,
  Exercise,
  LedgerKey,
  ScheduledSession,
  SessionTemplate,
  SetLog,
} from '../types';

/**
 * The 28-day rolling ledger. Pure — the clock is injected.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE: a session counts for a quality only
 * if what was actually LOGGED earned it. A TD1 whose throw block was cut is
 * not a TD1 and does not count. Counting sessions by template would over-count,
 * and over-counting makes frequency drift invisible — which defeats the entire
 * purpose of a ledger.
 */

export const LEDGER_WINDOW_DAYS = 28;

export interface LedgerRow {
  key: LedgerKey;
  count: number;
  missed: number; // vo2max only; 0 elsewhere
  floor: number;
  ceiling: number | null;
  belowFloor: boolean;
}

export interface LedgerInput {
  scheduled: ScheduledSession[];
  setLogs: SetLog[];
  esdLogs: EsdLog[];
  templates: SessionTemplate[];
  exercises: Exercise[];
  block: Block;
  now: Date;
}

/** Row order is stable so the dashboard does not reshuffle between renders. */
const ROW_ORDER: LedgerKey[] = [
  'velocityFull',
  'velocityPrime',
  'vo2max',
  'zone2Min',
  'trainingDays',
];

export function computeLedger(input: LedgerInput): LedgerRow[] {
  const { scheduled, setLogs, esdLogs, templates, exercises, block, now } = input;

  const templateById = new Map(templates.map((t) => [t.id, t]));
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  // WINDOW: 28 local calendar days inclusive of today, compared on localDate
  // strings only. Never derive a day boundary from `ts`.
  const inWindow = scheduled.filter((s) =>
    isWithinLast(LEDGER_WINDOW_DAYS, s.localDate, now),
  );
  const windowSessionIds = new Set(inWindow.map((s) => s.id));

  // Logs are windowed by their PARENT SESSION's localDate — logs carry only a
  // `ts`, and deriving a calendar day from an epoch is the bug this design
  // avoids.
  const setsBySession = groupBy(
    setLogs.filter((l) => windowSessionIds.has(l.scheduledId)),
    (l) => l.scheduledId,
  );
  const esdBySession = groupBy(
    esdLogs.filter((l) => windowSessionIds.has(l.scheduledId)),
    (l) => l.scheduledId,
  );

  const countFor = (quality: CountableQuality): number =>
    inWindow.filter((s) =>
      countsFor(s, quality, {
        template: templateById.get(s.templateId),
        exerciseById,
        sets: setsBySession.get(s.id) ?? [],
        esd: esdBySession.get(s.id) ?? [],
      }),
    ).length;

  // vo2max misses: an attempt that did not meet the dosing signature. A miss is
  // not an absence — "attempted 7, 4 qualified" is a different diagnosis from
  // "did 4", and they call for different responses.
  const vo2Missed = inWindow
    .filter((s) => s.status === 'done')
    .flatMap((s) => esdBySession.get(s.id) ?? [])
    .filter((l) => l.type === 'vo2max' && !l.counted).length;

  const zone2Min = inWindow
    .filter((s) => s.status === 'done')
    .flatMap((s) => esdBySession.get(s.id) ?? [])
    .filter((l) => l.type === 'zone2')
    .reduce((sum, l) => sum + (Number.isFinite(l.minutes) ? l.minutes : 0), 0);

  // Two sessions on one date is one training day.
  const trainingDays = new Set(
    inWindow
      .filter((s) => s.status === 'done' && s.position !== 'RD')
      .map((s) => s.localDate),
  ).size;

  const values: Record<LedgerKey, { count: number; missed: number }> = {
    velocityFull: { count: countFor('velocityFull'), missed: 0 },
    velocityPrime: { count: countFor('velocityPrime'), missed: 0 },
    vo2max: { count: countFor('vo2max'), missed: vo2Missed },
    zone2Min: { count: zone2Min, missed: 0 },
    trainingDays: { count: trainingDays, missed: 0 },
  };

  return ROW_ORDER.map((key) => {
    // Floors and ceilings are block program data, never engine constants.
    const bounds = block.floors?.[key] ?? { floor: 0, ceiling: null };
    const { count, missed } = values[key];
    return {
      key,
      count,
      missed,
      floor: bounds.floor,
      ceiling: bounds.ceiling,
      belowFloor: count < bounds.floor,
    };
  });
}

interface CountsContext {
  template: SessionTemplate | undefined;
  exerciseById: Map<string, Exercise>;
  sets: SetLog[];
  esd: EsdLog[];
}

/**
 * countsFor(session, quality) — implemented exactly as specified.
 *
 *   status !== 'done'            -> false
 *   template.ledger[quality] nil -> false
 *   substituted                  -> metDosingSignature === true
 *   else                         -> blockPerformed(session, quality)
 */
export function countsFor(
  session: ScheduledSession,
  quality: CountableQuality,
  ctx: CountsContext,
): boolean {
  if (session.status !== 'done') return false;

  const template = ctx.template;
  if (!template) return false;
  if (template.ledger?.[quality] == null) return false;

  // A substitution is judged on whether it met the dosing signature — the
  // logged movements will not match the template's, so blockPerformed cannot
  // apply.
  if (session.substituted) return session.metDosingSignature === true;

  return blockPerformed(quality, template, ctx);
}

/** Did the defining block actually happen? Reads logs, never the template alone. */
export function blockPerformed(
  quality: CountableQuality,
  template: SessionTemplate,
  ctx: CountsContext,
): boolean {
  switch (quality) {
    case 'velocityFull': {
      const ids = powerSectionExerciseIds(template);
      return ctx.sets.some(
        (l) =>
          l.completed &&
          ids.has(l.exerciseId) &&
          ctx.exerciseById.get(l.exerciseId)?.maxIntent === true,
      );
    }
    case 'velocityPrime': {
      const primes = powerSectionPrimeIds(template);
      return ctx.sets.some((l) => l.completed && primes.has(l.exerciseId));
    }
    case 'vo2max':
      return ctx.esd.some((l) => l.type === 'vo2max' && l.counted);
  }
}

function powerSectionExerciseIds(template: SessionTemplate): Set<string> {
  const out = new Set<string>();
  for (const section of template.sections) {
    if (section.role !== 'power') continue;
    for (const id of section.exerciseIds) out.add(id);
  }
  return out;
}

function powerSectionPrimeIds(template: SessionTemplate): Set<string> {
  const out = new Set<string>();
  for (const section of template.sections) {
    if (section.role !== 'power') continue;
    if (section.primeExerciseId) out.add(section.primeExerciseId);
  }
  return out;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}
