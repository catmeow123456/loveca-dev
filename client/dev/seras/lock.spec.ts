import { expect, test, type Page } from '@playwright/test';

async function lockState(page: Page) {
  return page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    const s = useGameStore.getState();
    return {
      own: s.playerViewState.objects['obj_own-low'],
      enemy: s.playerViewState.objects['obj_enemy-low'],
      high: s.playerViewState.objects['obj_enemy-high'],
      noActivated: s.playerViewState.objects['obj_enemy-no-activated'],
      entrance: s.playerViewState.match.entrance,
      effect: s.playerViewState.activeEffect,
    };
  });
}

test('turning Izumi active seals both low-cost members; tapping her releases the rule immediately', async ({
  page,
}) => {
  await page.goto('/?lock');
  const seals = page.locator('[data-seras-lock]');
  await expect(seals).toHaveCount(0);
  expect((await lockState(page)).own.activatedAbilityUiConfigs.length).toBeGreaterThan(0);
  // The real tabletop double-click submits TAP_MEMBER; no fixture state mutation.
  await page.locator('[data-object-id="obj_hand-izumi"]').first().dblclick();
  await expect(seals).toHaveCount(2);
  await expect(page.locator('[data-seras-lock="obj_enemy-high"]')).toHaveCount(0);
  const locked = await lockState(page);
  expect(locked.own.activatedAbilityUiConfigs).toEqual([]);
  expect(locked.enemy.activatedAbilityProhibition).toBe('SERAS_LOW_COST');
  expect(locked.high.activatedAbilityProhibition).toBeUndefined();
  expect(locked.noActivated.frontInfo.cost).toBe(4);
  expect(locked.noActivated.activatedAbilityProhibition).toBeUndefined();
  await expect(page.locator('[data-seras-lock="obj_enemy-no-activated"]')).toHaveCount(0);
  expect(locked.entrance).toBeFalsy();
  expect(locked.effect).toBeFalsy();
  // Cancel the condition during formation: no delayed animation may resurrect a seal.
  await page.getByRole('button', { name: '泉横置／转正', exact: true }).click();
  await expect(seals).toHaveCount(0);
  await page.waitForTimeout(850);
  await expect(seals).toHaveCount(0);
  expect((await lockState(page)).own.activatedAbilityUiConfigs.length).toBeGreaterThan(0);
});

test('initial active lock and perspective switches join the resting seal without replay', async ({
  page,
}) => {
  await page.goto('/?lock&active');
  await expect(page.locator('[data-seras-lock]')).toHaveCount(2);
  await expect(page.locator('.seras-seal-formation')).toHaveCount(0);
  await page.getByRole('button', { name: /切换至 对手/ }).click();
  await expect(page.locator('[data-seras-lock]')).toHaveCount(2);
  await expect(page.locator('.seras-seal-formation')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-seras-lock]')).toHaveCount(2);
  await expect(page.locator('.seras-seal-formation')).toHaveCount(0);
});

test('moving Seras to the waiting room clears both seals and restores activation', async ({
  page,
}) => {
  await page.goto('/?lock&active');
  await expect(page.locator('[data-seras-lock]')).toHaveCount(2);
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    const result = useGameStore
      .getState()
      .movePublicCardToWaitingRoom('seras', 'MEMBER_SLOT', 'CENTER');
    if (!result.success) throw new Error(JSON.stringify(result));
  });
  await expect(page.locator('[data-seras-lock]')).toHaveCount(0);
  expect((await lockState(page)).own.activatedAbilityUiConfigs.length).toBeGreaterThan(0);
});

test('R print and reduced motion retain static seals on narrow screens with no input interception', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?lock');
  await page.getByText('测试选项', { exact: true }).click();
  await page.getByRole('button', { name: '验证 R 罕度', exact: true }).click();
  await page.getByText('测试选项', { exact: true }).click();
  await page.getByRole('button', { name: '泉横置／转正', exact: true }).click();
  const seal = page.locator('[data-seras-lock="obj_own-low"]');
  await expect(seal).toBeVisible();
  await expect(page.locator('.seras-seal-formation')).toHaveCount(0);
  const metrics = await seal.evaluate((e) => {
    const card = e.getBoundingClientRect();
    const badge = e.querySelector('.seras-seal-badge')!.getBoundingClientRect();
    return {
      pointer: getComputedStyle(e).pointerEvents,
      fits: badge.left >= card.left && badge.right <= card.right && badge.bottom <= card.bottom,
    };
  });
  expect(metrics).toEqual({ pointer: 'none', fits: true });
  await page.getByRole('button', { name: '泉横置／转正', exact: true }).click();
  await expect(seal).toHaveCount(0);
});

test('disabling cosmetics preserves the same locked ability availability', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('loveca-card-entrance-enabled', 'false'));
  await page.goto('/?lock&active');
  await expect(page.getByRole('button', { name: '泉横置／转正', exact: true })).toBeVisible();
  await expect(page.locator('[data-seras-lock]')).toHaveCount(0);
  expect((await lockState(page)).own.activatedAbilityUiConfigs).toEqual([]);
  await page.getByRole('button', { name: '泉横置／转正', exact: true }).click();
  expect((await lockState(page)).own.activatedAbilityUiConfigs.length).toBeGreaterThan(0);
});

