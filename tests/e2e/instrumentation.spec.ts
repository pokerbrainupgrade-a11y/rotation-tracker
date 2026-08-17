import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function runner(page: Page, scenario = 'session-ready'): Promise<void> {
  await page.goto(`?scenario=${scenario}`);
  await page.waitForSelector('[data-testid="dashboard"], [data-testid="resume-sheet"]');
  if (await page.getByTestId('resume-btn').count()) {
    await page.getByTestId('resume-btn').click();
  } else {
    await page.getByRole('button', { name: 'Calendar' }).click();
    await page.waitForSelector('[data-testid="calendar"]');
    await page.locator('.segmented__btn[data-view="day"]').click();
    await page.getByTestId('start-session').click();
  }
  await page.waitForSelector('[data-testid="session"]');
}

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

/* ---------- TEST 8 (load-bearing) ---------- */

test('8 — substitution confirm is disabled until the binary is chosen', async ({ page }) => {
  await runner(page);

  await page.locator('[data-exercise-id="ex_sidetoss"] [data-testid="sub-open"]').click();
  const sheet = page.getByTestId('substitution-sheet');
  await expect(sheet).toBeVisible();

  // The tag content renders verbatim from the seed.
  await expect(sheet.getByText('TARGET QUALITY', { exact: true })).toBeVisible();
  await expect(sheet.getByText('DOSING SIGNATURE', { exact: true })).toBeVisible();
  await expect(sheet.getByText('VALID SUBSTITUTION', { exact: true })).toBeVisible();
  await expect(sheet.getByText('INVALID SUBSTITUTION', { exact: true })).toBeVisible();

  await page.getByTestId('log-as-substitute').click();
  const confirm = page.getByTestId('substitution-confirm');

  // No default selection, so no way through yet.
  await expect(page.getByTestId('met-yes')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('met-no')).toHaveAttribute('aria-checked', 'false');
  await expect(confirm).toBeDisabled();

  // There is no third option and no skip path.
  const buttons = await page.getByTestId('substitution-log').locator('button').allInnerTexts();
  expect(buttons.join('|')).not.toMatch(/not sure|skip|later|remind/i);

  await page.getByTestId('met-yes').click();
  await expect(confirm).toBeEnabled();
});

/* ---------- TEST 9 ---------- */

test('9 — met counts toward the ledger; not-met does not', async ({ page }) => {
  await runner(page);

  await page.locator('[data-exercise-id="ex_sidetoss"] [data-testid="sub-open"]').click();
  await page.getByTestId('log-as-substitute').click();
  await page.getByTestId('met-yes').click();
  await page.getByTestId('substitution-confirm').click();
  await expect(page.getByTestId('substitution-log')).toHaveCount(0);

  let sessions = await readStore(page, 'scheduled');
  expect(sessions[0]?.['substituted']).toBe(true);
  expect(sessions[0]?.['metDosingSignature']).toBe(true);

  // Now the other way round.
  await runner(page);
  await page.locator('[data-exercise-id="ex_sidetoss"] [data-testid="sub-open"]').click();
  await page.getByTestId('log-as-substitute').click();
  await page.getByTestId('met-no').click();
  await page.getByTestId('substitution-confirm').click();
  await expect(page.getByTestId('substitution-log')).toHaveCount(0);

  sessions = await readStore(page, 'scheduled');
  expect(sessions[0]?.['substituted']).toBe(true);
  expect(sessions[0]?.['metDosingSignature']).toBe(false);
});

test('9b — a met substitution counts on the Dashboard ledger', async ({ page }) => {
  await runner(page);
  await page.locator('[data-exercise-id="ex_sidetoss"] [data-testid="sub-open"]').click();
  await page.getByTestId('log-as-substitute').click();
  await page.getByTestId('met-yes').click();
  await page.getByTestId('substitution-confirm').click();

  await page.getByTestId('finish-session').click();
  await expect(page.getByTestId('summary-sheet')).toBeVisible();
  await page.getByTestId('summary-done').click();

  // Finishing returns to the route the session was started from (Calendar),
  // so go to the Dashboard explicitly.
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.waitForSelector('[data-testid="dashboard"]');
  const count = await page
    .locator('.ledger-row[data-key="velocityFull"] .ledger-row__count')
    .textContent();
  expect(Number(count)).toBeGreaterThan(0);
});

/* ---------- TEST 10 ---------- */

