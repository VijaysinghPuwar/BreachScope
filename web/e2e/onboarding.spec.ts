import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fixture from '../src/test/fixtures/live.json' with { type: 'json' };

// A first visit: nothing in storage, so the guide shows.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(fixture.generated_at));
  await page.route('**/api/live', (route) => route.fulfill({ json: fixture }));
});

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
  [820, 1180],
  [390, 844],
] as const)
  test(`${width}x${height}: welcome, full tour, and it stays dismissed`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-ready', 'true', {
      timeout: 30_000,
    });
    const welcome = page.getByRole('region', { name: 'A live map of reported cyber threats' });
    await expect(welcome).toBeVisible();
    // The welcome card fits on screen at every size.
    const box = (await welcome.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    await expect(page.locator('.intro')).toHaveCount(0, { timeout: 15_000 });
    const axe = await new AxeBuilder({ page }).include('.welcome').analyze();
    expect(axe.violations).toEqual([]);

    await page.getByRole('button', { name: 'Show me around' }).click();
    const card = page.getByRole('dialog');
    await expect(card.getByRole('heading', { name: 'The map' })).toBeVisible();
    const total = Number((await card.locator('.mono').textContent())!.split(' of ')[1]);
    expect(total).toBeGreaterThanOrEqual(5);
    for (let step = 1; step < total; step++) {
      await expect(card.locator('.mono')).toHaveText(`${step} of ${total}`);
      const cardBox = (await card.boundingBox())!;
      expect(cardBox.x).toBeGreaterThanOrEqual(0);
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(width);
      expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(height);
      await card.getByRole('button', { name: 'Next' }).click();
    }
    await expect(card.getByRole('heading', { name: 'You are set' })).toBeVisible();
    await card.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-ready', 'true', {
      timeout: 30_000,
    });
    await expect(page.locator('.welcome')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

test('Explore on my own dismisses the welcome, and Guide reopens the tour', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore on my own' }).click();
  await expect(page.locator('.welcome')).toHaveCount(0);
  await page.getByRole('button', { name: 'Guide' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'The map' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Reports and Status show live data and pass axe', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/reports');
  await expect(page.getByRole('cell', { name: 'CVE-2026-10000' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('radio', { name: 'Breaches' }).click();
  await expect(page.getByText('No records of this type in the current snapshot.')).toBeVisible();

  await page.goto('/status');
  await expect(page.locator('.status-summary')).toContainText(
    `of ${fixture.sources.length} feeds healthy`,
  );
  await expect(page.getByRole('link', { name: 'ThreatFox' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.goto('/about');
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.goto('/investigations');
  await expect(page.getByRole('heading', { name: 'This page does not exist.' })).toBeVisible();
});

test('a report row opens its record in the console', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/reports');
  await page.getByRole('link', { name: 'Open in console' }).first().click();
  await expect(page).toHaveURL(/\?event=fixture-12/);
  await expect(page.getByText('Example vendor', { exact: true })).toBeVisible();
  // Someone who followed a link came for that record: no welcome card over it.
  await expect(page.locator('.welcome')).toHaveCount(0);
  await expect(page.locator('.arrival-toast')).toHaveCount(0);
});
