import { expect, test, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { OnlineRoomView } from '../../../src/online';
import { DEFAULT_BATTLE_TIMEOUT_CONFIG } from '../../../src/online/ranked-policy';
import { installVisualApiMocks } from '../visual/support/mockApp';

const root = fileURLToPath(new URL('../../../', import.meta.url));

declare global {
  interface Window {
    battleLayoutStoreUrl: string;
  }
}

// Exercise the production room page and shared board using a projected, in-memory match.
// All account, room, and match HTTP requests stay inside browser routes.
async function openJudgmentRoom(page: Page, local = false, dismissHelp = true) {
  await installVisualApiMocks(page, true);
  await page.route('**/site-status.json*', (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        availability: 'OPEN',
        generatedAt: new Date().toISOString(),
        maintenance: null,
      },
    })
  );
  await page.route('**/images/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/static/deck.png')) {
      return route.fulfill({ path: `${root}assets/deck.png` });
    }
    if (path.endsWith('/back.webp')) {
      return route.fulfill({ path: `${root}assets/back.jpg` });
    }
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140" viewBox="0 0 100 140"><rect width="100" height="140" rx="6" fill="#30203a"/><path d="M56 24 30 78h21l-8 38 30-58H52Z" fill="#e95678"/><rect x="4" y="4" width="92" height="132" rx="4" fill="none" stroke="#d8a8cc"/></svg>',
    });
  });
  await page.goto('/');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = performance
          .getEntriesByType('resource')
          .find((entry) => entry.name.includes('/src/store/gameStore.ts'))?.name;
        if (!path) return 0;
        const { useGameStore } = await import(path);
        return useGameStore.getState().cardDataRegistry.size;
      })
    )
    .toBeGreaterThan(0);

  const snapshot = await page.evaluate(async (repoRoot) => {
    const storePath = performance
      .getEntriesByType('resource')
      .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
    // Retain the app's module identity before fake clocks replace Performance.
    window.battleLayoutStoreUrl = storePath;
    const enumsPath = `/@fs${repoRoot}src/shared/types/enums.ts`;
    const serdePath = `/@fs${repoRoot}src/online/serde.ts`;
    const [{ useGameStore }, { GamePhase, SubPhase }, { toTransport }] = await Promise.all([
      import(storePath),
      import(enumsPath),
      import(serdePath),
    ]);
    const store = useGameStore.getState();
    const cards = Array.from(store.cardDataRegistry.values()) as Array<{ cardType: string }>;
    const members = cards.filter((card) => card.cardType === 'MEMBER');
    const lives = cards.filter((card) => card.cardType === 'LIVE');
    const energy = cards.find((card) => card.cardType === 'ENERGY');
    const deck = {
      mainDeck: [...members.flatMap((card) => Array(4).fill(card)), ...lives],
      energyDeck: Array(12).fill(energy),
    };
    store.createGame('layout-match', 'visual-user', '视觉验收玩家', 'opponent', '对手');
    store.initializeGame(deck, deck);
    Object.assign(store.gameSession.state, {
      turnCount: 2,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      activePlayerIndex: 0,
      waitingPlayerId: null,
    });
    store.syncState();
    return toTransport({
      matchId: 'layout-match',
      seat: 'FIRST',
      playerId: 'visual-user',
      seq: store.playerViewState?.match.seq ?? 0,
      currentPublicSeq: 0,
      playerViewState: useGameStore.getState().playerViewState,
      publicEvents: [],
    });
  }, root);
  if (local) {
    await page.evaluate(async () => {
      const reactPath = performance
        .getEntriesByType('resource')
        .find((entry) => /\/react\.js(?:\?|$)/.test(entry.name))!.name;
      const domPath = performance
        .getEntriesByType('resource')
        .find((entry) => /\/react-dom_client\.js(?:\?|$)/.test(entry.name))!.name;
      const boardPath = '/src/components/game/GameBoard.tsx';
      const shellPath = '/src/components/game/BattleViewportShell.tsx';
      const [reactModule, domModule, { GameBoard }, { BattleViewportShell }] = await Promise.all([
        import(reactPath),
        import(domPath),
        import(boardPath),
        import(shellPath),
      ]);
      const React = reactModule.default ?? reactModule;
      const dom = domModule.default ?? domModule;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:99999';
      document.body.append(host);
      const actions = { restart: 0, leave: 0 };
      Object.assign(window, { layoutActions: actions });
      dom.createRoot(host).render(
        React.createElement(
          BattleViewportShell,
          null,
          React.createElement(GameBoard, {
            onRestartGame: () => {
              actions.restart += 1;
            },
            onLeaveLocalGame: () => {
              actions.leave += 1;
            },
          })
        )
      );
    });
    return;
  }
  const room: OnlineRoomView = {
    roomCode: 'LAYOUT',
    originKind: 'ONLINE_ROOM',
    status: 'IN_GAME',
    battleTimeouts: DEFAULT_BATTLE_TIMEOUT_CONFIG,
    ownerUserId: 'visual-user',
    currentUserId: 'visual-user',
    currentUserRole: 'HOST',
    currentUserPresence: 'ACTIVE',
    currentUserSeat: 'FIRST',
    members: ['visual-user', 'opponent'].map((userId, index) => ({
      userId,
      displayName: index === 0 ? '视觉验收玩家' : '对手',
      role: index === 0 ? 'HOST' : 'GUEST',
      presence: 'ACTIVE',
      lockedDeckId: 'visual-deck',
      lockedDeckName: '测试卡组',
      ready: true,
      startReady: true,
      seat: index === 0 ? 'FIRST' : 'SECOND',
    })),
    openingRps: null,
    openingArrivalExpiresAt: null,
    restartRequest: null,
    endInfo: null,
    matchId: 'layout-match',
    spectatorRoomEntry: null,
    spectatorPresence: { total: 0, viewers: [] },
    updatedAt: Date.now(),
  };
  await page.route('**/api/online/rooms/LAYOUT**', (route) =>
    route.fulfill({ json: { data: room, error: null } })
  );
  await page.route('**/api/online/matches/layout-match/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/snapshot')
      ? snapshot
      : path.endsWith('/public-events')
        ? { events: [], hasMore: false, latestSeq: 0 }
        : { messages: [], hasMore: false };
    return route.fulfill({ json: { data, error: null } });
  });
  await page.evaluate(async () => {
    const path = '/src/lib/casualNavigation.ts';
    const { openCasualDestination } = await import(path);
    openCasualDestination('online-room', 'LAYOUT');
  });
  if (dismissHelp) {
    await page.getByRole('button', { name: '跳过提示', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '应援/判定区', exact: true })).toBeVisible();
  }
  return snapshot;
}

test('联机操作提示可以永久关闭并从设置重新打开', async ({ page }, info) => {
  test.skip(info.project.name !== 'tablet-1024x768');
  await openJudgmentRoom(page, false, false);
  const help = page.getByRole('dialog', { name: '联机对局提示' });
  await expect(help).toBeVisible();
  await help.getByRole('button', { name: '不再自动提示' }).click();
  await expect(help).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '应援/判定区', exact: true })).toBeVisible();
  const reopenRoom = async () => {
    await page.goto('/?page=battle-lobby');
    await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const { openCasualDestination } = await import('/src/lib/casualNavigation.ts');
      openCasualDestination('online-room', 'LAYOUT');
    });
  };
  await reopenRoom();
  await expect(page.getByRole('dialog', { name: '应援/判定区', exact: true })).toBeVisible();
  await expect(help).toHaveCount(0);
  await page.getByRole('button', { name: '对战设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '对战设置' });
  await expect(settings.locator('button').last()).toHaveText('操作提示');
  await settings.getByRole('button', { name: '操作提示', exact: true }).click();
  await expect(help).toBeVisible();
  await help.getByRole('button', { name: '跳过提示' }).click();
  await reopenRoom();
  await expect(page.getByRole('dialog', { name: '应援/判定区', exact: true })).toBeVisible();
  await expect(help).toHaveCount(0);
});

async function expectNoOverlap(first: Locator, second: Locator) {
  const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  const area =
    Math.max(0, Math.min(a!.x + a!.width, b!.x + b!.width) - Math.max(a!.x, b!.x)) *
    Math.max(0, Math.min(a!.y + a!.height, b!.y + b!.height) - Math.max(a!.y, b!.y));
  expect(area).toBe(0);
}

