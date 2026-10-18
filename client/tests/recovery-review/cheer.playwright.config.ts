import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testMatch: 'cheer.spec.ts',
  outputDir: '../../../output/playwright/cheer-preview',
});
