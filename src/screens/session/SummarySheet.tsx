import { Sheet } from '../../components/Sheet';
import { ROW_LABEL } from '../../lib/ledgerGeometry';
import type { LedgerKey } from '../../types';

export interface LedgerDelta {
  key: LedgerKey;
  delta: number;
  /** vo2max only: the session logged an attempt that did not qualify. */
  missed?: boolean;
}

interface SummarySheetProps {
  setsCompleted: number;
  setsPrescribed: number;
  tonnage: number;
  units: string;
  compressionLevel: number;
  substitutions: Array<{ note: string; met: boolean }>;
  deltas: LedgerDelta[];
  onDone: () => void;
}

/**
 * No score, no rating, no streak, no encouragement.
 *
 * The ledger delta IS the feedback: it closes the loop between logging a
 * session and watching the instrument move. Anything congratulatory bolted on
 * top would compete with the only number that means something.
 */
export function SummarySheet({
  setsCompleted, setsPrescribed, tonnage, units, compressionLevel,
  substitutions, deltas, onDone,
}: SummarySheetProps) {
  return (
    <Sheet title="Session complete" onClose={onDone} testId="summary-sheet">
      <dl class="summary">
        <div class="summary__row">
          <dt class="summary__key">SETS</dt>
          <dd class="summary__val num" data-testid="summary-sets">
            {setsCompleted} / {setsPrescribed} completed
          </dd>
        </div>

        <div class="summary__row">
          <dt class="summary__key">TONNAGE</dt>
          <dd class="summary__val num" data-testid="summary-tonnage">
            {tonnage.toLocaleString()} {units}
          </dd>
        </div>

        {compressionLevel < 100 && (
          <div class="summary__row">
            <dt class="summary__key">COMPRESSION</dt>
            <dd class="summary__val num" data-testid="summary-compression">
              {compressionLevel}%
            </dd>
          </div>
        )}

        {substitutions.length > 0 && (
          <div class="summary__row">
            <dt class="summary__key">SUBSTITUTIONS</dt>
            <dd class="summary__val">
              {substitutions.map((s, i) => (
                <span key={i} class="summary__sub">
                  {s.note || 'Substitute'} ·{' '}
                  <span style={{ color: s.met ? 'var(--text-dim)' : 'var(--alert)' }}>
                    {s.met ? 'MET' : 'NOT MET'}
                  </span>
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>

      <p class="sheet__label">LEDGER</p>
      <div class="summary__ledger" data-testid="summary-ledger">
        {deltas.length === 0 ? (
          <span class="summary__delta summary__delta--none">NO LEDGER CHANGE</span>
        ) : (
          deltas.map((d) => (
            <span
              key={d.key}
              class="summary__delta num"
              data-key={d.key}
              data-missed={d.missed ? 'true' : undefined}
              style={d.missed ? { color: 'var(--alert)' } : undefined}
            >
              {d.missed
                ? `${ROW_LABEL[d.key]}: MISSED`
                : `+${d.delta} ${ROW_LABEL[d.key]}`}
            </span>
          ))
        )}
      </div>

      <button
        type="button"
        class="btn btn--primary sheet__confirm"
        data-testid="summary-done"
        onClick={onDone}
      >
        DONE
      </button>
    </Sheet>
  );
}
