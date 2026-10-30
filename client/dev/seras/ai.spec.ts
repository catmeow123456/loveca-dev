import { expect, test, type Page } from '@playwright/test';

async function storeState(page: Page) {
  return page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    const s = useGameStore.getState();
    return {
      view: s.playerViewState,
      effect: s.gameSession.state.activeEffect,
      hand: s.gameSession.state.players[0].hand.cardIds,
      energy: s.gameSession.state.players[0].energyZone.cardIds,
      below: s.gameSession.state.players[0].memberSlots.energyBelow.CENTER,
      actions: s.gameSession.state.actionHistory,
      occlusions: s.ui.battleAnimationOcclusions,
    };
  });
}
async function dragAi(page: Page) {
  const card = page.locator('[data-recovery-hand-card="obj_ai"] [data-object-id="obj_ai"]');
  const destination = page.locator('[data-battle-ui-anchor="self-stage-center"]');
  await expect(card).toBeVisible();
  const a = await card.boundingBox(),
    b = await destination.boundingBox();
  if (!a || !b) throw new Error('Missing drag anchors');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function chooseRecovery(page: Page) {
  await page.locator('.battle-card-slot [data-object-id="obj_ai"]').click();
  await page
    .locator('[data-battle-ui-anchor="activated-ability-menu"] button')
    .filter({ hasText: '起动' })
    .last()
    .click();
  const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
  await panel.getByRole('button', { name: /休息 2 近江彼方/ }).click();
  await page.mouse.move(20, 50);
  await expect
    .poll(async () => (await storeState(page)).effect?.stepId)
    .toBe('COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION');
}
test('real drag shares only to actual recipients, with standard red icons and no action barrier', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?ai');
  await dragAi(page);
  await expect(page.locator('[data-ai-share]')).toHaveCount(4);
  expect(
    await page
      .locator('[data-ai-share]')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-ai-share')).sort())
  ).toEqual(['obj_ai', 'obj_enemy-other', 'obj_enemy-rina', 'obj_own-kanata']);
  const state = await storeState(page);
  expect(state.effect).toBeNull();
  expect(state.hand).not.toContain('ai');
  expect(
    await page.locator('.ai-effects-layer').evaluate((e) => getComputedStyle(e).pointerEvents)
  ).toBe('none');
  await page.mouse.move(20, 50);
  await page.waitForTimeout(80);
  await page.screenshot({ path: 'output/playwright/ai-share-desktop.png' });
  await expect(page.locator('[data-ai-share]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('paid public recovery invites exactly one card directly into the real hand', async ({
  page,
}) => {
  await page.goto('/?ai&ready');
  await chooseRecovery(page);
  const flight = page.locator('[data-ai-invitation="obj_waiting-kanata"]');
  await expect(flight.locator('[data-effect-recovery-card]')).toBeVisible();
  expect(await page.locator('[data-effect-recovery]').count()).toBe(1);
  await page.screenshot({ path: 'output/playwright/ai-invitation-desktop.png' });
  const state = await storeState(page);
  expect(state.hand).toEqual(['hand-rina', 'waiting-kanata']);
  expect(state.energy).toHaveLength(17);
  expect(state.below).toHaveLength(1);
  expect(state.actions.filter((a: any) => a.type === 'PAY_COST')).toHaveLength(1);
  await expect(flight).toHaveCount(0);
  await expect(page.locator('[data-recovery-hand-card="obj_waiting-kanata"]')).toBeVisible();
  await expect.poll(async () => (await storeState(page)).occlusions.length).toBe(0);
});
test('opponent observes a public invitation and no identifiable recovered hand object', async ({
  page,
}) => {
  await page.goto('/?ai&ready');
  await chooseRecovery(page);
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    useGameStore.setState({ gameMode: 'SOLITAIRE', viewingPlayerId: 'p2' });
    useGameStore.getState().syncState();
  });
  await expect.poll(async () => (await storeState(page)).view.match.viewerSeat).toBe('SECOND');
  // A separate player's confirmation arrives through the same session command path.
  await page.waitForTimeout(2100);
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    const store = useGameStore.getState();
    if (
      store.gameSession.state.activeEffect?.stepId === 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION'
    ) {
      const result = store.gameSession.executeCommand({
        type: 'CONFIRM_EFFECT_STEP',
        playerId: 'p1',
        timestamp: Date.now(),
      });
      if (!result.success) throw new Error(JSON.stringify(result));
      store.syncState();
    }
  });
  const flight = page.locator('[data-ai-invitation="obj_waiting-kanata"]');
  await expect(flight.locator('[data-effect-recovery-card]')).toBeVisible();
  expect((await storeState(page)).view.objects['obj_waiting-kanata']).toBeUndefined();
  await page.screenshot({ path: 'output/playwright/ai-invitation-opponent.png' });
  await expect(flight).toHaveCount(0);
  await expect(page.locator('[data-object-id="obj_waiting-kanata"]')).toHaveCount(0);
});
test('R print and reduced motion on a narrow board preserve rules without flights', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?ai&ready&rare&reduced');
  expect((await storeState(page)).view.objects.obj_ai.frontInfo.cardCode).toBe('PL!N-bp8-005-R');
  await expect(page.locator('[data-ai-share]')).toHaveCount(0);
  await chooseRecovery(page);
  await expect
    .poll(async () => (await storeState(page)).hand.includes('waiting-kanata'))
    .toBe(true);
  await expect(page.locator('[data-ai-invitation],.ai-share-flight')).toHaveCount(0);
  await page.screenshot({ path: 'output/playwright/ai-mobile-reduced.png' });
});
test('disabled effects preserve recovery and no-target still pays once', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('loveca-card-entrance-enabled', 'false'));
  await page.goto('/?ai&ready');
  await chooseRecovery(page);
  await expect
    .poll(async () => (await storeState(page)).hand.includes('waiting-kanata'))
    .toBe(true);
  await expect(page.locator('[data-ai-invitation],[data-ai-share]')).toHaveCount(0);
  await page.getByRole('button', { name: '无回收目标', exact: true }).click();
  await page.locator('.battle-card-slot [data-object-id="obj_ai"]').click();
  await page
    .locator('[data-battle-ui-anchor="activated-ability-menu"] button')
    .filter({ hasText: '起动' })
    .last()
    .click();
  await expect.poll(async () => (await storeState(page)).below.length).toBe(1);
  const state = await storeState(page);
  expect(state.effect).toBeNull();
  expect(state.hand).toEqual(['hand-rina']);
  await expect(page.locator('[data-ai-invitation]')).toHaveCount(0);
});

