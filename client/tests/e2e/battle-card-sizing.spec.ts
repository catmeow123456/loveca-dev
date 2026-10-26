import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { installVisualApiMocks } from '../visual/support/mockApp';

const root = fileURLToPath(new URL('../../../', import.meta.url));

async function openPopulatedBoard(
  page: Page,
  supportCards = false,
  successCount = 3,
  handCount = 5,
  effectsEnabled = false
) {
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
  await page.addInitScript(
    (enabled) => localStorage.setItem('loveca-card-entrance-enabled', String(enabled)),
    effectsEnabled
  );
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
  const fixture = { repoRoot: root, supportCards, successCount, handCount };
  await page.evaluate(async ({ repoRoot, supportCards, successCount, handCount }) => {
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
    const energy = { cardCode: 'TEST-energy', name: '能量', cardType: 'ENERGY' };
    const extraHands = Array.from({ length: Math.max(0, handCount - 5) }, (_, i) => `extra${i}`);
    const extraDecks = handCount > 5 ? Array.from({ length: 8 }, (_, i) => `draw${i}`) : [];
    const cards = ['p1', 'p2'].flatMap((id) => [
      ...[
        'left',
        'center',
        'right',
        'deck',
        'hand1',
        'hand2',
        'hand3',
        'hand4',
        ...extraHands,
        ...extraDecks,
      ].map((suffix) => createCardInstance(member, id, `${id}-${suffix}`)),
      ...['live0', 'live1', 'incoming'].map((suffix) =>
        createCardInstance(live, id, `${id}-${suffix}`)
      ),
      ...(supportCards
        ? [
            ...Array.from({ length: successCount }, (_, index) =>
              createCardInstance(live, id, `${id}-success${index}`)
            ),
            ...Array.from({ length: 12 }, (_, index) =>
              createCardInstance(energy, id, `${id}-energy${index}`)
            ),
          ]
        : []),
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
          cardIds: ['hand1', 'hand2', 'hand3', 'hand4', 'incoming', ...extraHands].map(
            (s) => `${id}-${s}`
          ),
        },
        mainDeck: {
          ...player.mainDeck,
          cardIds: [...extraDecks.map((s) => `${id}-${s}`), `${id}-deck`],
        },
        ...(supportCards
          ? {
              successZone: {
                ...player.successZone,
                cardIds: Array.from(
                  { length: successCount },
                  (_, index) => `${id}-success${index}`
                ),
              },
              energyZone: {
                ...player.energyZone,
                cardIds: Array.from({ length: 12 }, (_, index) => `${id}-energy${index}`),
                cardStates: new Map(
                  Array.from({ length: 12 }, (_, index) => [
                    `${id}-energy${index}`,
                    {
                      ...active,
                      orientation: index < 7 ? OrientationState.WAITING : OrientationState.ACTIVE,
                    },
                  ])
                ),
              },
            }
          : {}),
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
  }, fixture);
  await expect(page.locator('[data-battle-ui-anchor="self-stage-center"]')).toBeVisible();
}

const anchor = (page: Page, name: string) => page.locator(`[data-battle-ui-anchor="${name}"]`);

async function assertSuccessStack(page: Page, side: string, minimumStep: number) {
  const success = anchor(page, `${side}-success-live-zone`);
  const zone = (await success.boundingBox())!;
  const slots = await success.locator('.battle-success-slot').all();
  expect(slots).toHaveLength(3);
  let previous: { x: number; y: number; height: number } | null = null;
  for (const slot of slots) {
    const box = (await slot.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(zone.y + zone.height);
    if (previous) {
      expect(box.x).toBeCloseTo(previous.x, 1);
      expect(box.y - previous.y).toBeGreaterThanOrEqual(minimumStep);
      expect(box.y).toBeLessThan(previous.y + previous.height);
    }
    previous = box;
  }
}

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
      const minimum =
        width <= 320
          ? 50
          : width < 768
            ? 60
            : width < 1024
              ? 72
              : height >= 900
                ? 132
                : height >= 750
                  ? 104
                  : 88;
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
        const clearance = await anchor(page, `${side}-hand`).evaluate(
          (element) =>
            parseFloat(
              (element as HTMLElement).style.getPropertyValue('--battle-hand-clearance')
            ) || 0
        );
        expect(hand.height - clearance).toBeGreaterThanOrEqual(96);
        expect(hand.height - clearance).toBeLessThanOrEqual(112);
        if (side === 'self') {
          const handCardSize = await anchor(page, 'self-hand')
            .locator('[data-card-id="p1-hand1"]')
            .evaluate((e) => {
              const style = getComputedStyle(e);
              return { width: parseFloat(style.width), height: parseFloat(style.height) };
            });
          expect(handCardSize.width).toBeGreaterThanOrEqual(60);
          expect(handCardSize.width).toBeLessThanOrEqual(75);
          expect(handCardSize.height / handCardSize.width).toBeCloseTo(7 / 5, 2);
          if (height >= 900) expect(handCardSize).toEqual({ width: 75, height: 105 });
          if (height <= 768) expect(handCardSize).toEqual({ width: 60, height: 84 });
          for (const handCard of await anchor(page, 'self-hand').locator('[data-card-id]').all()) {
            expect((await handCard.boundingBox())!.y).toBeGreaterThanOrEqual(
              card.y + card.height - 1
            );
          }
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
      if (width >= 768) {
        expect(live.width).toBeGreaterThanOrEqual(95);
        expect(live.width).toBeLessThanOrEqual(117);
      }
      const zone = (await liveZone.boundingBox())!;
      if (width >= 768) {
        expect(zone.height).toBeGreaterThanOrEqual(78);
        expect(zone.height).toBeLessThanOrEqual(88);
        const separator = (await page
          .getByText('VS', { exact: true })
          .locator('..')
          .boundingBox())!;
        const gap =
          side === 'self'
            ? zone.y - (separator.y + separator.height)
            : separator.y - (zone.y + zone.height);
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(2);
      }
      const liveSlot = (await liveZone.locator('[data-battle-live-slot="0"]').boundingBox())!;
      const memberColumn = (await anchor(page, `${side}-stage-center`).boundingBox())!;
      expect(liveSlot.width).toBeCloseTo(memberColumn.width, 0);
      expect(liveSlot.height).toBeCloseTo(width >= 768 ? zone.height - 10 : live.height, 0);
      expect(live.y + live.height / 2).toBeCloseTo(zone.y + zone.height / 2, 0);
      expect(live.x + live.width / 2).toBeCloseTo(liveSlot.x + liveSlot.width / 2, 0);
      // Empty and filled slots both stay vertically centered; requirements use the row gap.
      const lastSlot = (await liveZone.locator('[data-battle-live-slot="2"]').boundingBox())!;
      expect(lastSlot.width).toBeCloseTo(memberColumn.width, 0);
      expect(lastSlot.height).toBeCloseTo(width >= 768 ? zone.height - 10 : live.height, 0);
      expect(lastSlot.y + lastSlot.height / 2).toBeCloseTo(zone.y + zone.height / 2, 0);
      const centerSlot = (await liveZone.locator('[data-battle-live-slot="1"]').boundingBox())!;
      expect(centerSlot.x + centerSlot.width / 2).toBeCloseTo(card.x + card.width / 2, 0);
      const requirements = (await liveZone
        .locator('[data-live-heart-requirements]')
        .first()
        .boundingBox())!;
      const area = (await anchor(page, `${side}-area`).boundingBox())!;
      if (width >= 768 && side === 'opponent') {
        expect(requirements.y + requirements.height).toBeLessThanOrEqual(live.y + 0.5);
        expect(requirements.y).toBeGreaterThanOrEqual(card.y + card.height - 0.5);
      } else {
        expect(requirements.y).toBeGreaterThanOrEqual(live.y + live.height - 0.5);
      }
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
    .poll(async () => {
      const incoming = (await target.locator('[data-card-id="p1-incoming"]').boundingBox())!;
      const existing = (await anchor(page, 'self-live-zone')
        .locator('[data-card-id="p1-live0"]')
        .boundingBox())!;
      return Math.abs(incoming.width - existing.width);
    })
    .toBeLessThan(0.5);
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
    [1280, 720],
    [1024, 768],
    [768, 1024],
  ]) {
    await page.setViewportSize({ width, height });
    await assertCardGeometry(page, width, height);
    await page.screenshot({ path: `${root}output/playwright/card-sizing-${width}.png` });
  }
  // Increasing viewport height must not make the primary cards smaller at a density boundary.
  let previousWidth = 0;
  for (const height of [768, 800, 849, 850, 900]) {
    await page.setViewportSize({ width: 1440, height });
    await assertCardGeometry(page, 1440, height);
    const member = (await anchor(page, 'self-stage-center')
      .locator('[data-card-id="p1-center"]')
      .boundingBox())!;
    expect(member.width).toBeGreaterThanOrEqual(previousWidth - 0.1);
    previousWidth = member.width;
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
    [320, 568],
  ]) {
    await page.setViewportSize({ width, height });
    await assertCardGeometry(page, width, height);
    await page.screenshot({ path: `${root}output/playwright/card-sizing-${width}.png` });
  }
});

