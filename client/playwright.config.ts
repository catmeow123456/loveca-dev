import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 测试配置
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',

  // 并行运行测试
  fullyParallel: true,

  // CI 模式下禁止 .only
  forbidOnly: !!process.env.CI,

  // CI 模式下重试失败的测试
  retries: process.env.CI ? 2 : 0,

  // 并发 worker 数量
  workers: 4,

  // 报告器配置
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],

  // 全局测试设置
  use: {
    // 开发服务器 URL
    baseURL: 'http://localhost:5173',

    // 失败时的追踪和截图
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',

    // 游戏测试需要较大视口
    viewport: { width: 1280, height: 800 },

    // 较长的动作超时（游戏有动画）
    actionTimeout: 10000,

    // 导航超时
    navigationTimeout: 30000,
  },

  // 测试项目（浏览器）配置
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // 可选：Firefox 测试
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // 可选：移动端测试
    // {
    //   name: 'mobile-chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
  ],

  // 开发服务器配置
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    // 本地开发时复用已启动的服务器，CI 中自动启动
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    // 输出服务器日志便于调试
    stdout: 'pipe',
    stderr: 'pipe',
  },

  // 测试超时
  timeout: 60000,

  // 期望超时
  expect: {
    timeout: 10000,
  },
});
