import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testMatch: 'landing.spec.ts',
  outputDir: '../../../output/playwright/landing-migration',
});
