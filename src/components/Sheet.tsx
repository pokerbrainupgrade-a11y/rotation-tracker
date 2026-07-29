import type { ComponentChildren } from 'preact';

interface SheetProps {
  title: string;
  onClose: () => void;
  testId?: string;
  children: ComponentChildren;
}

/** Bottom sheet. Motion is <=120ms and opacity/transform only. */
export function Sheet({ title, onClose, testId, children }: SheetProps) {
  return (
    <div class="sheet-root" data-testid={testId}>
      <button
        type="button"
        class="sheet-scrim"
        aria-label="Close"
        onClick={onClose}
      />
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div class="sheet__grip" aria-hidden="true" />
        <h2 class="sheet__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
