import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

// SpaceView is not routed in the app yet, so this spec serves the harness page
// (src/space/harness.html) from its own Vite dev server.
const sizes = [
  [1440, 900],
  [1024, 768],
  [820, 1180],
  [390, 844],
] as const;

let server: ViteDevServer;
let harnessUrl = '';

test.beforeAll(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 5187, strictPort: false },
  });
  await server.listen();
  harnessUrl = new URL('src/space/harness.html', server.resolvedUrls!.local[0]).href;
});

test.afterAll(async () => {
  await server?.close();
});

async function open(page: Page, errors: string[]) {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(harnessUrl);
  const view = page.getByTestId('space-view');
  await expect(view).toBeVisible();
  return view;
}

for (const [width, height] of sizes)
  for (const motion of ['no-preference', 'reduce'] as const) {
    test(`${width}x${height} ${motion}: zooms through every scale`, async ({ page }, info) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: motion });
      const errors: string[] = [];
      const view = await open(page, errors);
      const canvas = page.getByRole('img', { name: /scale/ });

      await expect(view).toHaveAttribute('data-scale', 'earth-moon');
      await expect(canvas).toHaveAttribute('aria-label', /^Earth and Moon scale/);
      await expect(canvas).toHaveAttribute('aria-label', /Moon/);
      await expect(
        page.getByText('Distances to scale on a log axis. Directions are schematic.'),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Back to Earth' })).toBeVisible();

      const axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations.map((violation) => violation.id)).toEqual([]);

      // Keyboard: eight presses of "-" zoom out two decades, into the Solar System.
      await view.focus();
      for (let press = 0; press < 8; press++) await page.keyboard.press('-');
      await expect(view).toHaveAttribute('data-scale', 'solar-system');
      await expect(page.getByText('Solar System · 1 AU = 149.6 million km')).toBeAttached();

      // Wheel: zoom out to the nearby galaxies.
      const box = (await canvas.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let step = 0; step < 12; step++) await page.mouse.wheel(0, 400);
      await expect(view).toHaveAttribute('data-scale', 'galaxies');
      await expect(canvas).toHaveAttribute('aria-label', /Andromeda/);

      await view.focus();
      await page.keyboard.press('End');
      await expect(view).toHaveAttribute('data-scale', 'universe');
      await expect(canvas).toHaveAttribute('aria-label', /Edge of the observable universe/);
      await page.keyboard.press('PageUp');
      await expect(view).toHaveAttribute('data-scale', 'galaxies');

      // Object list and detail card, with provenance.
      await page.getByRole('button', { name: /In view/ }).click();
      await page.getByRole('button', { name: /Andromeda \(M31\)/ }).click();
      const card = page.getByRole('region', { name: 'Andromeda (M31) details' });
      await expect(card).toContainText('2.5 Mly');
      await expect(card).toContainText('Source: NASA, Andromeda Galaxy');
      await expect(card).toContainText('2.5 million years');
      await page.screenshot({ path: info.outputPath('galaxies.png'), animations: 'disabled' });
      await page.getByRole('button', { name: 'Close details' }).click();
      await expect(card).toHaveCount(0);

      if (width > 600) {
        await page.getByRole('button', { name: 'Milky Way', exact: true }).click();
        await expect(view).toHaveAttribute('data-scale', 'milky-way');
        await expect(page.getByRole('button', { name: 'Milky Way', exact: true })).toHaveAttribute(
          'aria-current',
          'true',
        );
      }

      // Home, then zooming in past the closest view hands back to Earth.
      await view.focus();
      await page.keyboard.press('Home');
      await expect(view).toHaveAttribute('data-scale', 'earth-moon');
      await expect(view).toHaveAttribute('data-outer', '9.40');
      for (let press = 0; press < 5; press++) await page.keyboard.press('+');
      await expect(page.getByTestId('returns')).toHaveText('1');

      await page.getByRole('button', { name: 'Back to Earth' }).click();
      await expect(page.getByTestId('returns')).toHaveText('2');

      await page.screenshot({ path: info.outputPath('earth.png'), animations: 'disabled' });
      expect(errors).toEqual([]);
    });
  }

test('reduced motion jumps straight to the target', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const view = await open(page, []);
  await view.focus();
  await page.keyboard.press('End');
  // No easing frames: the very next read is already at the universe home.
  expect(await view.getAttribute('data-outer')).toBe('27.00');
});

test('clicking an object on the canvas opens its details', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, []);
  // Moon: angle 35 degrees at log share of its distance in the starting view.
  const canvas = page.getByRole('img', { name: /scale/ });
  const box = (await canvas.boundingBox())!;
  const point = await page.evaluate(
    ({ width, height }) => {
      const radius = Math.min(width, height) / 2 - 28;
      const share = (Math.log10(384_400_000) - (9.4 - 3)) / 3;
      const angle = (35 * Math.PI) / 180;
      return {
        x: width / 2 + share * radius * Math.cos(angle),
        y: height / 2 - share * radius * Math.sin(angle),
      };
    },
    { width: box.width, height: box.height },
  );
  await page.mouse.click(box.x + point.x, box.y + point.y);
  const card = page.getByRole('region', { name: 'Moon details' });
  await expect(card).toContainText('384,000 km');
  await expect(card).toContainText('1.28 seconds');
  await expect(card).toContainText('NASA Moon fact sheet');
});
