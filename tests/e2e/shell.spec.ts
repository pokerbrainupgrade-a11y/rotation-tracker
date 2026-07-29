import { expect, test } from '@playwright/test';

// Deliberately thin for Phase 0 — the shell is all there is to assert on.
// Not wired into CI yet; run locally with `npm run test:e2e`.

test('shell renders and tabs switch', async ({ page }) => {
  await page.goto('./');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.getByRole('button', { name: 'Train' }).click();
  await expect(page.getByRole('heading', { name: 'Train' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Train' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('every tab meets the 56px minimum tap target', async ({ page }) => {
  await page.goto('./');

  const buttons = page.locator('.tabbar__btn');
  const count = await buttons.count();
  expect(count).toBe(5);

  for (let i = 0; i < count; i++) {
    const box = await buttons.nth(i).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);
  }
});

test('service worker registers within the app scope', async ({ page }) => {
  await page.goto('./');

  const scope = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.scope;
  });
  expect(scope).toContain('/rotation-tracker/');
});
