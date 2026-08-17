import { defineConfig, devices } from '@playwright/test';

/**
 * Production-build suite.
 *
 * The dev server ships no service worker, so cold offline boot and precache
 * coverage cannot be measured there. These run against the real built output
 * served by `vite preview` — the same bytes that deploy.
 */
export default defineConfig({
  testDir: './tests/e2e-prod',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173/rotation-tracker/',
    trace: 'on-first-retry',
  },
  // Chromium, not WebKit: Playwright's WebKit cannot navigate while offline
  // through a service worker (it errors internally), so it cannot measure the
  // thing these tests exist to measure. Layout is covered by the WebKit suite
  // in tests/e2e; this suite is about caching and offline behaviour.
  //
  // The real iOS Safari behaviour is still a device check — see README §7.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/rotation-tracker/',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