test('a later recipient alone receives feedback; source departure cancels it and reload never replays it', async ({
  page,
}) => {
  await page.goto('/?ai&ready');
  await expect(page.locator('[data-ai-share]')).toHaveCount(0);
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    useGameStore.getState().setFreePlayEnabled(true);
    for (const result of [
      useGameStore.getState().movePublicCardToHand('own-other', 'MEMBER_SLOT', 'RIGHT'),
      useGameStore.getState().playMemberToSlot('hand-rina', 'RIGHT'),
    ])
      if (!result.success) throw new Error(JSON.stringify(result));
  });
  await expect(page.locator('[data-ai-share]')).toHaveCount(1);
  await expect(page.locator('[data-ai-share]')).toHaveAttribute('data-ai-share', 'obj_hand-rina');
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    const result = useGameStore.getState().movePublicCardToHand('ai', 'MEMBER_SLOT', 'CENTER');
    if (!result.success) throw new Error(JSON.stringify(result));
  });
  await expect(page.locator('[data-ai-share]')).toHaveCount(0);
  expect(
    Object.values((await storeState(page)).view.objects).flatMap((o: any) => o.aiHeartLinks ?? [])
  ).toEqual([]);
  await page.reload();
  await expect(page.locator('.battle-card-slot [data-object-id="obj_ai"]')).toBeVisible();
  await expect(page.locator('[data-ai-share]')).toHaveCount(0);
});
test('normal motion stays usable on a narrow board and honours the local reduced-motion toggle', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?ai&ready');
  await chooseRecovery(page);
  const card = page.locator('[data-ai-invitation] [data-effect-recovery-card]');
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(5 / 7, 1);
  await page.screenshot({ path: 'output/playwright/ai-invitation-mobile.png' });
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: '重置 · 起动回手', exact: true }).click();
  await page.getByRole('checkbox', { name: '减少动态', exact: true }).check();
  await chooseRecovery(page);
  await expect
    .poll(async () => (await storeState(page)).hand.includes('waiting-kanata'))
    .toBe(true);
  await expect(page.locator('[data-ai-invitation]')).toHaveCount(0);
});
