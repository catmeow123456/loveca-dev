import { defineConfig } from '@playwright/test';
import base from './playwright.excel.config';
export default defineConfig({
  ...base,
  testMatch: 'excel-interactions.spec.ts',
  outputDir: '../output/playwright/excel-interactions',
});
