import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testMatch: 'activation.spec.ts',
  outputDir: '../../../output/playwright/ability-activation',
  use: { ...base.use, baseURL: process.env.ACTIVATION_REVIEW_URL ?? 'http://127.0.0.1:5186' },
});
