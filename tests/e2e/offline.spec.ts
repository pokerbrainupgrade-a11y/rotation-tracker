import { expect, test } from '@playwright/test';

/**
 * The offline audit is MEASURED, not asserted from belief. Each test observes
 * real browser behaviour: actual requests, an actual offline context, actual
 * persisted records.
 */

/* ---------- TEST 10 (load-bearing) ---------- */

test('10 — zero external-origin requests after load', async ({ page, baseURL }) => {
  const appOrigin = new URL(baseURL ?? 'http://localhost:5174').origin;
  const external: string[] = [];

  page.on('request', (req) => {
    const url = req.url();
    // data: and blob: are in-document, not network.
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (new URL(url).origin !== appOrigin) external.push(url);
  });

  await page.goto('?scenario=healthy');
  await page.waitForSelector('[data-testid="dashboard"]');
  await page.waitForLoadState('networkidle');

  // Visit every tab — a font or icon pulled in by one screen still counts.
  for (const tab of ['Calendar', 'Train', 'Tests', 'Reference', 'Dashboard']) {
    await page.getByRole('button', { name: tab }).click();
    await page.waitForTimeout(150);
  }
  await page.waitForLoadState('networkidle');

  expect(external, `external requests:\n${external.join('\n')}`).toEqual([]);
});

/* ---------- TEST 11 lives in tests/e2e-prod ---------- */
/*
 * Cold offline boot needs a real service worker, and the dev server does not
 * ship one — asserting it here would measure nothing. It runs against the
 * production build in tests/e2e-prod/offline-boot.spec.ts instead.
 */

/* ---------- TEST 12 ---------- */

test('12 — an offline session write persists across reload', async ({ page, context }) => {
  await page.goto('?scenario=session-ready');
  await page.waitForSelector('[data-testid="dashboard"]');

  await context.setOffline(true);

  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.locator('.segmented__btn[data-view="day"]').click();
  await page.getByTestId('start-session').click();
  await page.waitForSelector('[data-testid="session"]');

  await page.locator('[data-testid="set-row"]').first().getByTestId('set-complete').click();
  await expect(page.locator('[data-testid="set-row"]').first())
    .toHaveAttribute('data-done', 'true');

  const count = async (): Promise<number> =>
    page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((r) => {
        const q = indexedDB.open('rotationTracker');
        q.onsuccess = () => r(q.result);
      });
      const n: number = await new Promise((r) => {
        const q = db.transaction('setLogs').objectStore('setLogs').count();
        q.onsuccess = () => r(q.result);
      });
      db.close();
      return n;
    });

  expect(await count()).toBeGreaterThan(0);

  // Reload WITHOUT the scenario param so the seeder does not wipe it.
  await context.setOffline(false);
  await page.goto('./');
  await page.waitForSelector('[data-testid="resume-sheet"], [data-testid="dashboard"]');
  expect(await count()).toBeGreaterThan(0);
});

/* ---------- version skew ---------- */

test('1 — data newer than the app blocks, and writes nothing', async ({ page }) => {
  await page.goto('?scenario=skew-newer');
  await page.waitForSelector('[data-testid="skew-screen"]');

  const screen = page.getByTestId('skew-screen');
  await expect(screen).toContainText('APP VERSION IS OLDER THAN YOUR DATA');
  await expect(screen).toContainText('99');
  await expect(screen).toContainText('Do not continue');

  // No app UI at all — not the dashboard, not the tab bar.
  await expect(page.getByTestId('dashboard')).toHaveCount(0);
  await expect(page.locator('.tabbar')).toHaveCount(0);

  // There is no "continue anyway".
  const labels = (await screen.locator('button').allInnerTexts()).join('|').toLowerCase();
  expect(labels).not.toMatch(/continue|proceed|ignore|anyway/);

  // The stored schemaVersion is untouched: nothing wrote over the newer data.
  const stored = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => {
      const q = indexedDB.open('rotationTracker');
      q.onsuccess = () => r(q.result);
    });
    const p: { schemaVersion?: number } = await new Promise((r) => {
      const q = db.transaction('profile').objectStore('profile').get('me');
      q.onsuccess = () => r(q.result);
    });
    db.close();
    return p?.schemaVersion;
  });
  expect(stored).toBe(99);
});

test('2 — export works from the skew screen', async ({ page }) => {
  await page.goto('?scenario=skew-newer');
  await page.waitForSelector('[data-testid="skew-screen"]');

  const button = page.getByTestId('skew-export');
  await expect(button).toBeEnabled();

  const download = page.waitForEvent('download', { timeout: 10_000 }).catch(() => null);
  await button.click();
  await expect(page.getByTestId('skew-export-result')).toContainText('Export complete');
  await download;
});

test('3 — data older than the app migrates normally, with no block', async ({ page }) => {
  await page.goto('?scenario=healthy');
  await page.waitForSelector('[data-testid="dashboard"]');

  // Rewrite the profile as if written by an older build, then reload.
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => {
      const q = indexedDB.open('rotationTracker');
      q.onsuccess = () => r(q.result);
    });
    const tx = db.transaction('profile', 'readwrite');
    const store = tx.objectStore('profile');
    const p: Record<string, unknown> = await new Promise((r) => {
      const q = store.get('me');
      q.onsuccess = () => r(q.result);
    });
    store.put({ ...p, schemaVersion: 1 });
    db.close();
  });

  await page.goto('./');
  await expect(page.getByTestId('skew-screen')).toHaveCount(0);
  await page.waitForSelector('[data-testid="dashboard"]');
});

/* ---------- update flow ---------- */

test('4 — the update banner appears when a waiting version exists', async ({ page }) => {
  await page.goto('?scenario=update-available');
  await page.waitForSelector('[data-testid="dashboard"]');

  const banner = page.getByTestId('banner-update');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('UPDATE AVAILABLE');

  // Dismissible, and it stays dismissed for the session.
  await banner.locator('.banner__dismiss').click();
  await expect(page.getByTestId('banner-update')).toHaveCount(0);
});

test('5 — Update opens the export prompt before applying', async ({ page }) => {
  await page.goto('?scenario=update-available');
  await page.waitForSelector('[data-testid="dashboard"]');

  await page.getByTestId('banner-update').getByRole('button', { name: 'Update' }).click();
  const prompt = page.getByTestId('update-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Export your data before updating?');
  await expect(page.getByTestId('update-last-export')).toBeVisible();

  // Export is the primary path, but declining is offered.
  await expect(page.getByTestId('export-and-update')).toBeVisible();
  await expect(page.getByTestId('update-without-export')).toBeVisible();
  await expect(page.getByTestId('update-cancel')).toBeVisible();

  // Nothing applied yet.
  expect(await page.evaluate(() =>
    (globalThis as { __updateApplied?: boolean }).__updateApplied ?? false)).toBe(false);
});

test('6 — updating without exporting still applies', async ({ page }) => {
  await page.goto('?scenario=update-available');
  await page.waitForSelector('[data-testid="dashboard"]');

  await page.getByTestId('banner-update').getByRole('button', { name: 'Update' }).click();
  await page.getByTestId('update-without-export').click();

  await expect(page.getByTestId('update-prompt')).toHaveCount(0);
  expect(await page.evaluate(() =>
    (globalThis as { __updateApplied?: boolean }).__updateApplied ?? false)).toBe(true);
});
