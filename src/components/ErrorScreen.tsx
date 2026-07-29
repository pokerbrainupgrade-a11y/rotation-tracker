

interface ErrorScreenProps {
  code: string;
  message: string;
  onExport?: () => void;
  exportBusy?: boolean;
}

/**
 * Blocking failure state for a database that will not open.
 *
 * Deliberately blocking. This app holds training data that cannot be
 * recreated; degrading to a half-working dashboard would invite logging on top
 * of storage that is not working, which is how you lose the lot.
 */
export function ErrorScreen({ code, message, onExport, exportBusy = false }: ErrorScreenProps) {
  return (
    <main class="screen error-screen" data-testid="error-screen" role="alert">
      <h1 class="error-screen__title">STORAGE UNAVAILABLE</h1>
      <p class="error-screen__body">{message}</p>
      <p class="error-screen__code num">{code}</p>
      {onExport && (
        <button
          type="button"
          class="btn btn--secondary"
          onClick={onExport}
          disabled={exportBusy}
        >
          {exportBusy ? 'EXPORTING…' : 'TRY EXPORT'}
        </button>
      )}
      <p class="error-screen__hint">
        Close other tabs running this app, then relaunch. If this persists,
        free device storage before logging anything further.
      </p>
    </main>
  );
}
