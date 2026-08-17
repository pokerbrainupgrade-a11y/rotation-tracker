import { useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { exportStatus } from '../lib/exportStatus';
import type { Profile } from '../types';

interface UpdatePromptProps {
  profile: Profile | null;
  onCancel: () => void;
  onApply: () => Promise<void>;
}

/**
 * Export before updating — a PROMPT, not a gate.
 *
 * An update runs migrations, and a migration is the one moment where a bug can
 * touch every record you own. Exporting first costs a few seconds and makes
 * that reversible. Declining is allowed, because blocking an update is its own
 * way of ending up on an old build forever.
 */
export function UpdatePrompt({ profile, onCancel, onApply }: UpdatePromptProps) {
  const [busy, setBusy] = useState<'export' | 'plain' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const info = profile
    ? exportStatus(profile.lastExport, profile.storagePersisted, new Date())
    : null;

  const exportThenUpdate = (): void => {
    setBusy('export');
    setError(null);
    void (async () => {
      try {
        const { downloadBackup } = await import('../data/backup');
        await downloadBackup();
        await onApply();
      } catch (err) {
        // A failed or cancelled export must not silently apply the update —
        // the whole point was to have the backup first.
        setError(err instanceof Error ? err.message : String(err));
        setBusy(null);
      }
    })();
  };

  return (
    <Sheet title="Update available" onClose={onCancel} testId="update-prompt">
      <p class="update__body">Export your data before updating?</p>
      <p class="update__last num" data-testid="update-last-export">
        {info ? info.label : 'LAST EXPORT · UNKNOWN'}
      </p>

      {error && (
        <p class="failure__result" data-testid="update-export-error">
          Export failed: {error}. The update has not been applied.
        </p>
      )}

      <button
        type="button"
        class="btn btn--primary sheet__confirm"
        data-testid="export-and-update"
        disabled={busy !== null}
        onClick={exportThenUpdate}
      >
        {busy === 'export' ? 'EXPORTING…' : 'EXPORT AND UPDATE'}
      </button>

      <button
        type="button"
        class="btn btn--secondary sheet__cancel"
        data-testid="update-without-export"
        disabled={busy !== null}
        onClick={() => {
          setBusy('plain');
          void onApply().finally(() => setBusy(null));
        }}
      >
        {busy === 'plain' ? 'UPDATING…' : 'Update without exporting'}
      </button>

      <button
        type="button"
        class="btn btn--ghost sheet__cancel"
        data-testid="update-cancel"
        onClick={onCancel}
      >
        Cancel
      </button>
    </Sheet>
  );
}
