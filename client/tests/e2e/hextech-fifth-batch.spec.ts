import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { prepareVisualPage } from '../visual/support/mockApp';

const root = fileURLToPath(new URL('../../../', import.meta.url));
test.use({ serviceWorkers: 'block' });

test('第五批取得检索、会玩与待机彼方在共享牌桌完成真实命令', async ({ page }, info) => {
  const errors: string[] = [];
  let storePath = '';
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/src/store/gameStore.ts') storePath = request.url();
  });
  await prepareVisualPage(page, info.project.name.startsWith('mobile') ? 'light' : 'dark', true);
  await page.route(/\/QA-KANATA\.webp(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="200"><rect width="140" height="200" fill="#ead5df"/><text x="70" y="100" text-anchor="middle">近江彼方</text></svg>',
    })
  );
  await page.goto('/?page=game-setup');
  await page.getByRole('button', { name: '切换模式', exact: true }).click();
  await page.getByRole('option', { name: '双人调试', exact: true }).click();
  await page.getByText('海克斯测试 · 未启用', { exact: true }).click();
  const first = page.getByRole('group', { name: 'Player 1 的海克斯', exact: true });
  for (const name of ['我为歌狂', '会玩', '好好睡好好睡'])
    await first.getByRole('checkbox', { name: new RegExp(name) }).check();
  await page.getByRole('button', { name: '开始对局', exact: true }).click();
  const mulligan = page.getByRole('dialog', { name: '换牌阶段', exact: true });
  await expect(mulligan).toBeVisible();
  // Arrange a reproducible opening hand in this isolated local match only.
  await page.evaluate(async (path) => {
    const { useGameStore } = await import(path);
    const store = useGameStore.getState();
    const game = store.gameSession.state;
    const player = game.players[0];
    const all = [...player.hand.cardIds, ...player.mainDeck.cardIds];
    const hand = all
      .filter((id: string) => game.cardRegistry.get(id).data.cardType === 'MEMBER')
      .slice(0, 6);
    const next = {
      ...game,
      players: [
        {
          ...player,
          hand: { ...player.hand, cardIds: hand },
          mainDeck: { ...player.mainDeck, cardIds: all.filter((id: string) => !hand.includes(id)) },
        },
        game.players[1],
      ],
    };
    store.gameSession.restoreRuntimeState({
      authorityState: next,
      currentPublicSeq: store.gameSession.getCurrentPublicEventSeq(),
    });
    store.syncState();
  }, storePath);
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  const search = page.getByRole('dialog', { name: '我为歌狂', exact: true });
  await expect(search).toBeVisible();
  await expect(search).toContainText('需要 6 张');
  await expect(search.getByRole('button', { name: '确认检索', exact: true })).toBeDisabled();
  for (let i = 0; i < 6; i++) await search.getByRole('checkbox').nth(i).check();
  await search.getByRole('button', { name: '查看详情', exact: true }).first().click();
  await page.screenshot({ path: info.outputPath('hextech-search.png') });
  await search.getByRole('button', { name: '确认检索', exact: true }).click();
  await expect(search).toHaveCount(0);
  const handCount = () =>
    page.evaluate(async (path) => {
      const { useGameStore } = await import(path);
      return useGameStore.getState().gameSession.state.players[0].hand.cardIds.length;
    }, storePath);
  await expect.poll(handCount).toBe(7);
  await page
    .locator('summary')
    .filter({ hasText: /^海克斯$/ })
    .click();
  await page.getByRole('button', { name: '发动会玩', exact: true }).click();
  const well = page.getByRole('dialog', { name: '会玩', exact: true });
  await expect(well).toBeVisible();
  for (const checkbox of await well.getByRole('checkbox').all()) await checkbox.check();
  await page.screenshot({ path: info.outputPath('hextech-discard.png') });
  await well.getByRole('button', { name: '确认发动', exact: true }).click();
  await expect(well).toHaveCount(0);
  await expect.poll(handCount).toBe(8);
  await page
    .locator('summary')
    .filter({ hasText: /^海克斯$/ })
    .click();
  await expect(page.getByRole('button', { name: '发动会玩', exact: true })).toHaveCount(0);

  await page.evaluate(
    async ({ path, repoRoot }) => {
      const [
        { useGameStore },
        { registerCards, updatePlayer },
        { createCardInstance },
        { placeCardInSlot },
      ] = await Promise.all([
        import(path),
        import(`/@fs${repoRoot}src/domain/entities/game.ts`),
        import(`/@fs${repoRoot}src/domain/entities/card.ts`),
        import(`/@fs${repoRoot}src/domain/entities/zone.ts`),
      ]);
      const store = useGameStore.getState();
      let game = store.gameSession.state;
      const playerId = game.players[0].id;
      const card = {
        cardCode: 'QA-KANATA',
        name: '近江 彼方',
        nameCn: '近江彼方',
        cardType: 'MEMBER',
        cost: 1,
        blade: 1,
        hearts: [],
      };
      store.loadCardData([card]);
      game = registerCards(game, [createCardInstance(card, playerId, 'qa-kanata')]);
      game = updatePlayer(game, playerId, (p: any) => ({
        ...p,
        memberSlots: placeCardInSlot(p.memberSlots, 'CENTER', 'qa-kanata'),
      }));
      store.gameSession.restoreRuntimeState({
        authorityState: game,
        currentPublicSeq: store.gameSession.getCurrentPublicEventSeq(),
      });
      store.syncState();
    },
    { path: storePath, repoRoot: root }
  );
  await page.getByRole('button', { name: '发动好好睡好好睡', exact: true }).click();
  const sleep = page.getByRole('dialog', { name: '好好睡好好睡', exact: true });
  await sleep.getByRole('checkbox').check();
  await sleep.getByRole('button', { name: '确认发动', exact: true }).click();
  await expect(sleep).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        const { useGameStore } = await import(path);
        const store = useGameStore.getState();
        return {
          orientation:
            store.gameSession.state.players[0].memberSlots.cardStates.get('qa-kanata').orientation,
          bonus: store.playerViewState.match.liveResult.scoreModifiers.FIRST,
        };
      }, storePath)
    )
    .toEqual({ orientation: 'WAITING', bonus: 2 });
  await page.screenshot({ path: info.outputPath('hextech-rested.png') });
  const authorityCursor = () =>
    page.evaluate(async (path) => {
      const { useGameStore } = await import(path);
      const session = useGameStore.getState().gameSession;
      return {
        action: session.state.actionSequence,
        command: session.getCommandLogSince(0).length,
        public: session.getCurrentPublicEventSeq(),
      };
    }, storePath);
  const beforeBrowse = await authorityCursor();
  const summary = page.locator('summary').filter({ hasText: /^海克斯$/ });
  await summary.click();
  await page.getByRole('button', { name: '查看海克斯池', exact: true }).click();
  const pool = page.getByRole('dialog', { name: '海克斯池', exact: true });
  await expect(pool.getByRole('article')).toHaveCount(24);
  await pool.getByRole('tab', { name: '金色', exact: true }).click();
  await expect(pool.getByRole('article')).toHaveCount(7);
  await pool.getByRole('button', { name: '关闭海克斯池', exact: true }).click();
  await expect(pool).toHaveCount(0);
  await expect(summary).toBeFocused();
  expect(await authorityCursor()).toEqual(beforeBrowse);
  expect(errors).toEqual([]);
});
