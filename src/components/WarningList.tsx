import { WarningItem } from './WarningItem';
import { groupWarnings } from '../lib/warningCopy';
import type { Warning } from '../engine/constraints';

interface WarningListProps {
  warnings: Warning[];
  onDismiss: (id: string) => void;
}

/**
 * Renders NOTHING when empty. No empty state, no "all clear" banner —
 * silence is the resting state, and a permanent green tick trains you to stop
 * looking at the one place that should catch your eye.
 */
export function WarningList({ warnings, onDismiss }: WarningListProps) {
  if (warnings.length === 0) return null;

  // Collapse repeats of the same id: the engine emits one per occurrence, but
  // the message carries no date, so three identical rows say nothing the first
  // one didn't. Dismissal was already per-id, so they always cleared together.
  const grouped = groupWarnings(warnings);

  return (
    <section class="section" data-testid="warning-list">
      <div class="section__head">
        <h2 class="section__title">Active Warnings</h2>
      </div>
      <div class="warnings">
        {grouped.map(({ warning, count }) => (
          <WarningItem
            key={warning.id}
            warning={warning}
            count={count}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </section>
  );
}
