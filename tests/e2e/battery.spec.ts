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

async function testsTab(page: Page, scenario = 'battery-fresh'): Promise<void> {
  await page.goto(`?scenario=${scenario}`);
  await page.waitForSelector('[data-testid="dashboard"]');
  await page.getByRole('button', { name: 'Tests' }).click();
  await page.waitForSelector('[data-testid="tests"]');
}

/** Bump a stepper `n` times. */
async function bump(page: Page, groupLabel: string, n: number): Promise<void> {
  const plus = page.getByRole('group', { name: groupLabel }).locator('.nstep__btn').last();
  for (let i = 0; i < n; i++) await plus.click();
}

/* ---------- TEST 9 ---------- */

test('9 — bilateral logging writes two records with correct sides', async ({ page }) => {
  await testsTab(page);

  // Grip Strength is bilateral in the shipped definitions.
  await page.locator('[data-test-id="t_grip"] .testrow__head').click();
  await page.locator('[data-test-id="t_grip"] [data-testid="log-result"]').click();
  await expect(page.getByTestId('log-result-sheet')).toBeVisible();

  await bump(page, 'Left value', 4);   // 2.0
  await bump(page, 'Right value', 8);  // 4.0

  // The ratio is shown live, before saving.
  await expect(page.getByTestId('log-ratio')).toContainText('L/R Δ 50%');

  await page.getByTestId('log-save').click();
  await expect(page.getByTestId('log-result-sheet')).toHaveCount(0);

  const rows = (await readStore(page, 'tests')).filter((r) => r['testId'] === 't_grip');
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r['side']).sort()).toEqual(['L', 'R']);
  expect(rows.every((r) => r['unit'] === 's')).toBe(true);

  // And the row now carries its own ratio line.
  await expect(page.locator('[data-test-id="t_grip"] [data-testid="test-ratio"]')).toBeVisible();
});

/* ---------- TEST 10 ---------- */

test('10 — the movement screen is pass/fail, needs a note on fail, has no chart', async ({
  page,
}) => {
  await testsTab(page);

  const row = page.locator('[data-test-id="t_screen"]');
  await row.locator('.testrow__head').click();

  // No chart for a pass/fail test.
  await expect(row.locator('[data-testid="detail-chart"]')).toHaveCount(0);
  await expect(row.getByText('Pass/fail — no trend')).toBeVisible();

  await row.locator('[data-testid="log-result"]').click();
  const sheet = page.getByTestId('log-result-sheet');
  await expect(sheet).toBeVisible();

  // Two options, no numeric field.
  await expect(page.getByTestId('screen-pass')).toBeVisible();
  await expect(page.getByTestId('screen-fail')).toBeVisible();
  await expect(page.getByTestId('log-save')).toBeDisabled();

  // Fail requires a note before saving becomes possible.
  await page.getByTestId('screen-fail').click();
  await expect(page.getByTestId('log-save')).toBeDisabled();
  await page.getByTestId('log-note').fill('Left hip shift under load');
  await expect(page.getByTestId('log-save')).toBeEnabled();

  await page.getByTestId('log-save').click();
  const rows = (await readStore(page, 'tests')).filter(
    (r) => r['testId'] === 't_screen',
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['value']).toBe(0);
  expect(rows[0]?.['note']).toBe('Left hip shift under load');

  // No delta on a pass/fail row.
  await expect(
    page.locator('[data-test-id="t_screen"] [data-testid="test-delta"]'),
  ).toHaveCount(0);
});

/* ---------- TEST 11 ---------- */

test('11 — BATTERY_DUE_FULL renders on the Dashboard with no dismiss control', async ({
  page,
}) => {
  await page.goto('?scenario=battery-due');
  await page.waitForSelector('[data-testid="dashboard"]');

  const warning = page.locator('[data-warning-id="BATTERY_DUE_FULL"]').first();
  await expect(warning).toBeVisible();
  await expect(warning).toHaveAttribute('data-severity', 'alert');
  // Non-dismissible, like LEDGER_FLOOR.
  await expect(warning.locator('.warning__dismiss')).toHaveCount(0);
  await expect(warning).toContainText('Full battery due');
});

