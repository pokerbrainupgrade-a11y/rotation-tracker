/**
 * Warning dismissals, scoped to a single local day.
 *
 * Dismissing is "I've seen this today", not "never tell me again" — the
 * underlying condition is re-evaluated every launch and the warning returns
 * tomorrow if it still holds. LEDGER_FLOOR is not dismissible at all, so it
 * never reaches here.
 *
 * sessionStorage-free and deliberately in localStorage: this is UI preference,
 * not training data. Losing it costs one extra tap.
 */

const KEY = 'rotation-tracker:dismissed';

interface Stored {
  day: string;
  ids: string[];
}

export function loadDismissed(today: string): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Stored;
    // A stale day means everything re-surfaces, which is the point.
    return parsed.day === today && Array.isArray(parsed.ids) ? parsed.ids : [];
  } catch {
    return [];
  }
}

export function saveDismissed(today: string, ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ day: today, ids } satisfies Stored));
  } catch {
    // Private mode or a full quota. Dismissal simply won't persist.
  }
}
