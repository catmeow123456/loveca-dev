import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { prepareVisualPage, installVisualApiMocks } from '../visual/support/mockApp';

test.use({ serviceWorkers: 'block' });
const root = fileURLToPath(new URL('../../../', import.meta.url));

test('黑暗池24项可筛选，最新代价和纵列规则可读', async ({ page }, info) => {
  await prepareVisualPage(page, 'dark', false);
  await page.goto('/?page=hextech-pool');
  await page.getByRole('tab', { name: '黑暗池', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(24);
  await expect(page.getByRole('article').filter({ hasText: '站位事故' })).toContainText(
    '【获得时】'
  );
  await expect(page.getByRole('article').filter({ hasText: '场地抽签落空' })).toHaveCount(0);
  await expect(page.getByRole('article').filter({ hasText: '独唱附加题' })).toContainText(
    '该LIVE灰心需求+1'
  );
  await expect(page.getByRole('article').filter({ hasText: '两头赶场' })).toContainText(
    '从第2张起各自灰心需求+1（成员牌不计入顺序）'
  );
  await expect(page.getByRole('article').filter({ hasText: '挑战大招' })).toContainText(
    '基础声援数量+4，每张LIVE灰心需求+1'
  );
  for (const rarity of ['银色', '金色', '彩色']) {
    await page.getByRole('tab', { name: rarity, exact: true }).click();
    await expect(page.getByRole('article')).toHaveCount(8);
  }
  await expect(page.getByRole('article').filter({ hasText: '突然断电' })).toContainText(
    '除本效果外'
  );
  await expect(page.getByRole('article').filter({ hasText: '寂静聚光灯' })).toContainText(
    '支付2能量并将1张手牌'
  );
  await expect(page.getByRole('article').filter({ hasText: '开场失声' })).toContainText(
    '第2、3格LIVE各自灰心需求+1'
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true
  );
  await page.screenshot({ path: info.outputPath('dark-pool.png'), fullPage: true });
});

test('站位事故获得时选择对方成员和镜像位置，完成后不再提供发动入口', async ({ page }, info) => {
  let storePath = '';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/src/store/gameStore.ts') storePath = request.url();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installVisualApiMocks(page, true);
  await page.goto('/?page=game-setup');
  await page.getByRole('button', { name: '切换模式', exact: true }).click();
  await page.getByRole('option', { name: '双人调试', exact: true }).click();
  await page.getByRole('button', { name: '开始对局', exact: true }).click();
  const mulligan = page.getByRole('dialog', { name: '换牌阶段', exact: true });
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await expect(mulligan).toHaveCount(0);
  await expect(page.locator('[data-phase-announcement]')).toHaveCount(0);

  // Prepare this isolated local match only; every choice below uses the shared effect panel.
  await page.evaluate(
    async ({ root, storePath }) => {
      const load = (path: string) => import(`/@fs${root}${path}.ts`);
      const [
        { useGameStore },
        { registerCards, updatePlayer },
        { createCardInstance },
        { placeCardInSlot },
        { acquireHextechBatch },
      ] = await Promise.all([
        import(storePath),
        load('src/domain/entities/game'),
        load('src/domain/entities/card'),
        load('src/domain/entities/zone'),
        load('src/application/hextech/acquire'),
      ]);
      const store = useGameStore.getState();
      let state = store.gameSession.state;
      const ownerId = state.players[0].id;
      const opponentId = state.players[1].id;
      const data = {
        cardCode: 'QA-POSITION-M',
        name: '换位测试成员',
        nameCn: '换位测试成员',
        cardType: 'MEMBER',
        cost: 15,
        blade: 3,
        hearts: [],
      };
      store.loadCardData([data]);
      state = registerCards(state, [
        createCardInstance(data, opponentId, 'mishap-target'),
        createCardInstance(data, opponentId, 'mishap-swapped'),
      ]);
      state = updatePlayer(state, opponentId, (player: any) => ({
        ...player,
        memberSlots: placeCardInSlot(
          placeCardInSlot(player.memberSlots, 'CENTER', 'mishap-target'),
          'LEFT',
          'mishap-swapped'
        ),
      }));
      state = acquireHextechBatch(
        { ...state, hextech: { rulesVersion: 'DARK_HEXTECH_V1', owned: [] } },
        [{ playerId: ownerId, definitionId: 'dark-position-mishap', instanceId: 'mishap-test' }],
        () => 0
      ).gameState;
      store.gameSession.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
      useGameStore.setState({ viewingPlayerId: ownerId });
      store.syncState();
    },
    { root, storePath }
  );
  const readState = () =>
    page.evaluate(async (path) => {
      const { useGameStore } = await import(path);
      const state = useGameStore.getState().gameSession.state;
      return {
        step: state.activeEffect?.stepId,
        slots: state.players[1].memberSlots.slots,
        modifiers: state.liveResolution.liveModifiers.filter(
          (m: any) => m.sourceHextechInstanceId === 'mishap-test'
        ),
      };
    }, storePath);
  await expect.poll(async () => (await readState()).step).toBe('HEXTECH_POSITION_TARGET');
  await page.getByRole('group', { name: '效果候选卡牌' }).getByRole('button').nth(1).click();
  await expect.poll(async () => (await readState()).step).toBe('HEXTECH_POSITION_DESTINATION');
  await expect(
    page.getByRole('button', { name: '移至对方左侧（你视角右侧）', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '移至对方右侧（你视角左侧）', exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('mishap-destination.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '移至对方左侧（你视角右侧）', exact: true }).click();
  await expect.poll(async () => (await readState()).step).toBeUndefined();
  const result = await readState();
  expect(result.slots).toEqual({ LEFT: 'mishap-target', CENTER: 'mishap-swapped', RIGHT: null });
  expect(result.modifiers).toEqual([
    expect.objectContaining({ targetMemberCardId: 'mishap-target', countDelta: -2 }),
  ]);
  await page
    .locator('summary')
    .filter({ hasText: /^黑暗海克斯$/ })
    .click();
  await expect(page.getByLabel('已持有海克斯')).toContainText('所选成员棒−2');
  await expect(page.getByRole('button', { name: '发动站位事故', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('双人调试选择黑暗池，起动弃牌与最终支付走共享效果面板', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installVisualApiMocks(page, true);
  await page.goto('/?page=game-setup');
  await page.getByRole('button', { name: '切换模式', exact: true }).click();
  await page.getByRole('option', { name: '双人调试', exact: true }).click();
  await page.getByRole('combobox', { name: '海克斯卡池' }).selectOption('DARK');
  await page.getByText('海克斯测试 · 未启用', { exact: true }).click();
  await page
    .getByRole('group', { name: 'Player 1 的海克斯', exact: true })
    .getByRole('checkbox', { name: /先借再还/ })
    .check();
  await page
    .getByRole('group', { name: 'Player 1 的海克斯', exact: true })
    .getByRole('checkbox', { name: /开场失声/ })
    .check();
  await page.getByRole('button', { name: '开始对局', exact: true }).click();
  const mulligan = page.getByRole('dialog', { name: '换牌阶段', exact: true });
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await expect(mulligan).toHaveCount(0);
  await expect(page.locator('[data-phase-announcement]')).toHaveCount(0);
  const compactBoard = (page.viewportSize()?.width ?? 0) < 768;
  if (compactBoard) {
    await page.getByRole('button', { name: /^P2 .*切换至此视角$/ }).click();
  }
  await expect(page.getByText('首格封麦', { exact: true })).toHaveCount(1);
  await expect(page.getByText('灰心+1', { exact: true })).toHaveCount(2);
  for (const slotIndex of [1, 2]) {
    await expect(
      page.locator(`[data-battle-live-slot="${slotIndex}"]`).getByText('灰心+1', { exact: true })
    ).toBeVisible();
  }
  await page.screenshot({
    path: info.outputPath('dark-placement-hints.png'),
    animations: 'disabled',
  });
  if (compactBoard) {
    await page.getByRole('button', { name: /^P1 .*切换至此视角$/ }).click();
  }
  const state = () =>
    page.evaluate(async () => {
      const path = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes('/src/store/gameStore.ts'))!;
      const { useGameStore } = await import(path);
      const game = useGameStore.getState().gameSession.state;
      return {
        hand: game.players[0].hand.cardIds.length,
        uses: game.hextech.uses?.length ?? 0,
        step: game.activeEffect?.stepId,
      };
    });
  const before = await state();
  await page
    .locator('summary')
    .filter({ hasText: /^黑暗海克斯$/ })
    .click();
  await page.getByRole('button', { name: '发动先借再还', exact: true }).click();
  await page.getByRole('button', { name: '确认发动', exact: true }).click();
  await expect.poll(async () => (await state()).step).toBe('HEXTECH_DISCARD');
  await page.screenshot({ path: info.outputPath('dark-activation-choice.png') });
  const candidates = page.getByRole('group', { name: '效果候选卡牌' }).getByRole('button');
  await candidates.first().click();
  await page.getByRole('button', { name: /^继续/ }).click();
  await expect.poll(async () => (await state()).step).toBe('HEXTECH_CONFIRM');
  await page.getByRole('button', { name: /^支付并发动/ }).click();
  await expect.poll(state).toEqual({ hand: before.hand + 3, uses: 1, step: undefined });
  await page
    .locator('summary')
    .filter({ hasText: /^黑暗海克斯$/ })
    .click();
  await expect(page.getByLabel('已持有海克斯')).toContainText('本局已使用');
  await expect(page.getByRole('button', { name: '发动先借再还', exact: true })).toHaveCount(0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: info.outputPath('dark-used.png'), animations: 'disabled' });
});
