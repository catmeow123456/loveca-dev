import { defineConfig } from '@playwright/test';
import base from './playwright.excel.config';
export default defineConfig({
  ...base,
  testMatch: 'excel-real.spec.ts',
  projects: [{ name: 'real-local', use: { viewport: { width: 1366, height: 768 } } }],
});
