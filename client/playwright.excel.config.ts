import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  webServer: base.webServer
    ? {
        ...base.webServer,
        command: 'pnpm exec vite --mode excel-review --host 127.0.0.1 --port 4175 --strictPort',
      }
    : undefined,
  testMatch: 'excel-mode.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  projects: [
    { name: 'excel-1366', use: { viewport: { width: 1366, height: 768 } } },
    { name: 'excel-1920', use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'excel-mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
});