test('desktop: energy uses the shared overlapping row without covering hand cards', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'tablet-1024x768');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1600, height: 900 });
  await openPopulatedBoard(page, true, 2);
  for (const [width, height] of [
    [1600, 900],
    [1024, 768],
    [768, 1024],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(async () => {
      for (const side of ['self', 'opponent']) {
        await assertSuccessStack(page, side, 30);
        const success = anchor(page, `${side}-success-live-zone`);
        const successZone = (await success.boundingBox())!;
        const label = (await success.locator('.battle-zone-label').boundingBox())!;
        for (const card of await success.locator('[data-card-surface]').all()) {
          const box = (await card.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(110);
          expect(box.width / box.height).toBeCloseTo(7 / 5, 1);
          expect(box.x).toBeGreaterThanOrEqual(successZone.x);
          expect(box.x + box.width).toBeLessThanOrEqual(successZone.x + successZone.width);
          expect(box.y).toBeGreaterThanOrEqual(label.y + label.height);
          expect(box.y + box.height).toBeLessThanOrEqual(successZone.y + successZone.height);
        }
        const energy = anchor(page, `${side}-energy-zone`);
        const zone = (await energy.boundingBox())!;
        const cards = await energy.locator('button[data-card-id]').all();
        expect(cards).toHaveLength(12);
        let lastX = zone.x;
        for (const card of cards) {
          const box = (await card.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(lastX);
          expect(box.x + box.width).toBeLessThanOrEqual(zone.x + zone.width);
          expect(box.y).toBeGreaterThanOrEqual(zone.y);
          expect(box.y + box.height).toBeLessThanOrEqual(zone.y + zone.height);
          const waiting = (await card.getAttribute('aria-pressed')) === 'true';
          expect(box.width / box.height).toBeCloseTo(waiting ? 7 / 5 : 5 / 7, 1);
          lastX = box.x;
        }
        const handCards =
          side === 'self'
            ? anchor(page, 'self-hand').locator('[data-card-id]')
            : anchor(page, 'opponent-hand').locator('img[alt="Card Back"]');
        for (const card of await handCards.all()) {
          const box = (await card.boundingBox())!;
          const overlap =
            Math.max(
              0,
              Math.min(box.x + box.width, zone.x + zone.width) - Math.max(box.x, zone.x)
            ) *
            Math.max(
              0,
              Math.min(box.y + box.height, zone.y + zone.height) - Math.max(box.y, zone.y)
            );
          expect(overlap).toBe(0);
        }
      }
    }).toPass({ timeout: 5000 });
    await page.screenshot({ path: `${root}output/playwright/desktop-energy-${width}.png` });
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  for (const side of ['self', 'opponent']) {
    const tabStops = await anchor(page, `${side}-energy-zone`)
      .locator('button, [tabindex]')
      .evaluateAll(
        (elements) =>
          elements.filter(
            (element) => (element as HTMLElement).tabIndex >= 0 && !element.matches(':disabled')
          ).length
      );
    expect(tabStops).toBe(0);
  }
  await page.evaluate(async () => {
    const storePath = performance
      .getEntriesByType('resource')
      .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(storePath);
    useGameStore.getState().setFreePlayEnabled(true);
  });
  const energy = anchor(page, 'self-energy-zone');
  const originalOrder = await energy
    .locator('button[data-card-id]')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-card-id')));
  await energy.locator('[data-card-id="p1-energy11"]').click();
  await expect(energy).toContainText('4/12');
  expect(
    await energy
      .locator('button[data-card-id]')
      .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-card-id')))
  ).toEqual(originalOrder);
  await energy.getByRole('button', { name: '全部能量变为待机' }).click();
  await expect(energy).toContainText('0/12');
  await energy.getByRole('button', { name: '全部能量变为活跃' }).click();
  await expect(energy).toContainText('12/12');
  expect(
    await energy
      .locator('button[data-card-id]')
      .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-card-id')))
  ).toEqual(originalOrder);
  // Tab reaches each usable card once; Enter and Space perform the same orientation action.
  await page.mouse.move(0, 0);
  await energy.getByRole('button', { name: '全部能量变为待机' }).focus();
  for (const cardId of originalOrder) {
    await page.keyboard.press('Tab');
    await expect(energy.locator(`button[data-card-id="${cardId}"]`)).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(energy.locator(':focus')).toHaveCount(0);
  const firstEnergy = energy.locator('button[data-card-id]').first();
  await firstEnergy.focus();
  await page.keyboard.press('Enter');
  await expect(firstEnergy).toHaveAttribute('aria-pressed', 'true');
  await expect(energy).toContainText('11/12');
  await page.keyboard.press('Space');
  await expect(firstEnergy).toHaveAttribute('aria-pressed', 'false');
  await expect(energy).toContainText('12/12');
  expect(
    await energy
      .locator('button[data-card-id]')
      .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-card-id')))
  ).toEqual(originalOrder);
});

test('phone: success LIVE and energy fit between stage and hand, with working energy controls', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile-390x844');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPopulatedBoard(page, true);
  const energy = anchor(page, 'self-energy-zone');
  const success = anchor(page, 'self-success-live-zone');
  const support = page.locator('[data-mobile-battle-support-row]');

  for (const [width, height] of [
    [390, 844],
    [430, 932],
    [320, 668],
    [390, 700],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(async () => {
      const tabletop = await page.locator('[data-mobile-tabletop]').evaluate((element) => ({
        height: element.clientHeight,
        contentHeight: element.scrollHeight,
        width: element.clientWidth,
        contentWidth: element.scrollWidth,
        top: element.getBoundingClientRect().top,
      }));
      expect(tabletop.contentHeight, `${width}×${height}: table height`).toBeLessThanOrEqual(
        tabletop.height + 1
      );
      expect(tabletop.contentWidth, `${width}×${height}: table width`).toBeLessThanOrEqual(
        tabletop.width + 1
      );
      const row = (await support.boundingBox())!;
      const hand = (await anchor(page, 'self-hand').boundingBox())!;
      const tools = (await page.locator('.battle-mobile-actions').boundingBox())!;
      expect(tools.height).toBe(32);
      for (const caption of await page
        .locator('.battle-mobile-actions > button > span.truncate')
        .all()) {
        expect(
          await caption.evaluate((element) => element.scrollWidth <= element.clientWidth)
        ).toBe(true);
      }
      expect(hand.y + hand.height).toBeLessThanOrEqual(tools.y);
      if (height >= 844) {
        const member = (await anchor(page, 'self-stage-center').boundingBox())!;
        expect(member.width).toBeGreaterThanOrEqual(68);
      }
      expect(row.y + row.height).toBeLessThanOrEqual(hand.y);
      const identity = (await anchor(page, 'self-area')
        .locator('[data-player-identity-seat]')
        .boundingBox())!;
      for (const card of await anchor(page, 'self-hand').locator('[data-card-id]').all()) {
        expect((await card.boundingBox())!.y).toBeGreaterThanOrEqual(identity.y + identity.height);
      }
      const resources = (await page.locator('[data-mobile-battle-resources-rail]').boundingBox())!;
      expect(resources.y + resources.height).toBeLessThanOrEqual(row.y);
      for (const pile of await page.locator('.battle-deck-pile, .battle-waiting-room-pile').all()) {
        const box = (await pile.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(40);
        if (height >= 844) expect(box.height).toBeGreaterThanOrEqual(70);
        expect(box.width / box.height).toBeCloseTo(5 / 7, 1);
      }
      const left = (await anchor(page, 'self-stage-left').boundingBox())!;
      const right = (await anchor(page, 'self-stage-right').boundingBox())!;
      const live = (await anchor(page, 'self-live-zone').boundingBox())!;
      expect(live.y).toBeGreaterThanOrEqual(tabletop.top);
      expect(left.y).toBeGreaterThanOrEqual(live.y + live.height);
      expect(right.x + right.width).toBeLessThan(resources.x);
      expect(left.x).toBeLessThan(width / 5);
      expect(left.y + left.height).toBeLessThanOrEqual(row.y);
      const won = (await success.boundingBox())!;
      await assertSuccessStack(page, 'self', 12);
      const power = (await energy.boundingBox())!;
      expect(won.x + won.width).toBeLessThanOrEqual(power.x);
      expect(won.y).toBeCloseTo(power.y, 0);
      const cards = await energy.locator('[data-card-id]').all();
      expect(cards).toHaveLength(12);
      for (const card of cards) {
        const box = (await card.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(power.x);
        expect(box.x + box.width).toBeLessThanOrEqual(power.x + power.width);
        expect(box.y).toBeGreaterThanOrEqual(power.y);
        expect(box.y + box.height).toBeLessThanOrEqual(power.y + power.height);
      }
      for (const card of await success.locator('[data-card-id]').all()) {
        const box = (await card.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(80);
        expect(box.width / box.height).toBeCloseTo(7 / 5, 1);
        expect(box.x).toBeGreaterThanOrEqual(won.x);
        expect(box.x + box.width).toBeLessThanOrEqual(won.x + won.width);
        expect(box.y + box.height).toBeLessThanOrEqual(row.y + row.height);
      }
      // A compact card must retain its rectangular face at every clipping layer.
      for (const surface of await page.locator('[data-card-surface]').all()) {
        const corners = await surface.evaluate((element) => ({
          radius: parseFloat(getComputedStyle(element).borderTopLeftRadius),
          shortEdge: Math.min(
            (element as HTMLElement).offsetWidth,
            (element as HTMLElement).offsetHeight
          ),
          faceRadius: parseFloat(getComputedStyle(element.firstElementChild!).borderTopLeftRadius),
        }));
        expect(corners.radius).toBeLessThanOrEqual(corners.shortEdge * 0.15);
        expect(corners.faceRadius).toBe(corners.radius);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width
      );
    }).toPass({ timeout: 5000 });
    await page.screenshot({
      path: `${root}output/playwright/mobile-support-${width}x${height}.png`,
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  // Three successful LIVE cards are a terminal board. Resume a two-LIVE fixture for commands.
  await page.evaluate(async (repoRoot) => {
    const storePath = performance
      .getEntriesByType('resource')
      .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
    const [{ useGameStore }, { updatePlayer }] = await Promise.all([
      import(storePath),
      import(`/@fs${repoRoot}src/domain/entities/game.ts`),
    ]);
    const store = useGameStore.getState();
    let state = store.gameSession.state;
    for (const id of ['p1', 'p2']) {
      state = updatePlayer(state, id, (player: any) => ({
        ...player,
        successZone: { ...player.successZone, cardIds: player.successZone.cardIds.slice(0, 2) },
        waitingRoom: { ...player.waitingRoom, cardIds: [player.successZone.cardIds[2]] },
      }));
    }
    store.gameSession.authorityState = state;
    store.syncState();
  }, root);
  const lastEnergy = energy.locator('[data-card-id="p1-energy11"]');
  await expect(lastEnergy).toHaveAttribute('aria-disabled', 'true');
  const lockedEnergy = (await lastEnergy.boundingBox())!;
  await page.mouse.click(
    lockedEnergy.x + lockedEnergy.width / 2,
    lockedEnergy.y + lockedEnergy.height / 2
  );
  await expect(lastEnergy).toHaveAttribute('aria-pressed', 'false');
  await expect(energy).toContainText('5/12');
  await page.getByRole('button', { name: '规则', exact: true }).click();
  const originalOrder = await energy
    .locator('button[data-card-id]')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-card-id')));
  await lastEnergy.click();
  await expect(lastEnergy).toHaveAttribute('aria-pressed', 'true');
  await expect(energy).toContainText('4/12');
  expect(
    await energy
      .locator('button[data-card-id]')
      .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-card-id')))
  ).toEqual(originalOrder);
  await energy.getByRole('button', { name: '全部能量变为待机' }).click();
  await expect(energy).toContainText('0/12');
  await energy.getByRole('button', { name: '全部能量变为活跃' }).click();
  await expect(energy).toContainText('12/12');

  const fullRowPositions = await energy
    .locator('button[data-card-id]')
    .evaluateAll((cards) => cards.slice(0, 4).map((card) => card.getBoundingClientRect().x));
  for (const count of [4, 12]) {
    await page.evaluate(
      async ({ repoRoot, count }) => {
        const storePath = performance
          .getEntriesByType('resource')
          .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
        const [{ useGameStore }, { updatePlayer }] = await Promise.all([
          import(storePath),
          import(`/@fs${repoRoot}src/domain/entities/game.ts`),
        ]);
        const store = useGameStore.getState();
        const ids = Array.from({ length: 12 }, (_, index) => `p1-energy${index}`);
        store.gameSession.authorityState = updatePlayer(
          store.gameSession.state,
          'p1',
          (player: any) => ({
            ...player,
            energyDeck: { ...player.energyDeck, cardIds: ids.slice(count) },
            energyZone: {
              ...player.energyZone,
              cardIds: ids.slice(0, count),
              cardStates: new Map(
                ids.slice(0, count).map((id) => [id, { orientation: 'ACTIVE', face: 'FACE_UP' }])
              ),
            },
          })
        );
        store.syncState();
      },
      { repoRoot: root, count }
    );
    await expect(energy.locator('button[data-card-id]')).toHaveCount(count);
    const positions = await energy
      .locator('button[data-card-id]')
      .evaluateAll((cards) => cards.slice(0, 4).map((card) => card.getBoundingClientRect().x));
    positions.forEach((position, index) =>
      expect(position).toBeCloseTo(fullRowPositions[index], 0)
    );
    await page.screenshot({ path: `${root}output/playwright/mobile-energy-${count}.png` });
  }

  const source = (await lastEnergy.boundingBox())!;
  const target = (await anchor(page, 'self-stage-left').boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2, {
    steps: 3,
  });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(lastEnergy).toHaveCount(0);
  await expect(anchor(page, 'self-stage-left').getByAltText('附加能量')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const storePath = performance
          .getEntriesByType('resource')
          .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
        const { useGameStore } = await import(storePath);
        return useGameStore.getState().getSeatMemberOverlayCardIds('FIRST', 'LEFT');
      })
    )
    .toEqual(['p1-energy11']);
  await expect(energy).toContainText('11/11');
  await page.screenshot({ path: `${root}output/playwright/mobile-support-after-drag.png` });

  await page.evaluate(async () => {
    const storePath = performance
      .getEntriesByType('resource')
      .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(storePath);
    useGameStore.getState().setGameMode('SOLITAIRE');
  });
  await page.getByRole('button', { name: '对手', exact: true }).click();
  const opponent = anchor(page, 'opponent-area');
  await expect(opponent).toBeVisible();
  await expect(async () => {
    const opponentRow = (await opponent.locator('[data-mobile-battle-support-row]').boundingBox())!;
    const opponentHand = (await anchor(page, 'opponent-hand').boundingBox())!;
    const opponentMember = (await anchor(page, 'opponent-stage-center').boundingBox())!;
    expect(opponentRow.y).toBeGreaterThanOrEqual(opponentHand.y + opponentHand.height);
    expect(opponentRow.y + opponentRow.height).toBeLessThanOrEqual(opponentMember.y);
  }).toPass({ timeout: 5000 });
  await expect(opponent.locator('[data-card-id^="p2-hand"]')).toHaveCount(0);
  await expect(anchor(page, 'opponent-energy-zone').locator('button[data-card-id]')).toHaveCount(
    12
  );
  await expect(
    anchor(page, 'opponent-energy-zone').getByRole('group', { name: '批量调整能量状态' })
  ).toHaveCount(0);
  for (const [width, height] of [
    [390, 844],
    [320, 668],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(async () => {
      const table = await opponent.locator('[data-mobile-tabletop]').evaluate((element) => ({
        height: element.clientHeight,
        contentHeight: element.scrollHeight,
        width: element.clientWidth,
        contentWidth: element.scrollWidth,
      }));
      expect(table.contentHeight).toBeLessThanOrEqual(table.height + 1);
      expect(table.contentWidth).toBeLessThanOrEqual(table.width + 1);
      const opponentDeck = (await anchor(page, 'opponent-energy-deck').boundingBox())!;
      const phaseControls = (await anchor(page, 'phase-controls').boundingBox())!;
      expect(opponentDeck.y + opponentDeck.height).toBeLessThanOrEqual(phaseControls.y);
    }).toPass({ timeout: 5000 });
    await page.screenshot({
      path: `${root}output/playwright/mobile-support-opponent-${width}.png`,
    });
  }
});

test('phone: short viewports and enlarged text keep zones separated and reachable', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile-390x844');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPopulatedBoard(page, true, 2);
  await page.getByRole('button', { name: '规则', exact: true }).click();
  const tabletop = page.locator('[data-mobile-tabletop]');
  const support = page.locator('[data-mobile-battle-support-row]');
  const resources = page.locator('[data-mobile-battle-resources-rail]');
  const hand = anchor(page, 'self-hand');

  for (const [width, height, fontSize] of [
    [393, 620, 16],
    [360, 640, 16],
    [320, 568, 16],
    [360, 540, 16],
    [320, 500, 16],
    [320, 668, 20],
    [320, 568, 20],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = `${size}px`;
    }, fontSize);
    await tabletop.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(async () => {
      const table = (await tabletop.boundingBox())!;
      const row = (await support.boundingBox())!;
      const rail = (await resources.boundingBox())!;
      const core = (await page.locator('[data-mobile-battle-core]').boundingBox())!;
      const left = (await anchor(page, 'self-stage-left').boundingBox())!;
      const right = (await anchor(page, 'self-stage-right').boundingBox())!;
      const cards = (await hand.boundingBox())!;
      if (height === 568 && fontSize === 16) {
        const member = (await anchor(page, 'self-stage-center')
          .locator('[data-card-id="p1-center"]')
          .boundingBox())!;
        const live = (await anchor(page, 'self-live-zone')
          .locator('[data-card-id="p1-live0"]')
          .boundingBox())!;
        expect(member.width).toBeGreaterThanOrEqual(50);
        expect(member.height / member.width).toBeCloseTo(7 / 5, 2);
        expect(live.height).toBeGreaterThanOrEqual(40);
        expect(live.width / live.height).toBeCloseTo(7 / 5, 1);
      }
      expect(core.y).toBeCloseTo(rail.y, 0);
      expect(left.y + left.height).toBeLessThanOrEqual(row.y);
      expect(rail.y + rail.height).toBeLessThanOrEqual(row.y);
      expect(right.x + right.width).toBeLessThan(rail.x);
      expect(left.x).toBeGreaterThanOrEqual(table.x);
      expect(table.y + table.height).toBeLessThanOrEqual(cards.y);
      const tools = (await page.locator('.battle-mobile-actions').boundingBox())!;
      expect(cards.y + cards.height).toBeLessThanOrEqual(tools.y);
      expect(await tabletop.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
        table.width + 1
      );
    }).toPass({ timeout: 5000 });

    const handBeforeScroll = (await hand.boundingBox())!;
    await expect(tabletop).toHaveCSS('overflow-y', 'auto');
    await tabletop.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(async () => {
      const table = (await tabletop.boundingBox())!;
      const row = (await support.boundingBox())!;
      expect(row.y).toBeGreaterThanOrEqual(table.y);
      expect(row.y + row.height).toBeLessThanOrEqual(table.y + table.height + 1);
      for (const card of await support.locator('[data-card-id]').all()) {
        const box = (await card.boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(table.y + table.height + 1);
      }
      expect((await hand.boundingBox())!.y).toBe(handBeforeScroll.y);
    }).toPass({ timeout: 5000 });

    const lastEnergy = anchor(page, 'self-energy-zone').locator('[data-card-id="p1-energy11"]');
    const wasWaiting = (await lastEnergy.getAttribute('aria-pressed')) === 'true';
    await lastEnergy.tap();
    await expect(lastEnergy).toHaveAttribute('aria-pressed', String(!wasWaiting));
  }

  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '16px';
  });
  await tabletop.evaluate((element) => {
    element.scrollTop = 0;
  });
  for (const slot of ['left', 'center', 'right']) {
    await anchor(page, `self-stage-${slot}`).locator(`[data-card-id="p1-${slot}"]`).dblclick();
  }
  await expect(async () => {
    const table = (await tabletop.boundingBox())!;
    const rail = (await resources.boundingBox())!;
    let previousRight = table.x;
    for (const slot of ['left', 'center', 'right']) {
      const memberSlot = anchor(page, `self-stage-${slot}`);
      const slotBox = (await memberSlot.boundingBox())!;
      const card = (await memberSlot.locator(`[data-card-id="p1-${slot}"]`).boundingBox())!;
      expect(card.width / card.height).toBeCloseTo(7 / 5, 2);
      expect(card.y + card.height / 2).toBeCloseTo(slotBox.y + slotBox.height / 2, 1);
      expect(card.x).toBeGreaterThanOrEqual(previousRight);
      expect(card.x + card.width).toBeLessThanOrEqual(rail.x);
      previousRight = card.x + card.width;
    }
  }).toPass({ timeout: 5000 });
});

test('free mode: return a chosen hand card to the top of the main deck', async ({ page }, info) => {
  test.skip(!['mobile-390x844', 'tablet-1024x768'].includes(info.project.name));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (info.project.name === 'tablet-1024x768')
    await page.setViewportSize({ width: 1600, height: 900 });
  await openPopulatedBoard(page);
  await page.getByRole('button', { name: /^(规则|规则模式)$/ }).click();
  const button = page.getByRole('button', { name: '将所选手牌放回牌库顶' });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(
    page.getByRole('status').filter({ hasText: '点选一张手牌放回卡组顶' })
  ).toBeVisible();
  if (info.project.name === 'tablet-1024x768') {
    for (const [width, height] of [
      [1600, 900],
      [1024, 768],
      [900, 768],
      [768, 1024],
    ]) {
      await page.setViewportSize({ width, height });
      await expect(async () => {
        const prompt = (await page
          .getByRole('status')
          .filter({ hasText: '点选一张手牌放回卡组顶' })
          .boundingBox())!;
        const hand = (await anchor(page, 'self-hand').boundingBox())!;
        const identity = (await anchor(page, 'self-area')
          .locator('[data-player-identity-seat]')
          .boundingBox())!;
        expect(prompt.x).toBeGreaterThanOrEqual(0);
        expect(prompt.x + prompt.width).toBeLessThanOrEqual(width);
        const textBounds = await page
          .getByRole('status')
          .filter({ hasText: '点选一张手牌放回卡组顶' })
          .evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const text = range.getBoundingClientRect();
            const table = element.closest('.battle-table')!.getBoundingClientRect();
            return {
              left: text.left,
              right: text.right,
              tableLeft: table.left,
              tableRight: table.right,
            };
          });
        expect(textBounds.left).toBeGreaterThanOrEqual(textBounds.tableLeft);
        expect(textBounds.right).toBeLessThanOrEqual(textBounds.tableRight);
        expect(prompt.y).toBeGreaterThanOrEqual(hand.y - 48);
        expect(prompt.y + prompt.height).toBeLessThanOrEqual(identity.y);
        const boardItems = anchor(page, 'self-area').locator(
          '[data-card-id], .battle-resource-pile, [data-player-identity-seat], [data-player-communication-seat], .battle-zone-label:not([role="status"]), .battle-mini-action'
        );
        for (const item of await boardItems.all()) {
          const box = (await item.boundingBox())!;
          const overlap =
            Math.max(
              0,
              Math.min(box.x + box.width, prompt.x + prompt.width) - Math.max(box.x, prompt.x)
            ) *
            Math.max(
              0,
              Math.min(box.y + box.height, prompt.y + prompt.height) - Math.max(box.y, prompt.y)
            );
          expect(
            overlap,
            `${width}px: ${await item.evaluate((element) => element.outerHTML.slice(0, 240))}`
          ).toBe(0);
        }
      }).toPass({ timeout: 5000 });
      await page.screenshot({
        path: `${root}output/playwright/return-hand-card-desktop-${width}.png`,
      });
    }
    await page.setViewportSize({ width: 1600, height: 900 });
  }
  await page.screenshot({
    path: `${root}output/playwright/return-hand-card-${info.project.name}.png`,
  });
  await page.getByRole('button', { name: '取消放回卡组顶' }).click();
  await expect(anchor(page, 'self-hand').locator('[data-card-id="p1-incoming"]')).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: '点选一张手牌放回卡组顶' })).toHaveCount(
    0
  );
  await button.click();
  await anchor(page, 'self-hand').locator('[data-card-id="p1-incoming"]').click();
  await expect(anchor(page, 'self-hand').locator('[data-card-id="p1-incoming"]')).toHaveCount(0);
  await expect(anchor(page, 'self-main-deck')).toContainText('2');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const storePath = performance
          .getEntriesByType('resource')
          .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
        const { useGameStore } = await import(storePath);
        return useGameStore.getState().gameSession.state.players[0].mainDeck.cardIds[0];
      })
    )
    .toBe('p1-incoming');
  // The established card-first route still executes the same command.
  if (info.project.name === 'mobile-390x844')
    await page.setViewportSize({ width: 320, height: 668 });
  await anchor(page, 'self-hand').locator('[data-card-id="p1-hand4"]').click();
  await button.click();
  await expect(anchor(page, 'self-hand').locator('[data-card-id="p1-hand4"]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const storePath = performance
          .getEntriesByType('resource')
          .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
        const { useGameStore } = await import(storePath);
        return useGameStore.getState().gameSession.state.players[0].mainDeck.cardIds;
      })
    )
    .toEqual(['p1-hand4', 'p1-incoming', 'p1-deck']);
  await button.click();
  await page.getByRole('button', { name: /^(自由|自由模式)$/ }).click();
  await expect(page.getByRole('status').filter({ hasText: '点选一张手牌放回卡组顶' })).toHaveCount(
    0
  );
  await expect(button).toHaveCount(0);
  await expect(anchor(page, 'self-hand').locator('[data-card-id]')).toHaveCount(3);
  await page.getByRole('button', { name: /^(规则|规则模式)$/ }).click();
  for (let remaining = 3; remaining > 0; remaining--) {
    await button.click();
    await anchor(page, 'self-hand').locator('[data-card-id]').last().click();
    await expect(anchor(page, 'self-hand').locator('[data-card-id]')).toHaveCount(remaining - 1);
  }
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', '没有可放回的手牌');
  await page.getByRole('button', { name: '从主卡组抽一张牌' }).click();
  await expect(anchor(page, 'self-hand').locator('[data-card-id]')).toHaveCount(1);
  await expect(button).toBeEnabled();
});

