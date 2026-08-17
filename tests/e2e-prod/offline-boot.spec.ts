import { expect, test } from '@playwright/test';

/**
 * Measured against the PRODUCTION build with its real service worker. This is
 * the only place cold offline boot means anything.
 */

/* ---------- TEST 11 ---------- */

test('11 — cold offline boot renders the Dashboard from cache', async ({ page, context }) => {
  // First load installs the service worker and precaches the shell.
  await page.goto('./');
  await page.waitForSelector('[data-testid="dashboard"], [data-testid="setup"]');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForLoadState('networkidle');

  // Create a profile so there is something to render after the cold boot.
  if (await page.getByTestId('setup').count()) {
    await page.getByTestId('units-lb').click();
    await page.getByTestId('setup-next').click();
    const plus = () => page.locator('.nstep__btn').last();
    await plus().click();
    await page.getByTestId('setup-next').click();
    await plus().click();
    await page.getByTestId('setup-next').click();
    await page.getByTestId('setup-next').click();
    await page.getByTestId('setup-next').click();
    await page.getByTestId('setup-finish').click();
    await page.waitForSelector('[data-testid="dashboard"]');
  }

  // Cold boot: go offline, then open a FRESH page. A new document with no warm
  // JS state is a truer cold launch than a reload, and it sidesteps a WebKit
  // bug where reload() while offline errors internally rather than serving
  // from the service worker.
  await context.setOffline(true);
  const cold = await context.newPage();
  await cold.goto('./', { waitUntil: 'load' });

  await expect(cold.getByTestId('dashboard')).toBeVisible({ timeout: 15_000 });
  await expect(cold.locator('.ledger-row')).toHaveCount(5);
  await expect(cold.locator('.tabbar__btn')).toHaveCount(5);

  // Navigation still works with no network.
  await cold.getByRole('button', { name: 'Calendar' }).click();
  await expect(cold.getByTestId('calendar')).toBeVisible();

  await cold.close();
});

/* ---------- TEST 13 ---------- */

test('13 — the service worker precache covers the built assets', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForLoadState('networkidle');

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const n of names) {
      const keys = await (await caches.open(n)).keys();
      urls.push(...keys.map((r) => new URL(r.url).pathname));
    }
    return urls;
  });

  // The shell and both code chunks have to be there, or an offline launch
  // renders nothing.
  expect(cached.some((u) => u.endsWith('index.html'))).toBe(true);
  expect(cached.some((u) => /assets\/index-.*\.js$/.test(u))).toBe(true);
  expect(cached.some((u) => /assets\/index-.*\.css$/.test(u))).toBe(true);
  expect(cached.some((u) => u.endsWith('manifest.webmanifest'))).toBe(true);
});

test('service worker registers within the app scope', async ({ page }) => {
  await page.goto('./');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toContain('/rotation-tracker/');
});
