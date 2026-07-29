import { barGeometry, ROW_LABEL, rowColor, subLabel } from '../lib/ledgerGeometry';
import type { LedgerRow as LedgerRowData } from '../engine/ledger';

interface LedgerRowProps {
  row: LedgerRowData;
}

/**
 * One ledger row: label, count, track, fill, floor tick, miss hatch, sub-label.
 *
 * Below floor, the count / fill / sub-label all move to --alert together.
 * --alert is amber-orange, deliberately NOT --brand red: red is primary
 * actions, and a warning that reads as a button is a warning you act on wrong.
 */
export function LedgerRow({ row }: LedgerRowProps) {
  const geo = barGeometry(row);
  const color = rowColor(row.key);
  const stateColor = row.belowFloor ? 'var(--alert)' : color;

  const label = ROW_LABEL[row.key] ?? row.key;

  return (
    <div class="ledger-row" data-key={row.key} data-below-floor={row.belowFloor}>
      <div class="ledger-row__head">
        <span class="ledger-row__label">{label}</span>
        <span class="ledger-row__count num" style={{ color: stateColor }}>
          {row.count}
        </span>
      </div>

      <div
        class="ledger-row__track"
        role="img"
        aria-label={`${label}: ${row.count} of floor ${row.floor}${
          row.missed > 0 ? `, ${row.missed} missed` : ''
        }`}
      >
        <div
          class="ledger-row__fill"
          style={{ width: `${geo.fillPct}%`, background: stateColor }}
        />
        {geo.hatchPct > 0 && (
          <div
            class="ledger-row__hatch"
            data-testid="ledger-hatch"
            style={{
              left: `${geo.fillPct}%`,
              width: `${geo.hatchPct}%`,
              // 45° hatch in the row colour. Distinguishable from the solid
              // fill at a glance is the acceptance criterion.
              backgroundImage:
                `repeating-linear-gradient(45deg, ${color} 0 2px, transparent 2px 5px)`,
              opacity: 0.3,
            }}
          />
        )}
        {geo.barMax > 0 && (
          <div
            class="ledger-row__tick"
            data-testid="ledger-tick"
            style={{ left: `${geo.floorPct}%` }}
          />
        )}
      </div>

      <div
        class="ledger-row__sub"
        style={row.belowFloor ? { color: 'var(--alert)' } : undefined}
      >
        {subLabel(row)}
      </div>
    </div>
  );
}
