import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet';
import { classifyResume } from '../../engine/timer';
import { longDate } from '../../lib/calendarGrid';
import type { ScheduledSession } from '../../types';

interface ResumeSheetProps {
  session: ScheduledSession;
  setCount: number;
  now: number;
  onResume: () => void;
  onMarkComplete: () => Promise<void>;
  onDiscard: () => Promise<void>;
}

/**
 * Offered on launch when a session was started but never finished.
 *
 * Under 12h it is almost certainly the session you are still in. At 12h or more
 * MARK COMPLETE appears, which keeps whatever was logged and lets the ledger
 * judge it — a half-finished TD1 correctly failing to count as a TD1 is the
 * intended outcome, not a bug to paper over.
 */
export function ResumeSheet({
  session, setCount, now, onResume, onMarkComplete, onDiscard,
}: ResumeSheetProps) {
  const age = classifyResume(session.startedAt ?? now, now);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);

  const sets = `${setCount} set${setCount === 1 ? '' : 's'} logged`;

  if (confirmDiscard) {
    return (
      <Sheet title="Discard session" onClose={() => setConfirmDiscard(false)} testId="discard-confirm">
        <p class="delete__body" data-testid="discard-summary">
          {setCount === 0
            ? 'This session has nothing logged. Discarding returns it to planned.'
            : `This will delete ${sets.replace(' logged', '')}. This cannot be undone.`}
        </p>
        <button type="button" class="btn btn--primary sheet__confirm" onClick={() => setConfirmDiscard(false)}>
          CANCEL
        </button>
        <button
          type="button"
          class="btn btn--destructive sheet__cancel"
          data-testid="discard-confirm-btn"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onDiscard().finally(() => setBusy(false));
          }}
        >
          {busy ? 'DISCARDING…' : 'DISCARD'}
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={age === 'fresh' ? 'Session in progress' : 'Unfinished session'}
      onClose={onResume}
      testId="resume-sheet"
    >
      <p class="delete__body" data-testid="resume-summary">
        {age === 'fresh'
          ? `${session.position} — ${sets}.`
          : `From ${longDate(session.localDate)} — ${sets}.`}
      </p>

      <button
        type="button"
        class="btn btn--primary sheet__confirm"
        data-testid="resume-btn"
        onClick={onResume}
      >
        RESUME
      </button>

      {age === 'stale' && (
        <button
          type="button"
          class="btn btn--secondary sheet__cancel"
          data-testid="mark-complete-btn"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onMarkComplete().finally(() => setBusy(false));
          }}
        >
          MARK COMPLETE
        </button>
      )}

      <button
        type="button"
        class="btn btn--destructive sheet__cancel"
        data-testid="discard-btn"
        onClick={() => setConfirmDiscard(true)}
      >
        DISCARD
      </button>
    </Sheet>
  );
}
