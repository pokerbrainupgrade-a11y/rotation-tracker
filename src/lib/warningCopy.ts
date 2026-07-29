import type { Warning } from '../engine/constraints';

/**
 * UI-layer copy for warnings. Deliberately NOT in the engine: the engine
 * decides whether a condition holds, this decides how to explain it.
 *
 * The rationale answers "why does this rule exist", which is what makes an
 * informed override possible. A warning you can't reason about is a warning
 * you learn to dismiss reflexively.
 */
export const WARNING_RATIONALE: Record<string, string> = {
  TD1_NOT_OFF_RD:
    'Max-intent velocity is a quality of a fresh nervous system. Behind ' +
    'fatigue the same session trains fatigue tolerance instead, at the cost ' +
    'of the quality you scheduled it for.',
  DOUBLE_MAXINTENT:
    'A work stretch has one genuinely fresh slot. Spending it twice means ' +
    'the second session is max-intent in name only.',
  ESD_AFTER_RD:
    'The slot after recovery is the most valuable one in the rotation. ' +
    'Conditioning does not need it; velocity and max strength do.',
  VO2_ADJACENT:
    'Consecutive VO2max exposures blunt the second one and lengthen recovery ' +
    'without adding aerobic stimulus.',
  CNS_ASCENT:
    'Neural load should descend across a work stretch. Ascending it means ' +
    'the heaviest demand lands on the most fatigued day.',
  GAP_4D:
    'Four days without training means the rotation is no longer rolling. ' +
    'Frequency, not any single session, is what the 28-day floors measure.',
  LEDGER_FLOOR:
    'This quality has fallen below its 28-day floor. Floors are a frequency ' +
    'contract — recovering one needs exposures scheduled, not a harder session.',
};

export function rationaleFor(id: string): string | null {
  return WARNING_RATIONALE[id] ?? null;
}

export interface GroupedWarning {
  warning: Warning;
  /** How many occurrences collapsed into this row. */
  count: number;
}

/**
 * Collapse repeats of the same warning id.
 *
 * The engine emits one warning per occurrence, which is correct — but the
 * message text carries no date, so three GAP_4D rows render as three identical
 * lines conveying nothing beyond the first. Dismissal is already per-id, so
 * they were always going to clear together. The count is kept so the
 * repetition is not silently discarded.
 */
export function groupWarnings(warnings: Warning[]): GroupedWarning[] {
  const out = new Map<string, GroupedWarning>();
  for (const warning of warnings) {
    const existing = out.get(warning.id);
    if (existing) {
      existing.count += 1;
      // Keep the most recent occurrence as the representative.
      if ((warning.relatedDate ?? '') > (existing.warning.relatedDate ?? '')) {
        existing.warning = warning;
      }
    } else {
      out.set(warning.id, { warning, count: 1 });
    }
  }
  return [...out.values()];
}
