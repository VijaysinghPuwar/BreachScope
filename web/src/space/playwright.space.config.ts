// Temporary: runs e2e/space.spec.ts without the preview server, which the spec does not need.
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

export default defineConfig({
  ...base,
  testDir: '../../e2e',
  outputDir: '../../test-results/space',
  webServer: undefined,
});
