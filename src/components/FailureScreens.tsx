import { useState } from 'preact/hooks';

/**
 * Designed failure states.
 *
 * Every one names a cause and offers an action. Nothing here throws to the
 * user, and nothing degrades silently — a blank screen with a console error is
 * indistinguishable from a bricked app when you are standing in a gym.
 */

/* ---------------- version skew ---------------- */

interface SkewScreenProps {
  dataVersion: number;
  appVersion: number;
}

export function SkewScreen({ dataVersion, appVersion }: SkewScreenProps) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const exportData = (): void => {
    setBusy(true);
    setResult(null);
    void (async () => {
      try {
        // Export reads the stores directly and writes nothing back except
        // lastExport, so it is safe even against newer data.
        const { downloadBackup } = await import('../data/backup');
        await downloadBackup();
        setResult('Export complete. Keep that file safe before updating.');
      } catch (err) {
        setResult(
          `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <main class="screen failure" data-testid="skew-screen" role="alert">
      <h1 class="failure__title">APP VERSION IS OLDER THAN YOUR DATA</h1>

      <p class="failure__body">
        Your data was written by a newer version of this app (schema v
        <span class="num">{dataVersion}</span>). This build understands v
        <span class="num">{appVersion}</span>.
      </p>

      <p class="failure__warn">
        Do not continue — writing to newer data can corrupt it.
      </p>

      {/* The one action that is always safe against unknown data. */}
      <button
        type="button"
        class="btn btn--primary failure__action"
        data-testid="skew-export"
        disabled={busy}
        onClick={exportData}
      >
        {busy ? 'EXPORTING…' : 'EXPORT MY DATA'}
      </button>

      {result && (
        <p class="failure__result" data-testid="skew-export-result">{result}</p>
      )}

      <button
        type="button"
        class="failure__link"
        data-testid="skew-help"
        onClick={() => setShowHelp((v) => !v)}
      >
        How to update
      </button>

      {showHelp && (
        <ol class="failure__steps" data-testid="skew-help-body">
          <li>Export your data above, if you have not already.</li>
          <li>
            Close every tab and window running this app, including the home
            screen icon in the app switcher.
          </li>
          <li>Reopen it. The newer version should load from the network.</li>
          <li>
            If it still loads this old build, you are offline — reconnect and
            try again.
          </li>
        </ol>
      )}
    </main>
  );
}

/* ---------------- storage unavailable ---------------- */

interface StorageUnavailableProps {
  code: string;
  message: string;
  onRetry: () => void;
}

export function StorageUnavailableScreen({
  code, message, onRetry,
}: StorageUnavailableProps) {
  return (
    <main class="screen failure" data-testid="storage-unavailable" role="alert">
      <h1 class="failure__title">STORAGE UNAVAILABLE</h1>
      <p class="failure__body">{message}</p>
      <p class="failure__code num">{code}</p>

      <ol class="failure__steps">
        <li>
          If you are in Private Browsing, leave it — IndexedDB is blocked there,
          and this app has nowhere else to put your training data.
        </li>
        <li>Close other tabs running this app, then retry.</li>
        <li>If the device is out of space, free some and retry.</li>
      </ol>

      <button
        type="button"
        class="btn btn--primary failure__action"
        data-testid="storage-retry"
        onClick={onRetry}
      >
        RETRY
      </button>

      {/*
        No export button here, deliberately. Export reads from the database
        that just failed to open, so the control would be dead. Saying so beats
        offering a button that does nothing.
      */}
      <p class="failure__note" data-testid="export-unavailable">
        Export is unavailable while storage cannot be opened — it reads from the
        same database.
      </p>
    </main>
  );
}

/* ---------------- storage evicted ---------------- */

export function EvictedScreen({ onImport }: { onImport: () => void }) {
  return (
    <main class="screen failure" data-testid="evicted-screen" role="alert">
      <h1 class="failure__title">YOUR DATA WAS REMOVED</h1>
      <p class="failure__body">
        This device previously held a Rotation Tracker profile, and it is gone.
        iOS reclaims storage from web apps it considers unused — usually after a
        few weeks without opening them.
      </p>
      <p class="failure__warn">
        This is not recoverable from the device. It is recoverable from a backup.
      </p>

      <button
        type="button"
        class="btn btn--primary failure__action"
        data-testid="evicted-import"
        onClick={onImport}
      >
        IMPORT BACKUP
      </button>

      <ol class="failure__steps">
        <li>Open Files, and look in iCloud Drive or On My iPhone → Downloads.</li>
        <li>
          Find the newest <span class="num">rotation-tracker-YYYY-MM-DD.json</span>.
        </li>
        <li>Import it above.</li>
        <li>
          Then go to Settings and confirm storage reads Persistent, so this is
          less likely to happen again.
        </li>
      </ol>
    </main>
  );
}

/* ---------------- seed validation ---------------- */

export function SeedInvalidScreen({ problems }: { problems: string[] }) {
  return (
    <main class="screen failure" data-testid="seed-invalid" role="alert">
      <h1 class="failure__title">PROGRAM DEFINITION IS INVALID</h1>
      <p class="failure__body">
        The program shipped with this build has broken references, so the app
        cannot safely prescribe anything. This is a build defect, not something
        you did — and not something you can fix from the phone.
      </p>
      <ul class="failure__list">
        {problems.slice(0, 8).map((p, i) => (
          <li key={i} class="failure__problem">{p}</li>
        ))}
      </ul>
      <p class="failure__note">
        Roll back to the previous deploy — see “Roll back a bad deploy” in the
        README runbook.
      </p>
    </main>
  );
}

/* ---------------- non-blocking banners ---------------- */

interface BannerProps {
  id: string;
  tone: 'alert' | 'warn';
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}

export function Banner({
  id, tone, message, actionLabel, onAction, onDismiss,
}: BannerProps) {
  return (
    <div class="banner" data-testid={`banner-${id}`} data-tone={tone} role="status">
      <span class="banner__text">{message}</span>
      {actionLabel && onAction && (
        <button type="button" class="banner__action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          class="banner__dismiss"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          ✕
        </button>
      )}
    </div>
  );
}
