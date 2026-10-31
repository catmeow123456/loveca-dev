import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { installVisualApiMocks } from '../visual/support/mockApp';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
test.use({ serviceWorkers: 'block' });

async function openBoard(page: Page, viewer = 'p1') {
  await installVisualApiMocks(page, false);
  await page.addInitScript(() => localStorage.setItem('loveca-card-entrance-enabled', 'true'));
  await page.route('**/images/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#a8b8cc"/></svg>',
    })
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
  await page.evaluate(
    async ({ repoRoot, viewer }) => {
      const resources = performance.getEntriesByType('resource');
      const storeUrl = resources.find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
      const reactUrl = resources.find((e) => /\/react\.js(?:\?|$)/.test(e.name))!.name;
      const domUrl = resources.find((e) => /\/react-dom_client\.js(?:\?|$)/.test(e.name))!.name;
      const fixtureUrl = `/@fs${repoRoot}tests/helpers/ginko-entrance-fixture.ts`;
      const boardUrl = '/src/components/game/GameBoard.tsx';
      const shellUrl = '/src/components/game/BattleViewportShell.tsx';
      const [
        react,
        dom,
        { useGameStore },
        { prepareGinkoScenario },
        { GameBoard },
        { BattleViewportShell },
      ] = await Promise.all([
        import(reactUrl),
        import(domUrl),
        import(storeUrl),
        import(fixtureUrl),
        import(boardUrl),
        import(shellUrl),
      ]);
      const React = react.default ?? react;
      const f = prepareGinkoScenario({ mode: 'REMOTE', relay: 'none' });
      if (!f.play().success || !f.ack('p1').success || !f.ack('p2').success)
        throw new Error('fixture entrance failed');
      useGameStore
        .getState()
        .loadCardData([...f.session.state.cardRegistry.values()].map((c: any) => c.data));
      useGameStore.setState({
        gameSession: f.session,
        // Keep the opponent seat fixed instead of DEBUG's automatic action-owner switch.
        gameMode: viewer === 'p2' ? 'SOLITAIRE' : 'DEBUG',
        viewingPlayerId: viewer,
        remoteSession: null,
        replaySession: null,
        playerViewState: null,
      });
      useGameStore.getState().syncState();
      const qa = {
        f,
        store: useGameStore,
        acks: [] as number[],
        receipt: 0,
        faded: 0,
        removed: 0,
        playback: 0,
      };
      const execute = f.session.executeCommand.bind(f.session);
      f.session.executeCommand = (command: any) => {
        if (command.type === 'ACK_CARD_ENTRANCE' && command.playerId === viewer)
          qa.acks.push(performance.now());
        return execute(command);
      };
      Object.assign(window, { ginkoNoticeQa: qa });
      const observe = () => {
        if (!qa.playback && document.querySelector('.ginko-ability-transfer[data-phase]'))
          qa.playback = performance.now();
        const label = document.querySelector<HTMLElement>('.ginko-transfer-received');
        if (label && !qa.receipt) qa.receipt = performance.now();
        if (label && !qa.faded && Number(getComputedStyle(label).opacity) < 0.98)
          qa.faded = performance.now();
        if (!label && qa.receipt && !qa.removed) qa.removed = performance.now();
        requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:99999';
      document.body.append(host);
      (dom.default ?? dom)
        .createRoot(host)
        .render(React.createElement(BattleViewportShell, null, React.createElement(GameBoard)));
    },
    { repoRoot, viewer }
  );
  await expect(page.locator('[data-ginko-knot-marker]')).toHaveCount(0);
  // Let the actual stage DOM mount before the real discard/reveal command.
  await expect(page.locator('[data-object-id="obj_ginko"]')).toBeVisible();
}

async function startTransfer(page: Page, viewer = 'p1') {
  await page.evaluate((viewer) => {
    const { f, store } = (window as any).ginkoNoticeQa;
    if (!f.activate().success || !f.discard().success) throw new Error('fixture transfer failed');
    // Model the other seat finishing first; this browser still owns its real ACK.
    f.ack(viewer === 'p1' ? 'p2' : 'p1');
    store.getState().syncState();
  }, viewer);
}

