import { useEffect, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet';
import { cascadeCounts } from '../../data/repo';
import type { ScheduledSession } from '../../types';

interface DeleteSheetProps {
  session: ScheduledSession;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * Names exactly what will be destroyed, with counts read from the database
 * rather than estimated. An approximate confirmation is theatre.
 *
 * Cancel is the primary button; Delete is destructive-styled. The safe path
 * should be the easy one.
 */
export function DeleteSheet({ session, onClose, onConfirm }: DeleteSheetProps) {
  const [counts, setCounts] = useState<{ setLogs: number; esdLogs: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void cascadeCounts(session.id).then((c) => {
      if (!cancelled) setCounts(c);
    });
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  const parts: string[] = [];
  if (counts) {
    if (counts.setLogs > 0) {
      parts.push(`${counts.setLogs} logged set${counts.setLogs === 1 ? '' : 's'}`);
    }
    if (counts.esdLogs > 0) {
      parts.push(`${counts.esdLogs} ESD entr${counts.esdLogs === 1 ? 'y' : 'ies'}`);
    }
  }

  return (
    <Sheet title="Delete session" onClose={onClose} testId="delete-sheet">
      <p class="delete__body" data-testid="delete-summary">
        {counts === null
          ? 'Checking what this would remove…'
          : parts.length === 0
            ? 'This session has no logged data. Deleting it removes the session only.'
            : `This will delete ${parts.join(' and ')}. This cannot be undone.`}
      </p>

      <button type="button" class="btn btn--primary sheet__confirm" onClick={onClose}>
        CANCEL
      </button>
      <button
        type="button"
        class="btn btn--destructive sheet__cancel"
        data-testid="delete-confirm"
        disabled={busy || counts === null}
        onClick={() => {
          setBusy(true);
          void onConfirm().finally(() => setBusy(false));
        }}
      >
        {busy ? 'DELETING…' : 'DELETE'}
      </button>
    </Sheet>
  );
}
