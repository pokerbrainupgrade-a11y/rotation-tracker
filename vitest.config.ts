import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts on purpose: the PWA/Workbox plugin has no place
// in a unit-test run. engine/ code is pure functions over plain data, so a
// jsdom environment is unnecessary here — node is faster and honest about the
// no-DOM constraint.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
