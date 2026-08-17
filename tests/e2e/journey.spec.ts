import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * TEST 14 — the full journey, run offline.
 *
 * This is the suite that protects every future change. Every assertion is on
 * observable state: rendered text, and records read back out of IndexedDB.
 * Nothing here reaches into a module or inspects internals.
 */

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

const plus = (page: Page) => page.locator('.nstep__btn').last();

async function schedule(page: Page, position: string): Promise<void> {
  await page.getByTestId('day-schedule').click();
  await page.locator('.sheet__disclosure').click();
  await page.locator(`.positions__btn[data-position="${position}"]`).click();
  await page.getByTestId('schedule-confirm').click();
  if (await page.getByTestId('schedule-anyway').count()) {
    await page.getByTestId('schedule-anyway').click();
  }
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
}

test('14 — full journey, offline', async ({ page, context }) => {
  test.setTimeout(120_000);

  /* --- first launch --- */
  await page.goto('?scenario=setup');
  await page.waitForSelector('[data-testid="setup"]');

  // Warm the lazily-loaded backup chunk before going offline. In production
  // the service worker precaches it — scripts/check-precache.mjs fails the
  // build if it ever stops doing so — but the dev server has no worker, so
  // without this the export step below would fail for a reason that does not
  // exist on a real device.
  await page.evaluate(async () => {
    const handle = (globalThis as { __rotation?: { backup: () => Promise<unknown> } })
      .__rotation;
    await handle?.backup();
  });

  // Everything after this point happens with no network.
  await context.setOffline(true);

  await page.getByTestId('units-lb').click();
  await page.getByTestId('setup-next').click();
  await plus(page).click();                       // bodyweight
  await page.getByTestId('setup-next').click();
  await plus(page).click();                       // hrMax
  await page.getByTestId('setup-next').click();
  await page.getByTestId('setup-next').click();   // bar + plates defaults

  // Skip exactly one lift; the rest get a max so loads resolve.
  const lifts = page.getByTestId('setup-lift');
  const liftCount = await lifts.count();
  await lifts.nth(0).getByTestId('skip-lift').click();
  for (let i = 1; i < liftCount; i++) {
    const step = lifts.nth(i).locator('.nstep__btn').last();
    for (let k = 0; k < 20; k++) await step.click();   // 100 lb
  }
  await page.getByTestId('setup-next').click();
  await page.getByTestId('setup-finish').click();
  await page.waitForSelector('[data-testid="dashboard"]');

  expect(await readStore(page, 'profile')).toHaveLength(1);
  expect((await readStore(page, 'maxes')).length).toBe(liftCount - 1);

  /* --- schedule a rotation --- */
  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.locator('.segmented__btn[data-view="day"]').click();
  await schedule(page, 'TD1');

  /* --- run the TD1 --- */
  await page.getByTestId('start-session').click();
  await page.waitForSelector('[data-testid="session"]');

  // Pillar prep checklist.
  const checks = page.locator('[data-section="pillar-prep"] [data-testid="check-row"]');
  for (let i = 0; i < await checks.count(); i++) await checks.nth(i).click();
  await expect(async () => {
    const rows = await readStore(page, 'scheduled');
    expect((rows[0]?.['checklist'] as string[]).length).toBeGreaterThan(0);
  }).toPass();

  // Bilateral throws.
  await page
    .locator('[data-exercise-id="ex_sidetoss"] [data-testid="set-row"]')
    .first()
    .getByTestId('set-complete')
    .click();
  if (await page.getByTestId('rest-skip').count()) await page.getByTestId('rest-skip').click();

  const throwLogs = (await readStore(page, 'setLogs'))
    .filter((l) => l['exerciseId'] === 'ex_sidetoss');
  expect(throwLogs).toHaveLength(2);
  expect(throwLogs.map((l) => l['side']).sort()).toEqual(['L', 'R']);

  // Substitute the ballistic block, meeting the signature.
  await page.locator('[data-exercise-id="ex_sidetoss"] [data-testid="sub-open"]').click();
  await page.getByTestId('log-as-substitute').click();
  await page.getByTestId('met-yes').click();
  await page.getByTestId('substitution-confirm').click();
  await expect(page.getByTestId('substitution-log')).toHaveCount(0);

  // Compress to 75%.
  await page.getByTestId('compress-open').click();
  await page.getByTestId('compression-75').click();
  await expect(page.getByTestId('compression-badge')).toHaveText('75%');

  // Finish.
  await page.getByTestId('finish-session').click();
  await expect(page.getByTestId('summary-sheet')).toBeVisible();
  await expect(page.getByTestId('summary-compression')).toHaveText('75%');
  await page.getByTestId('summary-done').click();

  /* --- ledger delta on the Dashboard --- */
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.waitForSelector('[data-testid="dashboard"]');
  const velocity = await page
    .locator('.ledger-row[data-key="velocityFull"] .ledger-row__count')
    .textContent();
  expect(Number(velocity)).toBeGreaterThan(0);

  /* --- TD3, abort the 4x4 --- */
  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.locator('.segmented__btn[data-view="day"]').click();
  // Scheduled TODAY, not tomorrow: the ledger's trailing window excludes
  // future-dated sessions, so a TD3 booked for tomorrow could never register
  // its miss. Multiple sessions on one date are allowed.
  await schedule(page, 'TD3');
  await page.getByTestId('start-session').last().click();
  await page.waitForSelector('[data-testid="session"]');

  await page.locator('[data-exercise-id="ex_4x4"] [data-testid="esd-abort"]').click();
  await expect(page.getByTestId('esd-abort-sheet')).toBeVisible();
  await page.getByTestId('esd-confirm').click();
  await expect(page.getByTestId('esd-abort-sheet')).toHaveCount(0);

  const esd = await readStore(page, 'esdLogs');
  expect(esd[0]?.['counted']).toBe(false);

  await page.getByTestId('finish-session').click();
  await expect(page.getByTestId('summary-sheet')).toBeVisible();
  await page.getByTestId('summary-done').click();

  /* --- the miss renders as a hatched segment --- */
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.waitForSelector('[data-testid="dashboard"]');
  await expect(
    page.locator('.ledger-row[data-key="vo2max"] [data-testid="ledger-hatch"]'),
  ).toHaveCount(1);

  /* --- full test battery resets both counters --- */
  await page.getByRole('button', { name: 'Tests' }).click();
  await page.waitForSelector('[data-testid="tests"]');
  await expect(page.getByTestId('cadence-calendar')).toHaveAttribute('data-due', 'true');

  await page.getByTestId('log-full-battery').click();
  for (let i = 0; i < 40; i++) {
    if (!(await page.getByTestId('battery-skip').count())) break;
    await page.getByTestId('battery-skip').click();
  }
  await expect(page.getByTestId('log-result-sheet')).toHaveCount(0);

  await expect(page.getByTestId('cadence-training')).not.toHaveAttribute('data-due', 'true');
  await expect(page.getByTestId('cadence-calendar')).not.toHaveAttribute('data-due', 'true');

  /* --- export, wipe, import, verify --- */
  const before = {
    profile: await readStore(page, 'profile'),
    maxes: await readStore(page, 'maxes'),
    scheduled: await readStore(page, 'scheduled'),
    setLogs: await readStore(page, 'setLogs'),
    esdLogs: await readStore(page, 'esdLogs'),
    tests: await readStore(page, 'tests'),
  };
  expect(before.setLogs.length).toBeGreaterThan(0);
  expect(before.tests.length).toBeGreaterThan(0);

  const json = await page.evaluate(async () => {
    const handle = (globalThis as {
      __rotation?: { backup: () => Promise<{ exportBackup: () => Promise<unknown> }> };
    }).__rotation;
    if (!handle) throw new Error('debug handle missing');
    return JSON.stringify(await (await handle.backup()).exportBackup());
  });

  // Wipe everything, then restore from the file alone.
  await page.evaluate(async () => {
    const handle = (globalThis as {
      __rotation?: { repo: unknown };
    }).__rotation;
    void handle;
    await new Promise<void>((res) => {
      const req = indexedDB.deleteDatabase('rotationTracker');
      req.onsuccess = () => res();
      req.onerror = () => res();
      req.onblocked = () => res();
    });
  });

  // Network back on for this navigation only. Playwright's WebKit cannot
  // navigate while offline without a service worker, and the dev server has
  // none — cold offline boot is measured against the real build in
  // tests/e2e-prod instead. Everything above ran with no network.
  await context.setOffline(false);
  await page.goto('./');
  // Wiping IndexedDB while the localStorage canary survives is exactly the
  // partial-eviction case, so the app correctly shows the evicted screen
  // rather than treating this as a first launch.
  await page.waitForSelector(
    '[data-testid="evicted-screen"], [data-testid="setup"], [data-testid="dashboard"]',
  );
  await expect(page.getByTestId('evicted-screen')).toBeVisible();
  expect(await readStore(page, 'setLogs')).toHaveLength(0);

  const restored = await page.evaluate(async (payload) => {
    const handle = (globalThis as {
      __rotation?: {
        backup: () => Promise<{ importBackup: (i: unknown) => Promise<unknown> }>;
      };
    }).__rotation;
    if (!handle) throw new Error('debug handle missing');
    await (await handle.backup()).importBackup(payload);
    return true;
  }, json);
  expect(restored).toBe(true);

  const after = {
    profile: await readStore(page, 'profile'),
    maxes: await readStore(page, 'maxes'),
    scheduled: await readStore(page, 'scheduled'),
    setLogs: await readStore(page, 'setLogs'),
    esdLogs: await readStore(page, 'esdLogs'),
    tests: await readStore(page, 'tests'),
  };

  const sortById = <T extends Record<string, unknown>>(rows: T[]): T[] =>
    [...rows].sort((a, b) => String(a['id']).localeCompare(String(b['id'])));

  expect(sortById(after.maxes)).toEqual(sortById(before.maxes));
  expect(sortById(after.scheduled)).toEqual(sortById(before.scheduled));
  expect(sortById(after.setLogs)).toEqual(sortById(before.setLogs));
  expect(sortById(after.esdLogs)).toEqual(sortById(before.esdLogs));
  expect(sortById(after.tests)).toEqual(sortById(before.tests));
  // lastExport legitimately moves when the export ran; everything else matches.
  expect({ ...after.profile[0], lastExport: null })
    .toEqual({ ...before.profile[0], lastExport: null });
});
