import { useEffect, useRef, useState } from 'preact/hooks';

interface UndoChipProps {
  label: string;
  /** Milliseconds the chip stays actionable. */
  ttlMs?: number;
  onUndo: () => void;
  onExpire: () => void;
}

/**
 * Transient undo affordance. Single level — the most recent set only.
 *
 * Expiry is checked against a timestamp rather than trusting one setTimeout, so
 * a backgrounded app cannot leave a stale chip that still acts on a set from
 * ten minutes ago.
 */
export function UndoChip({ label, ttlMs = 8000, onUndo, onExpire }: UndoChipProps) {
  const [expired, setExpired] = useState(false);

  // Callbacks live in a ref so the effect depends only on `ttlMs`. Passing an
  // inline arrow for onExpire would otherwise re-run the effect on every
  // render, resetting `bornAt` — and the chip would never expire at all.
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    const bornAt = Date.now();
    const check = (): void => {
      // Timestamp comparison, not a trusted single timeout: a backgrounded app
      // must not come back with a live chip that still undoes an old set.
      if (Date.now() - bornAt >= ttlMs) {
        setExpired(true);
        expire.current();
      }
    };
    const id = setInterval(check, 250);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, [ttlMs]);

  if (expired) return null;

  return (
    <button type="button" class="undo-chip" data-testid="undo-chip" onClick={onUndo}>
      {label} · <span class="undo-chip__action">UNDO</span>
    </button>
  );
}