test('battle utilities: readable text without covering the playmat, with keyboard feedback in both themes', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'tablet-1024x768');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await openPopulatedBoard(page, true, 2);
  await page.getByRole('button', { name: '规则', exact: true }).click();
  for (const [width, height] of [
    [320, 668],
    [390, 844],
    [1600, 900],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      const audit = async () =>
        page
          .locator('.battle-zone-label:visible, .battle-mini-action:visible')
          .evaluateAll((nodes) => {
            const context = document.createElement('canvas').getContext('2d')!;
            const rgb = (value: string) => {
              context.clearRect(0, 0, 1, 1);
              context.fillStyle = value;
              context.fillRect(0, 0, 1, 1);
              return Array.from(context.getImageData(0, 0, 1, 1).data);
            };
            const luminance = (color: number[]) =>
              color
                .slice(0, 3)
                .map((value) => {
                  const channel = value / 255;
                  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
                })
                .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
            const contrast = (a: number[], b: number[]) =>
              (Math.max(luminance(a), luminance(b)) + 0.05) /
              (Math.min(luminance(a), luminance(b)) + 0.05);
            const composite = (foreground: number[], background: number[]) =>
              foreground
                .slice(0, 3)
                .map(
                  (channel, index) =>
                    (channel * foreground[3]) / 255 + background[index] * (1 - foreground[3] / 255)
                );
            return nodes.map((node) => {
              const style = getComputedStyle(node);
              const scrim = getComputedStyle(node, '::before');
              const hasScrim = scrim.content !== 'none' && scrim.content !== 'normal';
              const background = rgb(hasScrim ? scrim.backgroundColor : style.backgroundColor);
              // The label scrim stays at full strength across the text and fades outside it.
              // Composite each local surface over both extremes of an arbitrary playmat.
              const backgrounds = [
                composite(background, [0, 0, 0]),
                composite(background, [255, 255, 255]),
              ];
              const box = node.getBoundingClientRect();
              let opacity = 1;
              for (let parent: Element | null = node; parent; parent = parent.parentElement) {
                opacity *= Number(getComputedStyle(parent).opacity);
              }
              return {
                text: node.textContent?.trim(),
                action: node.classList.contains('battle-mini-action'),
                disabled: node.matches(':disabled'),
                width: box.width,
                height: box.height,
                opacity,
                size: style.fontSize,
                weight: style.fontWeight,
                stroke: parseFloat(style.webkitTextStrokeWidth),
                textContrast: Math.min(...backgrounds.map((bg) => contrast(rgb(style.color), bg))),
              };
            });
          });
      await expect(async () => {
        const items = await audit();
        expect(items.length).toBeGreaterThan(8);
        const typography = { size: items[0].size, weight: items[0].weight };
        for (const item of items) {
          expect(item.opacity, item.text).toBe(1);
          expect({ size: item.size, weight: item.weight }, item.text).toEqual(typography);
          expect(item.stroke, item.text).toBe(0);
          expect(item.textContrast, item.text).toBeGreaterThanOrEqual(4.5);
          if (item.action) {
            expect(item.width).toBeGreaterThanOrEqual(24);
            expect(item.height).toBeGreaterThanOrEqual(24);
          }
        }
        for (const header of await page.locator('.battle-zone-header:visible').all()) {
          const label = header.locator('.battle-zone-label');
          const controls = header.locator('.battle-mini-action-group');
          if (!(await controls.count())) continue;
          const text = (await label.boundingBox())!;
          const buttons = (await controls.boundingBox())!;
          const zone = (await header.boundingBox())!;
          expect(text.x + text.width).toBeLessThanOrEqual(buttons.x);
          expect(buttons.x + buttons.width).toBeLessThanOrEqual(zone.x + zone.width + 1);
        }
      }).toPass({ timeout: 5000 });
      const button = page.locator('.battle-mini-action:visible:not(:disabled)').first();
      await page.mouse.move(0, 0);
      await expect.poll(() => button.evaluate((element) => element.matches(':hover'))).toBe(false);
      // Finish the hover-out transition before recording the resting surface.
      await page.waitForTimeout(150);
      const normal = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
      await button.hover();
      await expect
        .poll(() => button.evaluate((element) => getComputedStyle(element).backgroundColor))
        .not.toBe(normal);
      for (const item of await audit()) {
        expect(item.textContrast, item.text).toBeGreaterThanOrEqual(4.5);
      }
      await page.keyboard.press('Tab');
      await button.focus();
      await expect(button).toBeFocused();
      expect(
        await button.evaluate((element) => ({
          visible: element.matches(':focus-visible'),
          width: getComputedStyle(element).outlineWidth,
          style: getComputedStyle(element).outlineStyle,
        }))
      ).toEqual({ visible: true, width: '2px', style: 'solid' });
      const items = await audit();
      console.log(
        JSON.stringify({
          theme,
          width,
          minTextContrast: Math.min(
            ...items.filter((item) => !item.disabled).map((item) => item.textContrast)
          ),
          minDisabledContrast: Math.min(
            ...items.filter((item) => item.disabled).map((item) => item.textContrast)
          ),
        })
      );
      await page.screenshot({
        path: `${root}output/playwright/battle-utilities-${width}-${theme}.png`,
      });
    }
  }
});

