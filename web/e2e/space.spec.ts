import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fixture from '../src/test/fixtures/live.json' with { type: 'json' };

// Software WebGL in CI draws slowly, so zoom checks get extra time.
const SLOW = { timeout: 15_000 };

const sizes = [
  [1440, 900],
  [1024, 768],
  [820, 1180],
  [390, 844],
] as const;

async function openSpace(page: Page, errors: string[]) {
  await page.clock.setFixedTime(new Date(fixture.generated_at));
  await page.route('**/api/live', (route) => route.fulfill({ json: fixture }));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/space');
  const view = page.getByTestId('space-view');
  // CI renders WebGL in software, so the first frame can take a while.
  await expect(view).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(view).toHaveAttribute('data-webgl', 'true');
  return view;
}

for (const [width, height] of sizes)
  for (const motion of ['no-preference', 'reduce'] as const) {
    test(`${width}x${height} ${motion}: 3D space view zooms, flies and returns`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: motion });
      const errors: string[] = [];
      const view = await openSpace(page, errors);
      const canvas = page.getByRole('img', { name: /scale/ });

      await expect(view).toHaveAttribute('data-scale', 'earth-moon', SLOW);
      await expect(page.getByRole('heading', { name: 'Earth and Moon' })).toBeVisible();
      await expect(canvas).toHaveAttribute('aria-label', /Moon/);
      await expect(page.getByRole('button', { name: 'Back to Earth' })).toBeVisible();
      await page.screenshot({ path: info.outputPath('earth.png') });

      const axe = await new AxeBuilder({ page }).include('[data-testid="space-view"]').analyze();
      expect(axe.violations.map((violation) => violation.id)).toEqual([]);

      // Keyboard: fourteen presses of "-" zoom out 2.8 decades, into the Solar System.
      await view.focus();
      for (let press = 0; press < 14; press++) await page.keyboard.press('-');
      await expect(view).toHaveAttribute('data-scale', 'solar-system', SLOW);

      // Wheel zooms further out.
      const box = (await canvas.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let step = 0; step < 8; step++) await page.mouse.wheel(0, 500);
      await expect(view).toHaveAttribute('data-scale', /nearby-stars|milky-way/, SLOW);

      await view.focus();
      await page.keyboard.press('End');
      await expect(view).toHaveAttribute('data-scale', 'universe', SLOW);
      await expect(canvas).toHaveAttribute('aria-label', /Edge of the observable universe/);
      await page.screenshot({ path: info.outputPath('universe.png') });
      await page.keyboard.press('PageUp');
      await expect(view).toHaveAttribute('data-scale', 'galaxies', SLOW);
      await page.screenshot({ path: info.outputPath('galaxies.png') });

      // Fly to Jupiter from the planet bar, then read its details and provenance.
      await page
        .getByRole('navigation', { name: 'Fly to' })
        .getByRole('button', { name: 'Jupiter' })
        .click();
      await expect(view).toHaveAttribute('data-focus', 'jupiter');
      await expect(page.getByRole('heading', { name: 'Jupiter system' })).toBeVisible({
        timeout: 10_000,
      });
      const card = page.getByRole('region', { name: 'Jupiter details' });
      await expect(card).toContainText('5.2 AU from the Sun');
      await expect(card).toContainText('Source: NASA planetary fact sheet');
      await expect(canvas).toHaveAttribute('aria-label', /Io|Europa|Ganymede|Callisto/);
      await page.screenshot({ path: info.outputPath('jupiter.png') });
      await page.getByRole('button', { name: 'Close details' }).click();
      await expect(card).toHaveCount(0);

      if (width > 600) {
        await page
          .getByRole('navigation', { name: 'Scales' })
          .getByRole('button', { name: 'Milky Way' })
          .click();
        await expect(view).toHaveAttribute('data-scale', 'milky-way', SLOW);
      }

      // Time controls.
      await page.getByRole('button', { name: 'Play time' }).click();
      await expect(page.getByRole('button', { name: 'Pause time' })).toBeVisible();
      await page.getByRole('button', { name: 'Pause time' }).click();

      await page.getByRole('button', { name: 'Back to Earth' }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByTestId('space-view')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

test('reduced motion jumps straight to the target', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const view = await openSpace(page, []);
  await view.focus();
  await page.keyboard.press('End');
  await expect(view).toHaveAttribute('data-outer', '27.20');
});

test('Escape returns to the globe', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openSpace(page, []);
  await page.getByTestId('space-view').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('space-view')).toHaveCount(0);
});
