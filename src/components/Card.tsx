import type { ComponentChildren } from 'preact';

interface CardProps {
  /** CSS colour for the 4px left border, e.g. from sessionColor(). */
  accent?: string;
  class?: string;
  children: ComponentChildren;
}

export function Card({ accent, class: className = '', children }: CardProps) {
  return (
    <div
      class={`card ${accent ? 'card--accent' : ''} ${className}`.trim()}
      style={accent ? { borderLeftColor: accent } : undefined}
    >
      {children}
    </div>
  );
}
