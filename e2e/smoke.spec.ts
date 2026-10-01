import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const card = (page: Page) => page.locator('habit-scorecard');

test('app renders the demo scorecard', async ({ page }) => {
  await page.goto('./');
  await expect(card(page).getByRole('heading', { name: 'Habits' })).toBeVisible();
  const table = card(page).getByRole('table');
  await expect(table.getByRole('rowheader')).toHaveCount(5);
  await expect(table.getByRole('rowheader').first()).toContainText('Workout');
  await expect(table.getByRole('columnheader', { name: 'Streak' })).toBeVisible();
});

test('week and month views have no accessibility violations', async ({ page }) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto('./');
    await expect(card(page).getByRole('table')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await card(page).getByRole('button', { name: 'Month', exact: true }).click();
    await card(page).getByRole('button', { name: 'Previous month' }).click();
    await expect(card(page).getByRole('table')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});

test('fits a 360px phone without sideways page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const view of ['Week', 'Month']) {
    await page.goto('./');
    await card(page).getByRole('button', { name: view, exact: true }).click();
    await expect(card(page).getByRole('table')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
  }
});

test('navigates by keyboard', async ({ page }) => {
  await page.goto('./');
  await expect(card(page).getByRole('table')).toBeVisible();
  const range = card(page).locator('#range');
  const before = await range.textContent();
  await card(page).getByRole('button', { name: 'Previous week' }).focus();
  await page.keyboard.press('Enter');
  await expect(range).not.toHaveText(before!);
  await page.keyboard.press('Tab'); // Next week
  await page.keyboard.press('Enter');
  await expect(range).toHaveText(before!);
});

test('iframe entry passes query params through', async ({ page }) => {
  await page.goto('./embed.html?theme=dark&weeks=2');
  await expect(card(page)).toHaveAttribute('theme', 'dark');
  await expect(card(page)).toHaveAttribute('weeks', '2');
  await expect(card(page).getByRole('columnheader')).toHaveCount(1 + 14 + 2);
});

test('embed script works on a foreign page and survives its styles', async ({ page }) => {
  await page.route('**/host.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: readFileSync(new URL('./foreign-host.html', import.meta.url)),
    }),
  );
  await page.goto('/host.html');
  const table = card(page).getByRole('table');
  await expect(table.getByRole('rowheader')).toHaveCount(5);
  // The host's `* { color: red !important }` doesn't reach inside the shadow root.
  const color = await table
    .getByRole('rowheader')
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe('rgb(255, 0, 0)');
});
