import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { installVisualApiMocks } from '../visual/support/mockApp';

const root = fileURLToPath(new URL('../../../', import.meta.url));

// Only local fixtures and intercepted HTTP; the shared production board and command store are real.
async function seedBoard(
  page: Page,
  options: { energy?: number; incomingCost?: number; oldCode?: string } = {}
) {
  await page.evaluate(
    async ({ root, options }) => {
      const load = (path: string) => import(`/@fs${root}${path}.ts`);
      const storePath = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((url) => url.includes('/src/store/gameStore.ts'))!;
      const [
        { useGameStore },
        { createGameState, registerCards, updatePlayer },
        { createCardInstance },
        { placeCardInSlot },
        enums,
      ] = await Promise.all([
        import(storePath),
        load('src/domain/entities/game'),
        load('src/domain/entities/card'),
        load('src/domain/entities/zone'),
        load('src/shared/types/enums'),
      ]);
      const { GamePhase, SubPhase, SlotPosition, OrientationState, FaceState } = enums;
      const member = (cardCode: string, name: string, cost: number) => ({
        cardCode,
        name,
        nameCn: name,
        cardType: 'MEMBER',
        cost,
        blade: 1,
        hearts: [],
        unitName: 'DOLLCHESTRA',
      });
      const active = { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP };
      const energy = Array.from({ length: options.energy ?? 10 }, (_, i) =>
        createCardInstance(
          { cardCode: 'LL-E-001-SD', name: '能量', cardType: 'ENERGY' },
          'p1',
          `e${i}`
        )
      );
      let state = registerCards(createGameState('overwrite-ui', 'p1', '测试玩家', 'p2', '对手'), [
        createCardInstance(
          member('TEST-incoming', '新DC成员', options.incomingCost ?? 8),
          'p1',
          'incoming'
        ),
        createCardInstance(member(options.oldCode ?? 'TEST-old', '原DC成员', 6), 'p1', 'old'),
        createCardInstance(member('PL!HS-bp8-005-P', '徒町小铃', 0), 'p1', 'kosuzu'),
        createCardInstance(member('TEST-deck', '牌库成员', 1), 'p1', 'deck1'),
        createCardInstance(member('TEST-deck', '牌库成员', 1), 'p2', 'deck2'),
        ...energy,
      ]);
      state = {
        ...state,
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.NONE,
        turnCount: 3,
      };
      state = updatePlayer(state, 'p1', (player: any) => ({
        ...player,
        hand: { ...player.hand, cardIds: ['incoming'] },
        mainDeck: { ...player.mainDeck, cardIds: ['deck1'] },
        memberSlots: placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'old', active),
          SlotPosition.CENTER,
          'kosuzu',
          active
        ),
        energyZone: {
          ...player.energyZone,
          cardIds: energy.map((card: any) => card.instanceId),
          cardStates: new Map(energy.map((card: any) => [card.instanceId, active])),
        },
      }));
      state = updatePlayer(state, 'p2', (player: any) => ({
        ...player,
        mainDeck: { ...player.mainDeck, cardIds: ['deck2'] },
      }));
      const store = useGameStore.getState();
      store.createGame('overwrite-ui', 'p1', '测试玩家', 'p2', '对手');
      useGameStore.getState().gameSession.authorityState = state;
      useGameStore.getState().syncState();
      useGameStore.getState().deselectCard();
    },
    { root, options }
  );
}

async function openBoard(page: Page) {
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
    if (new URL(route.request().url()).pathname.endsWith('/static/deck.png')) {
      return route.fulfill({ path: `${root}assets/deck.png` });
    }
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#593751"/><path d="M15 70h70M50 35v70" stroke="#f8bade" stroke-width="8"/></svg>',
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('loveca-card-entrance-enabled', 'false');
  });
  await page.goto('/');
  await seedBoard(page);
  await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
    const reactPath = resources.find((url) => /\/react\.js(?:\?|$)/.test(url))!;
    const domPath = resources.find((url) => /\/react-dom_client\.js(?:\?|$)/.test(url))!;
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
    document.getElementById('root')!.hidden = true;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0';
    document.body.append(host);
    dom
      .createRoot(host)
      .render(React.createElement(BattleViewportShell, null, React.createElement(GameBoard)));
  });
  await expect(
    page.locator('[data-battle-ui-anchor="self-hand"] [data-card-id="incoming"]').first()
  ).toBeVisible();
}

