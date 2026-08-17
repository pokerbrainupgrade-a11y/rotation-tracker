import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function boot(page: Page, scenario: string): Promise<void> {
  await page.goto(`?scenario=${scenario}`);
  await page.waitForSelector(
    '[data-testid="dashboard"], [data-testid="resume-sheet"], [data-testid="setup"]',
  );
}

/** Read straight from IndexedDB — the UI is not the source of truth here. */
async function setLogs(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('rotationTracker');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows: Array<Record<string, unknown>> = await new Promise((res) => {
      const rq = db.transaction('setLogs').objectStore('setLogs').getAll();
      rq.onsuccess = () => res(rq.result as never);
    });
    db.close();
    return rows;
  });
}

async function sessions(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('rotationTracker');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows: Array<Record<string, unknown>> = await new Promise((res) => {
      const rq = db.transaction('scheduled').objectStore('scheduled').getAll();
      rq.onsuccess = () => res(rq.result as never);
    });
    db.close();
    return rows;
  });
}

/** Start the seeded session from the Calendar day view. */
async function startSession(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.waitForSelector('[data-testid="calendar"]');
  await page.locator('.segmented__btn[data-view="day"]').click();
  await page.getByTestId('start-session').click();
  await page.waitForSelector('[data-testid="session"]');
}

/* ---------- TEST 5 ---------- */

test('5 — a completed set is in IndexedDB before the UI advances', async ({ page }) => {
  await boot(page, 'session-ready');
  await startSession(page);

  expect(await setLogs(page)).toHaveLength(0);

  const row = page.locator('[data-testid="set-row"]').first();
  await row.getByTestId('set-complete').click();

  // The row shows as done only after the write resolved, so by the time this
  // assertion can pass, the record must already exist.
  await expect(row).toHaveAttribute('data-done', 'true');
  const logs = await setLogs(page);
  expect(logs.length).toBeGreaterThan(0);
  expect(logs[0]?.['completed']).toBe(true);
});

/* ---------- TEST 13 ---------- */

test('13 — a bilateral exercise writes separate L and R records', async ({ page }) => {
  await boot(page, 'session-ready');
  await startSession(page);

  // ex_sidetoss is the perSide exercise in the seeded TD1.
  const card = page.locator('[data-exercise-id="ex_sidetoss"]');
  await expect(card).toBeVisible();
  await card.locator('[data-testid="set-row"]').first().getByTestId('set-complete').click();

  await expect(async () => {
    const logs = (await setLogs(page)).filter((l) => l['exerciseId'] === 'ex_sidetoss');
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l['side']).sort()).toEqual(['L', 'R']);
  }).toPass();
});

test('13b — a bilateral row renders both sides, never one shared field', async ({ page }) => {
  await boot(page, 'session-ready');
  await startSession(page);

  const row = page
    .locator('[data-exercise-id="ex_sidetoss"] [data-testid="set-row"]')
    .first();
  await expect(row.locator('[data-side="L"]')).toHaveCount(1);
  await expect(row.locator('[data-side="R"]')).toHaveCount(1);
});

/* ---------- TEST 10 / 11: undo ---------- */

test('10 — undo removes the most recent set and cancels the timer', async ({ page }) => {
  await boot(page, 'session-ready');
  await startSession(page);

  const row = page.locator('[data-testid="set-row"]').first();
  await row.getByTestId('set-complete').click();
  await expect(row).toHaveAttribute('data-done', 'true');
  await expect(page.getByTestId('rest-bar')).toBeVisible();

  const before = (await setLogs(page)).length;
  expect(before).toBeGreaterThan(0);

  await page.getByTestId('undo-chip').click();

  await expect(row).toHaveAttribute('data-done', 'false');
  await expect(page.getByTestId('rest-bar')).toHaveCount(0);
  expect(await setLogs(page)).toHaveLength(0);
});

