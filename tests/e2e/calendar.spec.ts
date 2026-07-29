import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Boot into a scenario, then open the Calendar tab. */
async function calendar(page: Page, scenario: string): Promise<void> {
  await page.goto(`?scenario=${scenario}`);
  await page.waitForSelector('[data-testid="dashboard"], [data-testid="setup"]');
  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.waitForSelector('[data-testid="calendar"]');
}

const view = async (page: Page, mode: 'month' | 'week' | 'day'): Promise<void> => {
  await page.locator(`.segmented__btn[data-view="${mode}"]`).click();
  await page.waitForSelector(`[data-testid="${mode}-view"]`);
};

/** Every scheduled session currently in IndexedDB, sorted by date. */
async function readSchedule(page: Page): Promise<Array<{ id: string; localDate: string; status: string }>> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('rotationTracker');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows: Array<{ id: string; localDate: string; status: string }> = await new Promise((res) => {
      const rq = db.transaction('scheduled').objectStore('scheduled').getAll();
      rq.onsuccess = () => res(rq.result as never);
    });
    db.close();
    return rows.sort((a, b) => (a.localDate < b.localDate ? -1 : 1));
  });
}

async function counts(page: Page): Promise<{ setLogs: number; esdLogs: number }> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('rotationTracker');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const count = (store: string): Promise<number> =>
      new Promise((res) => {
        const rq = db.transaction(store).objectStore(store).count();
        rq.onsuccess = () => res(rq.result);
      });
    const out = { setLogs: await count('setLogs'), esdLogs: await count('esdLogs') };
    db.close();
    return out;
  });
}

/* ---------- TEST 4 ---------- */

test('4 — the suggested position matches nextPosition()', async ({ page }) => {
  await calendar(page, 'calendar-empty');
  await view(page, 'day');

  await page.getByTestId('day-schedule').click();
  const sheet = page.getByTestId('schedule-sheet');
  await expect(sheet).toBeVisible();

  // Empty history under 3:1 -> the engine's answer is TD1.
  await expect(page.getByTestId('suggested')).toHaveAttribute('data-position', 'TD1');

  await page.getByTestId('schedule-confirm').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);

  const rows = await readSchedule(page);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe('planned');
});

/* ---------- TEST 5 ---------- */

test('5 — TD1 not following an RD warns, and Schedule Anyway saves it', async ({ page }) => {
  await calendar(page, 'calendar-empty');
  await view(page, 'day');

  // Put a TD3 on today so a TD1 tomorrow is a genuine ordering violation.
  await page.getByTestId('day-schedule').click();
  await page.locator('.sheet__disclosure').click();
  await page.locator('.positions__btn[data-position="TD3"]').click();
  await page.getByTestId('schedule-confirm').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);

  // Now TD1 the next day.
  await page.locator('.day__chev[aria-label="Next day"]').click();
  await page.getByTestId('day-schedule').click();
  await page.locator('.sheet__disclosure').click();
  await page.locator('.positions__btn[data-position="TD1"]').click();
  await page.getByTestId('schedule-confirm').click();

  const review = page.getByTestId('warning-review');
  await expect(review).toBeVisible();
  await expect(review.locator('[data-warning-id="TD1_NOT_OFF_RD"]')).toBeVisible();
  // The rationale is present, not just the verdict.
  await expect(review.locator('.review__rationale').first()).toBeVisible();

  await page.getByTestId('schedule-anyway').click();
  await expect(page.getByTestId('warning-review')).toHaveCount(0);

  const rows = await readSchedule(page);
  expect(rows).toHaveLength(2);
});

/* ---------- TEST 6 (load-bearing) ---------- */

test('6 — no warning path blocks a save, across every position', async ({ page }) => {
  await calendar(page, 'calendar-empty');
  await view(page, 'day');

  const positions = ['TD1', 'TD2', 'TD3', 'TD-A', 'TD-B-STR', 'TD-B-ESD', 'RD'];

  for (const position of positions) {
    await page.getByTestId('day-schedule').click();
    await page.locator('.sheet__disclosure').click();
    await page.locator(`.positions__btn[data-position="${position}"]`).click();
    await page.getByTestId('schedule-confirm').click();

    // Either it saved directly, or a review appeared and Schedule Anyway saves.
    if (await page.getByTestId('warning-review').count()) {
      // There is no third option and no blocked path.
      await expect(page.getByTestId('schedule-anyway')).toBeEnabled();
      await page.getByTestId('schedule-anyway').click();
    }
    await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
    await expect(page.getByTestId('warning-review')).toHaveCount(0);

    await page.locator('.day__chev[aria-label="Next day"]').click();
  }

  // Every one of the seven saved.
  const rows = await readSchedule(page);
  expect(rows).toHaveLength(positions.length);
});

/* ---------- TEST 7 ---------- */

