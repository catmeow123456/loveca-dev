import { expect, test } from '@playwright/test';
import { DECK_RECORD, prepareVisualPage } from '../visual/support/mockApp';

for (const mode of ['对墙打', '双人调试'] as const) {
  test(`${mode}的短屏选组列表可以滚到最后一副并直接开局`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await prepareVisualPage(page, 'light', true);
    await page.route('**/api/decks', (route) =>
      route.fulfill({
        json: {
          data: Array.from({ length: 6 }, (_, index) => ({
            ...DECK_RECORD,
            id: `setup-deck-${index}`,
            name: `准备页卡组 ${index + 1}`,
          })),
          error: null,
        },
      })
    );
    await page.goto('/?page=game-setup');
    if (mode === '双人调试') {
      await page.getByRole('button', { name: '切换模式', exact: true }).click();
      await page.getByRole('option', { name: mode, exact: true }).click();
    }

    const titles =
      mode === '对墙打' ? ['选择己方卡组'] : ['选择 Player 1 的卡组', '选择 Player 2 的卡组'];
    for (const title of titles) {
      const selector = page.getByRole('region', { name: title, exact: true });
      const lastDeckName = selector.getByText('准备页卡组 6', { exact: true });
      await expect(selector).toBeVisible();
      // Use normal scrolling before click: locator auto-scrolling would hide the regression.
      const box = await selector.boundingBox();
      if (!box) throw new Error('选组区域未显示');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 24);
      await page.mouse.wheel(0, 1500);
      await expect(lastDeckName).toBeInViewport({ ratio: 1 });
      const lastDeck = selector.getByRole('button', { name: /准备页卡组 6/ });
      await expect
        .poll(() =>
          lastDeck.evaluate((button) => {
            const rect = button.getBoundingClientRect();
            return button.contains(
              document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            );
          })
        )
        .toBe(true);
      await lastDeck.click();
      await expect(lastDeck).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: '开始对局', exact: true })).toBeInViewport({
        ratio: 1,
      });
      if (titles.length > 1 && title === titles[0])
        await page.getByRole('tab', { name: /Player 2/ }).click();
    }
    await expect(page.locator('.game-setup-selection')).toContainText('准备页卡组 6');
    await expect(page.getByRole('button', { name: '开始对局', exact: true })).toBeEnabled();
  });
}

for (const scenario of [
  {
    page: 'ranked',
    endpoint: '/api/ranked/overview',
    emptyTitle: '暂无赛季',
    data: {
      season: null,
      availability: {
        state: 'NO_SEASON',
        canJoin: false,
        message: '暂无开放赛季',
        nextOpensAt: null,
        currentWindowEndsAt: null,
      },
      player: null,
      queue: {
        state: 'IDLE',
        ticketId: null,
        joinedAt: null,
        deckName: null,
        reservationId: null,
        confirmationExpiresAt: null,
        confirmed: false,
        roomCode: null,
        roomGeneration: null,
        message: null,
      },
      recentMatches: [],
      leaderboard: [],
    },
  },
  {
    page: 'theme-table',
    endpoint: '/api/theme-table/overview',
    emptyTitle: '下一期主题牌桌正在编排',
    data: { event: null },
  },
]) {
  test(`${scenario.page}读取失败可重试，成功后才显示真实空状态`, async ({ page }) => {
    await prepareVisualPage(page, 'light', true);
    await page.route('**/api/ranked/seasons', (route) =>
      route.fulfill({ json: { data: [], error: null } })
    );
    let recovered = false;
    await page.route(`**${scenario.endpoint}`, (route) =>
      route.fulfill(
        recovered
          ? { json: { data: scenario.data, error: null } }
          : {
              status: 503,
              json: { data: null, error: { code: 'UNAVAILABLE', message: '暂时无法读取，请重试' } },
            }
      )
    );
    await page.goto(`/?page=${scenario.page}`);
    const error = page.getByRole('alert').filter({ hasText: '暂时无法读取，请重试' });
    await expect(error).toBeVisible();
    await expect(page.getByText(scenario.emptyTitle, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('status')).toHaveCount(0);
    recovered = true;
    await error.getByRole('button', { name: '重试', exact: true }).click();
    await expect(error).toHaveCount(0);
    await expect(page.getByText(scenario.emptyTitle, { exact: true })).toBeVisible();
  });
}