test('release is cosmetic: availability returns immediately and a new lock cancels the old exit', async ({
  page,
}) => {
  await page.goto('/?lock&active');
  await expect(page.locator('[data-seras-lock]')).toHaveCount(2);
  // Hold the exit in flight to prove that animation completion never gates a rule action.
  await page.addStyleTag({
    content:
      ".seras-lock-seal[data-phase='releasing'] .seras-seal-badge { animation-duration: 10s !important; }",
  });
  const toggle = page.getByRole('button', { name: '泉横置／转正', exact: true });
  await toggle.click();
  await expect(page.locator('[data-seras-lock]')).toHaveCount(0);
  await expect(page.locator('[data-seras-lock-release]')).toHaveCount(2);
  expect((await lockState(page)).own.activatedAbilityUiConfigs.length).toBeGreaterThan(0);
  await toggle.click();
  await expect(page.locator('[data-seras-lock-release]')).toHaveCount(0);
  await expect(page.locator('[data-seras-lock][data-phase="sealed"]')).toHaveCount(2);
  expect((await lockState(page)).own.activatedAbilityUiConfigs).toEqual([]);
  await expect(page.locator('.seras-seal-formation')).toHaveCount(0);
});

test('chains stay full-width at the lower quarter and follow the card when tapped or dragged', async ({
  page,
}) => {
  await page.goto('/?lock');
  await page.getByRole('button', { name: '泉横置／转正', exact: true }).click();
  const seal = page.locator('[data-seras-lock="obj_own-low"]');
  const geometry = () =>
    seal.evaluate((e) => {
      const card = e.getBoundingClientRect();
      const chain = e.querySelector('.seras-seal-badge')!.getBoundingClientRect();
      return {
        width: chain.width / card.width,
        center: (chain.top + chain.height / 2 - card.top) / card.height,
      };
    });
  expect((await geometry()).width).toBeCloseTo(1, 2);
  await expect(seal).toHaveAttribute('data-phase', 'sealed');
  expect((await geometry()).width).toBeCloseTo(1, 2);
  expect((await geometry()).center).toBeCloseTo(0.75, 2);
  const card = page.locator(
    '[data-battle-ui-anchor="self-stage-right"] [data-object-id="obj_own-low"]'
  );
  await card.dblclick();
  await expect(card).toHaveCSS('rotate', '90deg');
  await expect(card.locator('[data-seras-lock="obj_own-low"]')).toHaveCount(1);
  await expect(seal).toHaveAttribute('data-phase', 'sealed');
  const box = await card.boundingBox();
  if (!box) throw new Error('Missing stage card');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 - 40, { steps: 6 });
  await expect(
    page.locator('[data-battle-drag-card="own-low"] [data-seras-lock="obj_own-low"]')
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('[data-battle-drag-card="own-low"]')).toHaveCount(0);
});

test('tightening keeps the crossing and card-edge anchors fixed through settling', async ({
  page,
}) => {
  await page.goto('/?lock');
  await page.getByRole('button', { name: '泉横置／转正', exact: true }).click();
  const seal = page.locator('[data-seras-lock="obj_own-low"]');
  await expect(seal).toHaveAttribute('data-phase', 'forming');
  await seal.evaluate((el) => el.getAnimations({ subtree: true }).forEach((a) => a.pause()));
  const geometry = () =>
    seal.evaluate((el) => {
      const origin = (node: SVGGraphicsElement) =>
        new DOMPoint().matrixTransform(node.getScreenCTM()!);
      const strands = [...el.querySelectorAll('.seras-chain-strand')].map((strand) =>
        [...strand.querySelectorAll<SVGGraphicsElement>('.seras-chain-link')].map(origin)
      );
      const [a, b] = [strands[0][1], strands[0][7]];
      const [c, d] = [strands[1][1], strands[1][7]];
      const ab = { x: b.x - a.x, y: b.y - a.y };
      const cd = { x: d.x - c.x, y: d.y - c.y };
      const t = ((c.x - a.x) * cd.y - (c.y - a.y) * cd.x) / (ab.x * cd.y - ab.y * cd.x);
      const rose = origin(el.querySelector<SVGGraphicsElement>('.seras-chain-clasp')!);
      const edgeBounds = [...el.querySelectorAll('.seras-chain-strand')].flatMap((strand) => {
        const links = strand.querySelectorAll('.seras-chain-link');
        return [links[0], links[links.length - 1]].map((link) => {
          const { x, y, width, height } = link.getBoundingClientRect();
          return { x, y, width, height };
        });
      });
      return {
        crossingOffset: Math.hypot(a.x + t * ab.x - rose.x, a.y + t * ab.y - rose.y),
        points: [...strands.flat(), rose].map((p) => ({ x: p.x, y: p.y })),
        edgeBounds,
      };
    });
  const samples: Awaited<ReturnType<typeof geometry>>[] = [];
  // Inspect the real SVG/CSS motion, including the frame immediately before its class is removed.
  for (const time of [80, 160, 260, 380, 480, 559]) {
    await seal.evaluate(
      (el, time) => el.getAnimations({ subtree: true }).forEach((a) => (a.currentTime = time)),
      time
    );
    const sample = await geometry();
    expect(sample.crossingOffset, `crossing at ${time}ms`).toBeLessThan(0.25);
    samples.push(sample);
  }
  const before = await geometry();
  await seal.evaluate((el) => el.getAnimations({ subtree: true }).forEach((a) => a.finish()));
  await expect(seal).toHaveAttribute('data-phase', 'sealed');
  const after = await geometry();
  expect(after.crossingOffset).toBeLessThan(0.25);
  for (const sample of samples) {
    sample.edgeBounds.forEach((bounds, i) => {
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(bounds[key] - after.edgeBounds[i][key]), `edge ${i} ${key}`).toBeLessThan(
          0.25
        );
      }
    });
  }
  for (let i = 0; i < before.points.length; i++) {
    expect(
      Math.hypot(after.points[i].x - before.points[i].x, after.points[i].y - before.points[i].y)
    ).toBeLessThan(0.25);
  }
});

