import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const tab = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true });
const card = (page: Page) => page.locator('habit-scorecard');
const axe = async (page: Page, what: string) =>
  expect((await new AxeBuilder({ page }).analyze()).violations, what).toEqual([]);

test('Today shows the greeting, the week, progress and habit cards', async ({ page }) => {
  await page.goto('./');
  await expect(
    page.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)$/ }),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: 'Day' }).getByRole('button')).toHaveCount(7);
  await expect(page.getByRole('heading', { name: 'Up next' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Workout: .*Open progress$/ })).toBeVisible();
  await expect(tab(page, 'Today')).toHaveAttribute('aria-current', 'page');
});

test('every screen fits a 360px phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const fits = async (what: string) =>
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      what,
    ).toBeLessThanOrEqual(360);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Up next' })).toBeVisible();
  await fits('Today');
  await tab(page, 'Progress').click();
  await page.getByRole('button', { name: /^Workout/ }).click();
  await expect(page.getByRole('heading', { name: 'Last 5 weeks' })).toBeVisible();
  await fits('Progress');
  await tab(page, 'New habit').click();
  await expect(page.getByRole('heading', { name: 'New habit' })).toBeVisible();
  await fits('New habit');
  await page.getByRole('button', { name: 'Close' }).click();
  await tab(page, 'Today').click();
  await page.getByRole('button', { name: 'Scorecard: every habit by day' }).click();
  await expect(card(page).getByRole('table')).toBeVisible();
  await fits('Scorecard');
});