async function expectCandidateCardGeometry(grid: Locator, ratio: number) {
  // Check the actual face, including transforms; a correctly sized outer box can
  // still hide a squashed face during an initial flip.
  const faces = grid.locator('[data-card-surface] > div > img');
  await expect(faces.first()).toBeVisible();
  const boxes = await faces.evaluateAll((images) =>
    images.map((image) => {
      const { x, y, width, height } = image.getBoundingClientRect();
      return { x, y, width, height };
    })
  );
  for (const box of boxes) {
    expect(box.width / box.height).toBeCloseTo(ratio, 2);
    expect(box.width).toBeCloseTo(boxes[0].width, 1);
    expect(box.height).toBeCloseTo(boxes[0].height, 1);
  }
  const firstRow = boxes.filter((box) => Math.abs(box.y - boxes[0].y) < 1);
  expect(firstRow.length).toBeGreaterThan(1);
  for (let i = 1; i < firstRow.length; i++) {
    const gap = firstRow[i].x - firstRow[i - 1].x - firstRow[i - 1].width;
    expect(gap).toBeGreaterThanOrEqual(8);
    expect(gap).toBeLessThanOrEqual(24);
  }
}

async function readUndoPosition(page: Page) {
  return page.evaluate(async () => {
    const path = window.battleLayoutStoreUrl;
    const { useGameStore } = await import(path);
    const state = useGameStore.getState().gameSession.state;
    return {
      hand: state.players[0].hand.cardIds,
      waitingRoom: state.players[0].waitingRoom.cardIds,
      effectStep: state.activeEffect?.stepId ?? null,
    };
  });
}

async function prepareUndoEffect(page: Page, scenario: 'single' | 'multiple') {
  return page.evaluate(
    async ({ repoRoot, scenario }) => {
      const storePath = window.battleLayoutStoreUrl;
      const fixturePath = `/@fs${repoRoot}tests/helpers/recovery-animation-fixture.ts`;
      const [{ useGameStore }, { prepareRecoveryScenario }] = await Promise.all([
        import(storePath),
        import(fixturePath),
      ]);
      const store = useGameStore.getState();
      const fixture = prepareRecoveryScenario(scenario, store.gameSession);
      store.loadCardData(fixture.cardData);
      useGameStore.setState({ viewingPlayerId: 'p1', replaySession: null, remoteSession: null });
      const position = () => {
        const state = store.gameSession.state;
        return {
          hand: state.players[0].hand.cardIds,
          waitingRoom: state.players[0].waitingRoom.cardIds,
          effectStep: state.activeEffect?.stepId ?? null,
        };
      };
      const positions = [position()];
      for (let i = 0; i < (scenario === 'single' ? 2 : 1); i++) {
        const result = store.gameSession.executeCommand(fixture.nextCommand());
        if (!result.success) throw new Error(result.error);
        positions.push(position());
      }
      store.syncState();
      return positions;
    },
    { repoRoot: root, scenario }
  );
}

// Seed a legal starting position, then create undo history through real commands.
async function prepareEntryOverlay(page: Page, scene: 'special' | 'success') {
  await page.evaluate(
    async ({ repoRoot, scene }) => {
      const storePath = window.battleLayoutStoreUrl;
      const [
        { useGameStore },
        { prepareMiaEntranceScenario },
        { prepareRecoveryScenario },
        commands,
        entities,
        enums,
      ] = await Promise.all([
        import(storePath),
        import(`/@fs${repoRoot}tests/helpers/mia-entrance-fixture.ts`),
        import(`/@fs${repoRoot}tests/helpers/recovery-animation-fixture.ts`),
        import(`/@fs${repoRoot}src/application/game-commands.ts`),
        import(`/@fs${repoRoot}src/domain/entities/card.ts`),
        import(`/@fs${repoRoot}src/shared/types/enums.ts`),
      ]);
      const store = useGameStore.getState();
      useGameStore.setState({ viewingPlayerId: 'p1', remoteSession: null, replaySession: null });
      if (scene === 'special') {
        const fixture = prepareMiaEntranceScenario({ session: store.gameSession });
        store.loadCardData(fixture.cardData);
        const result = fixture.begin();
        if (!result.success) throw new Error(result.error);
      } else {
        const fixture = prepareRecoveryScenario('single', store.gameSession);
        store.loadCardData(fixture.cardData);
        const state = store.gameSession.state;
        const live = fixture.cards.find((card) => card.data.cardType === 'LIVE').data;
        const cards = Array.from({ length: 3 }, (_, i) =>
          entities.createCardInstance(live, 'p1', `success-live-${i}`)
        );
        const ids = cards.map((card) => card.instanceId);
        store.gameSession.authorityState = {
          ...state,
          cardRegistry: new Map([
            ...state.cardRegistry,
            ...cards.map((card) => [card.instanceId, card]),
          ]),
          currentPhase: enums.GamePhase.LIVE_RESULT_PHASE,
          currentSubPhase: enums.SubPhase.RESULT_SETTLEMENT,
          activeEffect: null,
          pendingAbilities: [],
          waitingPlayerId: null,
          waitingForInput: false,
          players: [
            {
              ...state.players[0],
              liveZone: {
                ...state.players[0].liveZone,
                cardIds: ids,
                cardStates: new Map(
                  ids.map((id) => [
                    id,
                    { face: enums.FaceState.FACE_UP, orientation: enums.OrientationState.ACTIVE },
                  ])
                ),
              },
            },
            state.players[1],
          ],
          liveResolution: {
            ...state.liveResolution,
            isInLive: true,
            performingPlayerId: 'p1',
            liveResults: new Map(ids.map((id) => [id, true])),
            liveWinnerIds: ['p1'],
            playerScores: new Map([
              ['p1', 4],
              ['p2', 1],
            ]),
            scoreConfirmedBy: ['p1', 'p2'],
            animationConfirmedBy: ['p1', 'p2'],
          },
        };
        const result = store.gameSession.executeCommand(
          commands.createTapEnergyCommand('p1', 'energy-0')
        );
        if (!result.success) throw new Error(result.error);
      }
      store.syncState();
    },
    { repoRoot: root, scene }
  );
  if (scene === 'success') {
    await expect(page.locator('[data-battle-ui-anchor="success-live-selection"]')).toBeVisible();
    const closeJudgment = page.getByRole('button', { name: '收起应援/判定区', exact: true });
    if (await closeJudgment.isVisible()) await closeJudgment.click();
  }
}

async function readEntryPosition(page: Page) {
  return page.evaluate(async () => {
    const path = window.battleLayoutStoreUrl;
    const { useGameStore } = await import(path);
    const state = useGameStore.getState().gameSession.state;
    const player = state.players[0];
    return {
      pending: !!state.pendingSpecialMemberPlay,
      hand: player.hand.cardIds,
      left: player.memberSlots.slots.LEFT,
      live: player.liveZone.cardIds,
      success: player.successZone.cardIds,
      paid: [...player.energyZone.cardStates.values()].filter(
        (entry) => entry.orientation === 'WAITING'
      ).length,
    };
  });
}

