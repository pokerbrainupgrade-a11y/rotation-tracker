import { Sheet } from '../../components/Sheet';
import { availableLevels } from '../../engine/compression';
import type { CompressionLevel, SessionTemplate } from '../../types';

interface CompressionSheetProps {
  template: SessionTemplate;
  current: CompressionLevel;
  onClose: () => void;
  onSelect: (level: CompressionLevel) => Promise<void>;
}

/**
 * The compressionRule text is shown HERE, at the decision point — not buried in
 * Reference. The reasoning is only useful while you are deciding.
 */
export function CompressionSheet({
  template, current, onClose, onSelect,
}: CompressionSheetProps) {
  const levels = availableLevels(template);

  return (
    <Sheet title="Compress session" onClose={onClose} testId="compression-sheet">
      <p class="comp__rule" data-testid="compression-rule">{template.compressionRule}</p>

      <div class="comp__levels">
        {([100, ...levels] as CompressionLevel[])
          .sort((a, b) => b - a)
          .map((level) => (
            <button
              key={level}
              type="button"
              class="comp__level"
              aria-pressed={current === level}
              data-level={level}
              data-testid={`compression-${level}`}
              onClick={() => void onSelect(level)}
            >
              <span class="comp__pct num">{level}%</span>
              {level === 100 && <span class="comp__hint">FULL SESSION</span>}
            </button>
          ))}
      </div>

      <button type="button" class="btn btn--secondary sheet__cancel" onClick={onClose}>
        CANCEL
      </button>
    </Sheet>
  );
}
