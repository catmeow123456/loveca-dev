import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { installVisualApiMocks } from '../visual/support/mockApp';

const root = fileURLToPath(new URL('../../../', import.meta.url));

async function openPopulatedBoard(page: Page) {
  await installVisualApiMocks(page, true);
  await page.route('**/site-status.json*', (route) =>
    route.fulfill({ json: { schemaVersion: 1, availability: 'OPEN', maintenance: null } })
  );
  await page.route('**/images/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/static/deck.png')) return route.fulfill({ path: `${root}assets/deck.png` });
    if (path.endsWith('/back.webp')) return route.fulfill({ path: `${root}assets/back.jpg` });
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#593751"/><path d="M15 70h70M50 35v70" stroke="#f8bade" stroke-width="8"/></svg>',
    });
  });
  await page.addInitScript(() => localStorage.setItem('loveca-card-entrance-enabled', 'false'));
  await page.goto('/');
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .some((entry) => entry.name.includes('/src/store/gameStore.ts'))
      )
    )
    .toBe(true);
  await page.evaluate(async (repoRoot) => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
    const storePath = resources.find((url) => url.includes('/src/store/gameStore.ts'))!;
    const load = (path: string) => import(`/@fs${repoRoot}${path}.ts`);
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
    const active = { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP };
    const member = {
      cardCode: 'TEST-member',
      name: '成员',
      nameCn: '成员',
      cardType: 'MEMBER',
      cost: 1,
      blade: 1,
      hearts: [],
    };
    const live = {
      cardCode: 'TEST-live',
      name: 'LIVE',
      nameCn: 'LIVE',
      cardType: 'LIVE',
      score: 1,
      requirements: { colorRequirements: new Map([['PINK', 2]]), totalRequired: 2 },
    };
    const cards = ['p1', 'p2'].flatMap((id) => [
      ...['left', 'center', 'right', 'deck', 'hand1', 'hand2', 'hand3', 'hand4'].map((suffix) =>
        createCardInstance(member, id, `${id}-${suffix}`)
      ),
      ...['live0', 'live1', 'incoming'].map((suffix) =>
        createCardInstance(live, id, `${id}-${suffix}`)
      ),
    ]);
    let state = registerCards(
      createGameState('card-sizing', 'p1', '测试玩家', 'p2', '对手'),
      cards
    );
    state = {
      ...state,
      turnCount: 3,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
    };
    for (const id of ['p1', 'p2']) {
      state = updatePlayer(state, id, (player: any) => ({
        ...player,
        hand: {
          ...player.hand,
          cardIds: ['hand1', 'hand2', 'hand3', 'hand4', 'incoming'].map((s) => `${id}-${s}`),
        },
        mainDeck: { ...player.mainDeck, cardIds: [`${id}-deck`] },
        memberSlots: ['left', 'center', 'right'].reduce(
          (slots, slot) =>
            placeCardInSlot(slots, SlotPosition[slot.toUpperCase()], `${id}-${slot}`, {
              ...active,
              orientation:
                slot === 'right' && window.innerWidth >= 768
                  ? OrientationState.WAITING
                  : OrientationState.ACTIVE,
            }),
          player.memberSlots
        ),
        liveZone: {
          ...player.liveZone,
          cardIds: [`${id}-live0`, `${id}-live1`],
          cardStates: new Map([
            [`${id}-live0`, active],
            [`${id}-live1`, { ...active, face: FaceState.FACE_DOWN }],
          ]),
        },
      }));
    }
    useGameStore.getState().createGame('card-sizing', 'p1', '测试玩家', 'p2', '对手');
    useGameStore.getState().gameSession.authorityState = state;
    useGameStore.getState().syncState();
    const [reactModule, domModule, { GameBoard }, { BattleViewportShell }] = await Promise.all([
      import(resources.find((url) => /\/react\.js(?:\?|$)/.test(url))!),
      import(resources.find((url) => /\/react-dom_client\.js(?:\?|$)/.test(url))!),
      import('/src/components/game/GameBoard.tsx'),
      import('/src/components/game/BattleViewportShell.tsx'),
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
  }, root);
  await expect(page.locator('[data-battle-ui-anchor="self-stage-center"]')).toBeVisible();
}

const anchor = (page: Page, name: string) => page.locator(`[data-battle-ui-anchor="${name}"]`);

