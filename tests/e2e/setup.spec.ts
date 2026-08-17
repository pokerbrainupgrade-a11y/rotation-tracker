import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function readStore<T = Record<string, unknown>>(
  page: Page, store: string,
): Promise<T[]> {
  return page.evaluate(async (name) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('rotationTracker');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows: unknown[] = await new Promise((res) => {
      const rq = db.transaction(name).objectStore(name).getAll();
      rq.onsuccess = () => res(rq.result as unknown[]);
    });
    db.close();
    return rows as never;
  }, store);
}

/** Walk steps 1–4, filling the required fields. */
async function throughBasics(page: Page): Promise<void> {
  await page.getByTestId('units-lb').click();
  await page.getByTestId('setup-next').click();

  // Bodyweight
  const plus = () => page.locator('.nstep__btn').last();
  for (let i = 0; i < 3; i++) await plus().click();
  await page.getByTestId('setup-next').click();

  // HRmax
  for (let i = 0; i < 3; i++) await plus().click();
  await page.getByTestId('setup-next').click();

  // Bar + plates already defaulted
  await page.getByTestId('setup-next').click();
}

/* ---------- TEST 10 ---------- */

test('10 — setup completes, and required fields cannot be bypassed', async ({ page }) => {
  await page.goto('?scenario=setup');
  await page.waitForSelector('[data-testid="setup"]');

  // Step 1 → 2
  await page.getByTestId('units-lb').click();
  await page.getByTestId('setup-next').click();

  // Bodyweight is required: NEXT is disabled at 0.
  await expect(page.getByTestId('setup-next')).toBeDisabled();
  const plus = () => page.locator('.nstep__btn').last();
  await plus().click();
  await expect(page.getByTestId('setup-next')).toBeEnabled();
  await page.getByTestId('setup-next').click();

  // HRmax is required too.
  await expect(page.getByTestId('setup-next')).toBeDisabled();
  await plus().click();
  await expect(page.getByTestId('setup-next')).toBeEnabled();
  await page.getByTestId('setup-next').click();

  // Bar and plates come pre-filled with sensible defaults.
  await expect(page.getByTestId('plate-inventory').locator('button')).toHaveCount(6);
  await page.getByTestId('setup-next').click();

  // Step 5: maxes, each individually skippable.
  await expect(page.getByTestId('setup-lift').first()).toBeVisible();
  await page.getByTestId('setup-next').click();

  await page.getByTestId('setup-finish').click();
  await page.waitForSelector('[data-testid="dashboard"]');

  const profiles = await readStore(page, 'profile');
  expect(profiles).toHaveLength(1);
  expect(profiles[0]?.['units']).toBe('lb');
  expect(Number(profiles[0]?.['bodyweight'])).toBeGreaterThan(0);
  expect(Number(profiles[0]?.['hrMax'])).toBeGreaterThan(0);
});

test('10b — kg switches the bar and plate defaults', async ({ page }) => {
  await page.goto('?scenario=setup');
  await page.waitForSelector('[data-testid="setup"]');

  await page.getByTestId('units-kg').click();
  await page.getByTestId('setup-next').click();
  const plus = () => page.locator('.nstep__btn').last();
  await plus().click();
  await page.getByTestId('setup-next').click();
  await plus().click();
  await page.getByTestId('setup-next').click();

  // kg default inventory has seven plates, not six.
  await expect(page.getByTestId('plate-inventory').locator('button')).toHaveCount(7);
  await expect(page.getByTestId('plate-inventory')).toContainText('1.25');
});

/* ---------- TEST 11 (load-bearing): the lockout case ---------- */

test('11 — a profile write failure surfaces the reason with Retry, and does not loop', async ({
  page,
}) => {
  await page.goto('?scenario=setup-fail');
  await page.waitForSelector('[data-testid="setup"]');

  await throughBasics(page);
  await page.getByTestId('setup-next').click(); // past maxes
  await page.getByTestId('setup-finish').click();

  // The actual failure reason, not a generic message.
  const err = page.getByTestId('setup-error');
  await expect(err).toBeVisible();
  await expect(page.getByTestId('setup-error-reason')).toContainText('QuotaExceededError');

  // Critically: it did NOT loop back to step 1.
  await expect(page.getByTestId('setup')).toHaveCount(0);
  await expect(page.getByTestId('units-lb')).toHaveCount(0);

  // Retry exists and is actionable.
  await expect(page.getByTestId('setup-retry')).toBeEnabled();

  // Clearing the fault and retrying completes without re-entering anything.
  await page.evaluate(() => {
    (globalThis as { __failProfileWrite?: boolean }).__failProfileWrite = false;
  });
  await page.getByTestId('setup-retry').click();
  await page.waitForSelector('[data-testid="dashboard"]');
  expect(await readStore(page, 'profile')).toHaveLength(1);
});

/* ---------- TEST 12 ---------- */