test('creates a habit, ticks it off, undoes, and keeps it after a reload', async ({ page }) => {
  await page.goto('./');
  await tab(page, 'New habit').click();
  await page.getByLabel('Name').fill('Stretch');
  await page.getByRole('button', { name: 'coral' }).click();
  await page.getByRole('button', { name: 'Leaf' }).click();
  await axe(page, 'form');
  await page.getByRole('button', { name: 'Save habit' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved Stretch.' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Stretch' })).toBeVisible(); // the hero card

  await tab(page, 'Today').click();
  await page.getByRole('button', { name: 'Mark done: Stretch' }).click();
  await expect(page.getByRole('button', { name: 'Mark not done: Stretch' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Mark done: Stretch' })).toBeVisible();

  await page.getByRole('button', { name: 'Mark done: Stretch' }).click();
  await expect(page.getByRole('button', { name: 'Mark not done: Stretch' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Mark not done: Stretch' })).toBeVisible();
});

test('the scorecard grid: week, month and 12 weeks, by keyboard', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Scorecard: every habit by day' }).click();
  await expect(card(page).getByRole('table').getByRole('rowheader')).toHaveCount(5);
  const range = card(page).locator('#range');
  const before = await range.textContent();
  await card(page).getByRole('button', { name: 'Previous week' }).focus();
  await page.keyboard.press('Enter');
  await expect(range).not.toHaveText(before!);
  await page.keyboard.press('Tab'); // Next week
  await page.keyboard.press('Enter');
  await expect(range).toHaveText(before!);
  for (const view of ['Month', '12 weeks', 'Week']) {
    await card(page).getByRole('button', { name: view, exact: true }).click();
    await expect(card(page).getByRole('button', { name: view, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
});

test('picks which activities count for a habit, in light and dark', async ({ page }) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto('./');
    await tab(page, 'Progress').click();
    await page.getByRole('button', { name: /^Run/ }).click();
    await page.getByRole('button', { name: 'Edit Run' }).click();
    const activities = page.getByRole('group', { name: 'Activities that count' });
    await expect(activities.getByRole('button', { name: 'Run' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await activities.getByRole('button', { name: 'Walk' }).click();
    await expect(activities.getByRole('button', { name: 'Walk' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await axe(page, `${colorScheme} activities`);
  }
});

test('corrects a day from the progress heatmap', async ({ page }) => {
  await page.goto('./');
  await tab(page, 'Progress').click();
  await page.getByRole('button', { name: /^Run/ }).click();
  const missed = page.getByRole('button', { name: /^[A-Z][a-z]{2} \d+: missed$/ }).first();
  const label = (await missed.getAttribute('aria-label'))!.replace(/: missed$/, '');
  await missed.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { level: 2 })).toContainText('Run ·');
  await axe(page, 'dialog');
  await dialog.getByRole('button', { name: 'Mark as done' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Added.');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: `${label}: done` })).toBeFocused();
});

test('connects an app and shows its token once', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./');
  await tab(page, 'Sources').click();
  await page.getByRole('button', { name: 'Connect an app' }).click();
  await page.getByRole('button', { name: 'DeckFit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect DeckFit' })).toBeFocused();
  await expect(page.getByLabel('Token')).toHaveValue(/^hab_/);
  await axe(page, 'connect');
  await page.getByRole('button', { name: 'Copy' }).last().click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied the token.' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added Workout.' })).toBeVisible();
});

test('the theme setting sets <html data-theme> and sticks', async ({ page }) => {
  await page.goto('./');
  await tab(page, 'More').click();
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await tab(page, 'More').click();
  await page.getByRole('button', { name: 'System' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
});

test('wide screens get the dashboard', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1, name: /^[A-Z][a-z]+ \d{4}$/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /^Today: / })).toBeVisible();
  await expect(card(page).getByRole('table')).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Week', exact: true })).toBeHidden();
  await axe(page, 'dashboard');
});

test('every screen has no accessibility violations, in light and dark', async ({ page }) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto('./');
    await expect(page.getByRole('heading', { name: 'Up next' })).toBeVisible();
    await axe(page, `${colorScheme} Today`);
    await tab(page, 'Progress').click();
    await axe(page, `${colorScheme} Progress`);
    await page.getByRole('button', { name: /^Listen 20m/ }).click();
    await expect(page.getByRole('heading', { name: 'Last 5 weeks' })).toBeVisible();
    await axe(page, `${colorScheme} Progress detail`);
    for (const name of ['Sources', 'More']) {
      await tab(page, name).click();
      await expect(tab(page, name)).toHaveAttribute('aria-current', 'page');
      await axe(page, `${colorScheme} ${name}`);
    }
    await page.getByRole('button', { name: 'Manage habits' }).click();
    await axe(page, `${colorScheme} Manage`);
    await tab(page, 'Today').click();
    await page.getByRole('button', { name: 'Scorecard: every habit by day' }).click();
    for (const view of ['Week', 'Month', '12 weeks']) {
      await card(page).getByRole('button', { name: view, exact: true }).click();
      await axe(page, `${colorScheme} grid ${view}`);
    }
  }
});

test('iframe entry passes query params through', async ({ page }) => {
  await page.goto('./embed.html?theme=dark&weeks=2');
  await expect(card(page)).toHaveAttribute('theme', 'dark');
  await expect(card(page)).toHaveAttribute('weeks', '2');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(card(page).getByRole('columnheader')).toHaveCount(1 + 14 + 2);
});

test('embed script works on a foreign page, bringing its own tokens', async ({ page }) => {
  await page.route('**/host.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: readFileSync(new URL('./foreign-host.html', import.meta.url)),
    }),
  );
  await page.goto('/host.html');
  await expect(card(page)).toHaveAttribute('own-tokens', '');
  const table = card(page).getByRole('table');
  await expect(table.getByRole('rowheader')).toHaveCount(5);
  // The host's `* { color: red !important }` doesn't reach inside the shadow root.
  const color = await table
    .getByRole('rowheader')
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe('rgb(255, 0, 0)');
  // theme="dark" on the element: the dark surface, from its own tokens.
  const bg = await card(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(22, 30, 51)');
});

test('installs as a PWA and reloads offline', async ({ page, context }) => {
  await page.goto('./');
  const manifest = await page.locator('link[rel=manifest]').getAttribute('href');
  const res = await page.request.get(new URL(manifest!, page.url()).href);
  expect((await res.json()).icons).toHaveLength(3);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Up next' })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Up next' })).toBeVisible();
  await context.setOffline(false);
});