test('11 — the undo chip expires after 8s and no longer acts', async ({ page }) => {
  await boot(page, 'session-ready');
  await startSession(page);

  await page.locator('[data-testid="set-row"]').first().getByTestId('set-complete').click();
  await expect(page.getByTestId('undo-chip')).toBeVisible();

  const logged = (await setLogs(page)).length;
  expect(logged).toBeGreaterThan(0);

  // Gone after the TTL, and the set stays logged.
  await expect(page.getByTestId('undo-chip')).toHaveCount(0, { timeout: 12_000 });
  expect(await setLogs(page)).toHaveLength(logged);
});

/* ---------- TEST 12 ---------- */

test('12 — Pillar Prep renders no skip control', async ({ page }) => {
  await boot(page, 'session-ready');
  await startSession(page);

  const pillar = page.locator('[data-section="pillar-prep"]');
  await expect(pillar).toBeVisible();

  // It can be left unchecked, but nothing offers to dismiss it.
  await expect(pillar.getByText(/skip/i)).toHaveCount(0);
  await expect(pillar.locator('button[data-testid*="skip"]')).toHaveCount(0);
  await expect(pillar.locator('[data-testid="check-row"]').first()).toBeVisible();
});

test('12b — checklist toggles persist to IndexedDB', async ({ page }) => {
  await boot(page, 'session-ready');
  await startSession(page);

  await page.locator('[data-section="pillar-prep"] [data-testid="check-row"]').first().click();

  await expect(async () => {
    const rows = await sessions(page);
    expect((rows[0]?.['checklist'] as string[]).length).toBe(1);
  }).toPass();
});

/* ---------- TEST 6 / 7: resume ---------- */

test('6 — reloading mid-session offers resume with the right set count', async ({ page }) => {
  await boot(page, 'session-midway');

  const sheet = page.getByTestId('resume-sheet');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('resume-summary')).toContainText('6 sets logged');

  // Under 12h: no MARK COMPLETE on this path.
  await expect(page.getByTestId('mark-complete-btn')).toHaveCount(0);
});

test('6b — a stale session offers MARK COMPLETE as well', async ({ page }) => {
  await boot(page, 'session-stale');

  await expect(page.getByTestId('resume-sheet')).toBeVisible();
  await expect(page.getByTestId('mark-complete-btn')).toBeVisible();
  await expect(page.getByTestId('discard-btn')).toBeVisible();
});

test('7 — RESUME reopens the runner with logged sets intact', async ({ page }) => {
  await boot(page, 'session-midway');
  await page.getByTestId('resume-btn').click();

  await expect(page.getByTestId('session')).toBeVisible();
  // The six seeded sets are still there and render as done.
  expect(await setLogs(page)).toHaveLength(6);
  await expect(page.locator('[data-testid="set-row"][data-done="true"]').first()).toBeVisible();
});

test('7b — a rest timer with time left is restored on resume', async ({ page }) => {
  await boot(page, 'session-midway');
  await page.getByTestId('resume-btn').click();
  await expect(page.getByTestId('session')).toBeVisible();

  // Pick a row that is NOT already logged: the seeded session has its first
  // few sets done, and tapping a done row reopens it rather than completing.
  await page
    .locator('[data-testid="set-row"][data-done="false"]')
    .first()
    .getByTestId('set-complete')
    .click();
  await expect(page.getByTestId('rest-bar')).toBeVisible();
  const before = toSeconds(await page.getByTestId('rest-remaining').textContent());
  expect(before).toBeGreaterThan(80); // a fresh 1:30 rest

  // Let real time pass so a restarted-from-scratch timer is distinguishable
  // from one resumed against the persisted start epoch.
  await page.waitForTimeout(3000);

  // Navigate WITHOUT the scenario param: reloading with it re-runs the seeder,
  // which would wipe the very state this test is checking survived.
  await page.goto('./');
  await page.waitForSelector('[data-testid="resume-sheet"]');
  await page.getByTestId('resume-btn').click();
  await expect(page.getByTestId('session')).toBeVisible();

  // Restored, and counting from the PERSISTED START rather than from scratch:
  // a timer that reset on reload would read ~3:00 again.
  await expect(page.getByTestId('rest-bar')).toBeVisible();
  const after = toSeconds(await page.getByTestId('rest-remaining').textContent());
  expect(after).toBeLessThan(before - 1);
  expect(after).toBeGreaterThan(0);
});

