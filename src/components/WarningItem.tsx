import type { Warning } from '../engine/constraints';

interface WarningItemProps {
  warning: Warning;
  /** Occurrences collapsed into this row; 1 renders no badge. */
  count?: number;
  onDismiss: (id: string) => void;
}

/**
 * Severity border: --alert for `alert`, --strength for `warn`. Neither is
 * --brand red — red means "press this", not "look at this".
 */
export function WarningItem({ warning, count = 1, onDismiss }: WarningItemProps) {
  const accent = warning.severity === 'alert' ? 'var(--alert)' : 'var(--strength)';

  return (
    <div
      class="warning"
      data-severity={warning.severity}
      data-warning-id={warning.id}
      style={{ borderLeftColor: accent }}
    >
      <p class="warning__text">
        {warning.message}
        {count > 1 && <span class="warning__count num"> ×{count}</span>}
      </p>
      {warning.dismissible && (
        <button
          type="button"
          class="warning__dismiss"
          aria-label={`Dismiss ${warning.id}`}
          onClick={() => onDismiss(warning.id)}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M3 3l10 10M13 3L3 13"
              stroke="currentColor"
              stroke-width="1.6"
              fill="none"
              stroke-linecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
