interface PlaceholderProps {
  title: string;
  note: string;
}

/**
 * Phase 0 stands in for every screen. Each tab gets a real heading so the
 * shell is verifiably navigable before any data exists.
 */
export function Placeholder({ title, note }: PlaceholderProps) {
  return (
    <main class="screen">
      <h1 class="screen__title">{title}</h1>
      <p class="screen__note">{note}</p>
    </main>
  );
}