/* ---------- TEST 12 ---------- */

test('12 — a full battery run resets both counters and clears the warning', async ({
  page,
}) => {
  await page.goto('?scenario=battery-due');
  await page.waitForSelector('[data-testid="dashboard"]');
  await expect(page.locator('[data-warning-id="BATTERY_DUE_FULL"]').first()).toBeVisible();

  await page.getByRole('button', { name: 'Tests' }).click();
  await page.waitForSelector('[data-testid="tests"]');

  // Counters start past threshold.
  await expect(page.getByTestId('cadence-training')).toHaveAttribute('data-due', 'true');
  await expect(page.getByTestId('cadence-calendar')).toHaveAttribute('data-due', 'true');

  // Run the battery, skipping every test — a completed RUN is what resets.
  await page.getByTestId('log-full-battery').click();
  await expect(page.getByTestId('log-result-sheet')).toBeVisible();
  for (let i = 0; i < 40; i++) {
    if (!(await page.getByTestId('battery-skip').count())) break;
    await page.getByTestId('battery-skip').click();
  }
  await expect(page.getByTestId('log-result-sheet')).toHaveCount(0);

  // Marker written, counters reset.
  const markers = (await readStore(page, 'tests')).filter(
    (r) => r['testId'] === 'test.battery-full-complete',
  );
  expect(markers.length).toBeGreaterThan(0);

  await expect(page.getByTestId('cadence-training')).not.toHaveAttribute('data-due', 'true');
  await expect(page.getByTestId('cadence-calendar')).not.toHaveAttribute('data-due', 'true');

  // Warning gone from the Dashboard.
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.waitForSelector('[data-testid="dashboard"]');
  await expect(page.locator('[data-warning-id="BATTERY_DUE_FULL"]')).toHaveCount(0);
});

test('12b — logging one test individually does NOT reset the counters', async ({ page }) => {
  await page.goto('?scenario=battery-due');
  await page.waitForSelector('[data-testid="dashboard"]');
  await page.getByRole('button', { name: 'Tests' }).click();
  await page.waitForSelector('[data-testid="tests"]');

  await page.locator('[data-test-id="t_neck"] .testrow__head').click();
  await page.locator('[data-test-id="t_neck"] [data-testid="log-result"]').click();
  await bump(page, 'Value', 4);
  await page.getByTestId('log-save').click();
  await expect(page.getByTestId('log-result-sheet')).toHaveCount(0);

  // Still due — an individual log is not a battery run.
  await expect(page.getByTestId('cadence-training')).toHaveAttribute('data-due', 'true');
  const markers = (await readStore(page, 'tests')).filter(
    (r) => r['testId'] === 'test.battery-full-complete',
  );
  expect(markers).toHaveLength(0);
});

/* ---------- TEST 13 (load-bearing): the product boundary ---------- */

test('13 — a progression-gate FAIL blocks nothing', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  await testsTab(page);

  // Fail the movement screen.
  await page.locator('[data-test-id="t_screen"] .testrow__head').click();
  await page.locator('[data-test-id="t_screen"] [data-testid="log-result"]').click();
  await page.getByTestId('screen-fail').click();
  await page.getByTestId('log-note').fill('failed');
  await page.getByTestId('log-save').click();

  const gate = page.getByTestId('progression-gate');
  await expect(gate).toHaveAttribute('data-status', 'fail-screen');
  await expect(gate).toContainText('FAIL — MOVEMENT SCREEN');

  // It asked nothing.
  expect(dialogs).toEqual([]);

  // Block advancement is untouched: the block field is still freely editable
  // and a session still schedules normally.
  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.locator('.segmented__btn[data-view="day"]').click();
  await page.getByTestId('day-schedule').click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();

  const blockField = page.locator('.field__input').first();
  await expect(blockField).toBeEditable();
  await blockField.fill('b4');

  await page.getByTestId('schedule-confirm').click();
  if (await page.getByTestId('schedule-anyway').count()) {
    await page.getByTestId('schedule-anyway').click();
  }
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);

  // The session saved with the advanced block, gate failure notwithstanding.
  const sessions = await readStore(page, 'scheduled');
  expect(sessions.some((s) => s['blockId'] === 'b4')).toBe(true);
  expect(dialogs).toEqual([]);
});