test('battle panels: card contours stay consistent through judgment, inspection and portal details', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'tablet-1024x768');
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const expectCardCorners = async (selector: string) => {
    const cards = page.locator(selector);
    await expect(cards.first()).toBeVisible();
    for (const card of await cards.all()) {
      const geometry = await card.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          radius: parseFloat(style.borderTopLeftRadius),
          ratio: parseFloat(style.height) / parseFloat(style.width),
        };
      });
      expect(geometry.radius).toBe(4);
      expect(geometry.ratio).toBeCloseTo(7 / 5, 1);
    }
  };
  for (const [width, height] of [
    [1600, 900],
    [390, 844],
    [320, 668],
  ]) {
    await page.setViewportSize({ width, height });
    await openPopulatedBoard(page);
    await page.evaluate(async (repoRoot) => {
      const storePath = performance
        .getEntriesByType('resource')
        .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
      const [{ useGameStore }, { updatePlayer }, { GamePhase, SubPhase }] = await Promise.all([
        import(storePath),
        import(`/@fs${repoRoot}src/domain/entities/game.ts`),
        import(`/@fs${repoRoot}src/shared/types/enums.ts`),
      ]);
      const store = useGameStore.getState();
      let state = store.gameSession.state;
      for (const id of ['p1', 'p2']) {
        state = updatePlayer(state, id, (player: any) => ({
          ...player,
          hand: {
            ...player.hand,
            cardIds: player.hand.cardIds.filter(
              (cardId: string) =>
                ![
                  `${id}-hand1`,
                  `${id}-hand3`,
                  `${id}-hand4`,
                  ...(id === 'p1' ? [`${id}-hand2`] : []),
                ].includes(cardId)
            ),
          },
          waitingRoom: { ...player.waitingRoom, cardIds: [`${id}-hand3`] },
          mainDeck: { ...player.mainDeck, cardIds: [`${id}-deck`, `${id}-hand4`] },
        }));
      }
      store.gameSession.authorityState = {
        ...state,
        currentPhase: GamePhase.PERFORMANCE_PHASE,
        currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
        manualOperationMode: 'FREE',
        resolutionZone: {
          ...state.resolutionZone,
          cardIds: ['p1-hand1', 'p1-hand2', 'p2-hand1'],
          revealedCardIds: ['p1-hand1', 'p2-hand1'],
        },
      };
      store.syncState();
    }, root);
    const judgment = page.getByRole('dialog', { name: '应援/判定区', exact: true });
    await expect(judgment).toBeVisible();
    await expectCardCorners('#judgment-panel [data-cheer-strip] .battle-card-face');
    await expectCardCorners('#judgment-panel [data-cheer-live-group] .battle-card-face');
    await judgment.getByRole('button', { name: /查看后攻玩家/ }).click();
    await expect(judgment).toContainText('此视图仅供查看');
    await expect(judgment.getByRole('button', { name: '↓ 翻开一张', exact: true })).toHaveCount(0);
    await judgment.getByRole('button', { name: /查看先攻玩家/ }).click();
    await page.screenshot({ path: `${root}output/playwright/battle-panel-judgment-${width}.png` });
    await judgment.getByRole('button', { name: '收起应援/判定区', exact: true }).click();
    await page.evaluate(async (repoRoot) => {
      const storePath = performance
        .getEntriesByType('resource')
        .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
      const [{ useGameStore }, { GamePhase, SubPhase, ZoneType }] = await Promise.all([
        import(storePath),
        import(`/@fs${repoRoot}src/shared/types/enums.ts`),
      ]);
      const store = useGameStore.getState();
      store.gameSession.authorityState = {
        ...store.gameSession.state,
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.NONE,
      };
      store.syncState();
      const opened = store.openInspection(ZoneType.MAIN_DECK, 1);
      if (!opened.success) throw new Error('Failed to open inspection');
    }, root);
    const inspected = anchor(page, 'self-area').locator('[data-inspection-zone-collapsed="false"]');
    await expect(inspected).toBeVisible();
    await expect(page.locator('[data-phase-announcement]')).toHaveCount(0);
    await expectCardCorners('[data-inspection-zone-collapsed="false"] [data-card-id]');
    await page.getByRole('button', { name: '隐藏检视区', exact: true }).click();
    await expect(
      anchor(page, 'self-area').locator('[data-inspection-zone-collapsed="true"]')
    ).toBeVisible();
    await page.getByRole('button', { name: '展开检视区', exact: true }).click();
    await expect(inspected).toBeVisible();
    await page.screenshot({
      path: `${root}output/playwright/battle-panel-inspection-${width}.png`,
    });
    await page.getByRole('button', { name: '关闭回顶', exact: true }).click();
    await expect(inspected).toHaveCount(0);
    await anchor(page, 'self-area').locator('.battle-waiting-room-pile').click();
    const waitingRoom = page.getByRole('dialog', { name: '休息室', exact: true });
    await expect(waitingRoom).toBeVisible();
    await expectCardCorners('[role="dialog"][aria-label="休息室"] [data-card-surface]');
    expect(
      await waitingRoom
        .locator('.modal-surface')
        .evaluate((e) => getComputedStyle(e).borderTopLeftRadius)
    ).toBe('12px');
    await page.screenshot({ path: `${root}output/playwright/battle-panel-waiting-${width}.png` });
    await waitingRoom.getByTitle('关闭休息室', { exact: true }).click();
    await page.evaluate(async () => {
      const storePath = performance
        .getEntriesByType('resource')
        .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
      const { useGameStore } = await import(storePath);
      useGameStore.getState().setHoveredCard('p1-center');
    });
    const detail = page.getByLabel('成员 卡牌详情', { exact: true });
    await expect(detail).toBeVisible();
    const detailCard = detail.locator('[data-card-surface]');
    expect(await detailCard.evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).toBe('4px');
    await page.screenshot({ path: `${root}output/playwright/battle-panel-detail-${width}.png` });
    if (width < 768) await page.getByRole('button', { name: '关闭卡牌详情', exact: true }).click();
    await page.evaluate(async (repoRoot) => {
      const storePath = performance
        .getEntriesByType('resource')
        .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
      const [{ useGameStore }, { GamePhase, SubPhase }] = await Promise.all([
        import(storePath),
        import(`/@fs${repoRoot}src/shared/types/enums.ts`),
      ]);
      const store = useGameStore.getState();
      store.setHoveredCard(null);
      store.gameSession.authorityState = {
        ...store.gameSession.state,
        currentPhase: GamePhase.MULLIGAN_PHASE,
        currentSubPhase: SubPhase.MULLIGAN_FIRST_PLAYER,
      };
      store.syncState();
    }, root);
    await expect(anchor(page, 'mulligan-panel')).toBeVisible();
    await expectCardCorners('[data-battle-ui-anchor="mulligan-cards"] [data-card-surface]');
    await expect(page.locator('[data-phase-announcement]')).toHaveCount(0);
    await page.screenshot({ path: `${root}output/playwright/battle-panel-mulligan-${width}.png` });
  }
});