test('12 — a skipped lift renders SET MAX, and tapping it routes to that lift', async ({
  page,
}) => {
  await page.goto('?scenario=setup');
  await page.waitForSelector('[data-testid="setup"]');
  await throughBasics(page);

  // Skip every lift.
  const skips = page.getByTestId('skip-lift');
  const n = await skips.count();
  for (let i = 0; i < n; i++) await skips.nth(i).click();
  await page.getByTestId('setup-next').click();
  await page.getByTestId('setup-finish').click();
  await page.waitForSelector('[data-testid="dashboard"]');

  expect(await readStore(page, 'maxes')).toHaveLength(0);

  // Schedule and open a TD2, whose primary lift is barbell-loaded.
  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.locator('.segmented__btn[data-view="day"]').click();
  await page.getByTestId('day-schedule').click();
  await page.locator('.sheet__disclosure').click();
  await page.locator('.positions__btn[data-position="TD2"]').click();
  await page.getByTestId('schedule-confirm').click();
  if (await page.getByTestId('schedule-anyway').count()) {
    await page.getByTestId('schedule-anyway').click();
  }
  await page.getByTestId('start-session').click();
  await page.waitForSelector('[data-testid="session"]');

  const setMax = page
    .locator('[data-exercise-id="ex.trap-bar-deadlift"] [data-testid="set-max"]')
    .first();
  await expect(setMax).toBeVisible();
  await expect(setMax).toHaveText('SET MAX');

  await setMax.click();
  await page.waitForSelector('[data-testid="maxes"]');
  // Routed to the right lift's row, already open for editing.
  await expect(
    page.locator('[data-testid="max-row"][data-lift-id="lift.trap-bar-deadlift"]'),
  ).toHaveAttribute('data-open', 'true');
});

/* ---------- TEST 13 ---------- */

test('13 — updating an e1RM recomputes dependent targets immediately', async ({ page }) => {
  await page.goto('?scenario=session-ready');
  await page.waitForSelector('[data-testid="dashboard"]');

  // No maxes seeded, so the squat starts at SET MAX.
  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.locator('.segmented__btn[data-view="day"]').click();
  await page.getByTestId('start-session').click();
  await page.waitForSelector('[data-testid="session"]');

  const squat = page.locator('[data-exercise-id="ex.back-squat"]');
  await expect(squat.getByTestId('set-max')).toBeVisible();

  // Set a max via the Maxes screen.
  await squat.getByTestId('set-max').click();
  await page.waitForSelector('[data-testid="maxes"]');
  const row = page.locator('[data-testid="max-row"][data-lift-id="lift.back-squat"]');
  const plus = row.locator('.nstep__btn').last();
  for (let i = 0; i < 40; i++) await plus.click(); // 40 × 5 lb = 200

  await expect(row.getByTestId('max-value')).toHaveText('200');
  await expect(row.getByTestId('max-age')).toBeVisible();

  // Reopen the session: the target is now computed, not SET MAX.
  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.locator('.segmented__btn[data-view="day"]').click();
  await page.getByTestId('start-session').click();
  await page.waitForSelector('[data-testid="session"]');

  const squatAgain = page.locator('[data-exercise-id="ex.back-squat"]');
  await expect(squatAgain.getByTestId('set-max')).toHaveCount(0);
  await expect(squatAgain.getByTestId('load-primary')).toBeVisible();
  // Back squat is a velocity lift: primary is the m/s floor, weight secondary.
  await expect(squatAgain.getByTestId('load-secondary')).toContainText('LB');
  await expect(squatAgain.getByTestId('plate-line')).toContainText('BAR 45');
});

/* ---------- TEST 14 ---------- */

test('14 — the deload toggle changes displayed doses per the protocol table', async ({
  page,
}) => {
  await page.goto('?scenario=session-ready');
  await page.waitForSelector('[data-testid="dashboard"]');
  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.locator('.segmented__btn[data-view="day"]').click();
  await page.getByTestId('start-session').click();
  await page.waitForSelector('[data-testid="session"]');

  const throwDose = page.locator('[data-exercise-id="ex.med-ball-throw"] .exercise__dose');
  const before = await throwDose.textContent();
  expect(before).toBe('4 × 3 / side');

  await page.getByTestId('deload-toggle').click();
  await expect(page.getByTestId('deload-badge')).toBeVisible();

  // Max-intent throw: volume −50%, sets and intent unchanged.
  await expect(throwDose).toHaveText('4 × 2 / side');

  // Ballistic (back squat): sets halved, reps unchanged.
  await expect(
    page.locator('[data-exercise-id="ex.back-squat"] .exercise__dose'),
  ).toHaveText('3 × 3');

  // Reversible.
  await page.getByTestId('deload-toggle').click();
  await expect(page.getByTestId('deload-badge')).toHaveCount(0);
  await expect(throwDose).toHaveText('4 × 3 / side');
});

/* ---------- TEST 15 (load-bearing): the product boundary ---------- */

test('15 — the deload-position chip renders on the right rotation and applies nothing', async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  await page.goto('?scenario=deload-position');
  await page.waitForSelector('[data-testid="dashboard"]');

  // Dashboard chip.
  await expect(page.getByTestId('deload-position')).toBeVisible();

  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.locator('.segmented__btn[data-view="day"]').click();
  await page.getByTestId('start-session').click();
  await page.waitForSelector('[data-testid="session"]');

  // Session-header chip.
  await expect(page.getByTestId('deload-position')).toBeVisible();

  // It applied NOTHING: deload is still off, the badge is absent, and the
  // dose is the undeloaded one.
  await expect(page.getByTestId('deload-badge')).toHaveCount(0);
  await expect(page.getByTestId('deload-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page.locator('[data-exercise-id="ex.med-ball-throw"] .exercise__dose'),
  ).toHaveText('4 × 3 / side');

  const sessions = await readStore(page, 'scheduled');
  expect(sessions[0]?.['deload']).toBe(false);

  // And it asked nothing.
  expect(dialogs).toEqual([]);
});

test('15b — a non-deload rotation shows no chip at all', async ({ page }) => {
  // session-ready sits at rotation 2; the block's deload position is 4.
  await page.goto('?scenario=session-ready');
  await page.waitForSelector('[data-testid="dashboard"]');
  await expect(page.getByTestId('deload-position')).toHaveCount(0);

  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.locator('.segmented__btn[data-view="day"]').click();
  await page.getByTestId('start-session').click();
  await page.waitForSelector('[data-testid="session"]');
  await expect(page.getByTestId('deload-position')).toHaveCount(0);
});
