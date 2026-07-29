import { describe, expect, it } from 'vitest';
import { TABS } from '../../src/types';

// Trivial by design — Phase 0's job is to prove the CI gate is live, not to
// test behaviour that doesn't exist yet.
describe('shell', () => {
  it('declares five tabs in fixed order', () => {
    expect(TABS.map((t) => t.id)).toEqual([
      'dashboard',
      'calendar',
      'train',
      'tests',
      'reference',
    ]);
  });
});