async function arrangeHandCount(page: Page, count: number, mainPhase = false) {
  await page.evaluate(
    async ({ repoRoot, count, mainPhase }) => {
      const storePath = performance
        .getEntriesByType('resource')
        .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
      const [{ useGameStore }, { updatePlayer }] = await Promise.all([
        import(storePath),
        import(`/@fs${repoRoot}src/domain/entities/game.ts`),
      ]);
      const store = useGameStore.getState();
      const all = [
        'hand1',
        'hand2',
        'hand3',
        'hand4',
        'incoming',
        ...Array.from({ length: 25 }, (_, i) => `extra${i}`),
      ].map((s) => `p1-${s}`);
      let state = updatePlayer(store.gameSession.state, 'p1', (player: any) => ({
        ...player,
        hand: { ...player.hand, cardIds: all.slice(0, count) },
        mainDeck: {
          ...player.mainDeck,
          cardIds: [
            ...all.slice(count),
            ...Array.from({ length: 8 }, (_, i) => `p1-draw${i}`),
            'p1-deck',
          ],
        },
      }));
      if (mainPhase) state = { ...state, currentPhase: 'MAIN_PHASE', currentSubPhase: 'NONE' };
      store.gameSession.authorityState = state;
      store.syncState();
    },
    { repoRoot: root, count, mainPhase }
  );
}

const handViewport = (page: Page) => anchor(page, 'self-hand').locator('[data-hand-viewport]');

async function browseHand(page: Page, end: boolean) {
  if (
    await handViewport(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
  )
    return;
  await handViewport(page).evaluate((element, end) => {
    element.scrollLeft = end ? element.scrollWidth : 0;
  }, end);
  await expect(
    page.getByRole('button', { name: end ? '向后浏览手牌' : '向前浏览手牌' })
  ).toBeDisabled();
}

for (const count of [5, 30]) {
  for (const width of [1366, 1024, 768, 1600]) {
    test(`desktop: phase changes keep the hand stable at ${width}px with ${count} cards`, async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'tablet-1024x768');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: width === 1600 ? 900 : 768 });
      await openPopulatedBoard(page, true, 2, 30);
      await arrangeHandCount(page, count, true);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(250);
      await browseHand(page, true);
      const geometry = () =>
        handViewport(page).evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const first = element.querySelector('[data-hand-card-slot]')!.getBoundingClientRect();
          return { x: rect.x, width: rect.width, cardX: first.x, scroll: element.scrollLeft };
        });
      const before = await geometry();
      const live = (await anchor(page, 'self-live-zone').boundingBox())!;
      expect(before.x + before.width / 2, 'hand and LIVE share a center line').toBeCloseTo(
        live.x + live.width / 2,
        0
      );
      const result = await page.evaluate(async (repoRoot) => {
        const path = performance
          .getEntriesByType('resource')
          .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
        const [{ useGameStore }, { createEndPhaseCommand }] = await Promise.all([
          import(path),
          import(`/@fs${repoRoot}src/application/game-commands.ts`),
        ]);
        const store = useGameStore.getState();
        const before = store.gameSession.state.players[0].hand.cardIds;
        const result = store.gameSession.executeCommand(createEndPhaseCommand('p1'));
        store.syncState();
        return { ...result, before, after: store.gameSession.state.players[0].hand.cardIds };
      }, root);
      expect(result.success, result.error).toBe(true);
      expect(result.after).toEqual(result.before);
      await page.waitForTimeout(250);
      const after = await geometry();
      await page.screenshot({
        path: `${root}output/playwright/phase-hand-stability/${width}-${count}.png`,
      });
      expect(after.x, `${width}px / ${count} hand cards: viewport x`).toBeCloseTo(before.x, 0);
      expect(after.width, `${width}px / ${count} hand cards: viewport width`).toBeCloseTo(
        before.width,
        0
      );
      expect(after.cardX, `${width}px / ${count} hand cards: first card x`).toBeCloseTo(
        before.cardX,
        0
      );
      expect(after.scroll, `${width}px / ${count} hand cards: browsing position`).toBeCloseTo(
        before.scroll,
        0
      );
    });
  }
}

for (const count of [5, 12, 30]) {
  test(`hand: draw launches smoothly and lands on the settled hand with ${count} cards`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'tablet-1024x768');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1366, height: 768 });
    await openPopulatedBoard(page, true, 2, 30);
    await arrangeHandCount(page, count, true);
    await page.getByRole('button', { name: /^(规则|规则模式)$/ }).click();
    await browseHand(page, true);
    const id = await page.evaluate(async () => {
      const path = performance
        .getEntriesByType('resource')
        .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
      const { useGameStore } = await import(path);
      const id = useGameStore.getState().gameSession.state.players[0].mainDeck.cardIds[0];
      const { measureRecoveryHandPose } = await import('/src/lib/recoveryCardMotion.ts');
      const capture = {
        frames: [] as { t: number; x: number; y: number }[],
        done: false,
        eventTarget: null as any,
        target: null as any,
      };
      Object.assign(window, { drawMotionCapture: capture });
      const start = performance.now();
      const sample = () => {
        const moving = document.querySelector<HTMLElement>(`[data-battle-card-move="obj_${id}"]`);
        if (moving) {
          const box = moving.getBoundingClientRect();
          capture.frames.push({
            t: performance.now(),
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
          });
          capture.target = measureRecoveryHandPose(`obj_${id}`);
          capture.eventTarget = JSON.parse(moving.dataset.battleCardMoveTarget!);
        } else if (capture.frames.length || performance.now() - start > 4000) {
          capture.done = true;
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      return id;
    });
    await page.getByRole('button', { name: '从主卡组抽一张牌', exact: true }).click();
    await page.waitForFunction(() => (window as any).drawMotionCapture.done);
    const { frames, target, eventTarget } = await page.evaluate(
      () =>
        (window as any).drawMotionCapture as {
          frames: { t: number; x: number; y: number }[];
          target: { left: number; top: number; width: number; height: number };
          eventTarget: unknown;
        }
    );
    expect(frames.length).toBeGreaterThan(5);
    const first = frames[0];
    const last = frames.at(-1)!;
    const early = frames.find((frame) => frame.t - first.t >= 60)!;
    const distance = (a: typeof first, b: typeof first) => Math.hypot(a.x - b.x, a.y - b.y);
    expect(
      distance(first, early) / distance(first, last),
      'launch must accelerate instead of jumping through most of the path'
    ).toBeLessThan(0.3);
    expect(last.x, JSON.stringify({ target, eventTarget, last })).toBeCloseTo(
      target.left + target.width / 2,
      0
    );
    expect(last.y).toBeCloseTo(target.top + target.height / 2, 0);
    await expect(anchor(page, 'self-hand').locator(`[data-card-id="${id}"]`)).toBeVisible();
    await expect(anchor(page, 'self-hand').locator('[data-card-id]')).toHaveCount(count + 1);
  });
}

