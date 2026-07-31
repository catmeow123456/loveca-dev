import { defineConfig, type Project } from '@playwright/test';
import process from 'node:process';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4176';
const channel = process.env.PLAYWRIGHT_CHANNEL || undefined;

const projects: Project[] = [
  {
    name: '390-light',
    metadata: { theme: 'light' },
    use: {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      colorScheme: 'light',
    },
  },
  {
    name: '768-dark',
    metadata: { theme: 'dark' },
    use: {
      viewport: { width: 768, height: 1024 },
      hasTouch: true,
      isMobile: true,
      colorScheme: 'dark',
    },
  },
  {
    name: '1024-light',
    metadata: { theme: 'light' },
    use: { viewport: { width: 1024, height: 768 }, colorScheme: 'light' },
  },
  {
    name: '1440-light',
    metadata: { theme: 'light' },
    use: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
  },
  {
    name: '1440-dark',
    metadata: { theme: 'dark' },
    use: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
  },
];

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.visual.spec.ts',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  snapshotPathTemplate:
    '{testDir}/__screenshots__/{platform}/{projectName}/{testFilePath}/{arg}{ext}',
  expect: {
    timeout: 8_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.002,
    },
  },
  use: {
    baseURL,
    browserName: 'chromium',
    channel,
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm exec vite --host 127.0.0.1 --port 4176 --strictPort',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects,
});
