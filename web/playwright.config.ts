import { defineConfig } from '@playwright/test';

// GitHub's runners draw WebGL in software on two cores, several times slower
// than a laptop, so CI gets longer limits and one retry. Locally the limits
// stay tight so slow regressions show up.
const ci = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: ci ? 180_000 : 60_000,
  expect: { timeout: ci ? 20_000 : 5_000 },
  retries: ci ? 1 : 0,
  reporter: ci ? [['list'], ['github']] : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