async function assertCardGeometry(page: Page, width: number, height: number) {
  // ResizeObserver and card rotation settle asynchronously; assert the complete geometry together.
  await expect(async () => {
    if (width >= 1024) {
      const toolbar = (await page.getByRole('banner', { name: '对战工具栏' }).boundingBox())!;
      expect(toolbar.height).toBe(48);
    }
    const sides = width < 768 ? ['self'] : ['self', 'opponent'];
    for (const side of sides) {
      const id = side === 'self' ? 'p1' : 'p2';
      const member = anchor(page, `${side}-stage-center`).locator(`[data-card-id="${id}-center"]`);
      // A full stage must not collapse to thumbnail size on ordinary desktop viewports.
      // The portrait sits inside the slot's two 2px borders.
      const minimum = width < 768 ? 60 : height >= 900 && width >= 1024 ? 120 : 72;
      await expect
        .poll(async () => (await member.boundingBox())!.width)
        .toBeGreaterThanOrEqual(minimum);
      const card = (await member.boundingBox())!;
      expect(card.height / card.width).toBeCloseTo(7 / 5, 1);
      const slot = await member.evaluate(
        (element) => element.closest('[data-zone-id]')!.getBoundingClientRect().width
      );
      expect(Math.abs(card.width - (slot - 4))).toBeLessThan(1);
      if (width >= 768) {
        // Opponent cards appear in mirrored order; waiting must not cover the center member.
        const resting = (await anchor(page, `${side}-area`)
          .locator(`[data-card-id="${id}-right"]`)
          .boundingBox())!;
        expect(resting.width / resting.height).toBeCloseTo(7 / 5, 1);
        if (side === 'self') expect(resting.x).toBeGreaterThan(card.x + card.width);
        else expect(resting.x + resting.width).toBeLessThan(card.x);
      }
      const hand = (await anchor(page, `${side}-hand`).boundingBox())!;
      if (width >= 768) {
        expect(hand.height).toBe(124);
        if (side === 'self') {
          const handCardSize = await anchor(page, 'self-hand')
            .locator('[data-card-id="p1-hand1"]')
            .evaluate((e) => {
              const style = getComputedStyle(e);
              return { width: parseFloat(style.width), height: parseFloat(style.height) };
            });
          expect(handCardSize).toEqual(
            height >= 850 ? { width: 75, height: 105 } : { width: 70, height: 98 }
          );
        }
      }
      if (side === 'self') expect(card.y + card.height).toBeLessThanOrEqual(hand.y + 1);
      else expect(card.y).toBeGreaterThanOrEqual(hand.y + hand.height - 1);

      const liveZone = anchor(page, `${side}-live-zone`);
      const front = liveZone.locator(`[data-card-id="${id}-live0"]`);
      await expect
        .poll(async () => {
          const box = (await front.boundingBox())!;
          const height = await front.evaluate((e) => parseFloat(getComputedStyle(e).height));
          return Math.abs(box.width - height);
        })
        .toBeLessThan(0.1);
      const live = (await front.boundingBox())!;
      expect(live.width / live.height).toBeCloseTo(7 / 5, 1);
      if (width >= 768) expect(live.width).toBeCloseTo(105, 0);
      const zone = (await liveZone.boundingBox())!;
      if (width >= 768) expect(zone.height).toBe(80);
      const liveSlot = (await liveZone.locator('[data-battle-live-slot="0"]').boundingBox())!;
      const memberColumn = (await anchor(page, `${side}-stage-center`).boundingBox())!;
      expect(liveSlot.width).toBeCloseTo(memberColumn.width, 0);
      expect(liveSlot.height).toBeCloseTo(width >= 768 ? 70 : live.height, 0);
      expect(live.y + live.height / 2).toBeCloseTo(zone.y + zone.height / 2, 0);
      expect(live.x + live.width / 2).toBeCloseTo(liveSlot.x + liveSlot.width / 2, 0);
      // Empty and filled slots both stay vertically centered; requirements use the row gap.
      const lastSlot = (await liveZone.locator('[data-battle-live-slot="2"]').boundingBox())!;
      expect(lastSlot.width).toBeCloseTo(memberColumn.width, 0);
      expect(lastSlot.height).toBeCloseTo(width >= 768 ? 70 : live.height, 0);
      expect(lastSlot.y + lastSlot.height / 2).toBeCloseTo(zone.y + zone.height / 2, 0);
      const centerSlot = (await liveZone.locator('[data-battle-live-slot="1"]').boundingBox())!;
      expect(centerSlot.x + centerSlot.width / 2).toBeCloseTo(card.x + card.width / 2, 0);
      const requirements = (await liveZone
        .locator('[data-live-heart-requirements]')
        .first()
        .boundingBox())!;
      const area = (await anchor(page, `${side}-area`).boundingBox())!;
      expect(requirements.y).toBeGreaterThanOrEqual(live.y + live.height - 0.5);
      expect(requirements.y + requirements.height).toBeLessThanOrEqual(area.y + area.height);
      if (side === 'self') expect(requirements.y + requirements.height).toBeLessThan(card.y);
      const adjacent = (await liveZone.locator('[data-battle-live-slot="1"]').boundingBox())!;
      if (side === 'self') expect(live.x + live.width).toBeLessThanOrEqual(adjacent.x + 1);
      else expect(adjacent.x + adjacent.width).toBeLessThanOrEqual(live.x + 1);
      expect(live.x).toBeGreaterThanOrEqual(0);
      expect(live.x + live.width).toBeLessThanOrEqual(width);
      // The opponent's face-down LIVE stays a back and keeps the same footprint.
      if (side === 'opponent') {
        const back = (await liveZone
          .locator('[data-battle-live-slot="1"] img[alt="Card Back"]')
          .boundingBox())!;
        expect(back.width).toBeCloseTo(live.width, 0);
        expect(back.height).toBeCloseTo(live.height, 0);
        await expect(liveZone.locator('[data-card-id="p2-live1"]')).toHaveCount(0);
      }
    }
  }).toPass({ timeout: 5000 });
}