test('hand: small fans fit their viewport and 12↔13 cards reflow without a scroll jump', async ({
  page,
}, info) => {
  test.skip(!['mobile-390x844', 'tablet-1024x768'].includes(info.project.name));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const mobile = info.project.name === 'mobile-390x844';
  await page.setViewportSize({ width: mobile ? 320 : 1024, height: mobile ? 568 : 768 });
  await openPopulatedBoard(page, true, 2, 30);
  for (const [width, height, count] of mobile
    ? [1, 2, 5, 12].map((count) => [320, 568, count])
    : [1024, 1600, 768].flatMap((width) =>
        [1, 2, 5, 12].map((count) => [width, width === 1600 ? 900 : 768, count])
      )) {
    await page.setViewportSize({ width, height });
    await arrangeHandCount(page, count, true);
    await expect(async () => {
      const geometry = await handViewport(page).evaluate((viewport) => {
        const bounds = viewport.getBoundingClientRect();
        const cards = Array.from(viewport.querySelectorAll<HTMLElement>('[data-hand-card-slot]'));
        return {
          viewport: {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
          },
          scrollable: viewport.scrollWidth > viewport.clientWidth,
          cards: cards.map((card) => {
            const rect = card.getBoundingClientRect();
            const matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform);
            return {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              rotation: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
            };
          }),
        };
      });
      expect(geometry.scrollable).toBe(false);
      for (const card of geometry.cards) {
        expect(Math.abs(card.rotation)).toBeLessThanOrEqual(10.01);
        expect(card.left).toBeGreaterThanOrEqual(geometry.viewport.left);
        expect(card.right).toBeLessThanOrEqual(geometry.viewport.right);
        expect(card.top).toBeGreaterThanOrEqual(geometry.viewport.top);
        expect(card.bottom).toBeLessThanOrEqual(geometry.viewport.bottom);
        expect((card.top + card.bottom) / 2).toBeCloseTo(
          (geometry.cards[0].top + geometry.cards[0].bottom) / 2,
          1
        );
      }
      expect(geometry.cards[0].rotation).toBeCloseTo(-Math.min(10, (count - 1) * 2), 1);
      expect(geometry.cards.at(-1)!.rotation).toBeCloseTo(Math.min(10, (count - 1) * 2), 1);
    }).toPass();
  }
  await page.screenshot({
    path: `${root}output/playwright/hand-fan-${mobile ? 'mobile' : 'desktop'}.png`,
  });
  await page.setViewportSize({ width: mobile ? 320 : 1024, height: mobile ? 568 : 768 });
  await page.getByRole('button', { name: /^(规则|规则模式)$/ }).click();
  const capture = async (action: () => Promise<unknown>) => {
    await page.evaluate(() => {
      const frames: { t: number; x: number; rotation: number }[] = [];
      Object.assign(window, { handReflowCapture: { frames, done: false } });
      const start = performance.now();
      const sample = () => {
        const slot = document.querySelector<HTMLElement>(
          '[data-battle-ui-anchor="self-hand"] [data-hand-card-slot]'
        )!;
        const box = slot.getBoundingClientRect();
        const matrix = new DOMMatrixReadOnly(getComputedStyle(slot).transform);
        frames.push({
          // WAAPI poses use the document timeline; a busy main thread can run a
          // callback late without advancing the pose until the next animation tick.
          t: Number(document.timeline.currentTime),
          x: box.x + box.width / 2,
          rotation: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
        });
        if (performance.now() - start > 550) (window as any).handReflowCapture.done = true;
        else requestAnimationFrame(sample);
      };
      sample();
    });
    await action();
    await page.waitForFunction(() => (window as any).handReflowCapture.done);
    return page.evaluate(
      () => (window as any).handReflowCapture.frames as { t: number; x: number; rotation: number }[]
    );
  };
  const draw = () => page.getByRole('button', { name: '从主卡组抽一张牌', exact: true }).click();
  const drawn = await page.evaluate(async () => {
    const path = performance
      .getEntriesByType('resource')
      .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(path);
    return useGameStore.getState().gameSession.state.players[0].mainDeck.cardIds[0];
  });
  const opened = await capture(draw);
  await expect(anchor(page, 'self-hand').locator('[data-hand-layout]')).toHaveAttribute(
    'data-hand-layout',
    'row'
  );
  expect(
    await handViewport(page).evaluate((viewport) =>
      Array.from(viewport.querySelectorAll<HTMLElement>('[data-hand-card-slot]')).map((slot) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(slot).transform);
        return (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
      })
    )
  ).toEqual(Array(13).fill(0));
  const closed = await capture(async () => {
    const result = await page.evaluate(async (id) => {
      const path = performance
        .getEntriesByType('resource')
        .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
      const { useGameStore } = await import(path);
      return useGameStore.getState().moveOwnedCardToZone(id, 'HAND', 'MAIN_DECK');
    }, drawn);
    expect(result.success).toBe(true);
  });
  await expect(anchor(page, 'self-hand').locator('[data-hand-layout]')).toHaveAttribute(
    'data-hand-layout',
    'fan'
  );
  for (const frames of [opened, closed]) {
    const start = frames[0],
      end = frames.at(-1)!;
    expect(Math.abs(end.rotation - start.rotation)).toBeGreaterThan(9);
    expect(frames.some((frame) => frame.rotation > -9 && frame.rotation < -1)).toBe(true);
    for (let i = 1; i < frames.length; i++) {
      const progress = (frames[i].rotation - start.rotation) / (end.rotation - start.rotation);
      // Translation and rotation share one interpolation. A scroll snap would
      // move the card center without the corresponding change in angle.
      expect(frames[i].x).toBeCloseTo(start.x + (end.x - start.x) * progress, 0);
      if (frames[i].t - frames[i - 1].t < 35) {
        const maxProgress = ((frames[i].t - frames[i - 1].t) * 3) / 200 + 0.05;
        expect(Math.abs(frames[i].rotation - frames[i - 1].rotation) / 10).toBeLessThan(
          maxProgress
        );
      }
    }
  }
  await expect(anchor(page, 'self-hand').locator('[data-card-id]')).toHaveCount(12);
  await page.screenshot({
    path: `${root}output/playwright/hand-fan-${mobile ? 'mobile' : 'desktop'}.png`,
  });
});

test('hand: height-only resizing keeps the selected card fully visible', async ({ page }, info) => {
  test.skip(!['mobile-390x844', 'tablet-1024x768'].includes(info.project.name));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const mobile = info.project.name === 'mobile-390x844';
  const width = mobile ? 320 : 1366;
  const heights = mobile ? [568, 700, 568] : [768, 900, 768];
  await page.setViewportSize({ width, height: heights[0] });
  await openPopulatedBoard(page, true, 2, 30);
  await browseHand(page, true);
  const card = anchor(page, 'self-hand').locator('[data-card-id="p1-extra24"]');
  await card.click();
  await expect(card).toHaveClass(/ring-yellow-400/);
  await page.mouse.move(0, 0);
  for (const height of heights) {
    await page.setViewportSize({ width, height });
    await expect(async () => {
      const viewport = (await handViewport(page).boundingBox())!;
      const selected = (await card.boundingBox())!;
      expect(selected.x).toBeGreaterThanOrEqual(viewport.x + 15);
      expect(selected.x + selected.width).toBeLessThanOrEqual(viewport.x + viewport.width - 15);
      await expect(card).toHaveClass(/ring-yellow-400/);
    }).toPass({ timeout: 5000 });
  }
});

