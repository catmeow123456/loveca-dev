import { defineConfig } from '@playwright/test';
import base from './playwright.excel.config';
export default defineConfig({
  ...base,
  testMatch: 'card-sync-review.spec.ts',
  outputDir: '../output/playwright/card-sync-review',
});
