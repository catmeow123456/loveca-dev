import { readFile, mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { aiBrowserFixture } from './ai-battle-fixture';
import { createHeartRequirement, type AnyCardData } from '../../../src/domain/entities/card';
import { CardType, HeartColor } from '../../../src/shared/types/enums';
import type { CardDbRecord } from '../../src/lib/cardService';

// Read a frozen snapshot of the local public card API. No database writes or model calls.
async function publishedFixture() {
  const path = process.env.LOVECA_AI_UI_CARDS;
  if (!path) throw new Error('LOVECA_AI_UI_CARDS must point to a local public /api/cards snapshot');
  const { data: records } = JSON.parse(await readFile(path, 'utf8')) as { data: CardDbRecord[] };
  const cards = records.map((r): AnyCardData => {
    const base = {
      cardCode: r.card_code,
      name: r.name_cn ?? r.name_jp ?? r.card_code,
      nameCn: r.name_cn ?? undefined,
      nameJp: r.name_jp ?? undefined,
      groupNames: r.group_names ?? undefined,
      unitName: r.unit_name ?? undefined,
      cardText: r.card_text_cn ?? r.card_text_jp ?? undefined,
      cardTextCn: r.card_text_cn ?? undefined,
      cardTextJp: r.card_text_jp ?? undefined,
      imageFilename: r.image_filename ?? undefined,
      imageSourceUri: r.image_source_uri ?? undefined,
      rare: r.rare ?? undefined,
      bladeHearts: r.blade_hearts ?? undefined,
    };
    if (r.card_type === 'MEMBER')
      return {
        ...base,
        cardType: CardType.MEMBER,
        cost: r.cost ?? 0,
        blade: r.blade ?? 0,
        hearts: r.hearts,
      };
    if (r.card_type === 'LIVE')
      return {
        ...base,
        cardType: CardType.LIVE,
        score: r.score ?? 0,
        requirements: createHeartRequirement(
          r.requirements.reduce(
            (acc, h) => {
              acc[h.color] = (acc[h.color] ?? 0) + h.count;
              return acc;
            },
            {} as Partial<Record<HeartColor, number>>
          )
        ),
      };
    return { ...base, cardType: CardType.ENERGY };
  });
  return { records, cards };
}

test.describe('管理员双 AI 建局与共享观战窗口', () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== 'tablet-1024x768', '显式验证宽屏和窄屏');
    await mkdir('../output/playwright/ai-battle', { recursive: true });
  });

  for (const width of [1600, 390]) {
    test(`${width}：建局自动观战、切换双方视角、观察与结束`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const f = await aiBrowserFixture(page, undefined, await publishedFixture());
      try {
        await page.goto('/?page=ai-battle-admin');
        await page.getByRole('radio', { name: 'AI vs AI', exact: true }).check();
        await page
          .getByRole('combobox', { name: '先手 AI 构筑', exact: true })
          .selectOption('blue-purple-nijigasaki');
        await expect(
          page.getByRole('combobox', { name: '先手 AI 对局手册', exact: true })
        ).toHaveValue('blue-purple-nijigasaki-tempo');
        await expect(page.getByRole('radio', { name: '真人先手', exact: true })).toHaveCount(0);
        await page.screenshot({
          path: `../output/playwright/ai-battle/self-play-setup-${width}.png`,
          fullPage: true,
        });
        const popupPromise = page.waitForEvent('popup');
        await page.getByRole('button', { name: '创建双 AI 对局并观战', exact: true }).click();
        const popup = await popupPromise;
        await popup.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await popup.waitForURL(/\/online\/spectate\//);
        await expect(popup.getByText('玩家视角观战', { exact: false })).toBeVisible();
        await expect(popup.getByText('AI 先手', { exact: false }).first()).toBeVisible();
        const sessions = f.service.listSessions(f.owner);
        expect(sessions).toHaveLength(1);
        expect(sessions[0]!.mode).toBe('AI_VS_AI');
        await expect.poll(() => f.state.modelCalls).toBeGreaterThan(1);
        await expect
          .poll(() =>
            f.service
              .listDecisions(f.owner, sessions[0]!.matchId)
              .decisions.some((d) => d.id.startsWith('SECOND:'))
          )
          .toBe(true);
        await popup.getByRole('button', { name: '后攻视角', exact: true }).click();
        await expect(popup.getByText('AI 后手', { exact: false }).first()).toBeVisible();
        await expect(popup.getByRole('button', { name: '后攻视角', exact: true })).toBeDisabled();
        await popup.getByRole('button', { name: '先攻视角', exact: true }).click();
        await expect(popup.getByRole('button', { name: '先攻视角', exact: true })).toBeDisabled();
        await popup.screenshot({
          path: `../output/playwright/ai-battle/self-play-spectator-${width}.png`,
        });
        expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        await page.getByRole('button', { name: '观察材料', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'AI 决定观察', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '关闭决定观察', exact: true }).click();
        await expect
          .poll(() =>
            f.service.exportDecisions(f.owner, sessions[0]!.matchId).decisions.some(
              (decision) =>
                decision.purpose === 'LIVE_SET' &&
                decision.events.some((event) => event.stage === 'MODEL_VALIDATION')
            )
          )
          .toBe(true);
        expect(f.service.getSession(f.owner, sessions[0]!.matchId).consecutiveFailures).toBe(0);
        await page.getByRole('button', { name: '结束', exact: true }).click();
        await page.getByRole('button', { name: '结束调试对局', exact: true }).click();
        await expect.poll(() => f.matches.getMatch(sessions[0]!.matchId)).toBeNull();
        expect(
          f.state.writes.some((path) => path.endsWith('/command') || path.endsWith('/advance'))
        ).toBe(false);
        await popup.close();
      } finally {
        await f.close();
      }
    });
  }

  test('弹窗被拦截时保留会话与手动观战入口，不重复建局', async ({ page }) => {
    const f = await aiBrowserFixture(page, undefined, await publishedFixture());
    await page.addInitScript(() => {
      window.open = () => null;
    });
    try {
      await page.goto('/?page=ai-battle-admin');
      await page.getByRole('radio', { name: 'AI vs AI', exact: true }).check();
      await page.getByRole('button', { name: '创建双 AI 对局并观战', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('浏览器阻止了观战窗口');
      await expect(page.getByRole('link', { name: '打开观战窗口', exact: true })).toHaveAttribute(
        'href',
        /\/online\/spectate\//
      );
      await expect(
        page.getByRole('button', { name: '创建双 AI 对局并观战', exact: true })
      ).toBeDisabled();
      await page.getByRole('button', { name: '进入观战', exact: true }).click();
      expect(f.service.listSessions(f.owner)).toHaveLength(1);
      expect(f.state.writes.filter((path) => path.endsWith('/self-play-sessions'))).toHaveLength(1);
    } finally {
      await f.close();
    }
  });

  test('建局失败关闭空白弹窗并允许重试', async ({ page }) => {
    const f = await aiBrowserFixture(page, undefined, await publishedFixture());
    await page.route('**/api/admin/ai-battle/self-play-sessions', (route) =>
      route.fulfill({
        status: 503,
        json: { data: null, error: { code: 'AI_SETUP_FAILED', message: '模型配置暂不可用' } },
      })
    );
    try {
      await page.goto('/?page=ai-battle-admin');
      await page.getByRole('radio', { name: 'AI vs AI', exact: true }).check();
      await page.getByRole('button', { name: '创建双 AI 对局并观战', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('模型配置暂不可用');
      await expect.poll(() => page.context().pages().length).toBe(1);
      await expect(
        page.getByRole('button', { name: '创建双 AI 对局并观战', exact: true })
      ).toBeEnabled();
      expect(f.service.listSessions(f.owner)).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
});
