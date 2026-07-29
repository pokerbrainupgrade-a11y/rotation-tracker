import { sessionColor } from '../lib/sessionColor';
import type { RotationPosition } from '../types';

interface SessionChipProps {
  position: RotationPosition;
}

/** Position pill. Colour comes only from sessionColor(). */
export function SessionChip({ position }: SessionChipProps) {
  return (
    <span class="chip" style={{ color: sessionColor(position) }}>
      {position}
    </span>
  );
}