async function togglePreference(page: Page) {
  const settings = page.getByRole('button', { name: '对战设置', exact: true });
  if (await settings.isVisible()) await settings.click();
  const toggle = page.getByRole('switch', { name: '覆盖登场时询问' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  if (await settings.isVisible()) await settings.click();
}

async function overwrite(page: Page, drag = false) {
  const source = page
    .locator('[data-battle-ui-anchor="self-hand"] [data-card-id="incoming"]')
    .first();
  const target = page.locator('[data-battle-ui-anchor="self-stage-left"] [data-zone-id]').first();
  if (drag) {
    const a = (await source.boundingBox())!;
    const b = (await target.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
    await page.mouse.up();
    // dnd-kit intentionally captures clicks for 50 ms after pointer release.
    await page.waitForTimeout(80);
  } else {
    await source.click();
    await target.click();
  }
}

async function result(page: Page) {
  return page.evaluate(async () => {
    const path = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => url.includes('/src/store/gameStore.ts'))!;
    const { useGameStore } = await import(path);
    const store = useGameStore.getState();
    const state = store.gameSession.state;
    const player = state.players[0];
    return {
      hand: player.hand.cardIds,
      waiting: player.waitingRoom.cardIds,
      paid: [...player.energyZone.cardStates.values()].filter(
        (entry: any) => entry.orientation === 'WAITING'
      ).length,
      isRelay: state.actionHistory.find((entry: any) => entry.type === 'PLAY_MEMBER')?.payload
        .isRelay,
      animations: store.ui.battleAnimationOcclusions.length,
    };
  });
}

test('default relay, opt-in choice, cancel, full overwrite and relay use the shared board', async ({
  page,
}, testInfo) => {
  if (!testInfo.project.name.startsWith('mobile'))
    await page.setViewportSize({ width: 1600, height: 900 });
  await openBoard(page);
  await overwrite(page);
  await expect
    .poll(() => result(page))
    .toMatchObject({ hand: [], waiting: ['old', 'kosuzu'], paid: 2, isRelay: true });
  await seedBoard(page);
  await togglePreference(page);
  await overwrite(page);
  const dialog = page.getByRole('dialog', { name: '选择登场方式' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => result(page)).toMatchObject({ hand: ['incoming'], waiting: [], paid: 0 });
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({
    path: `${root}output/playwright/member-overwrite-${testInfo.project.name}-choice.png`,
  });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => result(page)).toMatchObject({ hand: ['incoming'], waiting: [], paid: 0 });
  // Cancel retains hand selection; explicitly deselect to start a fresh click gesture.
  await page.evaluate(async () => {
    const p = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => url.includes('/src/store/gameStore.ts'))!;
    (await import(p)).useGameStore.getState().deselectCard();
  });
  await overwrite(page, !testInfo.project.name.startsWith('mobile'));
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /全款登场/ }).click();
  await expect
    .poll(() => result(page))
    .toMatchObject({ hand: [], waiting: ['old'], paid: 8, isRelay: false, animations: 0 });
  await page.screenshot({
    path: `${root}output/playwright/member-overwrite-${testInfo.project.name}-full.png`,
  });
  await seedBoard(page);
  await overwrite(page);
  await dialog.getByRole('button', { name: /换手登场/ }).click();
  await expect
    .poll(() => result(page))
    .toMatchObject({ waiting: ['old', 'kosuzu'], paid: 2, isRelay: true });
});

test('single legal mode never prompts and stale choices cannot pay', async ({ page }, testInfo) => {
  if (!testInfo.project.name.startsWith('mobile'))
    await page.setViewportSize({ width: 1600, height: 900 });
  await openBoard(page);
  await togglePreference(page);
  await seedBoard(page, { energy: 2 });
  await overwrite(page);
  await expect
    .poll(() => result(page))
    .toMatchObject({ waiting: ['old', 'kosuzu'], paid: 2, isRelay: true });
  await expect(page.getByRole('dialog', { name: '选择登场方式' })).not.toBeVisible();
  await seedBoard(page, { oldCode: 'LL-bp2-001-R+' });
  await overwrite(page);
  await expect
    .poll(() => result(page))
    .toMatchObject({ waiting: ['old'], paid: 8, isRelay: false });
  await seedBoard(page, { incomingCost: 0 });
  await overwrite(page);
  await expect
    .poll(() => result(page))
    .toMatchObject({ waiting: ['old'], paid: 0, isRelay: false });
  await seedBoard(page);
  await overwrite(page);
  await expect(page.getByRole('dialog', { name: '选择登场方式' })).toBeVisible();
  await seedBoard(page, { energy: 2 });
  await expect(page.getByRole('dialog', { name: '选择登场方式' })).not.toBeVisible();
  await expect.poll(() => result(page)).toMatchObject({ hand: ['incoming'], waiting: [], paid: 0 });
});
