import { expect, test } from '@playwright/test';

/**
 * Shell-level assertions.
 *
 * The service-worker registration check that lived here in Phase 0 has moved:
 * these specs now run against the dev server (required for the state seeder),
 * and vite-plugin-pwa does not emit a service worker in dev. Registration,
 * scope and offline behaviour are verified against the deployed site instead,
 * which is a stronger test than a dev-server stand-in.
 */

test('shell renders the Dashboard and tabs switch', async ({ page }) => {
  await page.goto('?scenario=healthy');
  await expect(page.getByTestId('dashboard')).toBeVisible();

  await page.getByRole('button', { name: 'Train' }).click();
  await expect(page.getByRole('heading', { name: 'Train' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Train' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('every tab meets the 56px minimum tap target', async ({ page }) => {
  await page.goto('?scenario=healthy');
  await page.waitForSelector('[data-testid="dashboard"]');

  const buttons = page.locator('.tabbar__btn');
  expect(await buttons.count()).toBe(5);

  for (let i = 0; i < 5; i++) {
    const box = await buttons.nth(i).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);
  }
});

test('the gear opens the Settings stub', async ({ page }) => {
  await page.goto('?scenario=healthy');
  await page.waitForSelector('[data-testid="dashboard"]');

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/#\/settings/);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
