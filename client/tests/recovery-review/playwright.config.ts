import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'recovery.spec.ts',
  timeout: 30_000,
  workers: 1,
  outputDir: '../../../output/playwright/recovery-2d',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5186',
    viewport: { width: 1600, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
