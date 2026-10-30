import { expect, test, type Page } from '@playwright/test';

async function activate(page: Page, plain = false, beforeActivate?: () => Promise<void>) {
  await page.goto(plain ? '/?izumi&plain' : '/?izumi');
  await beforeActivate?.();
  await page.locator('[data-object-id="obj_hand-izumi"]').first().click();
  await page.locator('[data-battle-ui-anchor="activated-ability-menu"] button').first().click();
  const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
  await panel
    .getByRole('button', { name: /Bloom the smile/ })
    .first()
    .click();
  await panel
    .getByRole('button', { name: plain ? /桂城泉/ : /赛拉丝/ })
    .first()
    .click();
}

for (const { mobile, active } of [
  { mobile: false, active: false },
  { mobile: true, active: false },
  { mobile: false, active: true },
  { mobile: true, active: true },
]) {
  test(`${mobile ? '390px' : 'desktop'}: ${active ? 'active' : 'waiting'} replay keeps the original card dimensions`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    let original!: { width: number; height: number };
    await activate(page, false, async () => {
      if (active)
        await page.evaluate(async () => {
          const url = performance
            .getEntriesByType('resource')
            .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
          const { useGameStore } = await import(/* @vite-ignore */ url);
          const store = useGameStore.getState();
          store.setFreePlayEnabled(true);
          const result = useGameStore.getState().tapMember('seras', 'CENTER');
          if (!result.success) throw new Error(JSON.stringify(result));
          useGameStore.getState().setFreePlayEnabled(false);
        });
      const card = page.locator('.battle-card-slot [data-object-id="obj_seras"]');
      await expect(card).toBeVisible();
      original = await card.evaluate((e) => {
        const s = getComputedStyle(e);
        return { width: parseFloat(s.width), height: parseFloat(s.height) };
      });
    });
    const flying = page.locator('.izumi-replay-target');
    await expect(flying).toBeVisible();
    const dimensions = await flying.evaluate((e) => ({
      width: parseFloat(e.style.width),
      height: parseFloat(e.style.height),
    }));
    expect(dimensions.width).toBeCloseTo(original.width, 0);
    expect(dimensions.height).toBeCloseTo(original.height, 0);
    await page.screenshot({
      path: `output/playwright/izumi-size-${mobile ? 'mobile' : 'desktop'}-${active ? 'active' : 'waiting'}.png`,
    });
    await page.getByRole('button', { name: '跳过演出', exact: true }).click();
    await expect(page.locator('.seras-score')).toHaveCount(5);
  });
}

async function state(page: Page) {
  return page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    const s = useGameStore.getState(),
      game = s.gameSession.state;
    return {
      wait: s.playerViewState.match.entrance,
      stage: game.players[0].memberSlots.slots,
      hand: game.players[0].hand.cardIds,
      waiting: game.players[0].waitingRoom.cardIds,
      active: game.activeEffect?.stepId,
      occlusions: s.ui.battleAnimationOcclusions,
    };
  });
}

test('real activation, discard and selection connect moonlight to the existing Seras portrait and inspection', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await activate(page);
  const prelude = page.locator('.izumi-replay-prelude');
  await expect(prelude).toHaveAttribute('data-phase', /invite|bow/);
  await expect(page.locator('.seras-theatre')).toHaveCount(0);
  await page.waitForTimeout(270);
  await page.screenshot({ path: 'output/playwright/izumi-replay-depart.png' });
  await page.waitForTimeout(340);
  await page.screenshot({ path: 'output/playwright/izumi-replay-moon.png' });
  await expect(page.locator('.card-entrance-presentation[data-profile="seras-bp8"]')).toBeVisible();
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'output/playwright/izumi-replay-portrait.png' });
  await expect(page.locator('.seras-score')).toHaveCount(5, { timeout: 6000 });
  expect((await state(page)).waiting).toEqual(['replay-cost-0']);
  await page.getByRole('button', { name: '全部放置入休息室', exact: true }).click();
  const settled = await state(page);
  expect(settled.waiting).toHaveLength(6);
  expect(settled.stage.CENTER).toBe('seras');
  expect(settled.wait).toBeFalsy();
  await expect.poll(async () => (await state(page)).occlusions).toEqual([]);
  expect(errors).toEqual([]);
});

