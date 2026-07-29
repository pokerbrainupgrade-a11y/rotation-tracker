import type { TabId } from '../types';

/** Placeholder copy per tab. Replaced screen-by-screen from Phase 1 on. */
export const SCREEN_COPY: Record<TabId, { title: string; note: string }> = {
  dashboard: { title: 'Dashboard', note: 'Rotation state and rolling load land here.' },
  calendar: { title: 'Calendar', note: 'Completed and planned sessions land here.' },
  train: { title: 'Train', note: 'Live session logging lands here.' },
  tests: { title: 'Tests', note: 'Benchmark tests and history land here.' },
  reference: { title: 'Reference', note: 'Movement library and protocols land here.' },
};
