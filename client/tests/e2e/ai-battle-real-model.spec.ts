import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type {
  AiTraceExport,
  AiTraceListing,
} from '../../../src/online/ai-battle-observation-types';
import type { CreateAiBattleResult } from '../../../src/online/ai-battle-types';
import { fromTransport } from '../../../src/online/serde';

const api = process.env.AI_BATTLE_QA_API_URL;
test('P4 真实模型：页面创建、实际决定、材料对照和完整导出', async ({ page }, info) => {
  test.skip(
    !api ||
      process.env.AI_BATTLE_QA_MODEL_MODE !== 'REAL' ||
      info.project.name !== 'tablet-1024x768',
    '仅在显式启动真实模型的隔离 QA 服务时执行'
  );
  test.setTimeout(120_000);
  if (!api || !['127.0.0.1', 'localhost'].includes(new URL(api).hostname))
    throw Error('Local QA API required');
  await mkdir('../output/playwright/ai-battle', { recursive: true });
  await page.setViewportSize({ width: 1600, height: 900 });
  const login = await page.context().request.post(`${api}/api/auth/login`, {
    data: { usernameOrEmail: 'test_admin', password: 'test_admin_password' },
  });
  expect(login.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await login.json()).data.accessToken}` };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${api}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  let matchId: string | undefined;
  const listing = async () => {
    const response = await page
      .context()
      .request.get(`${api}/api/admin/ai-battle/sessions/${matchId}/decisions`, { headers });
    expect(response.status()).toBe(200);
    return (await response.json()).data as AiTraceListing;
  };
  try {
    await page.goto('/?page=ai-battle-admin');
    await page.getByRole('radio', { name: '真人后手', exact: true }).check();
    const createdResponse = page.waitForResponse(
      (r) => r.url().endsWith('/api/admin/ai-battle/sessions') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: '创建调试对局', exact: true }).click();
    const response = await createdResponse;
    expect(response.status()).toBe(201);
    matchId = fromTransport<{ data: CreateAiBattleResult }>(await response.json()).data.session
      .matchId;
    await expect
      .poll(async () => (await listing()).decisions.some((d) => d.status === 'ACCEPTED'), {
        timeout: 65_000,
      })
      .toBe(true);
    const accepted = (await listing()).decisions.find((d) => d.status === 'ACCEPTED')!;
    await page.getByRole('button', { name: '观察', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'AI 决定观察', exact: true });
    await expect(dialog).toBeVisible();
    const row = dialog.locator('.ai-decision-row').filter({
      has: page.locator('.ai-decision-number').filter({ hasText: new RegExp(`^${accepted.id}$`) }),
    });
    await row.click();
    await expect(row).toHaveAttribute('aria-current', 'true');
    const requestMaterial = dialog
      .locator('.ai-material')
      .filter({ has: page.locator('summary', { hasText: '实际模型请求' }) })
      .first();
    await requestMaterial.locator('> summary').click();
    await expect(
      requestMaterial.getByRole('list', { name: '实际发送的消息，按请求顺序' }).locator('li')
    ).toHaveCount(6);
    await page.screenshot({ path: '../output/playwright/ai-battle/real-model-request-1600.png' });
    const downloadEvent = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '导出本决定', exact: true }).click();
    const download = await downloadEvent;
    const bundle = JSON.parse(await readFile((await download.path())!, 'utf8')) as AiTraceExport;
    expect(bundle.decisions).toHaveLength(1);
    expect(bundle.incompleteMaterialIds).toEqual([]);
    const decision = bundle.decisions[0]!;
    const materials = new Map(bundle.materials.map((m) => [m.id, m]));
    for (const event of decision.events)
      expect(materials.get(event.materialId)?.status).toBe('COMPLETE');
    const payload = (stage: string) =>
      JSON.parse(
        materials.get(decision.events.find((e) => e.stage === stage)!.materialId)!.content!
      );
    const request = JSON.parse(payload('REQUEST').body);
    expect(request).toMatchObject({
      model: process.env.AI_BATTLE_MODEL ?? 'qwen3.8-max',
      enable_thinking: false,
      stream: false,
      response_format: { type: 'json_object' },
    });
    expect(JSON.parse(payload('RESPONSE_BODY').rawBody).choices[0].message.content).toBeTruthy();
    expect(payload('SUBMIT').selection.source).toBe('MODEL');
    expect(payload('AUTHORITY_RESULT')).toMatchObject({ success: true });
    expect(payload('AUTHORITY_RESULT').commandRecords).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'ACCEPTED' })])
    );
    await writeFile(
      '../output/playwright/ai-battle/real-model-decision.json',
      JSON.stringify(bundle, null, 2)
    );
    await requestMaterial.locator('> summary').click();
    await dialog.locator('.ai-captured-view > summary').click();
    await page.screenshot({ path: '../output/playwright/ai-battle/real-model-view-1600.png' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '结束', exact: true }).click();
    await page.getByRole('button', { name: '结束调试对局', exact: true }).click();
    await expect(page.getByRole('button', { name: '创建调试对局', exact: true })).toBeEnabled();
  } finally {
    if (matchId)
      await page
        .context()
        .request.post(`${api}/api/admin/ai-battle/sessions/${matchId}/end`, { headers });
  }
});
