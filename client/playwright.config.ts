import { defineConfig } from '@playwright/test';
import process from 'node:process';

const noProxyHosts = new Set(
  (process.env.NO_PROXY ?? process.env.no_proxy ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)
);
noProxyHosts.add('127.0.0.1');
noProxyHosts.add('localhost');
process.env.NO_PROXY = Array.from(noProxyHosts).join(',');
process.env.no_proxy = process.env.NO_PROXY;

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4175';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: true,
  reporter: [['list']],
  workers: process.env.CI ? 2 : 4,
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm exec vite --host 127.0.0.1 --port 4175 --strictPort',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    {
      name: 'mobile-390x844',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'mobile-430x932',
      use: {
        viewport: { width: 430, height: 932 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'tablet-768x1024',
      use: {
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'tablet-1024x768',
      use: {
        viewport: { width: 1024, height: 768 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: false,
      },
    },
  ],
});