test('10 — the 4x4 abort writes counted:false and increments the miss count', async ({
  page,
}) => {
  await runner(page, 'session-td3');

  const abort = page.locator('[data-exercise-id="ex_4x4"] [data-testid="esd-abort"]');
  await expect(abort).toBeVisible();
  await abort.click();

  await expect(page.getByTestId('esd-abort-sheet')).toBeVisible();
  await expect(page.getByTestId('esd-abort-note')).toContainText('90% HRmax');
  await page.getByTestId('esd-confirm').click();
  await expect(page.getByTestId('esd-abort-sheet')).toHaveCount(0);

  const esd = await readStore(page, 'esdLogs');
  expect(esd).toHaveLength(1);
  expect(esd[0]?.['type']).toBe('vo2max');
  expect(esd[0]?.['counted']).toBe(false);

  // Finish, then confirm the ledger records it as a MISS, not a count.
  await page.getByTestId('finish-session').click();
  await expect(page.getByTestId('summary-sheet')).toBeVisible();
  await page.getByTestId('summary-done').click();

  // Finishing returns to the route the session was started from (Calendar),
  // so go to the Dashboard explicitly.
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.waitForSelector('[data-testid="dashboard"]');
  const row = page.locator('.ledger-row[data-key="vo2max"]');
  expect(Number(await row.locator('.ledger-row__count').textContent())).toBe(0);
  await expect(row.locator('[data-testid="ledger-hatch"]')).toHaveCount(1);
});

/* ---------- TEST 11 / 12 / 13: compression ---------- */

test('11 — compression 25% on TD1 leaves only the max-intent throw block', async ({ page }) => {
  await runner(page);

  await page.getByTestId('compress-open').click();
  await expect(page.getByTestId('compression-sheet')).toBeVisible();
  // The reasoning is shown at the decision point.
  await expect(page.getByTestId('compression-rule')).not.toBeEmpty();

  await page.getByTestId('compression-25').click();
  await expect(page.getByTestId('compression-sheet')).toHaveCount(0);
  await expect(page.getByTestId('compression-badge')).toHaveText('25%');

  // Only the throw survives; everything else is cut and non-interactive.
  await expect(
    page.locator('[data-exercise-id="ex_sidetoss"]'),
  ).not.toHaveAttribute('data-cut', 'true');
  for (const id of ['ex_stepbehind', 'ex_chopslam', 'ex_trapbar']) {
    await expect(page.locator(`[data-exercise-id="${id}"]`)).toHaveAttribute('data-cut', 'true');
  }

  // Cut cards expose no set rows to tap.
  await expect(
    page.locator('[data-exercise-id="ex_frontsquat"] [data-testid="set-row"]'),
  ).toHaveCount(0);
});

test('12 — compression 25% on TD3 leaves only the 4x4', async ({ page }) => {
  await runner(page, 'session-td3');

  await page.getByTestId('compress-open').click();
  await page.getByTestId('compression-25').click();

  await expect(
    page.locator('[data-exercise-id="ex_4x4"]'),
  ).not.toHaveAttribute('data-cut', 'true');
  await expect(
    page.locator('[data-exercise-id="ex_pogo"]'),
  ).toHaveAttribute('data-cut', 'true');
});

test('13 — changing compression mid-session preserves logged sets', async ({ page }) => {
  await runner(page);

  // Log a couple of sets first.
  await page.locator('[data-exercise-id="ex_stepbehind"] [data-testid="set-complete"]').first().click();
  await page.getByTestId('rest-skip').click();
  await page.locator('[data-exercise-id="ex_trapbar"] [data-testid="set-complete"]').first().click();
  await page.getByTestId('rest-skip').click();

  const before = (await readStore(page, 'setLogs')).length;
  // Three, not two: the step-behind throw is bilateral, so one completed set
  // writes an L and an R record.
  expect(before).toBe(3);

  // Compress hard, then back to full.
  await page.getByTestId('compress-open').click();
  await page.getByTestId('compression-25').click();
  expect((await readStore(page, 'setLogs')).length).toBe(before);

  await page.getByTestId('compress-open').click();
  await page.getByTestId('compression-100').click();
  await expect(page.getByTestId('compression-badge')).toHaveCount(0);

  expect((await readStore(page, 'setLogs')).length).toBe(before);
  // And they still render as done.
  await expect(
    page.locator('[data-exercise-id="ex_trapbar"] [data-testid="set-row"][data-done="true"]'),
  ).toHaveCount(1);
});

/* ---------- TEST 14 ---------- */

