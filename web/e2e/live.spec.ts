import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fixture from '../src/test/fixtures/live.json' with { type: 'json' };
const sizes = [
  [1440, 900],
  [1024, 768],
  [820, 1180],
  [390, 844],
] as const;
for (const [width, height] of sizes)
  for (const projection of ['Flat', 'Globe'])
    for (const motion of ['no-preference', 'reduce'] as const) {
      test(`${width}x${height} ${projection} ${motion}: accessible live map and event panel`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ reducedMotion: motion });
        await page.clock.setFixedTime(new Date(fixture.generated_at));
        await page.route('**/api/live', (route) => route.fulfill({ json: fixture }));
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        await page.goto('/');
        await expect(page.getByText('Live · 0 new in last poll · updated 0s ago')).toBeVisible();
        await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-ready', 'true', {
          // CI renders WebGL in software and fetches the tile index first.
          timeout: 30_000,
        });
        await page.getByRole('radio', { name: projection, exact: true }).click();
        await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-projection', projection);
        await expect(
          page.getByText("This device can't draw the map.", { exact: false }),
        ).toHaveCount(0);
        await page.screenshot({
          path: info.outputPath('console.png'),
          fullPage: true,
          animations: 'disabled',
        });
        const tags = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
        expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        if (width >= 768)
          await page.getByRole('button', { name: 'Open feed', exact: true }).click();
        if (width < 768) {
          await page.getByRole('button', { name: 'Search events', exact: true }).click();
          await page.getByRole('button', { name: 'Feed', exact: true }).click();
        }
        const urlhaus = page.locator('[data-uid="fixture-00"]');
        await urlhaus.click();
        await expect(
          page.getByText('Indicator, not an observed attack. Reported by URLhaus.'),
        ).toBeVisible();
        await expect(page.getByRole('link', { name: 'Open raw record' })).toHaveAttribute(
          'href',
          'https://urlhaus.abuse.ch/url/1000/',
        );
        await expect(page.locator('a[href^="hxxp"], a[href*="malware.example"]')).toHaveCount(0);
        await page.screenshot({
          path: info.outputPath('detail.png'),
          fullPage: true,
          animations: 'disabled',
        });
        expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        expect(errors).toEqual([]);
      });
    }
test('first-load error shows request ID and Retry recovers without sample data', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/api/live', (route) =>
    fail
      ? route.fulfill({ status: 503, headers: { 'X-Request-ID': 'live-request-503' }, json: {} })
      : route.fulfill({ json: fixture }),
  );
  await page.goto('/');
  await expect(
    page.getByText('Something went wrong on our side. Request ID live-request-503. Try again.'),
  ).toBeVisible();
  await expect(page.locator('.feed-row')).toHaveCount(0);
  await expect(page.getByText('Sample data. Live feeds are not connected yet.')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  // The console opens map-first; the feed is one click away.
  const openFeed = page.getByRole('button', { name: 'Open feed', exact: true });
  if (await openFeed.isVisible()) await openFeed.click();
  await expect(page.locator('.feed-row')).toHaveCount(18);
});
test('search, class filters, missing accuracy, KEV details and new UID accent', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: new Date(fixture.generated_at) });
  let polls = 0;
  await page.route('**/api/live', (route) =>
    route.fulfill({
      json:
        polls++ === 0
          ? fixture
          : {
              ...fixture,
              events: [{ ...fixture.events[0], event_uid: 'new-event' }, ...fixture.events],
            },
    }),
  );
  await page.goto('/');
  // The console opens map-first; the feed is one click away.
  const openFeed = page.getByRole('button', { name: 'Open feed', exact: true });
  if (await openFeed.isVisible()) await openFeed.click();
  await expect(page.locator('.feed-row')).toHaveCount(18);
  await page.clock.fastForward(60000);
  await expect(page.locator('[data-uid="new-event"]')).toHaveClass(/is-new/);
  await page.getByRole('button', { name: 'Search events', exact: true }).click();
  await page.getByRole('textbox').fill('VShell');
  await page.getByRole('textbox').press('Enter');
  await expect(page.locator('.feed-row')).toHaveCount(3);
  await page.locator('[data-uid="fixture-04"]').click();
  await expect(page.getByText('Accuracy: not published by DB-IP Lite')).toBeVisible();
  await page.getByRole('button', { name: 'Close event detail' }).click();
  await page.getByRole('button', { name: 'Search events', exact: true }).click();
  await page.getByRole('textbox').fill('CVE-2026-10000');
  await page.getByRole('textbox').press('Enter');
  await expect(page.locator('.feed-row')).toHaveCount(1);
  await page.locator('.feed-row').click();
  await expect(page.getByText('Example vendor', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open raw record' })).toHaveAttribute(
    'href',
    'https://nvd.nist.gov/vuln/detail/CVE-2026-10000',
  );
});

test('a failed tile download does not take the map down', async ({ page }) => {
  await page.route('**/api/live', (route) => route.fulfill({ json: fixture }));
  // Every street-detail tile fails, as on a flaky connection.
  await page.route('https://tiles.openfreemap.org/planet/**', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
  await page.waitForTimeout(2_000);
  await expect(page.getByText("This device can't draw the map.", { exact: false })).toHaveCount(0);
});
