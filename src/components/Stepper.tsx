interface StepperProps {
  value: number;
  min?: number;
  max?: number;
  label: string;
  onChange: (next: number) => void;
}

export function Stepper({ value, min = 1, max = 60, label, onChange }: StepperProps) {
  return (
    <div class="stepper" role="group" aria-label={label}>
      <button
        type="button"
        class="stepper__btn"
        aria-label="Decrease"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span class="stepper__value num" data-testid="stepper-value">
        {value}
      </span>
      <button
        type="button"
        class="stepper__btn"
        aria-label="Increase"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  );
}
