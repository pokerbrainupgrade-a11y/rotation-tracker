import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet';
import { NumberStepper } from '../../components/NumberStepper';
import { ratioColorVar } from '../../engine/battery';
import { toLocalDate } from '../../data/dates';
import type { TestDef } from '../../types';

export interface LoggedResult {
  localDate: string;
  battery: 'full' | 'mini';
  note: string | null;
  /** Bilateral tests carry both; unilateral carries `value` only. */
  value?: number;
  left?: number;
  right?: number;
  /** Pass/fail tests. */
  passed?: boolean;
}

interface LogResultSheetProps {
  def: TestDef;
  onClose: () => void;
  onSave: (result: LoggedResult) => Promise<void>;
}

export function LogResultSheet({ def, onClose, onSave }: LogResultSheetProps) {
  const today = toLocalDate(new Date());
  const [localDate, setLocalDate] = useState(today);
  const [battery, setBattery] = useState<'full' | 'mini'>(
    def.battery === 'mini' ? 'mini' : 'full',
  );
  const [note, setNote] = useState('');
  const [value, setValue] = useState(0);
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(0);
  const [passed, setPassed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const isPassFail = def.kind === 'passfail';

  // A failed movement screen without a note is a data point you cannot act on
  // later, so the note is required on fail.
  const noteRequired = isPassFail && passed === false;
  const canSave = isPassFail
    ? passed !== null && (!noteRequired || note.trim().length > 0)
    : def.bilateral
      ? left > 0 && right > 0
      : value > 0;

  const ratio =
    def.bilateral && left > 0 && right > 0
      ? Number(((Math.abs(left - right) / Math.max(left, right)) * 100).toFixed(1))
      : null;

  return (
    <Sheet title={def.name} onClose={onClose} testId="log-result-sheet">
      {isPassFail ? (
        <>
          <p class="sheet__label">RESULT</p>
          <div class="binary" role="radiogroup" aria-label="Movement screen result">
            <button
              type="button"
              role="radio"
              class="binary__opt"
              aria-checked={passed === true}
              data-testid="screen-pass"
              onClick={() => setPassed(true)}
            >
              Pass
            </button>
            <button
              type="button"
              role="radio"
              class="binary__opt"
              aria-checked={passed === false}
              data-testid="screen-fail"
              onClick={() => setPassed(false)}
            >
              Fail
            </button>
          </div>
        </>
      ) : def.bilateral ? (
        <>
          {/* L and R are separate required fields. One combined number would
              make an asymmetry — the thing the battery exists to detect —
              permanently invisible. */}
          <p class="sheet__label">LEFT</p>
          <NumberStepper
            label="Left value"
            value={left}
            step={0.5}
            suffix={def.unit}
            onChange={setLeft}
          />
          <p class="sheet__label">RIGHT</p>
          <NumberStepper
            label="Right value"
            value={right}
            step={0.5}
            suffix={def.unit}
            onChange={setRight}
          />
          {ratio !== null && (
            <p
              class="log__ratio num"
              data-testid="log-ratio"
              style={{ color: `var(${ratioColorVar(ratio)})` }}
            >
              L/R Δ {ratio}%
            </p>
          )}
        </>
      ) : (
        <>
          <p class="sheet__label">VALUE</p>
          <NumberStepper
            label="Value"
            value={value}
            step={0.5}
            suffix={def.unit}
            onChange={setValue}
          />
        </>
      )}

      <label class="field">
        <span class="field__label">DATE</span>
        <input
          class="field__input num"
          type="date"
          value={localDate}
          onInput={(e) => setLocalDate((e.target as HTMLInputElement).value)}
        />
      </label>

      <p class="sheet__label">BATTERY</p>
      <div class="binary binary--row">
        {(['full', 'mini'] as const).map((b) => (
          <button
            key={b}
            type="button"
            class="binary__opt"
            aria-pressed={battery === b}
            data-testid={`battery-${b}`}
            onClick={() => setBattery(b)}
          >
            {b.toUpperCase()}
          </button>
        ))}
      </div>

      <label class="field">
        <span class="field__label">
          NOTE{noteRequired ? ' — REQUIRED ON FAIL' : ''}
        </span>
        <textarea
          class="sub__note"
          rows={2}
          data-testid="log-note"
          value={note}
          onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
        />
      </label>

      <button
        type="button"
        class="btn btn--primary sheet__confirm"
        data-testid="log-save"
        disabled={!canSave || busy}
        onClick={() => {
          setBusy(true);
          const payload: LoggedResult = {
            localDate,
            battery,
            note: note.trim() || null,
            ...(isPassFail
              ? { passed: passed ?? false }
              : def.bilateral
                ? { left, right }
                : { value }),
          };
          void onSave(payload).finally(() => setBusy(false));
        }}
      >
        {busy ? 'SAVING…' : 'SAVE'}
      </button>
      <button type="button" class="btn btn--secondary sheet__cancel" onClick={onClose}>
        CANCEL
      </button>
    </Sheet>
  );
}
