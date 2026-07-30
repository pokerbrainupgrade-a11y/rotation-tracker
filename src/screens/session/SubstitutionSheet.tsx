import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet';
import type { Exercise, SubstitutionTag } from '../../types';

export interface SubstitutionResult {
  note: string;
  metDosingSignature: boolean;
}

interface SubstitutionSheetProps {
  exercise: Exercise;
  tag: SubstitutionTag | null;
  onClose: () => void;
  onLog: (result: SubstitutionResult) => Promise<void>;
}

/**
 * The mechanism that keeps the ledger honest.
 *
 * The dosing-signature choice has NO default, NO "not sure", NO remembered
 * preference, and no way to dismiss past it. That friction is the entire point:
 * the ledger's accuracy rests on this one answer, and a default would let it
 * drift toward whichever option is easier to tap.
 */
export function SubstitutionSheet({ exercise, tag, onClose, onLog }: SubstitutionSheetProps) {
  const [stage, setStage] = useState<'brief' | 'log'>('brief');
  const [note, setNote] = useState('');
  const [met, setMet] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  if (stage === 'brief') {
    return (
      <Sheet title={exercise.name} onClose={onClose} testId="substitution-sheet">
        {tag ? (
          <>
            <p class="sheet__label">TARGET QUALITY</p>
            <p class="sub__body">{tag.targetQuality}</p>

            <p class="sheet__label">DOSING SIGNATURE</p>
            <p class="sub__body">{tag.dosingSignature}</p>

            <div class="sub__valid">
              <p class="sheet__label">VALID SUBSTITUTION</p>
              <p class="sub__body">{tag.validSubstitution}</p>
            </div>

            <div class="sub__invalid">
              <p class="sheet__label">INVALID SUBSTITUTION</p>
              <p class="sub__body">{tag.invalidSubstitution}</p>
            </div>

            {tag.failureMode && <p class="sub__failure">{tag.failureMode}</p>}
          </>
        ) : (
          <p class="sub__body">
            No substitution guidance is defined for this movement in the program.
          </p>
        )}

        <button
          type="button"
          class="btn btn--primary sheet__confirm"
          data-testid="log-as-substitute"
          onClick={() => setStage('log')}
        >
          LOG AS SUBSTITUTE
        </button>
        <button type="button" class="btn btn--secondary sheet__cancel" onClick={onClose}>
          CANCEL
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet title="What did you actually do?" onClose={onClose} testId="substitution-log">
      <textarea
        class="sub__note"
        rows={3}
        placeholder="Cable rotational throw, 4 × 3 per side"
        value={note}
        aria-label="What did you actually do"
        onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
      />

      <p class="sheet__label">DOSING SIGNATURE</p>

      {/* Two options, no default, no third path. */}
      <div class="binary" role="radiogroup" aria-label="Dosing signature">
        <button
          type="button"
          role="radio"
          class="binary__opt"
          aria-checked={met === true}
          data-testid="met-yes"
          onClick={() => setMet(true)}
        >
          Met the dosing signature
        </button>
        <button
          type="button"
          role="radio"
          class="binary__opt"
          aria-checked={met === false}
          data-testid="met-no"
          onClick={() => setMet(false)}
        >
          Did not meet it
        </button>
      </div>

      <button
        type="button"
        class="btn btn--primary sheet__confirm"
        data-testid="substitution-confirm"
        disabled={met === null || busy}
        onClick={() => {
          if (met === null) return;
          setBusy(true);
          void onLog({ note: note.trim(), metDosingSignature: met }).finally(() =>
            setBusy(false),
          );
        }}
      >
        {busy ? 'SAVING…' : 'CONFIRM'}
      </button>
      <button type="button" class="btn btn--secondary sheet__cancel" onClick={onClose}>
        CANCEL
      </button>
    </Sheet>
  );
}
