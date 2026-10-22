import { expect, test } from '@playwright/test';
import { installVisualApiMocks, waitForVisualStability } from '../visual/support/mockApp';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await installVisualApiMocks(page, true);
});

test('导航进入新版大厅，练习与调试直接选组并返回原大厅', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Loveca 大厅', exact: true })).toBeVisible();
  if (page.viewportSize()!.width < 768) {
    await page.getByRole('button', { name: '打开导航菜单' }).click();
  }
  await page.getByRole('button', { name: '对战', exact: true }).click();
  await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '对墙打', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '双人调试', exact: true })).toBeEnabled();
  await waitForVisualStability(page);
  await page.screenshot({ path: testInfo.outputPath('battle-lobby-entries.png'), fullPage: true });

  await page.getByRole('button', { name: '对墙打', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择己方卡组', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一步：确认对局' }).click();
  await expect(page.getByRole('heading', { name: '确认并开始对局', exact: true })).toBeVisible();
  await expect(page.getByText('在线记录：本局会保存到历史并可复盘')).toBeVisible();
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await page.getByRole('button', { name: '返回大厅', exact: true }).click();
  await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '双人调试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择 Player 1 的卡组' })).toBeVisible();
  await page.getByRole('button', { name: '下一步：选择 P2 卡组' }).click();
  await expect(page.getByRole('heading', { name: '选择 Player 2 的卡组' })).toBeVisible();
  await page.getByRole('button', { name: '下一步：确认对局' }).click();
  await expect(page.getByRole('button', { name: '开始对局', exact: true })).toBeEnabled();
  await expect(page.getByRole('region', { name: '对局确认', exact: true })).toHaveCSS(
    'opacity',
    '1'
  );
  await waitForVisualStability(page);
  await page.screenshot({ path: testInfo.outputPath('debug-confirm.png'), fullPage: true });
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择 Player 2 的卡组' })).toBeVisible();
  await page.getByRole('button', { name: '返回大厅', exact: true }).click();
  await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
});

test('没有可用卡组时可管理卡组，模式切换仍阻止无卡组开局', async ({ page }) => {
  await page.route('**/api/decks', (route) => route.fulfill({ json: { data: [], error: null } }));
  await page.goto('/?page=battle-lobby');
  await page.getByRole('button', { name: '对墙打', exact: true }).click();
  await expect(page.getByRole('button', { name: '下一步：确认对局' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '管理卡组', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '双人调试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择 Player 1 的卡组' })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步：选择 P2 卡组' })).toBeDisabled();
  await page.getByRole('button', { name: '管理卡组', exact: true }).click();
  await expect(page.getByRole('heading', { name: '卡组管理', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回对局准备', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择 Player 1 的卡组' })).toBeVisible();
});

test('恢复参与状态期间及正在排队时不能绕过房间进入练习', async ({ page }) => {
  let releaseStatus!: () => void;
  const statusGate = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  await page.route('**/api/casual-tables/me', async (route) => {
    await statusGate;
    await route.fulfill({
      json: {
        data: {
          table: null,
          otherParticipation: {
            kind: 'RANKED_QUEUE',
            destination: 'ranked',
            roomGeneration: null,
            matchId: null,
          },
        },
        error: null,
      },
    });
  });
  await page.goto('/?page=battle-lobby');
  await expect(page.getByRole('button', { name: '对墙打', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '双人调试', exact: true })).toBeDisabled();
  releaseStatus();
  await expect(page.getByText('请先结束当前匹配或离开房间，再开始练习或调试。')).toBeVisible();
  await expect(page.getByRole('button', { name: '对墙打', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '双人调试', exact: true })).toBeDisabled();
});
