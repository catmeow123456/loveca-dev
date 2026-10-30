import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: [
    'inspection.spec.ts',
    'lock.spec.ts',
    'entrance.spec.ts',
    'izumi.spec.ts',
    'protection.spec.ts',
    'ai.spec.ts',
  ],
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5193',
    viewport: { width: 1440, height: 960 },
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'node client/node_modules/vite/bin/vite.js --config client/dev/seras/vite.config.mjs',
    cwd: decodeURIComponent(new URL('../../..', import.meta.url).pathname),
    url: 'http://127.0.0.1:5193',
    reuseExistingServer: true,
  },
});
