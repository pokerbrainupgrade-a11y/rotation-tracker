import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from '../components/Sheet';
import { getProfile } from '../data/repo';
import { describePersistence, getStorageStatus, type StorageStatus } from '../data/persistence';
import { SCHEMA_VERSION, SEED_VERSION, type Profile } from '../types';
import type { ImportPlan } from '../data/backup';

interface SettingsProps {
  onOpenMaxes: () => void;
}

export function Settings({ onOpenMaxes }: SettingsProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([getProfile(), getStorageStatus()]);
    setProfile(p ?? null);
    setStorage(s);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const doExport = useCallback(() => {
    setBusy('export');
    setMessage(null);
    void (async () => {
      try {
        const { downloadBackup } = await import('../data/backup');
        await downloadBackup();
        setMessage({ tone: 'ok', text: 'Export complete.' });
        await load();
      } catch (err) {
        setMessage({
          tone: 'bad',
          text: `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        setBusy(null);
      }
    })();
  }, [load]);

  const onFile = useCallback((file: File) => {
    setBusy('import');
    setMessage(null);
    void (async () => {
      try {
        const { prepareImport } = await import('../data/backup');
        // Preview first: the confirmation has to name what would be destroyed.
        setPlan(await prepareImport(file));
      } catch (err) {
        setMessage({
          tone: 'bad',
          text: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(null);
      }
    })();
  }, []);

  const commit = useCallback(() => {
    if (!plan) return;
    setBusy('commit');
    void (async () => {
      try {
        const { commitImport } = await import('../data/backup');
        await commitImport(plan);
        setMessage({ tone: 'ok', text: 'Import complete. Your history is restored.' });
        setPlan(null);
        await load();
      } catch (err) {
        // commitImport already names the store and record, and states that
        // nothing changed.
        setMessage({
          tone: 'bad',
          text: err instanceof Error ? err.message : String(err),
        });
        setPlan(null);
      } finally {
        setBusy(null);
      }
    })();
  }, [plan, load]);

  const totalIncoming = plan
    ? Object.values(plan.incoming).reduce((a, b) => a + b, 0)
    : 0;
  const totalDestroys = plan
    ? Object.values(plan.destroys).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <main class="screen settings" data-testid="settings">
      <h1 class="screen__title">Settings</h1>

      <section class="settings__group">
        <h2 class="settings__heading">DATA</h2>

        <button
          type="button"
          class="btn btn--secondary settings__row"
          data-testid="export-all"
          disabled={busy !== null}
          onClick={doExport}
        >
          {busy === 'export' ? 'EXPORTING…' : 'EXPORT ALL (JSON)'}
        </button>

        <button
          type="button"
          class="btn btn--secondary settings__row"
          data-testid="import-backup"
          disabled={busy !== null}
          onClick={() => fileInput.current?.click()}
        >
          IMPORT BACKUP
        </button>

        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          class="settings__file"
          data-testid="import-file"
          onChange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) onFile(file);
          }}
        />

        <p class="settings__meta num" data-testid="last-export">
          LAST EXPORT · {profile?.lastExport
            ? new Date(profile.lastExport).toLocaleDateString()
            : 'NEVER'}
        </p>

        {message && (
          <p
            class="settings__message"
            data-testid="settings-message"
            data-tone={message.tone}
            style={message.tone === 'bad' ? { color: 'var(--alert)' } : undefined}
          >
            {message.text}
          </p>
        )}
      </section>

      <section class="settings__group">
        <h2 class="settings__heading">STORAGE</h2>
        {/* Honest by design: best-effort is never dressed up as safe. */}
        <p class="settings__meta" data-testid="storage-status">
          {storage ? describePersistence(storage) : 'Checking…'}
        </p>
        {storage?.usageBytes !== null && storage?.usageBytes !== undefined && (
          <p class="settings__meta num">
            {(storage.usageBytes / 1024 / 1024).toFixed(1)} MB used
          </p>
        )}
      </section>

      <section class="settings__group">
        <h2 class="settings__heading">PROGRAM</h2>
        <button
          type="button"
          class="btn btn--secondary settings__row"
          data-testid="open-maxes"
          onClick={onOpenMaxes}
        >
          MAXES
        </button>
      </section>

      <section class="settings__group">
        <h2 class="settings__heading">VERSION</h2>
        <p class="settings__meta num" data-testid="schema-version">
          SCHEMA v{SCHEMA_VERSION} · SEED v{SEED_VERSION}
        </p>
        {profile && profile.schemaVersion !== SCHEMA_VERSION && (
          <p class="settings__meta num" data-testid="schema-pending">
            Data written at v{profile.schemaVersion} — migrating on next write.
          </p>
        )}
      </section>

      {plan && (
        <Sheet
          title="Full replace — destructive"
          onClose={() => setPlan(null)}
          testId="import-confirm"
        >
          <p class="delete__body" data-testid="import-summary">
            <span class="num">{totalDestroys}</span> records will be destroyed and
            replaced by <span class="num">{totalIncoming}</span> from the imported
            file. This cannot be undone.
          </p>
          {plan.migrated && (
            <p class="failure__note">
              This backup was written by an older version and will be migrated on
              import.
            </p>
          )}
          <button
            type="button"
            class="btn btn--primary sheet__confirm"
            onClick={() => setPlan(null)}
          >
            CANCEL
          </button>
          <button
            type="button"
            class="btn btn--destructive sheet__cancel"
            data-testid="import-confirm-btn"
            disabled={busy !== null}
            onClick={commit}
          >
            {busy === 'commit' ? 'REPLACING…' : 'REPLACE ALL DATA'}
          </button>
        </Sheet>
      )}
    </main>
  );
}