test('7 — scheduled violations persist as Dashboard warnings after save', async ({ page }) => {
  await calendar(page, 'calendar-empty');
  await view(page, 'day');

  await page.getByTestId('day-schedule').click();
  await page.locator('.sheet__disclosure').click();
  await page.locator('.positions__btn[data-position="TD3"]').click();
  await page.getByTestId('schedule-confirm').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);

  await page.locator('.day__chev[aria-label="Next day"]').click();
  await page.getByTestId('day-schedule').click();
  await page.locator('.sheet__disclosure').click();
  await page.locator('.positions__btn[data-position="TD1"]').click();
  await page.getByTestId('schedule-confirm').click();
  await page.getByTestId('schedule-anyway').click();
  await expect(page.getByTestId('warning-review')).toHaveCount(0);

  // The violation must survive the sheet closing.
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.waitForSelector('[data-testid="dashboard"]');

  const list = page.getByTestId('warning-list');
  await expect(list).toBeVisible();
  await expect(list.locator('[data-warning-id="TD1_NOT_OFF_RD"]')).toBeVisible();
});

/* ---------- TEST 8 (load-bearing) ---------- */

test('8 — defer by 2 shifts every forward session, preserving spacing', async ({ page }) => {
  await calendar(page, 'calendar');

  const before = await readSchedule(page);
  const planned = before.filter((s) => s.status === 'planned').map((s) => s.localDate);
  expect(planned.length).toBeGreaterThan(1);

  const gapsBefore = planned.slice(1).map((d, i) => dayGap(planned[i] as string, d));

  await view(page, 'day');
  // Navigate to the first planned session (tomorrow in the seeded scenario).
  await page.locator('.day__chev[aria-label="Next day"]').click();
  await expect(page.getByTestId('day-session')).toBeVisible();

  await page.getByTestId('defer-open').click();
  await expect(page.getByTestId('defer-sheet')).toBeVisible();
  await page.getByRole('button', { name: 'Increase' }).click(); // 1 -> 2
  await expect(page.getByTestId('stepper-value')).toHaveText('2');
  await page.getByTestId('defer-confirm').click();
  await expect(page.getByTestId('defer-sheet')).toHaveCount(0);

  const after = await readSchedule(page);
  const plannedAfter = after.filter((s) => s.status === 'planned').map((s) => s.localDate);

  // Every forward session moved by exactly 2 days.
  expect(plannedAfter).toHaveLength(planned.length);
  plannedAfter.forEach((d, i) => {
    expect(dayGap(planned[i] as string, d)).toBe(2);
  });

  // Spacing preserved.
  const gapsAfter = plannedAfter.slice(1).map((d, i) => dayGap(plannedAfter[i] as string, d));
  expect(gapsAfter).toEqual(gapsBefore);

  // Nothing doubled onto one date.
  expect(new Set(after.map((s) => s.localDate)).size).toBe(after.length);

  // The past session did not move.
  const pastBefore = before.filter((s) => s.status === 'done').map((s) => s.localDate);
  const pastAfter = after.filter((s) => s.status === 'done').map((s) => s.localDate);
  expect(pastAfter).toEqual(pastBefore);
});

