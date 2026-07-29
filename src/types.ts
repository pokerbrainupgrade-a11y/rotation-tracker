/**
 * Shared domain types. Phase 0 only needs navigation; the training-day and
 * ledger types arrive with the data layer in Phase 1.
 */

export type TabId = 'dashboard' | 'calendar' | 'train' | 'tests' | 'reference';

export interface Tab {
  readonly id: TabId;
  readonly label: string;
}

export const TABS: readonly Tab[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'train', label: 'Train' },
  { id: 'tests', label: 'Tests' },
  { id: 'reference', label: 'Reference' },
] as const;
