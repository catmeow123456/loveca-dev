import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testMatch: 'feedback.spec.ts',
  outputDir: '../../../output/playwright/member-feedback',
  use: { ...base.use, baseURL: process.env.FEEDBACK_REVIEW_URL ?? 'http://127.0.0.1:5186' },
});
