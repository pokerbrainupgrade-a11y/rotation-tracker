import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet';
import { NumberStepper } from '../../components/NumberStepper';

export interface EsdResult {
  minutes: number;
  intervalsCompleted: number;
  avgHr: number | null;
  peakHr: number | null;
  modality: string;
  counted: boolean;
}

interface EsdSheetProps {
  /** true = ABORT path, writing counted: false. */
  aborting: boolean;
  onClose: () => void;
  onLog: (result: EsdResult) => Promise<void>;
}

/**
 * The 4x4 form, used by both normal completion and the abort path.
 *
 * ABORT exists because the protocol is explicit: a 4x4 that never reaches 90%
 * HRmax in interval 1 is not a VO2max session. Logging it as a miss is more
 * useful than logging it as a success, because "attempted 7, qualified 4" and
 * "did 4" call for different responses.
 */
export function EsdSheet({ aborting, onClose, onLog }: EsdSheetProps) {
  const [minutes, setMinutes] = useState(aborting ? 4 : 16);
  const [intervals, setIntervals] = useState(aborting ? 1 : 4);
  const [avgHr, setAvgHr] = useState(0);
  const [peakHr, setPeakHr] = useState(0);
  const [modality, setModality] = useState('bike');
  const [busy, setBusy] = useState(false);

  return (
    <Sheet
      title={aborting ? 'Log as missed' : 'Log conditioning'}
      onClose={onClose}
      testId={aborting ? 'esd-abort-sheet' : 'esd-sheet'}
    >
      {aborting && (
        <p class="sub__failure" data-testid="esd-abort-note">
          A 4x4 that never reaches 90% HRmax in interval 1 is not a VO2max
          session. This logs as a miss and counts nothing toward the ledger.
        </p>
      )}

      <div class="esd__field">
        <span class="field__label">MINUTES COMPLETED</span>
        <NumberStepper label="Minutes completed" value={minutes} onChange={setMinutes} />
      </div>
      <div class="esd__field">
        <span class="field__label">INTERVALS COMPLETED</span>
        <NumberStepper label="Intervals completed" value={intervals} onChange={setIntervals} />
      </div>
      <div class="esd__field">
        <span class="field__label">AVG HR</span>
        <NumberStepper label="Average heart rate" value={avgHr} step={5} onChange={setAvgHr} />
      </div>
      <div class="esd__field">
        <span class="field__label">PEAK HR</span>
        <NumberStepper label="Peak heart rate" value={peakHr} step={5} onChange={setPeakHr} />
      </div>
      <label class="field">
        <span class="field__label">MODALITY</span>
        <input
          class="field__input"
          value={modality}
          onInput={(e) => setModality((e.target as HTMLInputElement).value)}
        />
      </label>

      <button
        type="button"
        class={`btn ${aborting ? 'btn--destructive' : 'btn--primary'} sheet__confirm`}
        data-testid="esd-confirm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onLog({
            minutes,
            intervalsCompleted: intervals,
            avgHr: avgHr > 0 ? avgHr : null,
            peakHr: peakHr > 0 ? peakHr : null,
            modality,
            counted: !aborting,
          }).finally(() => setBusy(false));
        }}
      >
        {busy ? 'SAVING…' : aborting ? 'LOG AS MISSED' : 'LOG'}
      </button>
      <button type="button" class="btn btn--secondary sheet__cancel" onClick={onClose}>
        CANCEL
      </button>
    </Sheet>
  );
}