for (const scenario of ['normal', 'opponent', 'narrow', 'reduced'] as const) {
  test(`吟子获得提示独立于结算：${scenario}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'tablet-1024x768');
    const viewer = scenario === 'opponent' ? 'p2' : 'p1';
    await page.emulateMedia({ reducedMotion: scenario === 'reduced' ? 'reduce' : 'no-preference' });
    if (scenario === 'narrow') await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page, viewer);
    await startTransfer(page, viewer);
    const label = page.locator('.ginko-transfer-received');
    await expect(label).toBeVisible();
    await expect(label).toHaveCSS('pointer-events', 'none');
    await expect
      .poll(() =>
        page.evaluate(
          () => !!(window as any).ginkoNoticeQa.store.getState().playerViewState.match.entrance
        )
      )
      .toBe(false);
    await expect(label).toBeVisible();
    const state = await page.evaluate(() => {
      const q = (window as any).ginkoNoticeQa;
      return { inspection: q.f.session.state.inspectionZone.cardIds.length, acks: q.acks.length };
    });
    expect(state).toEqual({ inspection: 3, acks: 1 });
    const box = (await label.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    const blockedByLabel = await label.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(blockedByLabel).toBe(false);
    // A transparent-to-input notice must still paint above the resumed effect panel.
    const paintedAbovePanel = await label.evaluate((el) => {
      const r = el.getBoundingClientRect();
      el.style.pointerEvents = 'auto';
      const onTop = el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      el.style.removeProperty('pointer-events');
      return onTop;
    });
    expect(paintedAbovePanel).toBe(true);
    if (scenario === 'normal' || scenario === 'narrow') {
      const path = info.outputPath('notice-after-ack.png');
      await page.screenshot({ path });
      await info.attach('notice-after-ack', {
        path,
        contentType: 'image/png',
      });
    }
    if (scenario === 'normal') {
      await page.getByRole('group', { name: '效果候选卡牌' }).getByRole('button').first().click();
      expect(
        await page.evaluate(
          () => (window as any).ginkoNoticeQa.f.session.state.inspectionZone.cardIds.length
        )
      ).toBe(0);
      await expect(label).toBeVisible();
    }
    await expect(label).toHaveCount(0);
    const timing = await page.evaluate(() => {
      const { receipt, faded, removed, playback, acks } = (window as any).ginkoNoticeQa;
      return { receipt, faded, removed, playback, acks };
    });
    expect(timing.removed - timing.receipt).toBeGreaterThanOrEqual(1150);
    expect(timing.removed - timing.receipt).toBeLessThan(1400);
    if (scenario !== 'reduced') {
      expect(timing.faded - timing.receipt).toBeGreaterThanOrEqual(970);
      expect(timing.faded - timing.receipt).toBeLessThan(1120);
      expect(timing.acks[0] - timing.playback).toBeLessThan(1450);
    }
    await info.attach('notice-timing', {
      body: JSON.stringify(timing),
      contentType: 'application/json',
    });
  });
}

for (const action of ['skip', 'disable', 'reset', 'live-end'] as const) {
  test(`吟子获得提示及时清理：${action}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'tablet-1024x768');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openBoard(page);
    if (action === 'disable')
      await page.getByRole('button', { name: '对战设置', exact: true }).click();
    await startTransfer(page);
    if (action === 'skip') {
      await expect(page.locator('.ginko-ability-transfer[data-phase="extract"]')).toBeVisible();
      await page.getByRole('button', { name: '跳过演出', exact: true }).click();
    } else {
      await expect(page.locator('.ginko-transfer-received')).toBeVisible();
      if (action === 'disable') {
        await page.getByRole('switch', { name: '对战特效' }).click();
      } else {
        await page.evaluate(
          async ({ action, repoRoot }) => {
            const { f, store } = (window as any).ginkoNoticeQa;
            if (action === 'reset') {
              store.setState({ playerViewState: null });
            } else {
              const serviceUrl = `/@fs${repoRoot}src/application/game-service.ts`;
              const { GameService } = await import(serviceUrl);
              const result = new GameService().finalizeLiveResult(f.session.state);
              if (!result.success) throw new Error('fixture live end failed');
              f.session.restoreRuntimeState({
                authorityState: result.gameState,
                currentPublicSeq: f.session.getCurrentPublicEventSeq(),
              });
              store.getState().syncState();
            }
          },
          { action, repoRoot }
        );
      }
    }
    await expect(page.locator('.ginko-transfer-received')).toHaveCount(0);
    if (action === 'disable') {
      await page.getByRole('switch', { name: '对战特效' }).click();
      await page.waitForTimeout(300);
      await expect(page.locator('.ginko-transfer-received')).toHaveCount(0);
    }
  });
}
