import { defineConfig, devices } from '@playwright/test';

// Portrait iPhone only — this app has no desktop layout, so testing one
// would be testing a thing that doesn't exist.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173/rotation-tracker/',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'iphone', use: { ...devices['iPhone 14 Pro'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/rotation-tracker/',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
