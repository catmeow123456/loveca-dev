import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { OnlineMatchSnapshot, PlayerViewState, Seat } from '../../../src/online';
import type {
  AiBattleSessionView,
  CreateAiBattleResult,
} from '../../../src/online/ai-battle-types';
import type { MatchRecordDetailView } from '../../../src/online/replay-types';
import { fromTransport } from '../../../src/online/serde';

const api = process.env.AI_BATTLE_QA_API_URL;
test('计费：Flash 创建、单次调用、结束后在历史详情读取同一费用', async ({ page }, info) => {
  test.skip(!api || info.project.name !== 'tablet-1024x768', '需隔离数据库 HTTP harness');
  if (!api || !['127.0.0.1', 'localhost'].includes(new URL(api).hostname))
    throw Error('Expected local QA API');
  const login = await page.context().request.post(`${api}/api/auth/login`, {
    data: { usernameOrEmail: 'test_admin', password: 'test_admin_password' },
  });
  expect(login.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await login.json()).data.accessToken}` };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      response: await route.fetch({ url: `${api}${url.pathname}${url.search}` }),
    });
  });
  let matchId: string | undefined;
  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/?page=ai-battle-admin');
    await page
      .getByRole('combobox', { name: 'AI 模型', exact: true })
      .selectOption('qwen3.8-flash');
    await page.getByRole('radio', { name: '真人后手', exact: true }).check();
    const pendingCreate = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/admin/ai-battle/sessions') &&
        response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: '创建调试对局', exact: true }).click();
    const created = await pendingCreate;
    expect(created.status()).toBe(201);
    const createdSession = ((await created.json()) as { data: CreateAiBattleResult }).data.session;
    matchId = createdSession.matchId;
    expect(createdSession.enableThinking).toBe(false);
    await expect(page.locator('.ai-battle-toolbar [data-ai-billing="match"]')).toContainText(
      '≈¥0.0258'
    );
    await page.getByRole('button', { name: '结束', exact: true }).click();
    await page.getByRole('button', { name: '结束调试对局', exact: true }).click();
    await expect(page.getByRole('button', { name: '创建调试对局', exact: true })).toBeEnabled();
    const pendingHistory = page.waitForResponse((response) =>
      response.url().endsWith(`/api/admin/ai-battle/records/${matchId}/billing`)
    );
    await page.getByRole('button', { name: '历史', exact: true }).click();
    const history = await pendingHistory;
    expect(history.status()).toBe(200);
    expect((await history.json()).data.matchBilling).toMatchObject({
      model: 'qwen3.8-flash',
      estimatedCny: '0.02579710',
      attempts: 1,
      reportedAttempts: 1,
    });
    await expect(page.locator('.ai-billing-history [data-ai-billing="match"]')).toContainText(
      '≈¥0.0258'
    );
    await page.screenshot({ path: '../output/playwright/ai-battle/billing-history-1600.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.ai-billing-history [data-ai-billing="match"]').click();
    await expect(page.getByRole('tooltip')).toContainText(
      '输入 29,797 + 缓存输入 17,408 + 缓存创建 0 → 输出 81 token'
    );
    await page.screenshot({ path: '../output/playwright/ai-battle/billing-history-390.png' });
  } finally {
    if (matchId)
      await page
        .context()
        .request.post(`${api}/api/admin/ai-battle/sessions/${matchId}/end`, { headers, data: {} });
  }
});

test('P5 完整 HTTP 与 PostgreSQL：真人登场、效果、LIVE 和结束封存', async ({ page }, info) => {
  test.skip(!api || info.project.name !== 'tablet-1024x768', '需单独启动隔离数据库 HTTP harness');
  test.setTimeout(240_000);
  if (!api || !['127.0.0.1', 'localhost'].includes(new URL(api).hostname))
    throw Error('Expected local QA API');
  await mkdir('../output/playwright/ai-battle', { recursive: true });
  await page.setViewportSize({ width: 1600, height: 900 });
  const login = await page.context().request.post(`${api}/api/auth/login`, {
    data: { usernameOrEmail: 'test_admin', password: 'test_admin_password' },
  });
  expect(login.status()).toBe(200);
  const token = (await login.json()).data.accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  await page.route('**/api/**', async (route) => {
    const original = new URL(route.request().url());
    const response = await route.fetch({ url: `${api}${original.pathname}${original.search}` });
    await route.fulfill({ response });
  });
  const commands: { type: string; success: boolean; error?: string }[] = [];
  page.on('response', async (response) => {
    if (
      !response.url().includes('/api/admin/ai-battle/sessions/') ||
      !response.url().endsWith('/command')
    )
      return;
    const body = await response.json();
    commands.push({
      type: response.request().postDataJSON().command.type,
      success: body.data?.success === true,
      error: body.data?.error ?? body.error?.message,
    });
  });
  let matchId: string | null = null;
  const snapshot = async () => {
    const response = await page
      .context()
      .request.get(`${api}/api/admin/ai-battle/sessions/${matchId}/snapshot`, { headers });
    expect(response.status()).toBe(200);
    return fromTransport<{ data: OnlineMatchSnapshot }>(await response.json()).data;
  };
  try {
    await page.goto('/?page=ai-battle-admin');
    const createdResponse = page.waitForResponse(
      (r) => r.url().endsWith('/api/admin/ai-battle/sessions') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: '创建调试对局', exact: true }).click();
    const response = await createdResponse;
    const payload = await response.json();
    expect(response.status(), JSON.stringify(payload.error)).toBe(201);
    const created = fromTransport<{ data: CreateAiBattleResult }>(payload).data;
    matchId = created.session.matchId;
    await page.getByRole('button', { name: '保留手牌', exact: true }).click();
    await expect
      .poll(async () => (await snapshot()).playerViewState.match.phase)
      .toBe('MAIN_PHASE');
    let played = false;
    let effect = false;
    let judgment = false;
    for (let i = 0; i < 130 && !(played && effect && judgment); i++) {
      const current = await snapshot();
      const view = current.playerViewState;
      const statusResponse = await page
        .context()
        .request.get(`${api}/api/admin/ai-battle/sessions/${matchId}`, { headers });
      const status = (await statusResponse.json()).data as AiBattleSessionView;
      expect(
        status.stoppedReason,
        JSON.stringify({ phase: view.match.phase, subPhase: view.match.subPhase })
      ).toBeNull();
      const before = current.seq;
      console.log(
        JSON.stringify({
          step: i,
          phase: view.match.phase,
          subPhase: view.match.subPhase,
          activeEffect: view.activeEffect?.stepId,
          commands: commands.length,
          played,
          effect,
          judgment,
        })
      );
      if (view.activeEffect?.waitingSeat === current.seat) {
        await resolveEffect(page, view);
        effect = true;
      } else if (view.match.phase === 'MAIN_PHASE' && enabled(view, 'PLAY_MEMBER_TO_SLOT')) {
        const candidate = affordableEmptySlot(view, current.seat);
        if (candidate) {
          await page
            .locator(`[data-battle-ui-anchor="self-hand"] [data-object-id="${candidate.id}"]`)
            .click();
          await page.locator(`[data-battle-ui-anchor="self-stage-${candidate.slot}"]`).click();
          await expect
            .poll(
              async () =>
                (await snapshot()).playerViewState.table.zones[
                  `${current.seat}_MEMBER_${candidate.slot.toUpperCase()}`
                ]?.slotMap?.[candidate.slot.toUpperCase()]
            )
            .toBe(candidate.id);
          const afterPlay = (await snapshot()).playerViewState;
          expect(activeEnergyCount(afterPlay, current.seat)).toBe(
            activeEnergyCount(view, current.seat) - view.objects[candidate.id]!.frontInfo!.cost!
          );
          played = true;
          await page.mouse.move(450, 30);
          await expect(page.locator('[data-phase-announcement]')).toHaveCount(0);
          await page.screenshot({
            path: '../output/playwright/ai-battle/full-env-play-1600.png',
            animations: 'disabled',
          });
        } else await page.locator('[data-battle-ui-anchor="phase-primary-action"]:visible').click();
      } else if (view.match.phase === 'LIVE_SET_PHASE' && enabled(view, 'SET_LIVE_CARD')) {
        const zone = view.table.zones[`${current.seat}_LIVE_ZONE`];
        const hand = view.table.zones[`${current.seat}_HAND`]?.objectIds ?? [];
        const live =
          !zone?.count && hand.find((id) => view.objects[id]?.frontInfo?.cardType === 'LIVE');
        if (live) {
          await page
            .locator(`[data-battle-ui-anchor="self-hand"] [data-object-id="${live}"]`)
            .click();
          const liveZone = page.locator('[data-battle-ui-anchor="self-live-zone"]');
          await expect(liveZone).toHaveAttribute('title', '里侧放置');
          await liveZone.click();
        } else await page.locator('[data-battle-ui-anchor="phase-primary-action"]:visible').click();
      } else if (enabled(view, 'SUBMIT_JUDGMENT')) {
        await page.locator('[data-battle-ui-anchor="phase-primary-action"]:visible').click();
        await expect(
          page.locator('[data-battle-ui-anchor="automatic-judgment-confirm"]')
        ).toBeVisible();
        await page.mouse.move(450, 30);
        await page.screenshot({
          path: '../output/playwright/ai-battle/full-env-judgment-1600.png',
          animations: 'disabled',
        });
        await page.locator('[data-battle-ui-anchor="automatic-judgment-confirm"]').click();
        judgment = true;
      } else if (enabled(view, 'SUBMIT_SCORE')) {
        await page.locator('[data-battle-ui-anchor="score-confirm-action"]').click();
      } else if (enabled(view, 'CONFIRM_STEP') || enabled(view, 'END_PHASE')) {
        await page.locator('[data-battle-ui-anchor="phase-primary-action"]:visible').click();
      }
      await expect
        .poll(async () => (await snapshot()).seq, { timeout: 35_000 })
        .toBeGreaterThan(before);
    }
    expect({ played, effect, judgment }).toEqual({ played: true, effect: true, judgment: true });
    await expect
      .poll(() => commands.map((c) => c.type))
      .toEqual(
        expect.arrayContaining([
          'MULLIGAN',
          'PLAY_MEMBER_TO_SLOT',
          'CONFIRM_EFFECT_STEP',
          'SET_LIVE_CARD',
          'SUBMIT_JUDGMENT',
        ])
      );
    expect(commands.filter((c) => !c.success)).toEqual([]);
    await page.getByRole('button', { name: '结束', exact: true }).click();
    await page.getByRole('button', { name: '结束调试对局', exact: true }).click();
    await expect(page.getByRole('button', { name: '创建调试对局', exact: true })).toBeEnabled();
    const recordResponse = await page
      .context()
      .request.get(`${api}/api/battle/match-records/${matchId}`, { headers });
    expect(recordResponse.status()).toBe(200);
    const record = (await recordResponse.json()).data as MatchRecordDetailView;
    expect(record).toMatchObject({
      originKind: 'AI_DEBUG',
      status: 'INTERRUPTED',
      winnerSeat: null,
      endReason: 'AI_DEBUG_ENDED',
      matchMode: 'ONLINE',
      automationGameMode: 'DEBUG',
    });
    expect(record.sealedAt).not.toBeNull();
    expect(record.lastCheckpointSeq).toBeGreaterThan(0);
    expect(record.participants.map((p) => p.participantKind).sort()).toEqual(['SYSTEM', 'USER']);
    const replayResponse = await page
      .context()
      .request.get(`${api}/api/battle/match-records/${matchId}/replay`, { headers });
    expect(replayResponse.status()).toBe(200);
    await writeFile(
      '../output/playwright/ai-battle/full-env-result.json',
      JSON.stringify({ matchId, record, commands, replayStatus: replayResponse.status() }, null, 2)
    );
  } finally {
    await writeFile(
      '../output/playwright/ai-battle/full-env-last-commands.json',
      JSON.stringify({ matchId, commands }, null, 2)
    );
    if (matchId)
      await page
        .context()
        .request.post(`${api}/api/admin/ai-battle/sessions/${matchId}/end`, { headers });
  }
});

function enabled(view: PlayerViewState, type: string) {
  return view.permissions.availableCommands.some((hint) => hint.command === type && hint.enabled);
}
function affordableEmptySlot(view: PlayerViewState, seat: Seat) {
  const activeEnergy = activeEnergyCount(view, seat);
  const slot = ['left', 'center', 'right'].find(
    (slot) => !view.table.zones[`${seat}_MEMBER_${slot.toUpperCase()}`]?.count
  );
  if (!slot) return null;
  const hand = [...(view.table.zones[`${seat}_HAND`]?.objectIds ?? [])];
  // Prefer an affordable entry effect so the browser story reaches a human selection window.
  hand.sort((a, b) => Number(hasEntryEffect(b)) - Number(hasEntryEffect(a)));
  function hasEntryEffect(id: string) {
    const front = view.objects[id]?.frontInfo;
    return /登場|登场/u.test(front?.cardTextJp ?? front?.cardTextCn ?? '');
  }
  const id = hand.find((id) => {
    const front = view.objects[id]?.frontInfo;
    return front?.cardType === 'MEMBER' && (front.cost ?? Infinity) <= activeEnergy;
  });
  return id ? { id, slot } : null;
}
function activeEnergyCount(view: PlayerViewState, seat: Seat) {
  return (view.table.zones[`${seat}_ENERGY_ZONE`]?.objectIds ?? []).filter(
    (id) => view.objects[id]?.orientation === 'ACTIVE'
  ).length;
}
async function resolveEffect(page: Page, view: PlayerViewState) {
  const effect = view.activeEffect!;
  const panel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
  await expect(panel).toBeVisible();
  await page.mouse.move(450, 30);
  await expect(page.locator('[data-phase-announcement]')).toHaveCount(0);
  await page.screenshot({
    path: '../output/playwright/ai-battle/full-env-effect-1600.png',
    animations: 'disabled',
  });
  if (effect.canResolveInOrder)
    return panel.getByRole('button', { name: '顺序发动', exact: true }).click();
  if (effect.selectableObjectIds?.length) {
    const count = Math.max(effect.minSelectableObjects ?? 1, 1);
    for (let i = 0; i < count; i++)
      await panel
        .locator('[data-battle-ui-anchor="active-effect-selection"] button')
        .nth(i)
        .click();
    if (effect.selectableObjectMode === 'ORDERED_MULTI' && !effect.autoSubmitSingleSelection)
      await panel
        .getByRole('button', { name: effect.confirmSelectionLabel ?? '确认选择', exact: true })
        .click();
    return;
  }
  if (effect.selectableOptions?.length)
    return panel
      .getByRole('button', { name: effect.selectableOptions[0]!.label, exact: true })
      .click();
  await panel
    .locator('[data-battle-ui-anchor="active-effect-confirm"] button:enabled')
    .first()
    .click();
}