test('hand: enhanced recovery lands inside the visible window without interrupting browsing', async ({
  page,
}, info) => {
  test.skip(!['mobile-390x844', 'tablet-1024x768'].includes(info.project.name));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const mobile = info.project.name === 'mobile-390x844';
  const width = mobile ? 320 : 1366;
  await page.setViewportSize({ width, height: mobile ? 568 : 768 });
  await openPopulatedBoard(page, true, 2, 30, true);
  await page.getByRole('button', { name: /^(规则|规则模式)$/ }).click();
  const card = anchor(page, 'self-hand').locator('[data-card-id="p1-extra24"]');
  const move = async (from: string, to: string) => {
    const result = await page.evaluate(
      async ({ from, to }) => {
        const storePath = performance
          .getEntriesByType('resource')
          .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
        const { useGameStore } = await import(storePath);
        return useGameStore.getState().moveOwnedCardToZone('p1-extra24', from, to);
      },
      { from, to }
    );
    expect(result.success).toBe(true);
  };

  for (const followEnd of [false, true]) {
    await move('HAND', 'WAITING_ROOM');
    await expect(card).toHaveCount(0);
    await expect(page.locator('[data-battle-card-move], [data-discard-presentation]')).toHaveCount(
      0
    );
    await browseHand(page, followEnd);
    const before = await handViewport(page).evaluate((element) => element.scrollLeft);
    await page.evaluate(() => {
      const state = window as any;
      state.handRecoveryFrames = [];
      state.handRecoveryFinished = false;
      let started = false;
      const record = () => {
        const flying = document.querySelector('[data-effect-recovery-card]');
        if (flying) {
          started = true;
          const rect = flying.getBoundingClientRect();
          state.handRecoveryFrames.push({ left: rect.left, right: rect.right });
        } else if (started) {
          state.handRecoveryFinished = true;
          return;
        }
        requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
    });
    await move('WAITING_ROOM', 'HAND');
    await expect(page.locator('[data-effect-recovery-card]')).toHaveCount(1);
    await expect(card).toHaveCSS('visibility', 'hidden');
    await page.waitForFunction(() => (window as any).handRecoveryFinished);
    const frames = await page.evaluate(
      () => (window as any).handRecoveryFrames as { left: number; right: number }[]
    );
    expect(frames.length).toBeGreaterThan(2);
    for (const frame of frames) {
      expect(frame.left).toBeGreaterThanOrEqual(-1);
      expect(frame.right).toBeLessThanOrEqual(width + 1);
    }
    const viewport = (await handViewport(page).boundingBox())!;
    const end = frames.at(-1)!;
    expect(end.left).toBeGreaterThanOrEqual(viewport.x - 1);
    expect(end.right).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
    const landing = await page.evaluate(async () => {
      const { measureRecoveryHandPose } = await import('/src/lib/recoveryCardMotion.ts');
      return measureRecoveryHandPose('obj_p1-extra24');
    });
    expect(landing).not.toBeNull();
    const fade = Number(await handViewport(page).getAttribute('data-hand-fade-end'));
    if (followEnd) {
      const target = (await card.boundingBox())!;
      expect(landing!.left).toBeCloseTo(target.x, 0);
      expect(landing!.left + landing!.width).toBeCloseTo(target.x + target.width, 0);
      await expect(page.getByRole('button', { name: '向后浏览手牌' })).toBeDisabled();
    } else {
      expect(landing!.left + landing!.width).toBeCloseTo(viewport.x + viewport.width - fade, 0);
      expect(await handViewport(page).evaluate((element) => element.scrollLeft)).toBe(before);
      await expect(page.locator('[data-hand-new-cards]')).toHaveText('+1');
      await page.getByRole('button', { name: '查看 1 张新手牌' }).click();
      await expect(page.locator('[data-hand-new-cards]')).toHaveCount(0);
    }
    await expect(card).toHaveCSS('visibility', 'visible');
    expect(await card.getAttribute('data-object-id')).toBe('obj_p1-extra24');
  }
});

test('phone: fan and scrollable hand remain usable at 9, 12, 13, 20 and 30 cards', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile-390x844');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPopulatedBoard(page, true, 2, 30);
  for (const [width, height, fontSize] of [
    [320, 568, 16],
    [390, 844, 16],
    [320, 568, 20],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      (size) => (document.documentElement.style.fontSize = `${size}px`),
      fontSize
    );
    let previousCardWidth = 0;
    for (const count of [9, 12, 13, 20, 30, 13, 12, 9]) {
      await arrangeHandCount(page, count);
      await expect(anchor(page, 'self-hand').locator('[data-card-id]')).toHaveCount(count);
      await expect(anchor(page, 'self-hand').locator('[data-hand-layout]')).toHaveAttribute(
        'data-hand-layout',
        count <= 12 ? 'fan' : 'row'
      );
      await expect(async () => {
        const viewport = (await handViewport(page).boundingBox())!;
        const support = (await page.locator('[data-mobile-battle-support-row]').boundingBox())!;
        const tabletop = (await page.locator('[data-mobile-tabletop]').boundingBox())!;
        expect(support.y).toBeGreaterThanOrEqual(tabletop.y);
        expect(support.y + support.height).toBeLessThanOrEqual(tabletop.y + tabletop.height + 1);
        expect(support.y + support.height).toBeLessThanOrEqual(viewport.y);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width
        );
        const cards = anchor(page, 'self-hand').locator('[data-card-surface]');
        const cardWidth = await cards
          .first()
          .evaluate((element) => (element as HTMLElement).offsetWidth);
        if (previousCardWidth) expect(cardWidth).toBe(previousCardWidth);
        previousCardWidth = cardWidth;
      }).toPass();
      await browseHand(page, false);
      await expect(anchor(page, 'self-hand').getByRole('slider')).toHaveCount(0);
      await expect(handViewport(page)).toHaveAttribute('data-hand-fade-start', '0');
      if (count === 30 && width === 320 && fontSize === 16) {
        const viewport = handViewport(page);
        const box = (await viewport.boundingBox())!;
        const previous = (await page.getByRole('button', { name: '向前浏览手牌' }).boundingBox())!;
        const next = (await page
          .getByRole('button', { name: /向后浏览手牌|查看 .* 张新手牌/ })
          .boundingBox())!;
        expect(previous.x + previous.width).toBeLessThanOrEqual(box.x);
        expect(next.x).toBeGreaterThanOrEqual(box.x + box.width);
        // Tap the visible strip of a partly cropped card. Selection must bring
        // its entire face and ring into the opaque part of the hand.
        await viewport.evaluate((element) => {
          const slot = element.querySelectorAll<HTMLElement>('[data-hand-card-slot]')[3];
          element.scrollLeft +=
            slot.getBoundingClientRect().left - element.getBoundingClientRect().left + 12;
        });
        const partial = anchor(page, 'self-hand').locator('[data-card-id="p1-hand4"]');
        const card = (await partial.boundingBox())!;
        await page.touchscreen.tap(box.x + 15, card.y + card.height / 2);
        await expect(partial).toHaveClass(/ring-yellow-400/);
        await expect(async () => {
          const selected = (await partial.boundingBox())!;
          expect(selected.x).toBeGreaterThanOrEqual(box.x + 16 - 0.5);
          expect(selected.x + selected.width).toBeLessThanOrEqual(box.x + box.width - 16 + 0.5);
        }).toPass();
        await page.getByRole('button', { name: '取消手牌选择' }).click();
      }
      await browseHand(page, true);
      await expect(handViewport(page)).toHaveAttribute('data-hand-fade-end', '0');
      const last = anchor(page, 'self-hand').locator('[data-card-id]').last();
      await last.tap();
      await expect(last).toHaveClass(/ring-yellow-400/);
      await page.getByRole('button', { name: '取消手牌选择' }).click();
      if ([12, 13, 30].includes(count))
        await page.screenshot({
          path: `${root}output/playwright/continuous-hand-${width}x${height}-font${fontSize}-${count}.png`,
        });
      await browseHand(page, false);
    }
  }
});

test('phone: large hand draw, LIVE, discard and entry retain command outcomes and motion sources', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile-390x844');
  await page.setViewportSize({ width: 320, height: 568 });
  await openPopulatedBoard(page, true, 2, 30);
  await arrangeHandCount(page, 13);
  await page.getByRole('button', { name: '规则', exact: true }).click();
  await page.evaluate(() => {
    (window as any).handMoves = [];
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const selector = '[data-battle-card-move], [data-discard-presentation-object-id]';
          const moves = [
            ...(node.matches(selector) ? [node] : []),
            ...node.querySelectorAll(selector),
          ];
          for (const move of moves)
            (window as any).handMoves.push({
              id:
                move.getAttribute('data-battle-card-move') ??
                move.getAttribute('data-discard-presentation-object-id'),
              left: parseFloat((move as HTMLElement).style.left),
              top: parseFloat((move as HTMLElement).style.top),
            });
        }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await browseHand(page, false);
  const oldScroll = await handViewport(page).evaluate((element) => element.scrollLeft);
  await page.getByRole('button', { name: '从主卡组抽一张牌', exact: true }).click();
  await page.getByRole('button', { name: '从主卡组抽一张牌', exact: true }).click();
  await expect(anchor(page, 'self-hand').locator('[data-card-id]')).toHaveCount(15);
  expect(await handViewport(page).evaluate((element) => element.scrollLeft)).toBe(oldScroll);
  await expect(page.locator('[data-hand-new-cards]')).toHaveText('+2');
  await expect
    .poll(() => page.evaluate(() => (window as any).handMoves.length))
    .toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: `${root}output/playwright/continuous-hand-draw.png` });
  await expect(page.locator('[data-battle-card-move]')).toHaveCount(0);
  await page.getByRole('button', { name: '查看 2 张新手牌' }).click();
  await expect(page.locator('[data-hand-new-cards]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '向后浏览手牌' })).toBeDisabled();
  await browseHand(page, false);

  // Manual LIVE placement uses the existing selected-card command path.
  const live = anchor(page, 'self-hand').locator('[data-card-id="p1-incoming"]');
  await live.tap({ position: { x: 8, y: 35 } });
  await anchor(page, 'self-live-zone').locator('[data-battle-live-slot="2"]').tap();
  await expect(live).toHaveCount(0);
  await expect(
    anchor(page, 'self-live-zone').locator('[data-card-id="p1-incoming"]')
  ).toBeVisible();
  await expect(page.locator('[data-battle-card-move]')).toHaveCount(0);

  // Arrange a legal main phase, keeping the same shared board and actual commands.
  await page.evaluate(async () => {
    const storePath = performance
      .getEntriesByType('resource')
      .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(storePath);
    const store = useGameStore.getState();
    Object.assign(store.gameSession.state, { currentPhase: 'MAIN_PHASE', currentSubPhase: 'NONE' });
    store.syncState();
  });
  await browseHand(page, true);
  await page.evaluate(() => ((window as any).handMoves = []));
  const source = anchor(page, 'self-hand').locator('[data-card-id]').last();
  const cardId = (await source.getAttribute('data-card-id'))!;
  const a = (await source.boundingBox())!;
  const target = anchor(page, 'self-waiting-room');
  const b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 - 12, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  const release = (await page
    .locator('[data-battle-drag-card] [data-card-surface]')
    .boundingBox())!;
  await page.mouse.up();
  await expect(anchor(page, 'self-hand').locator(`[data-card-id="${cardId}"]`)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        (id) => (window as any).handMoves.some((move: any) => move.id === `obj_${id}`),
        cardId
      )
    )
    .toBe(true);
  const movement = await page.evaluate(
    (id) => (window as any).handMoves.find((move: any) => move.id === `obj_${id}`),
    cardId
  );
  expect(movement.left).toBeCloseTo(release.x, 0);
  expect(movement.top).toBeCloseTo(release.y, 0);
  await expect(page.locator('[data-battle-card-move], [data-discard-presentation]')).toHaveCount(0);

  await browseHand(page, true);
  const member = anchor(page, 'self-hand').locator('[data-card-id]').last();
  const memberId = (await member.getAttribute('data-card-id'))!;
  await member.tap();
  await anchor(page, 'self-stage-left').tap();
  await expect(
    anchor(page, 'self-stage-left').locator(`[data-card-id="${memberId}"]`)
  ).toBeVisible();
  await expect(anchor(page, 'self-hand').locator(`[data-card-id="${memberId}"]`)).toHaveCount(0);
  await expect(page.locator('[data-battle-card-move]')).toHaveCount(0);
  await page.screenshot({ path: `${root}output/playwright/continuous-hand-after-actions.png` });
  // At the end, incoming cards follow the hand; automatic removal of an offscreen
  // card uses the visible edge, not a stale source from an earlier scroll position.
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '从主卡组抽一张牌' }).click();
  await expect(anchor(page, 'self-hand').locator('[data-card-id]')).toHaveCount(15);
  await expect(page.getByRole('button', { name: '向后浏览手牌' })).toBeDisabled();
  await expect(page.locator('[data-hand-new-cards]')).toHaveCount(0);
  await expect(page.locator('[data-battle-card-move]')).toHaveCount(0);
  const edge = (await handViewport(page).boundingBox())!;
  await page.evaluate(async () => {
    (window as any).handMoves = [];
    const storePath = performance
      .getEntriesByType('resource')
      .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(storePath);
    const result = useGameStore.getState().moveOwnedCardToZone('p1-hand1', 'HAND', 'WAITING_ROOM');
    if (!result.success) throw new Error(JSON.stringify(result));
  });
  await expect(anchor(page, 'self-hand').locator('[data-card-id="p1-hand1"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).handMoves.length)).toBeGreaterThan(0);
  const automatic = await page.evaluate(() =>
    (window as any).handMoves.find((move: any) => move.id === 'obj_p1-hand1')
  );
  const fade = Number(await handViewport(page).getAttribute('data-hand-fade-start'));
  expect(automatic.left).toBeCloseTo(edge.x + fade, 0);
  await expect(page.locator('[data-battle-card-move], [data-discard-presentation]')).toHaveCount(0);
});

