import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const card = (page: Page) => page.locator('habit-scorecard');

test('app renders the demo scorecard', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Habits', level: 1 })).toBeVisible();
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
    if (view === 'Week') {
      // The week fits without the table scrolling either, and names break only between words.
      const scroll = card(page).locator('.scroll');
      expect(await scroll.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      const name = card(page).getByRole('rowheader', { name: /Meditate/ });
      expect(await name.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(60);
    }
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

test('creates a hand-ticked habit, ticks today, and keeps it after a reload', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('navigation').getByRole('button', { name: 'Habits' }).click();
  await page.getByRole('button', { name: 'New habit' }).click();
  await page.getByLabel('Name').fill('Stretch');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved Stretch.' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('navigation').getByRole('button', { name: 'Scorecard' }).click();
  const todayCell = card(page)
    .getByRole('row', { name: /Stretch/ })
    .getByRole('button', { pressed: false })
    .last();
  await todayCell.click();
  await expect(
    card(page)
      .getByRole('row', { name: /Stretch/ })
      .getByRole('button', { pressed: true }),
  ).toHaveCount(1);

  await page.reload();
  await expect(
    card(page)
      .getByRole('row', { name: /Stretch/ })
      .getByRole('button', { pressed: true }),
  ).toHaveCount(1);
  await expect(card(page).getByRole('row', { name: /Stretch/ })).toContainText(/1 of [1-7]/); // started today: target is the days left this week
});

test('habit form has no accessibility violations', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('navigation').getByRole('button', { name: 'Habits' }).click();
  await page.getByRole('button', { name: 'Edit Listen 20m' }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Listen 20m');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('connects an app and shows its token once, accessibly', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./');
  await page.getByRole('navigation').getByRole('button', { name: 'Sources' }).click();
  await page.getByRole('button', { name: 'Connect an app' }).click();
  await page.getByRole('button', { name: 'DeckFit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect DeckFit' })).toBeFocused();
  await expect(page.getByLabel('Token')).toHaveValue(/^hab_/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Copy' }).last().click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied the token.' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added Workout.' })).toBeVisible();
  await expect(page.getByText('Waiting for its first report')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
