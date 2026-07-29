import { WarningItem } from './WarningItem';
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

  return (
    <section class="section" data-testid="warning-list">
      <div class="section__head">
        <h2 class="section__title">Active Warnings</h2>
      </div>
      <div class="warnings">
        {warnings.map((w, i) => (
          <WarningItem key={`${w.id}-${w.relatedDate ?? i}`} warning={w} onDismiss={onDismiss} />
        ))}
      </div>
    </section>
  );
}
