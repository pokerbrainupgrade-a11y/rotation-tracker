import { daysBetweenLocal } from '../data/dates';
import { toLocalDate } from '../data/dates';
import type { LedgerKey, RotationPosition, ScheduledSession, SessionTemplate } from '../types';
import type { LedgerRow } from './ledger';

/**
 * Ordering-constraint warnings.
 *
 * This module RETURNS AN ARRAY. Always. Never a boolean, never a throw, never a
 * gate. The athlete makes the call; this exists to make the call informed.
 */

export interface Warning {
  id: string;
  severity: 'warn' | 'alert';
  message: string;
  relatedDate?: string;
  dismissible: boolean;
}

export interface ConstraintsInput {
  schedule: ScheduledSession[];
  ledger: LedgerRow[];
  templates: SessionTemplate[];
  now: Date;
}

/** Neural load by position. Drives the CNS-descent check. */
export const NEURAL_LOAD: Record<RotationPosition, number> = {
  TD1: 9,
  'TD-A': 9,
  TD2: 7,
  'TD-B-STR': 7,
  TD3: 4,
  'TD-B-ESD': 4,
  RD: 1,
};

const MAX_INTENT_POSITIONS: RotationPosition[] = ['TD1', 'TD-A'];
const ESD_POSITIONS: RotationPosition[] = ['TD3', 'TD-B-ESD'];

const QUALITY_LABEL: Record<LedgerKey, string> = {
  velocityFull: 'Velocity (full)',
  velocityPrime: 'Velocity (prime)',
  vo2max: 'VO2max',
  zone2Min: 'Zone 2 minutes',
  trainingDays: 'Training days',
};

export const GAP_WARNING_DAYS = 4;

export function evaluateConstraints(input: ConstraintsInput): Warning[] {
  // Defensive by contract: malformed input must degrade to an empty array, not
  // an exception. A warnings panel that throws takes the whole dashboard down.
  try {
    return evaluate(input);
  } catch {
    return [];
  }
}

function evaluate(input: ConstraintsInput): Warning[] {
  const schedule = Array.isArray(input?.schedule) ? input.schedule : [];
  const ledger = Array.isArray(input?.ledger) ? input.ledger : [];
  const templates = Array.isArray(input?.templates) ? input.templates : [];

  const warnings: Warning[] = [];
  const ordered = [...schedule]
    .filter((s) => s && typeof s.localDate === 'string')
    .sort((a, b) =>
      a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : a.ts - b.ts,
    );

  const vo2Capable = new Set(
    templates.filter((t) => t?.ledger?.vo2max != null).map((t) => t.id),
  );

  for (let i = 0; i < ordered.length; i++) {
    const curr = ordered[i];
    const prev = ordered[i - 1];
    if (!curr) continue;

    // TD1_NOT_OFF_RD — max intent behind fatigue produces fatigue.
    // Only fires when there IS a preceding session: the first session in a
    // history cannot violate an ordering rule.
    if (MAX_INTENT_POSITIONS.includes(curr.position) && prev && prev.position !== 'RD') {
      warnings.push({
        id: 'TD1_NOT_OFF_RD',
        severity: 'alert',
        message:
          'TD1 must follow a Recovery Day. Max-intent velocity behind fatigue ' +
          'produces fatigue, not adaptation.',
        relatedDate: curr.localDate,
        dismissible: true,
      });
    }

    // ESD_AFTER_RD — conditioning eating the one fresh slot.
    if (ESD_POSITIONS.includes(curr.position) && prev && prev.position === 'RD') {
      warnings.push({
        id: 'ESD_AFTER_RD',
        severity: 'warn',
        message: 'Conditioning is consuming the only fresh slot in the rotation.',
        relatedDate: curr.localDate,
        dismissible: true,
      });
    }

    // CNS_ASCENT — load must descend across a work stretch. An RD resets it,
    // so a rise immediately after recovery is expected, not a violation.
    if (prev && prev.position !== 'RD' && curr.position !== 'RD') {
      const prevLoad = NEURAL_LOAD[prev.position] ?? 0;
      const currLoad = NEURAL_LOAD[curr.position] ?? 0;
      if (currLoad > prevLoad) {
        warnings.push({
          id: 'CNS_ASCENT',
          severity: 'warn',
          message: 'CNS load must descend across the work stretch.',
          relatedDate: curr.localDate,
          dismissible: true,
        });
      }
    }
  }

  // DOUBLE_MAXINTENT — two max-intent sessions inside 48h, i.e. same day or
  // adjacent days. Measured on localDate, not `ts`: `ts` is ordering only.
  const maxIntent = ordered.filter((s) => MAX_INTENT_POSITIONS.includes(s.position));
  for (let i = 1; i < maxIntent.length; i++) {
    const a = maxIntent[i - 1];
    const b = maxIntent[i];
    if (!a || !b) continue;
    if (daysBetweenLocal(a.localDate, b.localDate) <= 1) {
      warnings.push({
        id: 'DOUBLE_MAXINTENT',
        severity: 'alert',
        message: 'Two max-intent sessions inside 48h. One fresh slot per work stretch.',
        relatedDate: b.localDate,
        dismissible: true,
      });
    }
  }

  // VO2_ADJACENT — two VO2max sessions on consecutive TRAINING days, so an
  // intervening Recovery Day does not separate them.
  const trainingDays = ordered.filter((s) => s.position !== 'RD');
  for (let i = 1; i < trainingDays.length; i++) {
    const a = trainingDays[i - 1];
    const b = trainingDays[i];
    if (!a || !b) continue;
    if (vo2Capable.has(a.templateId) && vo2Capable.has(b.templateId)) {
      warnings.push({
        id: 'VO2_ADJACENT',
        severity: 'warn',
        message: 'VO2max sessions not adjacent.',
        relatedDate: b.localDate,
        dismissible: true,
      });
    }
  }

  // GAP_4D — four or more consecutive calendar days with no training day,
  // including the open gap running up to today.
  const trainingDates = [
    ...new Set(
      ordered
        .filter((s) => s.status === 'done' && s.position !== 'RD')
        .map((s) => s.localDate),
    ),
  ].sort();

  for (let i = 1; i < trainingDates.length; i++) {
    const a = trainingDates[i - 1];
    const b = trainingDates[i];
    if (!a || !b) continue;
    if (daysBetweenLocal(a, b) - 1 >= GAP_WARNING_DAYS) {
      warnings.push({
        id: 'GAP_4D',
        severity: 'warn',
        message: '4 days without a training day. Rotation has drifted.',
        relatedDate: b,
        dismissible: true,
      });
    }
  }

  const lastTraining = trainingDates[trainingDates.length - 1];
  if (lastTraining && input.now instanceof Date) {
    const openGap = daysBetweenLocal(lastTraining, toLocalDate(input.now));
    if (openGap >= GAP_WARNING_DAYS) {
      warnings.push({
        id: 'GAP_4D',
        severity: 'warn',
        message: '4 days without a training day. Rotation has drifted.',
        relatedDate: toLocalDate(input.now),
        dismissible: true,
      });
    }
  }

  // LEDGER_FLOOR — NOT dismissible. It clears only when the count recovers.
  for (const row of ledger) {
    if (!row?.belowFloor) continue;
    warnings.push({
      id: 'LEDGER_FLOOR',
      severity: 'alert',
      message: `${QUALITY_LABEL[row.key] ?? row.key} below 28-day floor: ${row.count} of ${row.floor}.`,
      dismissible: false,
    });
  }

  return warnings;
}
