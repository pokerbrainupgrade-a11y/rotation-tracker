import { Sheet } from '../../components/Sheet';
import { groupWarnings, rationaleFor } from '../../lib/warningCopy';
import type { Warning } from '../../engine/constraints';

interface WarningReviewProps {
  warnings: Warning[];
  busy: boolean;
  onCancel: () => void;
  onProceed: () => void;
}

/**
 * Warnings are SOFT. Always.
 *
 * There are exactly two ways out of this sheet: proceed, or cancel. No third
 * option, no auto-correction, no path that refuses the save. The athlete
 * decides; this exists to make that decision informed, which is why each
 * warning carries its rationale rather than just its verdict.
 */
export function WarningReview({ warnings, busy, onCancel, onProceed }: WarningReviewProps) {
  const grouped = groupWarnings(warnings);

  return (
    <Sheet title="Ordering constraint" onClose={onCancel} testId="warning-review">
      <div class="review">
        {grouped.map(({ warning, count }) => {
          const accent = warning.severity === 'alert' ? 'var(--alert)' : 'var(--strength)';
          const rationale = rationaleFor(warning.id);
          return (
            <div
              key={warning.id}
              class="review__item"
              data-warning-id={warning.id}
              data-severity={warning.severity}
              style={{ borderLeftColor: accent }}
            >
              <p class="review__message">
                {warning.message}
                {count > 1 && <span class="review__count num"> ×{count}</span>}
              </p>
              {rationale && <p class="review__rationale">{rationale}</p>}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        class="btn btn--primary sheet__confirm"
        data-testid="schedule-anyway"
        disabled={busy}
        onClick={onProceed}
      >
        {busy ? 'SAVING…' : 'SCHEDULE ANYWAY'}
      </button>
      <button type="button" class="btn btn--secondary sheet__cancel" onClick={onCancel}>
        CANCEL
      </button>
    </Sheet>
  );
}
