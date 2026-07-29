import { useMemo, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet';
import { Stepper } from '../../components/Stepper';
import { longDate } from '../../lib/calendarGrid';
import { applyDeferral } from '../../engine/rotation';
import type { ScheduledSession } from '../../types';

interface DeferSheetProps {
  fromLocalDate: string;
  schedule: ScheduledSession[];
  onClose: () => void;
  onConfirm: (shifted: ScheduledSession[]) => Promise<void>;
}

/**
 * Deferral shifts the ENTIRE forward sequence, preserving spacing. There is no
 * "move only this one" path: moving a single session silently breaks the
 * rotation's spacing, and the damage only becomes visible weeks later.
 *
 * The cascade preview is non-optional for the same reason — the blast radius
 * has to be visible before you commit to it.
 */
export function DeferSheet({ fromLocalDate, schedule, onClose, onConfirm }: DeferSheetProps) {
  const [days, setDays] = useState(1);
  const [busy, setBusy] = useState(false);

  const affected = useMemo(
    () => schedule.filter((s) => s.localDate >= fromLocalDate),
    [schedule, fromLocalDate],
  );

  const shifted = useMemo(
    () => applyDeferral(schedule, fromLocalDate, days),
    [schedule, fromLocalDate, days],
  );

  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      // Persist only what actually moved.
      const moved = shifted.filter((s) => s.localDate >= fromLocalDate);
      await onConfirm(moved);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={`Defer from ${longDate(fromLocalDate)}`} onClose={onClose} testId="defer-sheet">
      <p class="sheet__label">DEFER BY</p>
      <Stepper value={days} label="Days to defer" onChange={setDays} />

      <p class="defer__preview" data-testid="defer-preview">
        <span class="num" data-testid="defer-count">{affected.length}</span>
        {affected.length === 1 ? ' session will move forward ' : ' sessions will move forward '}
        <span class="num">{days}</span>
        {days === 1 ? ' day' : ' days'}.
      </p>

      <ul class="defer__list">
        {shifted
          .filter((s) => s.localDate >= fromLocalDate)
          .slice(0, 8)
          .map((s) => {
            const before = schedule.find((o) => o.id === s.id);
            return (
              <li key={s.id} class="defer__row num">
                {before?.localDate} → {s.localDate}
              </li>
            );
          })}
      </ul>

      <button
        type="button"
        class="btn btn--primary sheet__confirm"
        data-testid="defer-confirm"
        disabled={busy || affected.length === 0}
        onClick={() => void confirm()}
      >
        {busy ? 'MOVING…' : 'CONFIRM DEFERRAL'}
      </button>
      <button type="button" class="btn btn--secondary sheet__cancel" onClick={onClose}>
        CANCEL
      </button>
    </Sheet>
  );
}