function toSeconds(label: string | null): number {
  const [m, s] = (label ?? '0:00').split(':').map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
}

/* ---------- TEST 8 ---------- */

test('8 — DISCARD names the correct set count and removes exactly those logs', async ({ page }) => {
  await boot(page, 'session-midway');

  await page.getByTestId('discard-btn').click();
  await expect(page.getByTestId('discard-summary')).toContainText('6 sets');

  await page.getByTestId('discard-confirm-btn').click();
  await expect(page.getByTestId('resume-sheet')).toHaveCount(0);

  expect(await setLogs(page)).toHaveLength(0);
  const rows = await sessions(page);
  expect(rows[0]?.['startedAt']).toBeNull();
  expect(rows[0]?.['status']).toBe('planned');
});

/* ---------- TEST 9 ---------- */

test('9 — MARK COMPLETE sets done and preserves the partial logs', async ({ page }) => {
  await boot(page, 'session-stale');

  await page.getByTestId('mark-complete-btn').click();
  await expect(page.getByTestId('resume-sheet')).toHaveCount(0);

  // Partial work is kept: the ledger judges it on merit, which may correctly
  // mean it does not count as a TD1.
  expect(await setLogs(page)).toHaveLength(6);
  const rows = await sessions(page);
  expect(rows[0]?.['status']).toBe('done');
  expect(rows[0]?.['completedAt']).not.toBeNull();
});

/* ---------- runner surface ---------- */

test('runner — intent and termination rule are always visible, not behind a tap', async ({
  page,
}) => {
  await boot(page, 'session-ready');
  await startSession(page);

  const card = page.locator('[data-testid="exercise-card"]').first();
  await expect(card.locator('.exercise__intent')).toBeVisible();
  await expect(card.locator('.exercise__termination')).toBeVisible();
  await expect(card.locator('.exercise__termination')).toContainText('⚠');
});

test('runner — the Exos sequence renders in fixed order', async ({ page }) => {
  await boot(page, 'session-ready');
  await startSession(page);

  const order = await page.locator('.exos').evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).dataset['section']),
  );
  expect(order[0]).toBe('pillar-prep');
  expect(order[1]).toBe('movement-prep');
  expect(order.indexOf('power')).toBeGreaterThan(order.indexOf('movement-prep'));
});

test('runner — set rows and steppers meet the 56px minimum', async ({ page }) => {
  await boot(page, 'session-ready');
  await startSession(page);

  const row = page.locator('[data-testid="set-row"]').first();
  const rowBox = await row.boundingBox();
  expect(rowBox?.height).toBeGreaterThanOrEqual(56);

  const stepper = row.locator('.nstep__btn').first();
  const stepBox = await stepper.boundingBox();
  expect(stepBox?.height).toBeGreaterThanOrEqual(56);
  expect(stepBox?.width).toBeGreaterThanOrEqual(56);
});

test('runner — adjusting a stepper does not complete the set', async ({ page }) => {
  await boot(page, 'session-ready');
  await startSession(page);

  const row = page.locator('[data-testid="set-row"]').first();
  await row.locator('.nstep__btn').last().click(); // "+" on load

  await expect(row).toHaveAttribute('data-done', 'false');
  expect(await setLogs(page)).toHaveLength(0);
});

test('runner — rest timer exposes +30s, −30s and skip', async ({ page }) => {
  await boot(page, 'session-ready');
  await startSession(page);

  await page.locator('[data-testid="set-row"]').first().getByTestId('set-complete').click();
  const bar = page.getByTestId('rest-bar');
  await expect(bar).toBeVisible();

  await expect(bar.getByText('+30s')).toBeVisible();
  await expect(bar.getByText('−30s')).toBeVisible();
  await page.getByTestId('rest-skip').click();
  await expect(page.getByTestId('rest-bar')).toHaveCount(0);
});
