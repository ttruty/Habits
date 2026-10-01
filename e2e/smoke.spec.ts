import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('app renders', async ({ page }) => {
  await page.goto('./');
  await expect(
    page.locator('habit-scorecard').getByRole('heading', { name: 'Habits' }),
  ).toBeVisible();
});

test('iframe entry passes query params through', async ({ page }) => {
  await page.goto('./embed.html?theme=dark&weeks=2');
  const card = page.locator('habit-scorecard');
  await expect(card).toHaveAttribute('theme', 'dark');
  await expect(card).toHaveAttribute('weeks', '2');
});

test('embed script works on a foreign page and survives its styles', async ({ page }) => {
  await page.route('**/host.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: readFileSync(new URL('./foreign-host.html', import.meta.url)),
    }),
  );
  await page.goto('/host.html');
  const heading = page.locator('habit-scorecard').getByRole('heading', { name: 'Habits' });
  await expect(heading).toBeVisible();
});