test('a dragged member visibly binds after landing without blocking further operations', async ({
  page,
}) => {
  await page.goto('/?lock&entry');
  await expect(page.locator('[data-seras-lock="obj_own-low"]')).toHaveCount(0);
  const handCard = page.locator('[data-object-id="obj_own-low"]');
  await expect(handCard).toBeVisible();
  const target = page.locator('[data-battle-ui-anchor="self-stage-right"]');
  const from = await handCard.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Missing hand card or stage');
  await page.evaluate(() => {
    // Sample the first visible frame, not a later Playwright polling tick.
    (window as Window & { serasLandingFrame?: Promise<number> }).serasLandingFrame = new Promise(
      (resolve) => {
        const sample = () => {
          const card = document.querySelector(
            '[data-battle-ui-anchor="self-stage-right"] [data-object-id="obj_own-low"]'
          );
          if (!card || getComputedStyle(card).visibility !== 'visible') {
            requestAnimationFrame(sample);
            return;
          }
          const animations =
            card.querySelector('[data-seras-lock]')?.getAnimations({ subtree: true }) ?? [];
          const formation = animations.find(
            (a) => (a as CSSAnimation).animationName === 'seras-seal-form'
          );
          animations.forEach((a) => a.pause());
          resolve(formation ? Number(formation.currentTime) : Infinity);
        };
        requestAnimationFrame(sample);
      }
    );
  });
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 15, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 });
  await page.mouse.up();
  const stageCard = target.locator('[data-object-id="obj_own-low"]');
  // The old test only checked the phase, so an animation spent behind the flying card passed.
  await expect(stageCard).toBeVisible();
  const seal = page.locator('[data-seras-lock="obj_own-low"]');
  await expect(seal).toHaveAttribute('data-phase', 'forming');
  const elapsed = await page.evaluate(
    () => (window as Window & { serasLandingFrame?: Promise<number> }).serasLandingFrame
  );
  expect(elapsed).toBeLessThan(80);
  const locked = await lockState(page);
  expect(locked.own.frontInfo.cost).toBe(4);
  expect(locked.own.activatedAbilityUiConfigs).toEqual([]);
  expect(locked.entrance).toBeFalsy();
  expect(locked.effect).toBeFalsy();
  await stageCard.dblclick();
  expect((await lockState(page)).own.orientation).toBe('WAITING');
  await expect(seal).toHaveAttribute('data-phase', 'forming');
  await seal.evaluate((el) => el.getAnimations({ subtree: true }).forEach((a) => a.finish()));
  await expect(seal).toHaveAttribute('data-phase', 'sealed');
});

test('losing the prohibition during landing cancels the pending bind', async ({ page }) => {
  await page.goto('/?lock&entry');
  await expect(page.locator('[data-seras-lock="obj_enemy-low"]')).toBeVisible();
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    const result = useGameStore.getState().playMemberToSlot('own-low', 'RIGHT');
    if (!result.success) throw new Error(JSON.stringify(result));
  });
  const stageCard = page.locator(
    '[data-battle-ui-anchor="self-stage-right"] [data-object-id="obj_own-low"]'
  );
  await expect(stageCard).toHaveClass(/invisible/);
  await expect(page.locator('[data-seras-lock="obj_own-low"]')).toHaveCount(0);
  // The arriving low-cost Izumi can also satisfy Seras, so remove Seras to end every source.
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    const result = useGameStore
      .getState()
      .movePublicCardToWaitingRoom('seras', 'MEMBER_SLOT', 'CENTER');
    if (!result.success) throw new Error(JSON.stringify(result));
  });
  await expect(stageCard).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-seras-lock]')).toHaveCount(0);
  expect((await lockState(page)).own.activatedAbilityUiConfigs.length).toBeGreaterThan(0);
});