function dayGap(a: string, b: string): number {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  const da = new Date(pa[0] ?? 0, (pa[1] ?? 1) - 1, pa[2] ?? 1);
  const db = new Date(pb[0] ?? 0, (pb[1] ?? 1) - 1, pb[2] ?? 1);
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/* ---------- TEST 9 ---------- */

test('9 — the defer preview count matches what actually moves', async ({ page }) => {
  await calendar(page, 'calendar');
  await view(page, 'day');
  await page.locator('.day__chev[aria-label="Next day"]').click();
  await expect(page.getByTestId('day-session')).toBeVisible();

  await page.getByTestId('defer-open').click();
  const previewed = Number(await page.getByTestId('defer-count').textContent());
  expect(previewed).toBeGreaterThan(0);

  const before = await readSchedule(page);
  await page.getByTestId('defer-confirm').click();
  await expect(page.getByTestId('defer-sheet')).toHaveCount(0);
  const after = await readSchedule(page);

  const movedCount = after.filter((a) => {
    const b = before.find((x) => x.id === a.id);
    return b && b.localDate !== a.localDate;
  }).length;

  expect(movedCount).toBe(previewed);
});

test('9b — the preview updates live with the stepper', async ({ page }) => {
  await calendar(page, 'calendar');
  await view(page, 'day');
  await page.locator('.day__chev[aria-label="Next day"]').click();
  await page.getByTestId('defer-open').click();

  await expect(page.getByTestId('defer-preview')).toContainText('1 day');
  await page.getByRole('button', { name: 'Increase' }).click();
  await expect(page.getByTestId('defer-preview')).toContainText('2 days');
});

/* ---------- TEST 10 ---------- */

test('10 — delete cascades to sets and ESD logs with no orphans', async ({ page }) => {
  await calendar(page, 'calendar');

  const startCounts = await counts(page);
  expect(startCounts.setLogs).toBeGreaterThan(0);
  expect(startCounts.esdLogs).toBeGreaterThan(0);

  await view(page, 'day');
  // The seeded past session with logs is two days back.
  await page.locator('.day__chev[aria-label="Previous day"]').click();
  await page.locator('.day__chev[aria-label="Previous day"]').click();
  await expect(page.getByTestId('day-session')).toBeVisible();

  await page.getByTestId('delete-open').click();
  await expect(page.getByTestId('delete-sheet')).toBeVisible();

  // The confirmation names real counts, not an estimate.
  await expect(page.getByTestId('delete-summary')).toContainText(
    `${startCounts.setLogs} logged sets`,
  );

  await page.getByTestId('delete-confirm').click();
  await expect(page.getByTestId('delete-sheet')).toHaveCount(0);

  const endCounts = await counts(page);
  expect(endCounts.setLogs).toBe(0);
  expect(endCounts.esdLogs).toBe(0);
});

/* ---------- TEST 11 ---------- */

const WARNING_SCENARIOS: Array<[string, string]> = [
  ['warn-td1-not-off-rd', 'TD1_NOT_OFF_RD'],
  ['warn-double-maxintent', 'DOUBLE_MAXINTENT'],
  ['warn-esd-after-rd', 'ESD_AFTER_RD'],
  ['warn-vo2-adjacent', 'VO2_ADJACENT'],
  ['warn-cns-ascent', 'CNS_ASCENT'],
  ['warn-gap-4d', 'GAP_4D'],
  ['warn-ledger-floor', 'LEDGER_FLOOR'],
];

for (const [scenario, id] of WARNING_SCENARIOS) {
  test(`11 — ${id} renders from the seeder`, async ({ page }) => {
    await page.goto(`?scenario=${scenario}`);
    await page.waitForSelector('[data-testid="dashboard"]');

    const item = page.locator(`[data-warning-id="${id}"]`).first();
    await expect(item).toBeVisible();
    await expect(item.locator('.warning__text')).not.toBeEmpty();

    // LEDGER_FLOOR alone is non-dismissible.
    const dismiss = item.locator('.warning__dismiss');
    if (id === 'LEDGER_FLOOR') {
      await expect(dismiss).toHaveCount(0);
    } else {
      await expect(dismiss).toHaveCount(1);
    }
  });
}

/* ---------- views ---------- */

test('views — segmented control persists the last-used view', async ({ page }) => {
  await calendar(page, 'calendar');
  await view(page, 'month');

  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.getByRole('button', { name: 'Calendar' }).click();
  await expect(page.getByTestId('month-view')).toBeVisible();
});

test('views — month grid does not distinguish weekends', async ({ page }) => {
  await calendar(page, 'calendar');
  await view(page, 'month');

  const cells = page.locator('.month__cell:not(.month__cell--blank)');
  const n = await cells.count();
  const backgrounds = new Set<string>();
  for (let i = 0; i < Math.min(n, 14); i++) {
    backgrounds.add(
      await cells.nth(i).evaluate((el) => getComputedStyle(el).backgroundColor),
    );
  }
  // Every day cell shares one background: no weekend shading.
  expect(backgrounds.size).toBe(1);
});

test('views — density strip renders 28 cells with gaps visible', async ({ page }) => {
  await calendar(page, 'calendar');
  await view(page, 'month');

  const strip = page.getByTestId('density-strip');
  await expect(strip).toBeVisible();
  await expect(strip.locator('.strip__cell')).toHaveCount(28);
  expect(await strip.locator('.strip__cell[data-empty="true"]').count()).toBeGreaterThan(0);
});

test('views — week view shows seven rows and empty days are tappable', async ({ page }) => {
  await calendar(page, 'calendar');
  await view(page, 'week');

  await expect(page.locator('.week__row')).toHaveCount(7);
  const empty = page.locator('.week__empty').first();
  await expect(empty).toBeVisible();
  await empty.click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
});

test('views — tapping a session in week view opens Day view', async ({ page }) => {
  await calendar(page, 'calendar');
  await view(page, 'week');

  const session = page.locator('.week__session').first();
  await session.click();
  await expect(page.getByTestId('day-view')).toBeVisible();
});

test('day — exercise doses render as em-dashes, not invented numbers', async ({ page }) => {
  await calendar(page, 'calendar');
  await view(page, 'day');
  await page.locator('.day__chev[aria-label="Next day"]').click();
  await expect(page.getByTestId('day-session')).toBeVisible();

  const dose = page.locator('.exercise-row__dose').first();
  await expect(dose).toHaveText('—');
});