async function preparePublicDisplay(page: Page, scene: string, captureEntrance = false) {
  return page.evaluate(
    async ({ repoRoot, scene, captureEntrance }) => {
      const storePath = window.battleLayoutStoreUrl;
      const [{ useGameStore }, { preparePublicEffectDisplayScenario }] = await Promise.all([
        import(storePath),
        import(`/@fs${repoRoot}tests/helpers/public-effect-display-fixture.ts`),
      ]);
      const store = useGameStore.getState();
      const fixture = preparePublicEffectDisplayScenario(store.gameSession, scene);
      store.loadCardData(fixture.cardData);
      useGameStore.setState({ viewingPlayerId: 'p1', replaySession: null, remoteSession: null });
      store.syncState();
      const samples: number[][] = [];
      if (captureEntrance) {
        const started = performance.now();
        await new Promise<void>((resolve) => {
          const sample = () => {
            const cards = document.querySelectorAll(
              '[aria-label="本次公开的卡牌"] [data-battle-ui-object-id]'
            );
            if (cards.length === 2)
              samples.push(Array.from(cards, (card) => Number(getComputedStyle(card).opacity)));
            if (performance.now() - started >= 400) resolve();
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
      }
      return samples;
    },
    { repoRoot: root, scene, captureEntrance }
  );
}

async function readPublicDisplay(page: Page) {
  return page.evaluate(async () => {
    const path = window.battleLayoutStoreUrl;
    const state = (await import(path)).useGameStore.getState().gameSession.state;
    return {
      id: state.activeEffect?.id ?? null,
      step: state.activeEffect?.stepId ?? null,
      deadline:
        state.activeEffect?.publicRevealAutoAdvanceAt ??
        state.activeEffect?.publicCardSelectionAutoAdvanceAt ??
        state.activeEffect?.publicEffectChoiceAutoAdvanceAt ??
        null,
      hand: state.players[0].hand.cardIds,
      payload: state.actionHistory.at(-1)?.payload,
    };
  });
}

async function openPublicDisplayBoard(page: Page) {
  // Freeze rule deadlines after bootstrap; entrance motion is sampled with native time separately.
  await openJudgmentRoom(page, true);
  const time = Date.now();
  await page.clock.install({ time });
  await page.clock.pauseAt(time + 1000);
}

test.describe('对战工具栏与辅助面板', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'tablet-1024x768', '一个 project 内覆盖完整尺寸矩阵');
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('公开展示：正常动态逐张入场并在原卡位结束', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 640 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openJudgmentRoom(page, true);
    const samples = await preparePublicDisplay(page, 'reveal-live', true);
    expect(samples.some(([first, second]) => first > second && second < 1)).toBe(true);
    expect(samples.at(-1)).toEqual([1, 1]);
    const grid = page.getByRole('group', { name: '本次公开的卡牌', exact: true });
    await expectCandidateCardGeometry(grid, 7 / 5);
  });

  for (const width of [320, 1024]) {
    for (const scene of ['reveal-mixed', 'reveal-live']) {
      test(`公开展示：${width} ${scene} 保留双方可见性、截止时间与后续选择`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 320 ? 568 : 768 });
        await page.emulateMedia({
          reducedMotion: scene === 'reveal-live' ? 'no-preference' : 'reduce',
        });
        await openPublicDisplayBoard(page);
        await preparePublicDisplay(page, scene);
        const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
        const publicGrid = panel.getByRole('group', { name: '本次公开的卡牌', exact: true });
        await page.clock.runFor(500);
        await expectCandidateCardGeometry(publicGrid, scene === 'reveal-live' ? 7 / 5 : 5 / 7);
        await expect(publicGrid.getByRole('button')).toHaveCount(0);
        await expect(publicGrid.locator('[data-battle-ui-object-id="hand-0"]')).toHaveCount(0);
        await expect(panel.locator('[data-battle-ui-anchor="active-effect-confirm"]')).toBeHidden();
        const before = await readPublicDisplay(page);
        expect(before.step).toBe('COMMON_PUBLIC_REVEAL_DWELL');
        await page.screenshot({
          path: `../output/playwright/public-effect-display/${scene}-${width}.png`,
        });
        await page.evaluate(async () => {
          const path = window.battleLayoutStoreUrl;
          (await import(path)).useGameStore.getState().setViewingPlayer('p2');
        });
        await expect(publicGrid.locator('[data-card-surface]')).toHaveCount(2);
        expect(
          await page.evaluate(async () => {
            const path = window.battleLayoutStoreUrl;
            return !!(await import(path)).useGameStore.getState().playerViewState.objects[
              'obj_hand-0'
            ]?.frontInfo;
          })
        ).toBe(false);
        // Return to the acting player; re-projection must keep the same authority deadline.
        await page.evaluate(async () => {
          const path = window.battleLayoutStoreUrl;
          (await import(path)).useGameStore.getState().setViewingPlayer('p1');
        });
        expect((await readPublicDisplay(page)).deadline).toBe(before.deadline);
        const now = await page.evaluate(() => Date.now());
        await page.clock.runFor(before.deadline! - now - 1);
        expect((await readPublicDisplay(page)).step).toBe('COMMON_PUBLIC_REVEAL_DWELL');
        await page.clock.runFor(1);
        await expect.poll(async () => (await readPublicDisplay(page)).step).toBe('SELECT');
        await page.clock.runFor(500);
        await expectCandidateCardGeometry(
          panel.getByRole('group', { name: '已公开的卡牌', exact: true }),
          scene === 'reveal-live' ? 7 / 5 : 5 / 7
        );
        const choices = panel.getByRole('group', { name: '效果候选卡牌', exact: true });
        await expect(choices.getByRole('button')).toHaveCount(3);
        await choices.locator('[data-battle-ui-object-id="hand-0"]').click();
        await expect.poll(async () => (await readPublicDisplay(page)).step).toBeNull();
        await page.clock.runFor(5000);
        expect((await readPublicDisplay(page)).step).toBeNull();
      });
    }

    test(`公开展示：${width} 选择结果保留顺序且到期后才实际回收`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 768 });
      await openPublicDisplayBoard(page);
      await preparePublicDisplay(page, 'ordered-result');
      await page.clock.runFor(500);
      const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
      const result = panel.getByRole('group', { name: '本次公开的选择', exact: true });
      await expectCandidateCardGeometry(result, 5 / 7);
      const face = (await result.locator('[data-card-surface] > div > img').first().boundingBox())!;
      const panelBox = (await panel.boundingBox())!;
      expect(face.y + face.height).toBeLessThanOrEqual(panelBox.y + panelBox.height);
      await expect(result.getByRole('button')).toHaveCount(0);
      await expect(result.getByRole('group', { name: /顺序 1/ })).toHaveAttribute(
        'data-battle-ui-object-id',
        'recover-a'
      );
      await expect(result.getByRole('group', { name: /顺序 2/ })).toHaveAttribute(
        'data-battle-ui-object-id',
        'recover-b'
      );
      await expect(panel.getByRole('group', { name: '发动效果的卡牌', exact: true })).toBeVisible();
      await page.screenshot({
        path: `../output/playwright/public-effect-display/ordered-${width}.png`,
      });
      const before = await readPublicDisplay(page);
      expect(before.hand).not.toContain('recover-a');
      const now = await page.evaluate(() => Date.now());
      await page.clock.runFor(before.deadline! - now - 1);
      expect((await readPublicDisplay(page)).hand).toEqual(before.hand);
      await page.clock.runFor(1);
      await expect
        .poll(async () => (await readPublicDisplay(page)).hand.slice(-2))
        .toEqual(['recover-a', 'recover-b']);
      await page.clock.runFor(5000);
      expect(
        (await readPublicDisplay(page)).hand.filter((id: string) => id === 'recover-a')
      ).toHaveLength(1);
    });
  }

  for (const scene of ['legacy', 'single']) {
    test(`效果选项：${scene} 选牌前禁用、点击即提交且沿用各自命令`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await openPublicDisplayBoard(page);
      await preparePublicDisplay(page, scene);
      await page.clock.runFor(500);
      const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
      const options = panel.getByRole('group', { name: '效果选项', exact: true });
      await expect(options.getByRole('button').first()).toBeDisabled();
      const footer = panel.locator('[data-battle-ui-anchor="active-effect-confirm"]');
      await expect(footer.getByRole('button', { name: '不发动', exact: true })).toBeInViewport();
      expect(await options.evaluate((element) => !!element.closest('.touch-scroll'))).toBe(true);
      await panel
        .getByRole('group', { name: '效果候选卡牌', exact: true })
        .getByRole('button')
        .first()
        .click();
      await expect(options.getByRole('button').first()).toBeEnabled();
      if (scene === 'single') await expect(options.getByRole('button').nth(1)).toBeDisabled();
      await page.screenshot({
        path: `../output/playwright/public-effect-display/options-${scene}-320.png`,
      });
      await options.getByRole('button').first().click();
      if (scene === 'single') {
        const result = panel.getByRole('group', { name: '已选择的效果', exact: true });
        await expect(result.getByRole('button')).toHaveCount(0);
        await expect(result).toContainText('处理第1项效果');
        await expect(result).not.toContainText('处理第2项效果');
        const before = await readPublicDisplay(page);
        const now = await page.evaluate(() => Date.now());
        await page.clock.runFor(before.deadline! - now - 1);
        expect((await readPublicDisplay(page)).step).toBe(
          'COMMON_PUBLIC_EFFECT_CHOICE_CONFIRMATION'
        );
        await page.clock.runFor(1);
      }
      await expect.poll(async () => (await readPublicDisplay(page)).step).toBeNull();
      expect((await readPublicDisplay(page)).payload).toMatchObject({
        selectedCardId: 'hand-0',
        ...(scene === 'legacy'
          ? { selectedOptionId: 'choice-0' }
          : { selectedEffectOptionIds: ['first'] }),
      });
    });
  }

  for (const scene of ['legacy', 'single']) {
    test(`效果选项：回放中的 ${scene} 只显示选项且不提交命令`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 640 });
      await openJudgmentRoom(page, true);
      await preparePublicDisplay(page, scene);
      const before = await readPublicDisplay(page);
      await page.evaluate(async () => {
        const path = window.battleLayoutStoreUrl;
        const { useGameStore } = await import(path);
        const store = useGameStore.getState();
        await store.enterReadonlyReplay({
          matchId: store.playerViewState.match.matchId,
          sourceMatchMode: 'ONLINE',
          viewerSeat: 'FIRST',
          playerViewState: store.playerViewState,
          replayPosition: { checkpointSeq: 0, timelineSeq: 0 },
          recordStatus: 'COMPLETED',
          recordCompleteness: 'COMPLETE',
          partialReasonSummary: null,
        });
      });
      const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
      const options = panel.getByRole('group', { name: '效果选项', exact: true });
      await expect(options).toBeVisible();
      await expect(options).toContainText('第1项');
      await expect(options.getByRole('button')).toHaveCount(0);
      await expect(panel.locator('[data-battle-ui-anchor="active-effect-confirm"]')).toBeHidden();
      await expect.poll(() => readPublicDisplay(page)).toEqual(before);
    });
  }

  test('效果选项：发动顺序的长选项在正文滚动，选择指定效果后保留费用步骤', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openJudgmentRoom(page, true);
    await preparePublicDisplay(page, 'order');
    const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
    const options = panel.getByRole('group', { name: '效果发动顺序', exact: true });
    const footer = panel.locator('[data-battle-ui-anchor="active-effect-confirm"]');
    await expect(panel.getByText('队列 2 个', { exact: true })).toBeVisible();
    await expect(footer.getByRole('button', { name: '顺序发动', exact: true })).toBeInViewport();
    expect(await options.evaluate((element) => !!element.closest('.touch-scroll'))).toBe(true);
    await page.screenshot({ path: '../output/playwright/public-effect-display/order-320.png' });
    await options.getByRole('button').nth(1).click();
    await expect(options).toHaveCount(0);
    const state = await readPublicDisplay(page);
    expect(state.id).toBe('display-order-second');
    expect(state.hand).toHaveLength(6);
    await expect(panel.getByRole('group', { name: '当前效果步骤' })).toContainText(
      '选择要放置入休息室的2张手牌'
    );
    await expect(footer.getByRole('button', { name: '放置入休息室', exact: true })).toBeDisabled();
    await expect(footer.getByRole('button', { name: '不发动', exact: true })).toBeEnabled();
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 360, height: 640 },
    { width: 320, height: 568 },
    { width: 1024, height: 768 },
  ]) {
    test(`${viewport.width}×${viewport.height}：效果展开、收起和连续撤销保持可操作`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openJudgmentRoom(page, true);
      const positions = await prepareUndoEffect(page, 'single');
      const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
      const actions = page.locator('.battle-mobile-actions');
      const undo =
        viewport.width < 768
          ? actions.getByRole('button', { name: '撤销', exact: true })
          : page.getByRole('button', { name: '撤销上一步', exact: true });
      await expect(panel).toBeVisible();
      await expect(undo).toBeEnabled();
      await expect(panel.getByRole('group', { name: '当前效果步骤' })).toContainText(
        '点击卡牌即加入手牌'
      );
      await expect(panel.getByText('0 张', { exact: true })).toHaveCount(0);
      await expect(panel.locator('[data-battle-ui-anchor="active-effect-confirm"]')).toBeHidden();
      await page.screenshot({
        path: `../output/playwright/effect-panel-ui/expanded-${viewport.width}.png`,
      });
      await expectNoOverlap(panel, undo);
      await undo.click({ trial: true });
      await panel.getByRole('button', { name: '隐藏', exact: true }).click();
      const expand = page.getByRole('button', { name: '展开效果', exact: true });
      await expect(expand).toBeVisible();
      await expectNoOverlap(expand.locator('..').locator('..'), undo);
      await undo.click({ trial: true });
      await expand.click();
      for (let i = positions.length - 2; i >= 0; i--) {
        await undo.click();
        await expect.poll(() => readUndoPosition(page)).toEqual(positions[i]);
      }
      await expect(panel).toHaveCount(0);
      await expect(undo).toBeDisabled();
    });
  }

  for (const viewport of [
    { width: 390, height: 844, safeBottom: 0 },
    { width: 320, height: 568, safeBottom: 0 },
    { width: 320, height: 568, safeBottom: 34 },
  ]) {
    test(`${viewport.width} / safe ${viewport.safeBottom}：特殊登场取消后可连续撤销，支付按钮固定可达`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', {
        insets: {
          top: viewport.safeBottom ? 44 : 0,
          bottom: viewport.safeBottom,
          left: 0,
          right: 0,
        },
      });
      await page.addInitScript(() => localStorage.setItem('loveca-card-entrance-enabled', 'false'));
      await openJudgmentRoom(page, true);
      await prepareEntryOverlay(page, 'special');
      const panel = page.getByRole('region', { name: '特殊登场支付', exact: true });
      const undo = page
        .locator('.battle-mobile-actions')
        .getByRole('button', { name: '撤销', exact: true });
      await expect(panel).toBeVisible();
      await expectCandidateCardGeometry(
        panel.getByRole('group', { name: '特殊登场支付候选卡牌', exact: true }),
        5 / 7
      );
      await expectNoOverlap(panel, undo);
      await undo.click({ trial: true });
      await panel.getByRole('button', { name: '取消', exact: true }).click();
      await expect
        .poll(() => readEntryPosition(page))
        .toMatchObject({ pending: false, hand: ['mia'], left: null, paid: 0 });
      await undo.click();
      await expect(panel).toBeVisible();
      await expectNoOverlap(panel, undo);
      await page.screenshot({
        path: `../output/playwright/member-choice-refinement/special-${viewport.width}-safe${viewport.safeBottom}.png`,
      });
      await undo.click();
      await expect(panel).toHaveCount(0);
      await expect
        .poll(() => readEntryPosition(page))
        .toMatchObject({ pending: false, hand: ['mia'], left: null, paid: 0 });
      await prepareEntryOverlay(page, 'special');
      const confirm = panel.getByRole('button').last();
      await expect(confirm).toBeInViewport();
      await confirm.click();
      await expect
        .poll(() => readEntryPosition(page))
        .toMatchObject({ pending: false, hand: [], left: 'mia', paid: 11 });
    });

    test(`${viewport.width} / safe ${viewport.safeBottom}：成功 LIVE 展开收起均可撤销并完成选择`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', {
        insets: {
          top: viewport.safeBottom ? 44 : 0,
          bottom: viewport.safeBottom,
          left: 0,
          right: 0,
        },
      });
      await openJudgmentRoom(page, true);
      await prepareEntryOverlay(page, 'success');
      const panel = page.locator('[data-battle-ui-anchor="success-live-selection"]');
      const undo = page
        .locator('.battle-mobile-actions')
        .getByRole('button', { name: '撤销', exact: true });
      await expect(panel).toBeVisible();
      await expectCandidateCardGeometry(
        panel.getByRole('group', { name: '成功 LIVE 候选卡牌', exact: true }),
        7 / 5
      );
      await expectNoOverlap(panel, undo);
      await undo.click();
      await expect
        .poll(() => readEntryPosition(page))
        .toMatchObject({
          paid: 0,
          live: ['success-live-0', 'success-live-1', 'success-live-2'],
          success: [],
        });
      await prepareEntryOverlay(page, 'success');
      await panel.getByRole('button', { name: '隐藏', exact: true }).click();
      await expectNoOverlap(panel, undo);
      await page.screenshot({
        path: `../output/playwright/member-choice-refinement/success-collapsed-${viewport.width}-safe${viewport.safeBottom}.png`,
      });
      await undo.click();
      await expect.poll(() => readEntryPosition(page)).toMatchObject({ paid: 0 });
      await panel.getByRole('button', { name: '展开', exact: true }).click();
      await page.screenshot({
        path: `../output/playwright/member-choice-refinement/success-${viewport.width}-safe${viewport.safeBottom}.png`,
      });
      await panel.locator('[data-battle-ui-object-id="success-live-0"]').click();
      await expect
        .poll(() => readEntryPosition(page))
        .toMatchObject({ success: ['success-live-0'], live: ['success-live-1', 'success-live-2'] });
      await expect(panel).toHaveCount(0);
    });
  }

  for (const width of [390, 1024]) {
    test(`候选网格：${width} 顺序多选与混合 LIVE 回收沿用真实命令`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
      await openJudgmentRoom(page, true);
      await prepareUndoEffect(page, 'multiple');
      const undo =
        width < 768
          ? page
              .locator('.battle-mobile-actions')
              .getByRole('button', { name: '撤销', exact: true })
          : page.getByRole('button', { name: '撤销上一步', exact: true });
      await undo.click();
      const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
      const grid = panel.getByRole('group', { name: '效果候选卡牌', exact: true });
      const tile = (id: string) => grid.locator(`[data-battle-ui-object-id="${id}"]`);
      const footer = panel.locator('[data-battle-ui-anchor="active-effect-confirm"]');
      const discard = footer.getByRole('button', { name: '放置入休息室', exact: true });
      await expect(discard).toBeDisabled();
      await tile('hand-1').click();
      await expect(tile('hand-1')).toHaveAttribute('aria-pressed', 'true');
      await expect(discard).toBeDisabled();
      await tile('hand-0').click();
      await tile('hand-1').click();
      await expect(tile('hand-1')).toHaveAttribute('aria-pressed', 'false');
      await expect(discard).toBeDisabled();
      await tile('hand-1').click();
      await discard.click();
      await expect
        .poll(() => readUndoPosition(page))
        .toMatchObject({
          hand: ['hand-2', 'hand-3', 'hand-4', 'hand-5'],
          waitingRoom: [
            'recover-a',
            'recover-b',
            'waiting-live-2',
            'waiting-live-3',
            'hand-0',
            'hand-1',
          ],
        });
      await expect(tile('recover-a')).toBeVisible();
      await expectCandidateCardGeometry(grid, 5 / 7);
      await expect
        .poll(() =>
          tile('recover-a')
            .locator('img')
            .first()
            .evaluate((image) => {
              const r = image.getBoundingClientRect();
              return r.width / r.height;
            })
        )
        .toBeCloseTo(5 / 7, 2);
      await expect
        .poll(() =>
          tile('recover-b')
            .locator('img')
            .first()
            .evaluate((image) => {
              const r = image.getBoundingClientRect();
              return r.width / r.height;
            })
        )
        .toBeCloseTo(5 / 7, 2);
      await page.screenshot({
        path: `../output/playwright/candidate-grid-migration/mixed-recovery-${width}.png`,
      });
      await tile('recover-a').click();
      await tile('recover-b').click();
      await footer.getByRole('button', { name: '加入手牌', exact: true }).click();
      await expect
        .poll(() => readUndoPosition(page))
        .toMatchObject({
          hand: ['hand-2', 'hand-3', 'hand-4', 'hand-5', 'recover-a', 'recover-b'],
          waitingRoom: ['waiting-live-2', 'waiting-live-3', 'hand-0', 'hand-1'],
        });
    });
  }

  test('候选网格：匿名手牌无牌面或详情泄漏，提交仍使用匿名令牌', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.addInitScript(() => localStorage.setItem('loveca-card-entrance-enabled', 'false'));
    await openJudgmentRoom(page, true);
    const hiddenIds = await page.evaluate(async (repoRoot) => {
      const path = window.battleLayoutStoreUrl;
      const [{ useGameStore }, { prepareBlindHandCandidateScenario }] = await Promise.all([
        import(path),
        import(`/@fs${repoRoot}tests/helpers/active-effect-candidate-fixture.ts`),
      ]);
      const store = useGameStore.getState();
      const fixture = prepareBlindHandCandidateScenario(store.gameSession);
      store.loadCardData(fixture.cardData);
      useGameStore.setState({ viewingPlayerId: 'p1', replaySession: null, remoteSession: null });
      store.syncState();
      return fixture.hiddenIds;
    }, root);
    const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
    const grid = panel.getByRole('group', { name: '效果候选卡牌', exact: true });
    await expect(grid.getByRole('button')).toHaveCount(4);
    await expect(grid.locator('[data-card-surface]')).toHaveCount(0);
    await expect(grid.getByRole('img', { name: '不可见的手牌' })).toHaveCount(4);
    const markup = await grid.innerHTML();
    for (const id of hiddenIds) expect(markup).not.toContain(id);
    expect(markup).not.toContain('隐藏卡牌');
    expect(markup).not.toContain('TEST-PRIVATE-CANDIDATE');
    const first = grid.getByRole('button', { name: '第1张手牌', exact: true });
    await first.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 50, clientY: 200 });
    await page.waitForTimeout(460);
    await expect(page.getByRole('button', { name: '关闭卡牌详情', exact: true })).toHaveCount(0);
    await first.dispatchEvent('pointerup', { pointerType: 'touch' });
    await page.screenshot({ path: '../output/playwright/candidate-grid-migration/blind-hand.png' });
    for (let i = 0; i < 3; i++) await grid.getByRole('button').nth(i).click();
    await panel.getByRole('button', { name: '公开所选手牌', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const path = window.battleLayoutStoreUrl;
          const { useGameStore } = await import(path);
          const store = useGameStore.getState();
          const state = store.gameSession.state;
          const lastId = 'obj_private-hand-3';
          return {
            revealed: state.activeEffect?.revealedCardIds ?? [],
            hand: state.players[1].hand.cardIds,
            unselectedFront: store.playerViewState.objects[lastId]?.surface === 'FRONT',
          };
        })
      )
      .toMatchObject({ revealed: hiddenIds.slice(0, 3), hand: hiddenIds, unselectedFront: false });
  });

  test('候选网格：能量待机方向与跳过活跃提示保留，选择后只活跃所选能量', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openJudgmentRoom(page, true);
    await page.evaluate(async (repoRoot) => {
      const path = window.battleLayoutStoreUrl;
      const [{ useGameStore }, { prepareEnergyCandidateScenario }] = await Promise.all([
        import(path),
        import(`/@fs${repoRoot}tests/helpers/active-effect-candidate-fixture.ts`),
      ]);
      const store = useGameStore.getState();
      const fixture = prepareEnergyCandidateScenario(store.gameSession);
      store.loadCardData(fixture.cardData);
      useGameStore.setState({ viewingPlayerId: 'p1', replaySession: null, remoteSession: null });
      store.syncState();
    }, root);
    const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
    await panel.getByRole('button', { name: /能量/ }).click();
    const grid = panel.getByRole('group', { name: '效果候选卡牌', exact: true });
    await expect(grid.getByRole('button')).toHaveCount(3);
    const marked = grid.locator('[data-battle-ui-object-id="energy-2"]');
    await expect(marked).toHaveAccessibleName(/下次活跃阶段不会自动变为活跃/);
    await expect(marked).toContainText(/待机[\s\S]*下次不自动活跃/);
    await expectCandidateCardGeometry(grid, 7 / 5);
    const energyImage = marked.locator('[data-card-surface]');
    expect(await energyImage.evaluate((element) => getComputedStyle(element).opacity)).toBe('0.6');
    await page.screenshot({
      path: '../output/playwright/candidate-grid-migration/energy-selection.png',
    });
    await grid.locator('[data-battle-ui-object-id="energy-0"]').click();
    await marked.click();
    await panel
      .locator('[data-battle-ui-anchor="active-effect-confirm"]')
      .getByRole('button')
      .last()
      .click();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const path = window.battleLayoutStoreUrl;
          const state = (await import(path)).useGameStore.getState().gameSession.state;
          return ['energy-0', 'energy-1', 'energy-2', 'energy-3'].map(
            (id) => state.players[0].energyZone.cardStates.get(id).orientation
          );
        })
      )
      .toEqual(['ACTIVE', 'WAITING', 'ACTIVE', 'ACTIVE']);
  });

  for (const mode of ['回放', '观战']) {
    test(`候选网格：${mode}保留长按详情且不提供选牌命令`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openJudgmentRoom(page, true);
      await prepareUndoEffect(page, 'single');
      await page.evaluate(async (mode) => {
        document.getElementById('root')!.hidden = true;
        const host = document
          .querySelector('[data-battle-ui-anchor="battle-board"]')!
          .closest('.battle-viewport-shell')!.parentElement!;
        host.style.zIndex = 'auto';
        const path = window.battleLayoutStoreUrl;
        const { useGameStore } = await import(path);
        const store = useGameStore.getState();
        const view = store.playerViewState;
        if (mode === '观战') {
          store.connectRemoteSession({
            matchId: view.match.matchId,
            source: 'SPECTATOR',
            seat: 'FIRST',
            playerId: 'p1',
            spectatorToken: 'candidate-fixture',
            spectatorSessionId: 'candidate-viewer',
            spectatorAuthorizedViewerSeats: ['FIRST'],
          });
          await useGameStore.getState().applyRemoteSnapshot({
            matchId: view.match.matchId,
            seat: 'FIRST',
            playerId: 'p1',
            seq: view.match.seq,
            currentPublicSeq: 0,
            playerViewState: view,
            publicEvents: [],
          });
        } else {
          await store.enterReadonlyReplay({
            matchId: store.playerViewState.match.matchId,
            sourceMatchMode: 'ONLINE',
            viewerSeat: 'FIRST',
            playerViewState: store.playerViewState,
            replayPosition: { checkpointSeq: 0, timelineSeq: 0 },
            recordStatus: 'COMPLETED',
            recordCompleteness: 'COMPLETE',
            partialReasonSummary: null,
          });
        }
      }, mode);
      const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
      const grid = panel.getByRole('group', { name: '效果候选卡牌', exact: true });
      await expect(grid.getByRole('button')).toHaveCount(0);
      await expect(grid.getByRole('img', { name: 'Dream with You', exact: true })).toBeVisible();
      await expect(panel.locator('[data-battle-ui-anchor="active-effect-confirm"]')).toBeHidden();
      const before = await readUndoPosition(page);
      const image = grid.locator('[data-card-surface]');
      const box = (await image.boundingBox())!;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
      });
      await page.waitForTimeout(480);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const close = page.getByRole('button', { name: '关闭卡牌详情', exact: true });
      await expect(close).toBeVisible();
      await close.click();
      await expect(close).toHaveCount(0);
      await expect.poll(() => readUndoPosition(page)).toEqual(before);
      await page.screenshot({
        path: `../output/playwright/candidate-grid-migration/readonly-${mode}.png`,
      });
    });
  }

  test('390：登场自动效果可直接撤销回费用选择，底部工具不被透明外框拦截', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openJudgmentRoom(page, true);
    const positions = await prepareUndoEffect(page, 'multiple');
    const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
    const actions = page.locator('.battle-mobile-actions');
    await expectNoOverlap(panel, actions);
    await actions.getByTitle('查看调试日志', { exact: true }).click({ trial: true });
    await actions.getByRole('button', { name: '撤销', exact: true }).click();
    await expect.poll(() => readUndoPosition(page)).toEqual(positions[0]);
    await expect(panel).toBeVisible();
    const footer = panel.locator('[data-battle-ui-anchor="active-effect-confirm"]');
    await expect(footer.getByRole('button').first()).toHaveText('不发动');
    await expect(footer.getByRole('button').last()).toHaveText('放置入休息室');
    await page.screenshot({ path: '../output/playwright/effect-panel-ui/on-enter.png' });
  });

  for (const publicCount of [2, 4]) {
    test(`320：检视4张、公开${publicCount}张时双方数量说明与可见性一致`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await openJudgmentRoom(page, true);
      await page.evaluate(
        async ({ repoRoot, publicCount }) => {
          const storePath = window.battleLayoutStoreUrl;
          const fixturePath = `/@fs${repoRoot}tests/helpers/recovery-animation-fixture.ts`;
          const [{ useGameStore }, { prepareRecoveryScenario }] = await Promise.all([
            import(storePath),
            import(fixturePath),
          ]);
          const store = useGameStore.getState();
          const fixture = prepareRecoveryScenario('single', store.gameSession);
          store.loadCardData(fixture.cardData);
          const state = store.gameSession.state;
          const inspected = state.players[0].hand.cardIds.slice(0, 4);
          const revealed = inspected.slice(0, publicCount);
          // Initial visibility fixture; use the real projector and shared board for each player.
          store.gameSession.authorityState = {
            ...state,
            players: [
              {
                ...state.players[0],
                hand: { ...state.players[0].hand, cardIds: state.players[0].hand.cardIds.slice(4) },
              },
              state.players[1],
            ],
            inspectionZone: {
              ...state.inspectionZone,
              cardIds: inspected,
              revealedCardIds: revealed,
            },
            inspectionContext: { ownerPlayerId: 'p1', sourceZone: 'MAIN_DECK' },
            activeEffect: {
              id: 'visibility-ui-fixture',
              abilityId: 'test:visibility-ui',
              sourceCardId: 'source',
              controllerId: 'p1',
              awaitingPlayerId: 'p1',
              stepId: 'SELECT_INSPECTED_CARD',
              effectText: '用于核对检视与公开卡牌可见性的展示场景。',
              stepText: '选择要处理的卡牌。',
              inspectionCardIds: inspected,
              revealedCardIds: revealed,
              selectableCardIds: inspected,
              selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
            },
          };
          useGameStore.setState({
            viewingPlayerId: 'p1',
            replaySession: null,
            remoteSession: null,
          });
          store.syncState();
        },
        { repoRoot: root, publicCount }
      );
      const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
      const expected = publicCount === 4 ? '公开 4 张' : '未公开 2 张 · 公开 2 张';
      const badge = panel.getByText(expected, { exact: true });
      await expect(badge).toBeVisible();
      expect(
        await badge.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.left >= 0 &&
            rect.right <= window.innerWidth &&
            element.scrollWidth <= element.clientWidth
          );
        })
      ).toBe(true);
      await page.screenshot({
        path: `../output/playwright/effect-panel-visibility/actor-${publicCount}.png`,
      });
      await page
        .locator('.battle-mobile-actions')
        .getByRole('button', { name: /切换至/ })
        .click();
      await expect(panel.getByText(`公开 ${publicCount} 张`, { exact: true })).toBeVisible();
      await expect(panel.getByText(/未公开/)).toHaveCount(0);
      if (publicCount === 2) {
        const visibleFaces = await page.evaluate(async () => {
          const path = window.battleLayoutStoreUrl;
          const { useGameStore } = await import(path);
          const objects = useGameStore.getState().playerViewState.objects;
          return {
            publicCard: !!objects['obj_hand-0']?.frontInfo,
            privateCard: !!objects['obj_hand-2']?.frontInfo,
          };
        });
        expect(visibleFaces).toEqual({ publicCard: true, privateCard: false });
      }
      await page.screenshot({
        path: `../output/playwright/effect-panel-visibility/opponent-${publicCount}.png`,
      });
    });
  }

  test('390：点击单张候选直接提交，完成入手且没有空操作栏', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openJudgmentRoom(page, true);
    await prepareUndoEffect(page, 'single');
    const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
    await expect(panel.getByRole('group', { name: '当前效果步骤' })).toContainText(
      '点击卡牌即加入手牌'
    );
    await expect(panel.locator('[data-battle-ui-anchor="active-effect-confirm"]')).toBeHidden();
    await panel.getByRole('button', { name: /Dream with You/ }).click();
    await expect.poll(async () => (await readUndoPosition(page)).hand).toContain('recover-a');
    await expect(panel).toHaveCount(0);
  });

  test('320：安全区和长候选列表保留效果确认与撤销入口', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 44, bottom: 34 } });
    await openJudgmentRoom(page, true);
    const positions = await prepareUndoEffect(page, 'multiple');
    const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
    const actions = page.locator('.battle-mobile-actions');
    const undo = actions.getByRole('button', { name: '撤销', exact: true });
    await expect(actions).toHaveCSS('padding-bottom', '34px');
    await undo.click();
    await expect.poll(() => readUndoPosition(page)).toEqual(positions[0]);
    await expectNoOverlap(panel, actions);
    const step = panel.getByRole('group', { name: '当前效果步骤' });
    const stepPosition = await step.boundingBox();
    await expect(step).toContainText('选择要放置入休息室的2张手牌');
    const scroll = panel.locator('.touch-scroll');
    expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true
    );
    const candidates = panel.getByRole('button', { name: /手牌 4 中须霞/ });
    await candidates.nth(0).click();
    await candidates.nth(1).click();
    const confirm = panel.getByRole('button', { name: '放置入休息室', exact: true });
    await expect(confirm).toBeInViewport();
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(step).toBeInViewport();
    await expect(step).toContainText('已选 2 / 2');
    expect((await step.boundingBox())!.y).toBeCloseTo(stepPosition!.y, 0);
    await page.screenshot({ path: '../output/playwright/effect-panel-ui/safe-area-320.png' });
    await confirm.click();
    await expect.poll(() => readUndoPosition(page)).toEqual(positions[1]);
    await undo.click();
    await expect.poll(() => readUndoPosition(page)).toEqual(positions[0]);
  });

  test('390：效果选项的固定进度与底部确认通过真实命令提交所选效果', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 640 });
    await openJudgmentRoom(page, true);
    await page.evaluate(async (repoRoot) => {
      const storePath = window.battleLayoutStoreUrl;
      const fixturePath = `/@fs${repoRoot}tests/helpers/recovery-animation-fixture.ts`;
      const handlerPath = performance
        .getEntriesByType('resource')
        .find((entry) =>
          entry.name.includes('/src/application/card-effects/runtime/step-registry.')
        )!.name;
      const gamePath = `/@fs${repoRoot}src/domain/entities/game.ts`;
      const [
        { useGameStore },
        { prepareRecoveryScenario },
        { registerActiveEffectStepHandler },
        { addAction },
      ] = await Promise.all([
        import(storePath),
        import(fixturePath),
        import(handlerPath),
        import(gamePath),
      ]);
      const store = useGameStore.getState();
      const fixture = prepareRecoveryScenario('single', store.gameSession);
      store.loadCardData(fixture.cardData);
      const abilityId = 'test:effect-panel-choice';
      const stepId = 'CHOOSE_EFFECTS';
      registerActiveEffectStepHandler(abilityId, stepId, (game, input) =>
        addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', 'p1', {
          selectedEffectOptionIds: input.selectedEffectOptionIds,
        })
      );
      // Initial UI fixture; selection and resolution use the shared command path.
      store.gameSession.authorityState = {
        ...store.gameSession.state,
        activeEffect: {
          id: 'effect-panel-choice',
          abilityId,
          stepId,
          sourceCardId: 'source',
          controllerId: 'p1',
          awaitingPlayerId: 'p1',
          effectText: '从以下选择1项或2项效果。',
          stepText: '请选择要处理的效果。',
          selectionLabel: '选择要处理的效果',
          confirmSelectionLabel: '按所选效果结算',
          canSkipSelection: true,
          skipSelectionLabel: '不发动',
          effectChoice: {
            mode: 'MULTI',
            minSelections: 1,
            maxSelections: 2,
            publicConfirmation: true,
            options: [
              { id: 'first', text: '处理第1项效果。' },
              { id: 'second', text: '处理第2项效果。' },
              { id: 'third', text: '处理第3项效果。' },
            ],
          },
        },
      };
      useGameStore.setState({ viewingPlayerId: 'p1', replaySession: null, remoteSession: null });
      store.syncState();
    }, root);
    const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
    const step = panel.getByRole('group', { name: '当前效果步骤' });
    const footer = panel.locator('[data-battle-ui-anchor="active-effect-confirm"]');
    const confirm = footer.getByRole('button', { name: /按所选效果结算/ });
    await expect(confirm).toBeDisabled();
    await panel.getByRole('button', { name: /处理第1项效果/ }).click();
    await panel.getByRole('button', { name: /处理第2项效果/ }).click();
    await expect(step).toContainText('已选 2 / 2');
    await expect(footer.getByRole('button').first()).toHaveText('不发动');
    expect(await confirm.evaluate((element) => !!element.closest('.touch-scroll'))).toBe(false);
    await confirm.click();
    await expect.poll(async () => (await readUndoPosition(page)).effectStep).toBeNull();
    const selected = await page.evaluate(async () => {
      const path = window.battleLayoutStoreUrl;
      const { useGameStore } = await import(path);
      return useGameStore.getState().gameSession.state.actionHistory.at(-1).payload
        .selectedEffectOptionIds;
    });
    expect(selected).toEqual(['first', 'second']);
  });

  test('1600：辅助区展开收起连续调整牌桌，切换日志不重复伸缩', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openJudgmentRoom(page);
    const rail = page.locator('[data-battle-auxiliary-rail]');
    const panel = page.getByRole('dialog', { name: '应援/判定区', exact: true });
    const tabletop = page.locator('[data-battle-tabletop]');
    await expect(rail).toHaveCSS('width', '420px');
    const before = await page.evaluate(async () => {
      const path = window.battleLayoutStoreUrl;
      return JSON.stringify((await import(path)).useGameStore.getState().playerViewState);
    });
    await expect(rail).toHaveCSS('transition-property', 'width');
    const capture = async (action: () => Promise<unknown>) => {
      await page.evaluate(() => {
        const capture = { widths: [] as number[], done: false };
        Object.assign(window, { auxiliaryRailCapture: capture });
        const start = performance.now();
        const sample = () => {
          capture.widths.push(
            document.querySelector('[data-battle-tabletop]')!.getBoundingClientRect().width
          );
          if (performance.now() - start >= 350) capture.done = true;
          else requestAnimationFrame(sample);
        };
        sample();
      });
      await action();
      await page.waitForFunction(() => (window as any).auxiliaryRailCapture.done);
      return page.evaluate(() => (window as any).auxiliaryRailCapture.widths as number[]);
    };
    const closed = await capture(() =>
      panel.getByRole('button', { name: '收起应援/判定区', exact: true }).click()
    );
    await expect(rail).toHaveCSS('width', '0px');
    expect(closed.at(-1)! - closed[0]).toBeCloseTo(420, 0);
    expect(closed.some((width) => width > closed[0] + 1 && width < closed.at(-1)! - 1)).toBe(true);
    const opened = await capture(() =>
      page.getByRole('button', { name: '打开应援/判定区', exact: true }).click()
    );
    await expect(rail).toHaveCSS('width', '420px');
    expect(opened[0] - opened.at(-1)!).toBeCloseTo(420, 0);
    expect(opened.some((width) => width < opened[0] - 1 && width > opened.at(-1)! + 1)).toBe(true);
    await expectNoOverlap(panel, tabletop);
    const switched = await capture(() =>
      page.getByRole('button', { name: '对局日志', exact: true }).click()
    );
    expect(Math.max(...switched) - Math.min(...switched)).toBeLessThan(1);
    await page.getByRole('button', { name: '关闭对局日志', exact: true }).click();
    await expect(panel).toBeVisible();
    await page.screenshot({ path: '../output/playwright/battle-auxiliary-rail/expanded-1600.png' });
    expect(
      await page.evaluate(async () => {
        const path = window.battleLayoutStoreUrl;
        return JSON.stringify((await import(path)).useGameStore.getState().playerViewState);
      })
    ).toBe(before);
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(panel).toHaveAttribute('data-docked', 'false');
    const overlaid = await capture(() =>
      panel.getByRole('button', { name: '收起应援/判定区', exact: true }).click()
    );
    expect(Math.max(...overlaid) - Math.min(...overlaid)).toBeLessThan(1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1600, height: 900 });
    expect(
      await rail.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration))
    ).toBeLessThan(0.001);
    await page.getByRole('button', { name: '打开应援/判定区', exact: true }).click();
    await expect(rail).toHaveCSS('width', '420px');
    await panel.getByRole('button', { name: '收起应援/判定区', exact: true }).click();
    await expect(rail).toHaveCSS('width', '0px');
  });

  for (const width of [1600, 1366, 1024]) {
    test(`${width}：房间入口可点击，判定与日志共用辅助区域`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1600 ? 900 : 768 });
      await openJudgmentRoom(page);
      const panel = page.getByRole('dialog', { name: '应援/判定区', exact: true });
      const toolbar = page.getByRole('banner', { name: '对战工具栏' });
      expect((await toolbar.boundingBox())!.height).toBe(48);
      await expect(panel).toHaveAttribute('data-docked', String(width >= 1440));
      await expectNoOverlap(toolbar, panel);
      for (const side of ['self', 'opponent']) {
        await expectNoOverlap(
          page.locator(`[data-battle-ui-anchor="${side}-stage-center"]`),
          page.locator(`[data-battle-ui-anchor="${side}-hand"]`)
        );
      }
      if (width >= 1440) await expectNoOverlap(panel, page.locator('[data-battle-tabletop]'));

      const roomTrigger = page.getByTitle('打开房间操作', { exact: true });
      await roomTrigger.click();
      await expect(page.getByText('Room LAYOUT', { exact: true })).toBeVisible();
      await roomTrigger.click();
      await panel.getByRole('button', { name: /查看后攻玩家/ }).click();
      await expect(panel.getByRole('button', { name: /查看先攻玩家/ })).toHaveAttribute(
        'aria-description',
        '当前行动方'
      );
      if (width === 1600) {
        await panel.screenshot({
          path: '../output/playwright/ui-layout-research/judgment-second-seat.png',
        });
        await page.setViewportSize({ width: 1024, height: 768 });
        await expect(panel).toHaveAttribute('data-docked', 'false');
        await page.setViewportSize({ width: 1600, height: 900 });
        await expect(panel).toHaveAttribute('data-docked', 'true');
        await expect(panel.getByRole('button', { name: /查看后攻玩家/ })).toHaveAttribute(
          'aria-pressed',
          'true'
        );
      }
      await page.getByRole('button', { name: '对局日志', exact: true }).click();
      await expect(page.getByRole('region', { name: '对局日志' })).toBeVisible();
      await expect(panel).toHaveCount(0);
      await page.getByRole('button', { name: '关闭对局日志' }).click();
      await expect(panel.getByRole('button', { name: /查看后攻玩家/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await panel.getByRole('button', { name: /查看先攻玩家/ }).click();

      await page.getByRole('button', { name: '对战设置', exact: true }).click();
      const settings = page.getByRole('dialog', { name: '对战设置' });
      await expect(settings).toBeVisible();
      await settings.getByRole('button', { name: '切换到深色主题' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.keyboard.press('Escape');
      await expect(settings).toHaveCount(0);
      await expect(panel).toBeVisible();
      await expect(page.getByRole('button', { name: '对战设置', exact: true })).toBeFocused();

      const scroll = panel.locator('.touch-scroll');
      await scroll.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(panel.getByRole('button', { name: '接受自动判定' })).toBeInViewport();
      await page.screenshot({ path: `../output/playwright/ui-layout-research/room-${width}.png` });
      await panel.getByRole('button', { name: '收起应援/判定区', exact: true }).click();
      await expect(panel).toHaveCount(0);
      await page.getByRole('button', { name: '打开应援/判定区', exact: true }).click();
      await expectNoOverlap(toolbar, panel);
    });
  }

  test('本地桌面：房间菜单转交退出和重开，日志与判定入口可交替使用', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openJudgmentRoom(page, true);
    const panel = page.getByRole('dialog', { name: '应援/判定区', exact: true });
    await expect(panel).toBeVisible();
    await page.getByRole('button', { name: '房间', exact: true }).click();
    await page.getByRole('button', { name: '重开对局', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { layoutActions: { restart: number } }).layoutActions.restart
        )
      )
      .toBe(1);
    await page.getByRole('button', { name: '调试日志', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('region', { name: '调试日志', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭调试日志' }).click();
    await expect(panel).toBeVisible();
    await expectNoOverlap(page.getByRole('banner', { name: '对战工具栏' }), panel);
    await page.screenshot({ path: '../output/playwright/ui-layout-research/local-1600.png' });
    await page.getByRole('button', { name: '房间', exact: true }).click();
    await page.getByRole('button', { name: '离开房间', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { layoutActions: { leave: number } }).layoutActions.leave
        )
      )
      .toBe(1);
  });

  test('390：判定保持模态，关闭后房间与聊天入口恢复可操作', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openJudgmentRoom(page);
    const panel = page.getByRole('dialog', { name: '应援/判定区', exact: true });
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    const roomTrigger = page.getByTitle('打开房间操作', { exact: true });
    await expect
      .poll(() => roomTrigger.evaluate((element) => Boolean(element.closest('[inert]'))))
      .toBe(true);
    await expect
      .poll(() => panel.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    const controls = panel.locator('button:visible:not(:disabled)');
    await controls.last().focus();
    await page.keyboard.press('Tab');
    await expect(controls.first()).toBeFocused();
    await page.screenshot({ path: '../output/playwright/ui-layout-research/room-390.png' });
    const secondSeat = panel.getByRole('button', { name: /查看后攻玩家/ });
    await page.keyboard.press('Tab');
    await expect(panel.getByRole('button', { name: /查看先攻玩家/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(secondSeat).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(secondSeat).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByRole('button', { name: /查看先攻玩家/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await expect(panel.getByRole('button', { name: /查看先攻玩家/ })).toHaveAttribute(
      'aria-description',
      '当前行动方'
    );
    await page.screenshot({
      path: '../output/playwright/ui-layout-research/room-390-second-seat.png',
    });
    await panel.getByRole('button', { name: '收起应援/判定区', exact: true }).click();
    await expect
      .poll(() => roomTrigger.evaluate((element) => Boolean(element.closest('[inert]'))))
      .toBe(false);
    await roomTrigger.click();
    await expect(page.getByText('Room LAYOUT', { exact: true })).toBeVisible();
    await page.getByTitle('打开房间操作', { exact: true }).click();
    const opener = page.getByRole('button', { name: '打开应援/判定区', exact: true });
    await opener.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(opener).toBeFocused();
    await page.getByRole('button', { name: '局内聊天', exact: true }).click();
    await expect(
      page.getByRole('complementary', { name: '局内聊天面板', exact: true })
    ).toBeVisible();
  });

  test('观战与回放：只读工具入口位于判定区上方', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const snapshot = await openJudgmentRoom(page);
    const session = {
      sessionId: 'layout-spectator',
      displayName: '布局验收观众',
      viewType: 'PLAYER',
      viewerSeat: 'FIRST',
      authorizedViewerSeats: ['FIRST'],
      attachmentGeneration: 1,
      preferredViewerDisplayName: '视觉验收玩家',
      effectiveViewerDisplayName: '视觉验收玩家',
      viewVersion: 1,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
    };
    const spectatorSnapshot = {
      ...snapshot,
      spectatorView: {
        currentViewerSeat: 'FIRST',
        authorizedViewerSeats: ['FIRST'],
        roomCode: 'LAYOUT',
        roomGeneration: 'layout-generation',
        attachmentGeneration: 1,
        preferredViewerDisplayName: '视觉验收玩家',
        effectiveViewerDisplayName: '视觉验收玩家',
        viewVersion: 1,
        authorizationNotice: null,
      },
    };
    await page.route('**/api/online/spectator-links/layout-token/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const data = path.endsWith('/sessions')
        ? {
            session,
            snapshot: spectatorSnapshot,
            link: {
              token: 'layout-token',
              source: 'ROOM_CODE',
              matchId: 'layout-match',
              roomCode: 'LAYOUT',
              roomGeneration: 'layout-generation',
              attachmentGeneration: 1,
              viewType: 'PLAYER',
              viewerSeat: 'FIRST',
              authorizedViewerSeats: ['FIRST'],
              createdAt: Date.now(),
              expiresAt: Date.now() + 60000,
              revokedAt: null,
              path: '/online/spectate/layout-token',
            },
          }
        : path.endsWith('/snapshot')
          ? spectatorSnapshot
          : path.endsWith('/public-events')
            ? { events: [], hasMore: false, latestSeq: 0 }
            : { messages: [], hasMore: false };
      return route.fulfill({ json: { data, error: null } });
    });
    await page.goto('/online/spectate/layout-token');
    const panel = page.getByRole('dialog', { name: '应援/判定区', exact: true });
    await expect(panel).toBeVisible();
    expect((await page.getByRole('banner', { name: '对战工具栏' }).boundingBox())!.height).toBe(48);
    await expectNoOverlap(page.getByRole('banner', { name: '对战工具栏' }), panel);
    await expect(page.getByRole('button', { name: '接受自动判定' })).toHaveCount(0);
    await page.getByRole('button', { name: '对局日志', exact: true }).click();
    await expect(page.getByRole('region', { name: '对局日志' })).toBeVisible();
    await page.getByRole('button', { name: '关闭对局日志' }).click();
    await page.screenshot({ path: '../output/playwright/ui-layout-research/spectator-1600.png' });
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.goto('/');
    await page.evaluate(
      async ({ data, repoRoot }) => {
        const storePath = performance
          .getEntriesByType('resource')
          .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
        const serdePath = `/@fs${repoRoot}src/online/serde.ts`;
        const reactPath = performance
          .getEntriesByType('resource')
          .find((entry) => /\/react\.js(?:\?|$)/.test(entry.name))!.name;
        const domPath = performance
          .getEntriesByType('resource')
          .find((entry) => /\/react-dom_client\.js(?:\?|$)/.test(entry.name))!.name;
        const replayPath = '/src/components/pages/MatchRecordsPage.tsx';
        const [
          { useGameStore },
          { fromTransport },
          reactModule,
          domModule,
          { ReplayBoardSurface },
        ] = await Promise.all([
          import(storePath),
          import(serdePath),
          import(reactPath),
          import(domPath),
          import(replayPath),
        ]);
        const replay = {
          matchId: 'layout-match',
          sourceMatchMode: 'ONLINE',
          viewerSeat: 'FIRST',
          playerViewState: fromTransport(data).playerViewState,
          replayPosition: { checkpointSeq: 0, timelineSeq: 0 },
          recordStatus: 'COMPLETED',
          recordCompleteness: 'COMPLETE',
          partialReasonSummary: null,
        };
        await useGameStore.getState().enterReadonlyReplay(replay);
        const React = reactModule.default ?? reactModule;
        const dom = domModule.default ?? domModule;
        const host = document.createElement('div');
        document.body.append(host);
        const actions = { step: 0, close: 0 };
        Object.assign(window, { replayLayoutActions: actions });
        dom.createRoot(host).render(
          React.createElement(ReplayBoardSurface, {
            replay,
            currentCheckpointIndex: 1,
            checkpointCount: 3,
            canGoPrevious: true,
            canGoNext: true,
            isLoadingNode: false,
            nodeLoadError: null,
            onRetryNode: () => {},
            onStep: (direction: number) => {
              actions.step += direction;
            },
            onClose: () => {
              actions.close += 1;
            },
          })
        );
      },
      { data: snapshot, repoRoot: root }
    );
    await expect(panel).toBeVisible();
    expect((await page.getByRole('banner', { name: '对战工具栏' }).boundingBox())!.height).toBe(48);
    await expectNoOverlap(page.getByRole('banner', { name: '对战工具栏' }), panel);
    await expect(page.getByRole('button', { name: '接受自动判定' })).toHaveCount(0);
    await page.getByRole('button', { name: '下一个回放节点' }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { replayLayoutActions: { step: number } }).replayLayoutActions
              .step
        )
      )
      .toBe(1);
    await page.screenshot({ path: '../output/playwright/ui-layout-research/replay-1600.png' });
    // Body-portaled details must remain above the actual replay stacking context.
    const cardId = await page
      .locator('[data-battle-ui-anchor="self-hand"] [data-card-id]')
      .first()
      .getAttribute('data-card-id');
    expect(cardId).toBeTruthy();
    await page.evaluate(async (id) => {
      const storePath = '/src/store/gameStore.ts';
      const { useGameStore } = await import(storePath);
      useGameStore.getState().setHoveredCard(id);
    }, cardId);
    const detail = page.locator('[aria-label$=" 卡牌详情"]');
    await expect(detail).toBeVisible();
    const detailZIndex = await detail.evaluate((node) => Number(getComputedStyle(node).zIndex));
    const replayZIndex = await page
      .getByRole('button', { name: '关闭桌面回放' })
      .evaluate((node) => {
        let layer = node.parentElement;
        let outerZIndex: number | null = null;
        while (layer) {
          const style = getComputedStyle(layer);
          if (style.position !== 'static' && style.zIndex !== 'auto') {
            outerZIndex = Number(style.zIndex);
          }
          layer = layer.parentElement;
        }
        if (outerZIndex === null) throw new Error('Replay stacking context not found');
        return outerZIndex;
      });
    expect(detailZIndex).toBeGreaterThan(replayZIndex);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('dialog', { name: / 卡牌详情$/ })).toBeVisible();
    await page.getByRole('button', { name: '关闭卡牌详情', exact: true }).click();
    await expect(detail).toHaveCount(0);
    await page.getByRole('button', { name: '关闭桌面回放' }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { replayLayoutActions: { close: number } }).replayLayoutActions
              .close
        )
      )
      .toBe(1);
  });
});
