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
  },
});
