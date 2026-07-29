import { LedgerRow } from './LedgerRow';
import type { LedgerRow as LedgerRowData } from '../engine/ledger';

interface LedgerPanelProps {
  rows: LedgerRowData[];
  windowLabel: string;
}

export function LedgerPanel({ rows, windowLabel }: LedgerPanelProps) {
  return (
    <section class="section" data-testid="ledger-panel">
      <div class="section__head">
        <h2 class="section__title">28-Day Ledger</h2>
        <span class="section__meta">{windowLabel}</span>
      </div>
      <div class="ledger">
        {rows.map((row) => (
          <LedgerRow key={row.key} row={row} />
        ))}
      </div>
    </section>
  );
}