test('phone: touching a large hand pans horizontally and lifts a card vertically', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'mobile-390x844');
  await page.setViewportSize({ width: 320, height: 568 });
  await openPopulatedBoard(page, true, 2, 30);
  await arrangeHandCount(page, 20, true);
  await page.getByRole('button', { name: '规则', exact: true }).click();
  await browseHand(page, false);
  const client = await context.newCDPSession(page);
  const viewport = (await handViewport(page).boundingBox())!;
  const y = viewport.y + viewport.height / 2;
  const touch = (type: string, x: number, y: number) =>
    client.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }],
    });
  await touch('touchStart', 230, y);
  for (let x = 220; x >= 80; x -= 20) await touch('touchMove', x, y);
  await touch('touchEnd', 80, y);
  await expect
    .poll(() => handViewport(page).evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(50);
  await expect(page.locator('[data-battle-drag-card]')).toHaveCount(0);
  await expect(anchor(page, 'self-hand').locator('[data-card-id]')).toHaveCount(20);
  await browseHand(page, true);
  const card = anchor(page, 'self-hand').locator('[data-card-id]').last();
  const id = (await card.getAttribute('data-card-id'))!;
  const source = (await card.boundingBox())!;
  const target = (await anchor(page, 'self-waiting-room').boundingBox())!;
  const x = source.x + source.width / 2;
  const startY = source.y + source.height / 2;
  await touch('touchStart', x, startY);
  await touch('touchMove', x, startY - 10);
  await touch('touchMove', x, startY - 20);
  await expect(page.locator('[data-battle-drag-card]')).toBeVisible();
  for (let step = 1; step <= 10; step++) {
    await touch(
      'touchMove',
      x + ((target.x + target.width / 2 - x) * step) / 10,
      startY - 20 + ((target.y + target.height / 2 - startY + 20) * step) / 10
    );
  }
  await expect(anchor(page, 'self-waiting-room')).toHaveClass(/ring-slate-500/);
  await touch('touchEnd', target.x + target.width / 2, target.y + target.height / 2);
  await expect(anchor(page, 'self-hand').locator(`[data-card-id="${id}"]`)).toHaveCount(0);
  await expect(anchor(page, 'self-hand').locator('[data-card-id]')).toHaveCount(19);
  await expect(page.locator('[data-battle-card-move], [data-discard-presentation]')).toHaveCount(0);
  await browseHand(page, true);
  const remaining = (await anchor(page, 'self-hand')
    .locator('[data-card-id]')
    .last()
    .boundingBox())!;
  const nextX = remaining.x + remaining.width / 2;
  const nextY = remaining.y + remaining.height / 2;
  await touch('touchStart', nextX, nextY);
  await touch('touchMove', nextX, nextY - 12);
  await touch('touchMove', nextX, nextY - 24);
  await expect(page.locator('[data-battle-drag-card]')).toBeVisible();
  await touch('touchCancel', nextX, nextY - 24);
  await expect(page.locator('[data-battle-drag-card]')).toHaveCount(0);
  await expect(anchor(page, 'self-hand').locator('[data-card-id]')).toHaveCount(19);
  await touch('touchStart', nextX, nextY);
  await page.waitForTimeout(450);
  await expect(page.getByRole('dialog', { name: /卡牌详情/ })).toBeVisible();
  await touch('touchEnd', nextX, nextY);
  await page.getByRole('button', { name: '关闭卡牌详情' }).click();
  await expect(page.locator('[data-battle-drag-card]')).toHaveCount(0);
  await client.detach();
});

test('phone: incoming card lands on the visible hand slot after following the end', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile-390x844');
  await page.setViewportSize({ width: 320, height: 568 });
  await openPopulatedBoard(page, true, 2, 20);
  await page.getByRole('button', { name: '规则', exact: true }).click();
  await browseHand(page, true);
  await page.getByRole('button', { name: '从主卡组抽一张牌' }).click();
  const moving = page.locator('[data-battle-card-move="obj_p1-draw0"]');
  const landing = JSON.parse((await moving.getAttribute('data-battle-card-move-target'))!);
  const target = anchor(page, 'self-hand').locator('[data-card-id="p1-draw0"]');
  const box = (await target.boundingBox())!;
  expect(landing.left + landing.width / 2).toBeCloseTo(box.x + box.width / 2, 0);
  expect(landing.top + landing.height / 2).toBeCloseTo(box.y + box.height / 2, 0);
  expect(landing.width).toBe(
    await target.evaluate((element) => (element as HTMLElement).offsetWidth)
  );
  expect(landing.height).toBeCloseTo(
    await target.evaluate((element) => (element as HTMLElement).offsetHeight),
    0
  );
  await expect(page.locator('[data-battle-card-move]')).toHaveCount(0);
  await expect(anchor(page, 'self-hand').locator('[data-card-id="p1-draw0"]')).toBeVisible();
});

test('desktop: large hand edges, wheel browsing and card commands share the hand layout', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'tablet-1024x768');
  await page.setViewportSize({ width: 1600, height: 900 });
  await openPopulatedBoard(page, true, 2, 30);
  const viewport = handViewport(page);
  for (const [width, height] of [
    [1600, 900],
    [1366, 768],
    [1024, 768],
    [768, 1024],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(async () => {
      const view = (await viewport.boundingBox())!;
      const energy = (await anchor(page, 'self-energy-zone').boundingBox())!;
      const phase = (await anchor(page, 'phase-controls').boundingBox())!;
      expect(view.width).toBeGreaterThanOrEqual(100);
      expect(view.x).toBeGreaterThanOrEqual(energy.x + energy.width);
      expect(view.x + view.width <= phase.x || view.y + view.height <= phase.y).toBe(true);
      expect(view.x).toBeGreaterThanOrEqual(0);
      expect(view.x + view.width).toBeLessThanOrEqual(width);
    }).toPass({ timeout: 5000 });
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await browseHand(page, false);
  const first = anchor(page, 'self-hand').locator('[data-card-id="p1-hand1"]');
  await first.hover({ position: { x: 8, y: 35 } });
  await expect(page.getByLabel('成员 卡牌详情', { exact: true })).toBeVisible();
  await page.mouse.wheel(0, 160);
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
  await expect(page.locator('[data-battle-drag-card]')).toHaveCount(0);
  const beforeZoom = await viewport.evaluate((element) => element.scrollLeft);
  expect(
    await viewport.evaluate((element) =>
      element.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: 160,
          ctrlKey: true,
          cancelable: true,
          bubbles: true,
        })
      )
    )
  ).toBe(true);
  expect(await viewport.evaluate((element) => element.scrollLeft)).toBe(beforeZoom);
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: '向后浏览手牌' }).click();
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(160);
  await browseHand(page, false);
  await page.getByRole('button', { name: '规则模式', exact: true }).click();
  await page.getByRole('button', { name: '从主卡组抽一张牌' }).click();
  await expect(anchor(page, 'self-hand').locator('[data-card-id]')).toHaveCount(31);
  await expect(viewport).toHaveJSProperty('scrollLeft', 0);
  await page.getByRole('button', { name: '查看 1 张新手牌' }).click();
  await expect(page.locator('[data-hand-new-cards]')).toHaveCount(0);
  await expect(page.locator('[data-battle-card-move]')).toHaveCount(0);
  await browseHand(page, false);
  await anchor(page, 'self-hand')
    .locator('[data-card-id="p1-incoming"]')
    .click({ position: { x: 8, y: 35 } });
  await anchor(page, 'self-live-zone').locator('[data-battle-live-slot="2"]').click();
  await expect(
    anchor(page, 'self-live-zone').locator('[data-card-id="p1-incoming"]')
  ).toBeVisible();
  await expect(page.locator('[data-battle-card-move]')).toHaveCount(0);
  await page.evaluate(async () => {
    const storePath = performance
      .getEntriesByType('resource')
      .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(storePath);
    const store = useGameStore.getState();
    Object.assign(store.gameSession.state, { currentPhase: 'MAIN_PHASE', currentSubPhase: 'NONE' });
    store.syncState();
  });
  await browseHand(page, true);
  const source = anchor(page, 'self-hand').locator('[data-card-id="p1-draw0"]');
  const a = (await source.boundingBox())!;
  const target = anchor(page, 'self-waiting-room');
  const b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 - 12, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await expect(target).toHaveClass(/ring-slate-500/);
  await page.mouse.up();
  await expect(source).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const storePath = performance
          .getEntriesByType('resource')
          .find((entry) => entry.name.includes('/src/store/gameStore.ts'))!.name;
        const { useGameStore } = await import(storePath);
        return useGameStore.getState().playerViewState.table.zones.FIRST_WAITING_ROOM.objectIds;
      })
    )
    .toContain('obj_p1-draw0');
  await expect(page.locator('[data-battle-card-move], [data-discard-presentation]')).toHaveCount(0);
  await browseHand(page, true);
  const member = anchor(page, 'self-hand').locator('[data-card-id]').last();
  const memberId = (await member.getAttribute('data-card-id'))!;
  await member.click({ position: { x: 8, y: 35 } });
  await anchor(page, 'self-stage-left').click();
  await expect(
    anchor(page, 'self-stage-left').locator(`[data-card-id="${memberId}"]`)
  ).toBeVisible();
  await expect(page.locator('[data-battle-card-move]')).toHaveCount(0);
});
