import type { TimerView } from '../hooks/useTimer';

interface RestTimerBarProps {
  timer: TimerView;
  purpose: string;
  color: string;
}

/** Fixed above the tab bar, clearing the home indicator. */
export function RestTimerBar({ timer, purpose, color }: RestTimerBarProps) {
  if (!timer.active) return null;

  return (
    <div
      class="rest-bar"
      data-testid="rest-bar"
      data-complete={timer.complete ? 'true' : undefined}
    >
      <div
        class="rest-bar__progress"
        style={{ width: `${(1 - timer.fraction) * 100}%`, background: color }}
      />

      <div class="rest-bar__body">
        <span class="rest-bar__count num" data-testid="rest-remaining">
          {timer.complete ? 'REST COMPLETE' : timer.label}
        </span>
        <span class="rest-bar__purpose">{purpose}</span>
      </div>

      <div class="rest-bar__controls">
        <button type="button" class="rest-bar__btn" onClick={() => timer.adjust(-30)}>
          −30s
        </button>
        <button type="button" class="rest-bar__btn" onClick={() => timer.adjust(30)}>
          +30s
        </button>
        <button
          type="button"
          class="rest-bar__btn"
          data-testid="rest-skip"
          onClick={timer.complete ? timer.dismiss : timer.skip}
        >
          {timer.complete ? 'DISMISS' : 'SKIP'}
        </button>
      </div>
    </div>
  );
}
