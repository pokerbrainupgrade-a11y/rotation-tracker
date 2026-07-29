/** Shown while the database opens. Prevents a flash of empty content. */
export function Skeleton() {
  return (
    <main class="screen skeleton" aria-busy="true" aria-label="Loading">
      <div class="skeleton__line skeleton__line--head" />
      <div class="skeleton__card" />
      <div class="skeleton__line" />
      <div class="skeleton__row" />
      <div class="skeleton__row" />
      <div class="skeleton__row" />
      <div class="skeleton__row" />
      <div class="skeleton__row" />
    </main>
  );
}
