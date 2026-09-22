import { expect, test } from '@playwright/test';
import { GamePhase, SubPhase } from '../../../src/shared/types/enums';
import { aiBrowserFixture } from './ai-battle-fixture';

// QA: both public seats stay clickable above the AI toolbar; switching is read-only,
// survives snapshot polling, and works at desktop/mobile sizes with reduced motion.
for (const width of [1600, 390]) {
  test(`AI 判定区 ${width}：先后攻切换不被工具栏遮挡`, async ({ page }, info) => {
    test.skip(info.project.name !== 'tablet-1024x768');
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const f = await aiBrowserFixture(page);
    try {
      const created = await f.create();
      const match = f.matches.getMatch(created.session.matchId)!;
      Object.assign(match.session.state!, {
        turnCount: 2,
        currentPhase: GamePhase.PERFORMANCE_PHASE,
        currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
        activePlayerIndex: 0,
        waitingPlayerId: null,
      });
      await page.goto('/?page=ai-battle-admin');
      await page.getByRole('button', { name: '继续对局', exact: true }).click();
      const panel = page.getByRole('dialog', { name: '判定区', exact: true });
      await expect(panel).toBeVisible();
      const first = panel.getByRole('button', { name: /查看先攻玩家/ });
      const second = panel.getByRole('button', { name: /查看后攻玩家/ });
      const before = { writes: f.state.writes.length, calls: f.state.modelCalls };
      await page.screenshot({
        path: `../output/playwright/ai-battle/judgment-before-${width}.png`,
      });
      await second.click();
      await expect(second).toHaveAttribute('aria-pressed', 'true');
      await expect(panel).toContainText('此视图仅供查看');
      const snapshots = f.state.snapshots;
      await expect.poll(() => f.state.snapshots).toBeGreaterThan(snapshots + 1);
      await expect(second).toHaveAttribute('aria-pressed', 'true');
      await page.screenshot({
        path: `../output/playwright/ai-battle/judgment-second-${width}.png`,
      });
      await first.click();
      await expect(first).toHaveAttribute('aria-pressed', 'true');
      await expect(panel).not.toContainText('此视图仅供查看');
      expect({ writes: f.state.writes.length, calls: f.state.modelCalls }).toEqual(before);
      await page.screenshot({ path: `../output/playwright/ai-battle/judgment-first-${width}.png` });
      await panel.getByRole('button', { name: '收起判定区', exact: true }).click();
      await expect(panel).toHaveCount(0);
      await page.getByRole('button', { name: '观察', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'AI 决定观察', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '关闭决定观察', exact: true }).click();
      await page.getByRole('button', { name: '返回 AI 会话列表，保留对局', exact: true }).click();
      await expect(page.getByRole('button', { name: '继续对局', exact: true })).toBeVisible();
    } finally {
      await f.close();
    }
  });
}
