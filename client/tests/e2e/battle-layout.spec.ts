import { expect, test, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { OnlineRoomView } from '../../../src/online';
import { installVisualApiMocks } from '../visual/support/mockApp';

const root = fileURLToPath(new URL('../../../', import.meta.url));

// Exercise the production room page and shared board using a projected, in-memory match.
// All account, room, and match HTTP requests stay inside browser routes.
async function openJudgmentRoom(page: Page, local = false) {
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
        const path = '/src/store/gameStore.ts';
        const { useGameStore } = await import(path);
        return useGameStore.getState().cardDataRegistry.size;
      })
    )
    .toBeGreaterThan(0);

  const snapshot = await page.evaluate(async (repoRoot) => {
    const storePath = '/src/store/gameStore.ts';
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
      const reactPath = '/node_modules/.vite/deps/react.js';
      const domPath = '/node_modules/.vite/deps/react-dom_client.js';
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
    battleTimeouts: { playerActionTimeoutSeconds: 180, reconnectGracePeriodSeconds: 60 },
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
  await page.getByRole('button', { name: '跳过提示', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '应援/判定区', exact: true })).toBeVisible();
  return snapshot;
}

async function expectNoOverlap(first: Locator, second: Locator) {
  const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  const area =
    Math.max(0, Math.min(a!.x + a!.width, b!.x + b!.width) - Math.max(a!.x, b!.x)) *
    Math.max(0, Math.min(a!.y + a!.height, b!.y + b!.height) - Math.max(a!.y, b!.y));
  expect(area).toBe(0);
}

test.describe('对战工具栏与辅助面板', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'tablet-1024x768', '一个 project 内覆盖完整尺寸矩阵');
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  for (const width of [1600, 1366, 1024]) {
    test(`${width}：房间入口可点击，判定与日志共用辅助区域`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1600 ? 900 : 768 });
      await openJudgmentRoom(page);
      const panel = page.getByRole('dialog', { name: '应援/判定区', exact: true });
      const toolbar = page.getByRole('banner', { name: '对战工具栏' });
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
        const storePath = '/src/store/gameStore.ts';
        const serdePath = `/@fs${repoRoot}src/online/serde.ts`;
        const reactPath = '/node_modules/.vite/deps/react.js';
        const domPath = '/node_modules/.vite/deps/react-dom_client.js';
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
