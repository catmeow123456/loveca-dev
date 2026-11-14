import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { prepareVisualPage } from '../visual/support/mockApp';

const root = fileURLToPath(new URL('../../../', import.meta.url));
test.use({ serviceWorkers: 'block' });

async function currentResult(page: Page, storePath: string) {
  return page.evaluate(async (path) => {
    const { useGameStore } = await import(path);
    const state = useGameStore.getState().gameSession.state;
    return {
      hand: state.players[0].hand.cardIds.length,
      score: state.liveResolution.playerScores.get(state.players[0].id) ?? null,
    };
  }, storePath);
}

test('第四批本地取得、声援实际判定、普通与表格视图及确认分数一致', async ({ page }, info) => {
  const errors: string[] = [];
  let storePath = '';
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/src/store/gameStore.ts') storePath = request.url();
  });
  await prepareVisualPage(page, info.project.name.startsWith('mobile') ? 'light' : 'dark', true);
  await page.route(/\/QA-HEX-[A-Z-]+\.webp(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="200"><rect width="140" height="200" fill="#f2e4ec"/><text x="70" y="100" text-anchor="middle" fill="#60455b" font-size="16">海克斯测试牌</text></svg>',
    })
  );
  await page.goto('/?page=game-setup');
  await page.getByRole('button', { name: '切换模式', exact: true }).click();
  await page.getByRole('option', { name: '双人调试', exact: true }).click();
  await page.getByText('海克斯测试 · 未启用', { exact: true }).click();
  const first = page.getByRole('group', { name: 'Player 1 的海克斯', exact: true });
  const names = ['拒绝赌博', '压根没漏儿', '恶魔形态', '来财', '关键暴击', '掀桌'];
  for (const name of names) await first.getByRole('checkbox', { name: new RegExp(name) }).check();
  await page.getByRole('button', { name: '开始对局', exact: true }).click();
  const mulligan = page.getByRole('dialog', { name: '换牌阶段', exact: true });
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await expect(mulligan).toHaveCount(0);
  await expect.poll(() => currentResult(page, storePath)).toEqual({ hand: 8, score: null });
  await page
    .locator('summary')
    .filter({ hasText: /^海克斯$/ })
    .click();
  const held = page.getByLabel('已持有海克斯', { exact: true });
  for (const name of names) {
    const entry = held.getByText(new RegExp(`^[银金彩] · ${name}$`));
    await entry.scrollIntoViewIfNeeded();
    await expect(entry).toBeVisible();
  }
  await page.screenshot({ path: info.outputPath('hextech-fourth-held.png') });
  await page.keyboard.press('Escape');
  await expect(held).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '主要阶段', exact: true })).toBeHidden();

  // Arrange only this isolated browser's local match. The cheer and acceptance use real commands.
  const prepared = await page.evaluate(
    async ({ repoRoot, storePath }) => {
      const load = (path: string) => import(`/@fs${repoRoot}${path}.ts`);
      const [
        { useGameStore },
        { registerCards, updatePlayer },
        { createCardInstance, createHeartRequirement },
        { addCardToStatefulZone, placeCardInSlot },
        { createConfirmStepCommand },
      ] = await Promise.all([
        import(storePath),
        load('src/domain/entities/game'),
        load('src/domain/entities/card'),
        load('src/domain/entities/zone'),
        load('src/application/game-commands'),
      ]);
      const store = useGameStore.getState();
      let state = store.gameSession.state;
      const playerId = state.players[0].id;
      const member = {
        cardCode: 'QA-HEX-M',
        name: '判心成员',
        nameCn: '判心成员',
        cardType: 'MEMBER',
        cost: 5,
        blade: 0,
        hearts: [],
      };
      const song = {
        cardCode: 'QA-HEX-L',
        name: '海克斯测试曲',
        nameCn: '海克斯测试曲',
        cardType: 'LIVE',
        score: 3,
        requirements: createHeartRequirement({ GRAY: 3, RED: 1 }),
      };
      const red = { effect: 'HEART', heartColor: 'RED' };
      const cards = [
        member,
        {
          ...song,
          cardCode: 'QA-HEX-DRAW',
          name: '原抽卡判LIVE',
          nameCn: '原抽卡判LIVE',
          bladeHearts: [{ effect: 'DRAW' }],
        },
        { ...member, cardCode: 'QA-HEX-RED', cost: 6, bladeHearts: [red] },
        { ...song, cardCode: 'QA-HEX-COLOR', bladeHearts: [red, red, red] },
        { ...member, cardCode: 'QA-HEX-7', cost: 7, bladeHearts: [{ effect: 'DRAW' }] },
      ];
      const stage = {
        ...member,
        cardCode: 'QA-HEX-STAGE',
        blade: 4,
        hearts: [{ color: 'PINK', count: 1 }],
      };
      store.loadCardData([...cards, stage, song]);
      state = registerCards(state, [
        ...cards.map((data, index) => createCardInstance(data, playerId, `cheer-${index}`)),
        createCardInstance(stage, playerId, 'hex-stage'),
        createCardInstance(song, playerId, 'hex-live'),
      ]);
      state = updatePlayer(state, playerId, (p: any) => ({
        ...p,
        mainDeck: {
          ...p.mainDeck,
          cardIds: [...cards.map((_, i) => `cheer-${i}`), ...p.mainDeck.cardIds],
        },
        memberSlots: placeCardInSlot(p.memberSlots, 'CENTER', 'hex-stage'),
        liveZone: addCardToStatefulZone(p.liveZone, 'hex-live'),
      }));
      state = {
        ...state,
        currentPhase: 'PERFORMANCE_PHASE',
        currentSubPhase: 'PERFORMANCE_LIVE_START_EFFECTS',
        activePlayerIndex: 0,
        waitingPlayerId: null,
      };
      store.gameSession.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
      const before = state.players[0].hand.cardIds.length;
      const result = store.gameSession.executeCommand(
        createConfirmStepCommand(playerId, 'PERFORMANCE_LIVE_START_EFFECTS')
      );
      useGameStore.setState({ viewingPlayerId: playerId });
      store.syncState();
      return {
        success: result.success,
        error: result.error,
        before,
        hand: store.gameSession.state.players[0].hand.cardIds.length,
        cheer: store.gameSession.state.liveResolution.firstPlayerCheerCardIds.length,
      };
    },
    { repoRoot: root, storePath }
  );
  expect(prepared).toMatchObject({ success: true, hand: 8, before: 8, cheer: 5 });
  const panel = page.locator('#judgment-panel');
  await expect(panel).toBeVisible();
  const outcome = panel.locator('[data-cheer-outcome]');
  await expect(outcome).toContainText(/分数\s*8/);
  await expect(outcome).toContainText(/抽卡\s*\+0/);
  await expect(outcome).toContainText(/应援音符 \+4/);
  await outcome.scrollIntoViewIfNeeded();
  await expect(outcome).toBeInViewport();
  await page.screenshot({ path: info.outputPath('hextech-fourth-judgment.png') });

  await page.keyboard.press('Control+Alt+KeyE');
  await expect(panel).toContainText('预计分数 8');
  const drawRow = panel
    .getByRole('table', { name: '应援牌', exact: true })
    .getByRole('row')
    .filter({ hasText: 'QA-HEX-DRAW' });
  await expect(drawRow).toContainText('分数 +2');
  await expect(drawRow.locator('td[title^="本次判定"]')).toHaveAttribute(
    'title',
    '本次判定：分数 +2；印刷判定：抽卡 +1'
  );
  await panel.scrollIntoViewIfNeeded();
  await expect(drawRow).toBeInViewport();
  await page.screenshot({ path: info.outputPath('hextech-fourth-excel.png') });
  await panel.getByRole('button', { name: '接受自动判定', exact: true }).click();
  await expect.poll(() => currentResult(page, storePath)).toEqual({ hand: 8, score: 8 });
  expect(errors).toEqual([]);
});
