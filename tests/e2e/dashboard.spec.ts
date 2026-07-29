import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * E2E runs against the DEV server, not a production preview: the state seeder
 * is stripped from production builds by `import.meta.env.DEV`, and without it
 * these states could only be reached by hand-logging sessions.
 */

const go = async (page: Page, scenario: string): Promise<void> => {
  await page.goto(`?scenario=${scenario}`);
  await page.waitForSelector('[data-testid="dashboard"], [data-testid="error-screen"]');
};

/* ---------- TEST 5 ---------- */

test('5 — Dashboard renders seeded data: next session, five ledger rows, recent', async ({
  page,
}) => {
  await go(page, 'healthy');

  await expect(page.getByTestId('dashboard')).toBeVisible();

  // Next session comes from the rotation engine.
  const pos = await page.getByTestId('next-position').textContent();
  expect(['TD1', 'TD2', 'TD3', 'RD', 'TD-A', 'TD-B-STR', 'TD-B-ESD']).toContain(pos?.trim());

  await expect(page.getByRole('button', { name: 'START SESSION' })).toBeVisible();

  // Five ledger rows, in order.
  const rows = page.locator('.ledger-row');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toHaveAttribute('data-key', 'velocityFull');
  await expect(rows.nth(4)).toHaveAttribute('data-key', 'trainingDays');

  // Recent list is populated from real completed sessions.
  await expect(page.getByTestId('recent')).toBeVisible();
  await expect(page.locator('.recent-row')).toHaveCount(5);
});

test('5b — the ledger reflects real logs, not fixtures', async ({ page }) => {
  await go(page, 'healthy');
  const healthy = await page
    .locator('.ledger-row[data-key="velocityFull"] .ledger-row__count')
    .textContent();

  // Same sessions, max-intent sets removed: the count must drop.
  await go(page, 'below-velocity');
  const stripped = await page
    .locator('.ledger-row[data-key="velocityFull"] .ledger-row__count')
    .textContent();

  expect(Number(healthy)).toBeGreaterThan(0);
  expect(Number(stripped)).toBe(0);
});

/* ---------- TEST 6 ---------- */

test('6 — a below-floor state renders LEDGER_FLOOR with no dismiss control', async ({ page }) => {
  await go(page, 'warn-ledger-floor');

  const floor = page.locator('[data-warning-id="LEDGER_FLOOR"]').first();
  await expect(floor).toBeVisible();

  // Non-dismissible: it clears only when the count recovers.
  await expect(floor.locator('.warning__dismiss')).toHaveCount(0);
  await expect(floor).toHaveAttribute('data-severity', 'alert');

  // The row itself is amber, not brand red.
  const row = page.locator('.ledger-row[data-below-floor="true"]').first();
  await expect(row).toBeVisible();
  const color = await row
    .locator('.ledger-row__count')
    .evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe('rgb(255, 122, 26)'); // --alert
  expect(color).not.toBe('rgb(210, 10, 10)'); // --brand
});

/* ---------- TEST 7 ---------- */

test('7 — warnings list is absent, not empty-stated, when there are none', async ({ page }) => {
  await go(page, 'healthy');

  await expect(page.getByTestId('ledger-panel')).toBeVisible();
  await expect(page.getByTestId('warning-list')).toHaveCount(0);
  await expect(page.getByText('Active Warnings')).toHaveCount(0);
  await expect(page.getByText(/all clear/i)).toHaveCount(0);
});

/* ---------- TEST 8 ---------- */

test('8 — DB-open failure renders the blocking error screen, not a blank Dashboard', async ({
  page,
}) => {
  await go(page, 'db-error');

  await expect(page.getByTestId('error-screen')).toBeVisible();
  await expect(page.getByText('STORAGE UNAVAILABLE')).toBeVisible();
  await expect(page.getByTestId('dashboard')).toHaveCount(0);
});

/* ---------- shell ---------- */

test('shell — five tabs, hash routing, Dashboard is the landing route', async ({ page }) => {
  await go(page, 'healthy');

  await expect(page.locator('.tabbar__btn')).toHaveCount(5);
  expect(page.url()).toContain('#/dashboard');

  await page.getByRole('button', { name: 'Calendar' }).click();
  await expect(page).toHaveURL(/#\/calendar/);
  // Calendar is a real screen from Phase 4 on, not a titled placeholder.
  await expect(page.getByTestId('calendar')).toBeVisible();

  // Back returns to the Dashboard — the point of hash routing in standalone.
  await page.goBack();
  await expect(page.getByTestId('dashboard')).toBeVisible();
});

/* ---------- states ---------- */

test('states — UNSCHEDULED renders in --alert when nothing is planned', async ({ page }) => {
  await go(page, 'unscheduled');
  const date = page.locator('.next-card__date');
  await expect(date).toHaveText('UNSCHEDULED');
  const color = await date.evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe('rgb(255, 122, 26)');
});

test('states — VO2max misses render a hatched segment', async ({ page }) => {
  await go(page, 'vo2max-missed');
  const hatch = page.locator('.ledger-row[data-key="vo2max"] [data-testid="ledger-hatch"]');
  await expect(hatch).toHaveCount(1);
});

test('states — an overdue export reads in --alert', async ({ page }) => {
  await go(page, 'export-overdue');
  const status = page.locator('.export-status');
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute('data-severity', 'critical');
});

/* ---------- texture discipline ---------- */

test('texture — no background image on the ledger, cards or numerals', async ({ page }) => {
  await go(page, 'healthy');

  for (const selector of ['.ledger', '.ledger-row', '.card', '.ledger-row__count']) {
    const bg = await page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg, `${selector} must carry no texture`).toBe('none');
  }
});

test('texture — numerals use tabular-nums', async ({ page }) => {
  await go(page, 'healthy');
  const variant = await page
    .locator('.ledger-row__count')
    .first()
    .evaluate((el) => getComputedStyle(el).fontVariantNumeric);
  expect(variant).toContain('tabular-nums');
});

test('tap targets — primary action is 64px, dismiss is at least 56px', async ({ page }) => {
  await go(page, 'warn-gap-4d');

  const start = await page.getByRole('button', { name: 'START SESSION' }).boundingBox();
  expect(start?.height).toBeGreaterThanOrEqual(64);

  const dismiss = page.locator('.warning__dismiss').first();
  if (await dismiss.count()) {
    const box = await dismiss.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(56);
    expect(box?.width).toBeGreaterThanOrEqual(56);
  }
});
