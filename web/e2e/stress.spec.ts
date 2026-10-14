import { expect, test, type Page } from '@playwright/test';
import fixture from '../src/test/fixtures/live.json' with { type: 'json' };

// Soak test: thirty polls, each bringing hundreds of new events (with a breach
// every few polls), while the user switches projection, opens events, toggles
// the timeline and resizes across every breakpoint. It fails on any page error,
// on a map that stops being ready, or on memory that keeps climbing.

const POLLS = Number(process.env.STRESS_POLLS ?? 30);
const PER_POLL = 250;
const sizes = [
  [1440, 900],
  [1024, 768],
  [820, 1180],
  [390, 844],
] as const;

const cities = [
  ['Frankfurt am Main', 'DE', 50.11, 8.68],
  ['Singapore', 'SG', 1.29, 103.85],
  ['Toronto', 'CA', 43.65, -79.38],
  ['São Paulo', 'BR', -23.55, -46.63],
  ['Mumbai', 'IN', 19.07, 72.88],
  ['Ashburn', 'US', 39.04, -77.49],
] as const;

function liveResponse(poll: number, base: number) {
  const events = [];
  for (let i = 0; i < PER_POLL; i++) {
    const n = poll * PER_POLL + i;
    const [city, cc, lat, lon] = cities[n % cities.length]!;
    events.push({
      seq: 0,
      event_uid: `stress-${n}`,
      source: 'ThreatFox',
      data_class: 'indicator',
      licence: 'CC0',
      source_record_id: String(n),
      category: 'c2_server',
      category_label: 'C2 server',
      severity: n % 5,
      confidence: 75,
      confidence_basis: 'ThreatFox confidence level 75',
      reported_at: new Date(base + poll * 60_000 - i * 1000).toISOString(),
      ingested_at: new Date(base + poll * 60_000).toISOString(),
      geo_method: 'dbip_city_lite',
      src_ip: `198.51.100.${n % 250}`,
      src_country: cc,
      src_lat: lat + (n % 7) * 0.1,
      src_lon: lon + (n % 5) * 0.1,
      attrs: { city, malware: 'Stress', port: 443 },
    });
  }
  if (poll % 4 === 1)
    events.push({
      seq: 0,
      event_uid: `breach-${poll}`,
      source: 'Have I Been Pwned',
      data_class: 'breach_report',
      licence: 'CC BY 4.0',
      source_record_id: `Breach${poll}`,
      category: 'breach_disclosure',
      category_label: 'Data breach',
      severity: 3,
      confidence: 100,
      confidence_basis: 'Verified by Have I Been Pwned',
      reported_at: new Date(base + poll * 60_000).toISOString(),
      ingested_at: new Date(base + poll * 60_000).toISOString(),
      geo_method: 'none',
      attrs: { organisation: `Example Org ${poll}`, records: 120000 + poll, domain: 'example.org' },
    });
  return {
    generated_at: new Date(base + poll * 60_000).toISOString(),
    sources: fixture.sources,
    events: [...events, ...fixture.events].slice(0, 3000),
  };
}

async function heapMB(page: Page) {
  return page.evaluate(() => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return memory ? memory.usedJSHeapSize / 1e6 : 0;
  });
}

test('survives thirty heavy polls with constant interaction', async ({ page }) => {
  test.setTimeout(240_000);
  // Recent timestamps so ambient ripples and relative times behave as live.
  const base = Date.now() - 5 * 60_000;
  let poll = 0;
  await page.route('**/api/live', (route) => route.fulfill({ json: liveResponse(poll++, base) }));

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const map = page.getByTestId('map-canvas');
  await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  const startHeap = await heapMB(page);
  let sawBreach = false;

  for (let i = 0; i < POLLS; i++) {
    const started = Date.now();
    const [width, height] = sizes[i % sizes.length]!;
    await page.setViewportSize({ width, height });
    // The feed polls at once when the tab becomes visible, so firing that
    // event stands in for the 60 s wait without faking the clock (a fake
    // clock also freezes requestAnimationFrame, which stalls the map).
    const response = page.waitForResponse('**/api/live');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await response;
    const polled = Date.now();

    const projection = i % 2 ? 'Flat' : 'Globe';
    await page.getByRole('radio', { name: projection, exact: true }).click();

    if (width >= 1280 && i % 3 === 0) {
      const show = page.getByRole('button', { name: 'Show timeline' });
      if (await show.isVisible()) await show.click();
      else await page.getByRole('button', { name: 'Hide timeline' }).click();
    }

    const toast = page.locator('.arrival-toast');
    if (await toast.isVisible()) {
      if ((await toast.textContent())?.includes('New breach disclosed')) sawBreach = true;
      await toast.locator('.arrival-body').click();
      await page.keyboard.press('Escape');
    }
    await expect(map).toHaveAttribute('data-ready', 'true');
    if (process.env.STRESS_TRACE)
      console.log(`poll ${i}: clock ${polled - started} ms, rest ${Date.now() - polled} ms`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(2_000);
  const endHeap = await heapMB(page);
  console.log(`polls ${poll}, heap ${startHeap.toFixed(0)} MB -> ${endHeap.toFixed(0)} MB`);

  expect(errors).toEqual([]);
  expect(poll).toBeGreaterThanOrEqual(POLLS);
  expect(sawBreach).toBe(true);
  // Every poll replaces up to 3,000 events; memory must not grow with poll count.
  if (startHeap > 0) expect(endHeap).toBeLessThan(startHeap * 3 + 100);
});