/* ---------- TEST 14 ---------- */

test('14 — battery CSV export produces one row per result with side and unit', async ({
  page,
}) => {
  await testsTab(page);

  // Log a bilateral test (two records) and a unilateral one.
  await page.locator('[data-test-id="t_grip"] .testrow__head').click();
  await page.locator('[data-test-id="t_grip"] [data-testid="log-result"]').click();
  await bump(page, 'Left value', 4);
  await bump(page, 'Right value', 4);
  await page.getByTestId('log-save').click();
  await expect(page.getByTestId('log-result-sheet')).toHaveCount(0);

  await page.locator('[data-test-id="t_neck"] .testrow__head').click();
  await page.locator('[data-test-id="t_neck"] [data-testid="log-result"]').click();
  await bump(page, 'Value', 4);
  await page.getByTestId('log-save').click();
  await expect(page.getByTestId('log-result-sheet')).toHaveCount(0);

  // Generate the CSV through the same module the button uses.
  // Go through the app's own module handle rather than a raw path, so this
  // exercises the same code the export button calls.
  const csv = await page.evaluate(async () => {
    const handle = (globalThis as {
      __rotation?: { backup: () => Promise<{ exportBatteryCsv: () => Promise<string> }> };
    }).__rotation;
    if (!handle) throw new Error('debug handle missing');
    return (await handle.backup()).exportBatteryCsv();
  });

  const lines = csv.trim().split('\r\n');
  expect(lines[0]).toBe('localDate,testId,testName,battery,side,value,unit,note,ts');

  const dataRows = lines.slice(1);
  const stored = (await readStore(page, 'tests')).length;
  expect(dataRows).toHaveLength(stored);

  // Sides and units are present and real.
  expect(csv).toContain(',L,');
  expect(csv).toContain(',R,');
  expect(csv).toContain(',s,');
  expect(csv).toContain('Grip - Thick-Bar Hold');
});

/* ---------- charts ---------- */

test('charts — degrade correctly on sparse data', async ({ page }) => {
  await testsTab(page);

  const row = page.locator('[data-test-id="t_neck"]');
  await row.locator('.testrow__head').click();

  // 0 results: no chart element at all.
  await expect(row.getByTestId('chart-empty')).toBeVisible();
  await expect(row.getByTestId('detail-chart')).toHaveCount(0);

  // 1 result: value only, still no chart.
  await row.locator('[data-testid="log-result"]').click();
  await bump(page, 'Value', 4);
  await page.getByTestId('log-save').click();
  // The row stays expanded after saving — no need to re-open it.
  await expect(row.getByTestId('chart-single')).toBeVisible();
  await expect(row.getByTestId('detail-chart')).toHaveCount(0);

  // 2 results: a line, but no axis labels.
  await row.locator('[data-testid="log-result"]').click();
  await page.locator('.field__input[type="date"]').fill('2026-01-01');
  await bump(page, 'Value', 6);
  await page.getByTestId('log-save').click();
  await expect(row.getByTestId('detail-chart')).toHaveAttribute('data-tier', 'sparse');
  await expect(row.getByTestId('chart-axes')).toHaveCount(0);
});

test('charts — the sparkline is inline SVG, not a library canvas', async ({ page }) => {
  await testsTab(page);

  await page.locator('[data-test-id="t_neck"] .testrow__head').click();
  for (const [i, d] of ['2026-01-01', '2026-02-01'].entries()) {
    await page.locator('[data-test-id="t_neck"] [data-testid="log-result"]').click();
    await page.locator('.field__input[type="date"]').fill(d);
    await bump(page, 'Value', 4 + i * 2);
    await page.getByTestId('log-save').click();
    await expect(page.getByTestId('log-result-sheet')).toHaveCount(0);
  }

  const spark = page.locator('[data-test-id="t_neck"] [data-testid="sparkline"]').first();
  await expect(spark).toHaveCount(1);
  expect(await spark.evaluate((el) => el.tagName.toLowerCase())).toBe('svg');
  await expect(page.locator('canvas')).toHaveCount(0);
});
