interface StatPillProps {
  label: string;
  value: number;
  max?: number;
}

export function StatPill({ label, value, max = 10 }: StatPillProps) {
  return (
    <span class="statpill">
      {label} <span class="num">{value}</span>/<span class="num">{max}</span>
    </span>
  );
}
