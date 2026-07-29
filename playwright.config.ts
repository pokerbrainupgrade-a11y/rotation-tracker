import { defineConfig, devices } from '@playwright/test';

// Portrait iPhone only — this app has no desktop layout, so testing one
// would be testing a thing that doesn't exist.
//
// Runs against the DEV server, not a production preview: src/dev/seedStates.ts
// is stripped from production by `import.meta.env.DEV`, and without the seeder
// these visual states could only be reached by hand-logging sessions.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174/rotation-tracker/',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'iphone', use: { ...devices['iPhone 14 Pro'] } }],
  webServer: {
    command: 'npm run dev -- --port 5174 --strictPort',
    url: 'http://localhost:5174/rotation-tracker/',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
