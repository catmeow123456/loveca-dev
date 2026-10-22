import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: 'battle-effects.spec.ts',
  outputDir: '../../../output/playwright/battle-effects-switch',
});