test('unregistered portrait target returns face-up to the same slot without a second entrance', async ({
  page,
}) => {
  await activate(page, true);
  await expect(page.locator('.izumi-replay-prelude')).toHaveAttribute('data-phase', /invite|bow/);
  await expect(page.locator('.card-entrance-presentation')).toHaveCount(0, { timeout: 4000 });
  const settled = await state(page);
  expect(settled.stage.CENTER).toBe('replay-izumi');
  expect(settled.waiting).toEqual(['replay-cost-0']);
  expect(settled.active).toBeUndefined();
  await expect.poll(async () => (await state(page)).occlusions).toEqual([]);
  await expect(page.locator('[data-object-id="obj_replay-izumi"]').first()).toBeVisible();
});

test('390px: real activation, moonlight and repeat remain usable; skip clears every occlusion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await activate(page);
  await expect(page.locator('.izumi-replay-prelude')).toHaveAttribute(
    'data-phase',
    /invite|bow|depart/
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'output/playwright/izumi-replay-mobile.png' });
  await page.getByRole('button', { name: '跳过演出', exact: true }).click();
  await expect(page.locator('.seras-score')).toHaveCount(5);
  await expect.poll(async () => (await state(page)).occlusions).toEqual([]);
  await page.getByRole('button', { name: '泉返场测试', exact: true }).click();
  await expect(page.locator('.seras-theatre')).toHaveCount(0);
  expect((await state(page)).hand).toHaveLength(3);
});

test('reduced motion and disabled effects preserve exact return and inspection', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await activate(page, true);
  await expect.poll(async () => !!(await state(page)).wait).toBe(false);
  expect((await state(page)).stage.CENTER).toBe('replay-izumi');
  await expect.poll(async () => (await state(page)).occlusions).toEqual([]);
  await page.addInitScript(() => localStorage.setItem('loveca-card-entrance-enabled', 'false'));
  await activate(page);
  await expect(page.locator('.card-entrance-presentation')).toHaveCount(0);
  await expect(
    page
      .locator('[data-battle-ui-anchor="active-effect-panel"]')
      .getByRole('button', { name: /EdelinieN/ })
  ).toBeVisible();
  await expect.poll(async () => (await state(page)).occlusions).toEqual([]);
});

test('opponent perspective sees the public prelude and portrait, then private inspection stays hidden', async ({
  page,
}) => {
  await page.goto('/?izumi&opponent');
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    const store = useGameStore.getState();
    const session = store.gameSession;
    const ability = 'PL!HS-bp8-008:activated-discard-replay-other-edelnote-member';
    const activated = session.executeCommand({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      cardId: 'hand-izumi',
      abilityId: ability,
      timestamp: Date.now(),
    });
    if (!activated.success) throw new Error(JSON.stringify(activated));
    for (const selectedCardId of ['replay-cost-0', 'seras']) {
      const result = session.executeCommand({
        type: 'CONFIRM_EFFECT_STEP',
        playerId: 'p1',
        effectId: session.state.activeEffect.id,
        selectedCardId,
        timestamp: Date.now(),
      });
      if (!result.success) throw new Error(JSON.stringify(result));
    }
    store.syncState();
  });
  await expect(page.locator('.izumi-replay-prelude')).toHaveAttribute(
    'data-phase',
    /invite|bow|depart/
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'output/playwright/izumi-replay-opponent.png' });
  await expect(page.locator('.seras-theatre')).toContainText('等待对方选曲', { timeout: 6500 });
  await expect(page.locator('.seras-score img')).toHaveCount(0);
  await expect.poll(async () => (await state(page)).occlusions).toEqual([]);
});

test('failed first-play portrait load releases the replay without a late restart', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/seras-bp8.png*', async (route) => {
    await gate;
    await route.abort().catch(() => {});
  });
  await activate(page);
  await expect(page.locator('.card-entrance-presentation')).toHaveAttribute(
    'data-phase',
    'loading'
  );
  await expect(page.locator('.seras-score')).toHaveCount(5, { timeout: 3500 });
  release();
  await page.waitForTimeout(300);
  await expect.poll(async () => (await state(page)).occlusions).toEqual([]);
  await expect(page.locator('.card-entrance-presentation')).toHaveCount(0);
});
