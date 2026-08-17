import { useCallback, useState } from 'preact/hooks';
import { NumberStepper } from '../components/NumberStepper';
import { defaultProfile, putMax, putProfile } from '../data/repo';
import { requestPersistence } from '../data/persistence';
import { toLocalDate } from '../data/dates';
import { programSeed } from '../data/seed';
import type { Lift, MaxRecord, Profile, Units } from '../types';

const DEFAULTS: Record<Units, { bar: number; plates: number[] }> = {
  lb: { bar: 45, plates: [45, 35, 25, 10, 5, 2.5] },
  kg: { bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] },
};

const STEPS = 6;

interface SetupProps {
  onComplete: () => void;
}

interface LiftDraft {
  e1rm: number;
  method: 'tested' | 'estimated';
  testedOn: string;
  skipped: boolean;
}

/**
 * First-launch setup. One decision per screen.
 *
 * The failure path matters more than the happy path: if the profile write
 * fails, this shows the ACTUAL reason with a Retry. It never loops back to step
 * one, because that is the state where the app becomes unusable with no exit —
 * you cannot get in, and you cannot get out to fix it.
 */
export function Setup({ onComplete }: SetupProps) {
  const [step, setStep] = useState(1);
  const [units, setUnits] = useState<Units>('lb');
  const [bodyweight, setBodyweight] = useState(0);
  const [hrMax, setHrMax] = useState(0);
  const [bar, setBar] = useState(DEFAULTS.lb.bar);
  const [plates, setPlates] = useState<number[]>(DEFAULTS.lb.plates);
  const [drafts, setDrafts] = useState<Record<string, LiftDraft>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lifts: Lift[] = programSeed.lifts.filter((l) => !l.deprecated);
  const today = toLocalDate(new Date());

  const chooseUnits = useCallback((next: Units) => {
    setUnits(next);
    setBar(DEFAULTS[next].bar);
    setPlates(DEFAULTS[next].plates);
  }, []);

  const draftFor = (id: string): LiftDraft =>
    drafts[id] ?? { e1rm: 0, method: 'estimated', testedOn: today, skipped: false };

  const patch = (id: string, p: Partial<LiftDraft>): void =>
    setDrafts((prev) => ({ ...prev, [id]: { ...draftFor(id), ...p } }));

  const commit = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const first = programSeed.blocks[0];
      const profile: Profile = {
        ...defaultProfile(first?.id ?? 'block.accumulation'),
        units,
        bodyweight,
        hrMax,
        barWeight: bar,
        plateInventory: plates,
      };
      // DEV-ONLY failure injection, stripped from production. The lockout case
      // is the one that makes the app unusable with no exit, so it has to be
      // reachable in a test rather than reasoned about.
      if (import.meta.env.DEV) {
        const flag = (globalThis as { __failProfileWrite?: boolean }).__failProfileWrite;
        if (flag) throw new Error('QuotaExceededError: not enough storage available');
      }
      await putProfile(profile);

      for (const lift of lifts) {
        const d = drafts[lift.id];
        if (!d || d.skipped || d.e1rm <= 0) continue;
        const record: MaxRecord = {
          liftId: lift.id,
          e1rm: d.e1rm,
          unit: units,
          testedOn: d.testedOn,
          method: d.method,
        };
        await putMax(record);
      }

      // Step 6 — automatic, and never allowed to fail the setup.
      await requestPersistence().catch(() => null);
      onComplete();
    } catch (err) {
      // Surface the real reason. Never loop silently back to step 1.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [units, bodyweight, hrMax, bar, plates, drafts, lifts, onComplete]);

  if (error) {
    return (
      <main class="screen setup" data-testid="setup-error" role="alert">
        <h1 class="setup__title">Could not save your profile</h1>
        <p class="setup__error" data-testid="setup-error-reason">{error}</p>
        <p class="setup__note">
          Nothing was lost — your answers are still here. Free some device
          storage or close other tabs running this app, then retry.
        </p>
        <button
          type="button"
          class="btn btn--primary setup__next"
          data-testid="setup-retry"
          disabled={saving}
          onClick={() => void commit()}
        >
          {saving ? 'RETRYING…' : 'RETRY'}
        </button>
      </main>
    );
  }

  const canAdvance =
    step === 1 ? true
      : step === 2 ? bodyweight > 0
        : step === 3 ? hrMax > 0
          : step === 4 ? bar > 0 && plates.length > 0
            : true;

  return (
    <main class="screen setup" data-testid="setup">
      <div class="setup__dots" aria-label={`Step ${step} of ${STEPS}`}>
        {Array.from({ length: STEPS }, (_, i) => (
          <span key={i} class="setup__dot" data-active={i + 1 <= step ? 'true' : undefined} />
        ))}
      </div>

      {step === 1 && (
        <>
          <h1 class="setup__title">Units</h1>
          <div class="setup__choice">
            {(['lb', 'kg'] as Units[]).map((u) => (
              <button
                key={u}
                type="button"
                class="setup__opt"
                aria-pressed={units === u}
                data-testid={`units-${u}`}
                onClick={() => chooseUnits(u)}
              >
                {u.toUpperCase()}
              </button>
            ))}
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h1 class="setup__title">Bodyweight</h1>
          <NumberStepper
            label="Bodyweight"
            value={bodyweight}
            step={units === 'kg' ? 1 : 2}
            suffix={units}
            onChange={setBodyweight}
          />
        </>
      )}

      {step === 3 && (
        <>
          <h1 class="setup__title">HRmax</h1>
          <p class="setup__note">
            Drives the 4×4's bpm targets. Without it the conditioning card can
            only show percentages.
          </p>
          <NumberStepper label="HRmax" value={hrMax} step={1} suffix="bpm" onChange={setHrMax} />
        </>
      )}

      {step === 4 && (
        <>
          <h1 class="setup__title">Bar and plates</h1>
          <p class="setup__note">Plates available per side.</p>
          <NumberStepper
            label="Bar weight"
            value={bar}
            step={units === 'kg' ? 2.5 : 5}
            suffix={units}
            onChange={setBar}
          />
          <div class="setup__plates" data-testid="plate-inventory">
            {plates.map((p, i) => (
              <button
                key={`${p}-${i}`}
                type="button"
                class="setup__plate num"
                aria-label={`Remove ${p} ${units} plate`}
                onClick={() => setPlates((prev) => prev.filter((_, j) => j !== i))}
              >
                {p} ✕
              </button>
            ))}
          </div>
          <button
            type="button"
            class="btn btn--secondary setup__reset"
            onClick={() => setPlates(DEFAULTS[units].plates)}
          >
            RESET TO DEFAULTS
          </button>
        </>
      )}

      {step === 5 && (
        <>
          <h1 class="setup__title">Block 0 maxes</h1>
          <p class="setup__note">
            Each is skippable. A skipped lift shows SET MAX on its exercises
            rather than a made-up number.
          </p>
          {lifts.map((lift) => {
            const d = draftFor(lift.id);
            return (
              <div
                key={lift.id}
                class="setup__lift"
                data-testid="setup-lift"
                data-lift-id={lift.id}
                data-skipped={d.skipped ? 'true' : undefined}
              >
                <span class="setup__liftname">{lift.name}</span>
                {!d.skipped && (
                  <>
                    <NumberStepper
                      label={`${lift.name} e1RM`}
                      value={d.e1rm}
                      step={units === 'kg' ? 2.5 : 5}
                      suffix={units}
                      onChange={(n) => patch(lift.id, { e1rm: n })}
                    />
                    <div class="setup__method">
                      {(['tested', 'estimated'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          class="setup__methodbtn"
                          aria-pressed={d.method === m}
                          onClick={() => patch(lift.id, { method: m })}
                        >
                          {m.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <button
                  type="button"
                  class="setup__skip"
                  data-testid="skip-lift"
                  aria-pressed={d.skipped}
                  onClick={() => patch(lift.id, { skipped: !d.skipped })}
                >
                  {d.skipped ? 'SKIPPED — UNDO' : 'Skip — not yet tested'}
                </button>
              </div>
            );
          })}
        </>
      )}

      {step === 6 && (
        <>
          <h1 class="setup__title">Ready</h1>
          <p class="setup__note">
            Storage persistence is requested automatically. If the browser
            declines, Settings will say so rather than imply your data is safe.
          </p>
        </>
      )}

      <div class="setup__nav">
        {step > 1 && (
          <button
            type="button"
            class="btn btn--secondary"
            data-testid="setup-back"
            onClick={() => setStep((s) => s - 1)}
          >
            BACK
          </button>
        )}
        {step < STEPS ? (
          <button
            type="button"
            class="btn btn--primary setup__next"
            data-testid="setup-next"
            disabled={!canAdvance}
            onClick={() => setStep((s) => s + 1)}
          >
            NEXT
          </button>
        ) : (
          <button
            type="button"
            class="btn btn--primary setup__next"
            data-testid="setup-finish"
            disabled={saving}
            onClick={() => void commit()}
          >
            {saving ? 'SAVING…' : 'FINISH'}
          </button>
        )}
      </div>
    </main>
  );
}
