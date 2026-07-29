import { useState } from 'preact/hooks';

interface NumberStepperProps {
  value: number | null;
  step?: number;
  min?: number;
  label: string;
  suffix?: string;
  disabled?: boolean;
  onChange: (next: number) => void;
}

/**
 * Steppers by default; tap the value to type.
 *
 * The iOS keyboard is never forced open — mid-set, with wet hands, a numeric
 * keypad covering half the screen is worse than two big buttons.
 */
export function NumberStepper({
  value, step = 1, min = 0, label, suffix, disabled = false, onChange,
}: NumberStepperProps) {
  const [typing, setTyping] = useState(false);
  const current = value ?? 0;

  return (
    <span class="nstep" role="group" aria-label={label}>
      <button
        type="button"
        class="nstep__btn"
        aria-label={`Decrease ${label}`}
        disabled={disabled || current <= min}
        onClick={(e) => {
          e.stopPropagation();
          onChange(Math.max(min, current - step));
        }}
      >
        −
      </button>

      {typing ? (
        <input
          class="nstep__input num"
          type="number"
          inputMode="decimal"
          autoFocus
          value={current}
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => setTyping(false)}
          onInput={(e) => onChange(Number((e.target as HTMLInputElement).value) || 0)}
        />
      ) : (
        <button
          type="button"
          class="nstep__value num"
          aria-label={`${label}, tap to type`}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            setTyping(true);
          }}
        >
          {current}
          {suffix && <span class="nstep__suffix">{suffix}</span>}
        </button>
      )}

      <button
        type="button"
        class="nstep__btn"
        aria-label={`Increase ${label}`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onChange(current + step);
        }}
      >
        +
      </button>
    </span>
  );
}
