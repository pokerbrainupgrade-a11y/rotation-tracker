import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts on purpose: the PWA/Workbox plugin has no place
// in a unit-test run.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
    // Pinned so the DST tests are hermetic rather than dependent on the
    // machine's clock settings. America/New_York observes DST, which is the
    // whole point — a UTC-only CI box would never exercise the bug class the
    // dual date storage exists to prevent.
    env: { TZ: 'America/New_York' },
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts', 'src/data/dates.ts'],
      reporter: ['text', 'json-summary'],
      // ENFORCED, not merely reported. The ledger and the rotation are where a
      // silent miscount does real damage: an over-counted ledger hides
      // frequency drift, and a rotation that banks rest collapses the
      // CNS-descent architecture. A dropped branch in either must fail CI.
      thresholds: {
        'src/engine/ledger.ts': {
          statements: 100, branches: 100, functions: 100, lines: 100,
        },
        'src/engine/rotation.ts': {
          statements: 100, branches: 100, functions: 100, lines: 100,
        },
      },
    },
  },
});