test('14 — summary ledger deltas match the Dashboard after finishing', async ({ page }) => {
  await runner(page);

  // Earn velocityFull + velocityPrime by logging the throw block.
  await page.locator('[data-exercise-id="ex_sidetoss"] [data-testid="set-complete"]').first().click();
  await page.getByTestId('rest-skip').click();

  await page.getByTestId('finish-session').click();
  const summary = page.getByTestId('summary-sheet');
  await expect(summary).toBeVisible();

  const deltaKeys = await summary
    .locator('[data-testid="summary-ledger"] .summary__delta')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['key']));

  // No score, no rating, no streak anywhere in the summary.
  const text = (await summary.innerText()).toLowerCase();
  expect(text).not.toMatch(/score|rating|streak|great|nice work|congrat/);

  await page.getByTestId('summary-done').click();
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.waitForSelector('[data-testid="dashboard"]');

  for (const key of deltaKeys.filter(Boolean)) {
    const count = await page
      .locator(`.ledger-row[data-key="${key}"] .ledger-row__count`)
      .textContent();
    expect(Number(count), `${key} should have moved`).toBeGreaterThan(0);
  }
});

/* ---------- TEST 15 (load-bearing): the product boundary ---------- */

test('15 — no instrumentation feature prompts, gates, or blocks', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  await runner(page);

  const beforeSheets = await page.locator('.sheet-root').count();

  // --- decay floor: log a declining sequence, entering the metric ---
  const throwCard = page.locator('[data-exercise-id="ex_sidetoss"]');
  for (let i = 0; i < 3; i++) {
    const row = throwCard.locator('[data-testid="set-row"]').nth(i);
    if (!(await row.count())) break;
    // Nudge the distance stepper so the set records a metric to compare.
    const plus = row.locator('.nstep__btn').last();
    for (let k = 0; k < 3 - i; k++) await plus.click();
    await row.getByTestId('set-complete').click();
    if (await page.getByTestId('rest-skip').count()) {
      await page.getByTestId('rest-skip').click();
    }
  }

  // Floors displayed, nothing asked.
  await expect(throwCard.getByTestId('decay-floor').first()).toBeVisible();
  expect(dialogs, 'decay floor must not prompt').toEqual([]);
  expect(await page.locator('.sheet-root').count()).toBe(beforeSheets);

  // --- volume cap: keep logging past it ---
  const jumpCard = page.locator('[data-exercise-id="ex_stepbehind"]');
  const rows = jumpCard.locator('[data-testid="set-row"]');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    await rows.nth(i).getByTestId('set-complete').click();
    if (await page.getByTestId('rest-skip').count()) {
      await page.getByTestId('rest-skip').click();
    }
  }

  const cap = page.getByTestId('volume-cap').first();
  await expect(cap).toBeVisible();

  // Every logged set landed: the cap never blocked a write.
  const logged = await readStore(page, 'setLogs');
  expect(logged.length).toBeGreaterThanOrEqual(n);

  // --- ratio: bilateral work displays a number, no dialog ---
  const ratio = page.getByTestId('ratio').first();
  if (await ratio.count()) await expect(ratio).toBeVisible();

  // Nothing anywhere asked a question or refused a write.
  expect(dialogs, 'no instrumentation feature may prompt').toEqual([]);
  expect(await page.locator('.sheet-root').count()).toBe(beforeSheets);

  // No control was disabled by instrumentation.
  const disabledCompletes = await page
    .locator('[data-testid="set-complete"][disabled]')
    .count();
  expect(disabledCompletes).toBe(0);
});

test('15b — logging past the volume cap turns it amber but keeps working', async ({ page }) => {
  await runner(page, 'session-at-cap');

  const cap = page.getByTestId('volume-cap').first();
  await expect(cap).toHaveAttribute('data-at-cap', 'true');

  const before = (await readStore(page, 'setLogs')).length;
  const row = page
    .locator('[data-exercise-id="ex_stepbehind"] [data-testid="set-row"][data-done="false"]')
    .first();
  if (await row.count()) {
    await row.getByTestId('set-complete').click();
    expect((await readStore(page, 'setLogs')).length).toBeGreaterThan(before);
  }
});

/* ---------- training mode & prefill ---------- */

test('training mode toggles and persists to the profile', async ({ page }) => {
  await runner(page);

  await page.getByTestId('training-mode').click();
  await expect(page.getByTestId('session')).toHaveAttribute('data-training-mode', 'true');

  await expect(async () => {
    const profiles = await readStore(page, 'profile');
    expect(profiles[0]?.['trainingMode']).toBe(true);
  }).toPass();
});

test('the LAST chip appears only when there is history, and adopts on tap', async ({ page }) => {
  // session-ready has no prior logs for these exercises.
  await runner(page);
  await expect(page.getByTestId('last-chip')).toHaveCount(0);

  // session-midway seeds prior sets for ex_stepbehind.
  await runner(page, 'session-history');
  const chip = page.locator('[data-exercise-id="ex_stepbehind"] [data-testid="last-chip"]').first();
  await expect(chip).toBeVisible();
  await chip.click();
  // Adopting fills the draft rather than logging anything.
  expect((await readStore(page, 'setLogs')).filter(
    (l) => l['scheduledId'] === 'run-1',
  )).toHaveLength(0);
});
