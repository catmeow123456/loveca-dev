import { expect, test, type Page } from '@playwright/test';
import { prepareVisualPage, waitForVisualStability } from './support/mockApp';

type VisualScenario = {
  name: string;
  path: string;
  authenticated: boolean;
  ready: (page: Page) => Promise<void>;
};

const scenarios: VisualScenario[] = [
  {
    name: 'public-home',
    path: '/',
    authenticated: false,
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: 'Loveca 在线对战' })).toBeVisible();
    },
  },
  {
    name: 'player-lobby',
    path: '/',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: '欢迎回来，视觉验收玩家' })).toBeVisible();
    },
  },
  {
    name: 'game-setup',
    path: '/?page=game-setup',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: '选择对战方式' })).toBeVisible();
    },
  },
  {
    name: 'deck-manager',
    path: '/?page=deck-manager',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: '视觉回归标准卡组' })).toBeVisible();
    },
  },
  {
    name: 'spectator-lobby',
    path: '/?page=online-spectator',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByLabel('房间号')).toBeVisible();
    },
  },
];

for (const scenario of scenarios) {
  test(`${scenario.name} fixed viewport baseline`, async ({ page }, testInfo) => {
    const theme = testInfo.project.metadata.theme === 'dark' ? 'dark' : 'light';
    await prepareVisualPage(page, theme, scenario.authenticated);
    await page.goto(scenario.path);
    await scenario.ready(page);
    await waitForVisualStability(page);
    await expect(page).toHaveScreenshot(`${scenario.name}.png`, { fullPage: false });
  });
}