async function placeLive(page: Page, mobile: boolean) {
  const source = anchor(page, 'self-hand').locator('[data-card-id="p1-incoming"]');
  const target = anchor(page, 'self-live-zone').locator('[data-battle-live-slot="2"]');
  const original = (await anchor(page, 'self-stage-center').boundingBox())!;
  if (mobile) {
    await source.click();
    await target.click();
  } else {
    const a = (await source.boundingBox())!;
    const b = (await target.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
    await page.mouse.up();
    await page.mouse.move(0, 0);
  }
  await expect(source).toHaveCount(0);
  await expect(target.locator('[data-card-id="p1-incoming"]')).toBeVisible();
  await expect
    .poll(async () => (await target.locator('[data-card-id="p1-incoming"]').boundingBox())!.width)
    .toBeCloseTo(
      (await anchor(page, 'self-live-zone').locator('[data-card-id="p1-live0"]').boundingBox())!
        .width,
      0
    );
  const after = (await anchor(page, 'self-stage-center').boundingBox())!;
  expect(after.width).toBeCloseTo(original.width, 1);
  expect(after.height).toBeCloseTo(original.height, 1);
}

test('desktop: stage size survives LIVE placement, panel docking and viewport changes', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'tablet-1024x768');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1600, height: 900 });
  await openPopulatedBoard(page);
  await assertCardGeometry(page, 1600, 900);
  await placeLive(page, false);
  for (const [width, height] of [
    [1920, 1080],
    [1600, 900],
    [1366, 768],
    [1024, 768],
    [768, 1024],
  ]) {
    await page.setViewportSize({ width, height });
    await assertCardGeometry(page, width, height);
    await page.screenshot({ path: `${root}output/playwright/card-sizing-${width}.png` });
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(async (repoRoot) => {
    const storePath = performance
      .getEntriesByType('resource')
      .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(storePath);
    const { GamePhase, SubPhase } = await import(`/@fs${repoRoot}src/shared/types/enums.ts`);
    Object.assign(useGameStore.getState().gameSession.state, {
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
    });
    useGameStore.getState().syncState();
  }, root);
  const panel = page.getByRole('dialog', { name: '应援/判定区', exact: true });
  await expect(panel).toHaveAttribute('data-docked', 'true');
  await assertCardGeometry(page, 1600, 900);
  await expect(page.getByText('LIVE 开始', { exact: true })).not.toBeVisible();
  await page.screenshot({ path: `${root}output/playwright/card-sizing-panel-1600.png` });
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(panel).toHaveAttribute('data-docked', 'false');
  await panel.getByRole('button', { name: '收起应援/判定区', exact: true }).click();
  await assertCardGeometry(page, 1024, 768);
});

test('phone: LIVE placement keeps its aspect ratio and fits the three columns', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile-390x844');
  await openPopulatedBoard(page);
  await assertCardGeometry(page, 390, 844);
  await placeLive(page, true);
  for (const [width, height] of [
    [390, 844],
    [430, 932],
  ]) {
    await page.setViewportSize({ width, height });
    await assertCardGeometry(page, width, height);
    await page.screenshot({ path: `${root}output/playwright/card-sizing-${width}.png` });
  }
});
