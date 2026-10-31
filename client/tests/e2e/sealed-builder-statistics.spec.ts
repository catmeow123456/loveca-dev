import { expect, test, type Page } from '@playwright/test';
import { prepareVisualPage } from '../visual/support/mockApp';
import { generateBp7Box, treasurePackIndices } from '../../../src/domain/rules/sealed-box';
import { sealedCards } from '../../../tests/helpers/sealed-cards';
import { BladeHeartEffect, CardType, HeartColor } from '../../../src/shared/types/enums';
import type { CasualTableOwnView } from '../../../src/online/casual-table-types';

async function setup(page: Page, theme: 'light' | 'dark') {
  await prepareVisualPage(page, theme, true);
  const pool = generateBp7Box(sealedCards(), () => 0);
  let table: CasualTableOwnView = {
    tableId: 'sealed-statistics',
    roundId: 'round-one',
    revision: 1,
    format: 'SEALED_BP7',
    ruleMode: 'UNLIMITED',
    roomCode: 'BOX060',
    discoverability: 'PUBLIC',
    note: '',
    state: 'BUILDING',
    waitingSince: 0,
    confirmationExpiresAt: Date.parse('2026-07-31T12:15:00.000Z'),
    ownDeck: null,
    spectatorEnabled: true,
    members: [
      { userId: 'visual-user', displayName: '组牌玩家', confirmed: false },
      { userId: 'opponent', displayName: '对手', confirmed: false },
    ],
    roomGeneration: null,
    failureReason: null,
    runtime: null,
    canRematch: false,
    canContinuePublic: false,
    sealedRematch: null,
    sealedPool: {
      poolId: 'pool-one',
      version: pool.version,
      draftRevision: 0,
      selectedIndices: [],
      treasurePackIndices: treasurePackIndices(pool),
      cards: pool.packs.flat().map((card, index) => ({
        index,
        cardCode: card.cardCode,
        imageFilename: 'ME-visual-001.webp',
        name: card.name,
        cardType: card.cardType,
        rare: card.rare!,
        groupNames: card.groupNames ?? [],
        cardText: '用于验证本轮冻结牌池的本地测试卡牌。',
        cost:
          card.cardType === CardType.MEMBER
            ? (({ N: 1, R: 3, P: 5 } as Record<string, number>)[card.rare!] ?? 7)
            : null,
        score: card.cardType === CardType.LIVE ? 3 : null,
        baseRequiredHearts: card.cardType === CardType.LIVE ? 5 : null,
        bladeHearts:
          card.cardType === CardType.MEMBER
            ? [
                { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY },
                { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY },
              ]
            : card.cardType === CardType.LIVE
              ? [
                  { effect: BladeHeartEffect.SCORE },
                  { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PINK },
                ]
              : [],
      })),
    },
  };
  await page.route('**/api/casual-tables/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/sealed/draft')) {
      const body = route.request().postDataJSON();
      table = {
        ...table,
        sealedPool: {
          ...table.sealedPool!,
          selectedIndices: body.indices,
          draftRevision: table.sealedPool!.draftRevision + 1,
        },
      };
    }
    const data = path.endsWith('/me')
      ? { table, otherParticipation: null }
      : path.endsWith('/rooms')
        ? {
            rooms: [],
            counts: { waiting: 0, preparing: 1, playing: 0 },
            nextCursor: null,
            snapshotAt: 0,
            unavailableReason: null,
          }
        : table;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data, error: null }),
    });
  });
  await page.goto('/?page=battle-lobby');
  return table;
}

for (const [width, theme] of [
  [1440, 'light'],
  [390, 'light'],
  [1440, 'dark'],
  [320, 'dark'],
] as const) {
  test(`treasure reveal and frozen deck statistics at ${width} ${theme}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await setup(page, theme);
    await expect(page.getByRole('region', { name: '开盒战组牌' })).toBeVisible();
    await expect(page.getByText('开出了宝藏包', { exact: true })).toBeHidden();
    await page.getByRole('button', { name: '打开第 1 包', exact: true }).click();
    await expect(page.getByText('开出了宝藏包', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '查看五张卡', exact: true }).click();
    await expect(page.getByRole('dialog').locator('.sealed-card')).toHaveCount(5);
    await page.screenshot({ path: info.outputPath('treasure-pack.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '全部打开并组牌', exact: true }).click();
    await expect(page.locator('#sealed-deck-statistics')).toHaveCount(0);
    const card = page.getByRole('button', { name: /^选择 /, pressed: false }).first();
    await card.click();
    await expect(page.locator('.sealed-save-status')).toContainText('已自动保存');
    const toggle = page.getByRole('button', { name: '卡组统计', exact: true });
    await toggle.click();
    const statistics = page.locator('#sealed-deck-statistics');
    await expect(statistics).toContainText('已选 1 张成员 + 固定 6 张 Live');
    await expect(
      statistics.getByRole('listitem', { name: '无色心：1 张 / 2 心', exact: true })
    ).toBeVisible();
    await expect(
      statistics.getByRole('listitem', { name: '粉心：6 张 / 6 心', exact: true })
    ).toBeVisible();
    await expect(statistics.getByRole('img', { name: 'Live 基础灰心需求分布' })).toHaveCount(1);
    if (width >= 1200) {
      const side = await statistics.boundingBox();
      const grid = await page.locator('.sealed-workspace-cards').boundingBox();
      expect(side!.x).toBeGreaterThanOrEqual(grid!.x + grid!.width);
      await card.click();
      await expect(statistics).toContainText('已选 2 张成员');
      await expect(page.locator('.sealed-save-status')).toContainText('已自动保存');
      await page.setViewportSize({ width: 390, height: 900 });
      await expect(statistics).toHaveAttribute('aria-modal', 'true');
      await page.setViewportSize({ width, height: 900 });
      await expect(statistics).toHaveAttribute('role', 'complementary');
      expect(await page.evaluate(() => document.body.style.position)).not.toBe('fixed');
    } else {
      await expect(statistics).toHaveAttribute('aria-modal', 'true');
      await page.keyboard.press('Tab');
      expect(await statistics.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.screenshot({ path: info.outputPath('deck-statistics.png') });
    const counts = await statistics.textContent();
    await page.getByRole('button', { name: '关闭卡组统计' }).click();
    await expect(toggle).toBeFocused();
    await page.getByRole('button', { name: '罕度', exact: true }).click();
    await page.getByRole('option', { name: 'P', exact: true }).click();
    await toggle.click();
    expect(await statistics.textContent()).toBe(counts);
    await page.getByRole('button', { name: '关闭卡组统计' }).click();
    await page.reload();
    await expect(page.getByText('开出了宝藏包', { exact: true })).toBeVisible();
    await toggle.click();
    expect(await statistics.textContent()).toBe(counts);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true
    );
    expect(errors).toEqual([]);
  });
}
