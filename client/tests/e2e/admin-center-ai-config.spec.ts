import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

interface LoginResult {
  readonly accessToken: string;
}

interface AiConfig {
  readonly revision: number;
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKeyConfigured: boolean;
  readonly encryptionReady: boolean;
  readonly outboundPolicyReady: boolean;
  readonly runtimeReady: boolean;
  readonly updatedAt: string;
}

test.describe('运营管理中心与 AI 私密配置', () => {
  test.beforeEach(({ browser }, testInfo) => {
    void browser;
    test.skip(testInfo.project.name !== 'tablet-1024x768', '本用例自行覆盖桌面和移动端视口');
  });

  test('统一入口可用，私密接口、候选测试和版本冲突由服务端保护', async ({ page, request }) => {
    const admin = await login(page.context().request, 'test_admin', 'test_admin_password');
    const player = await login(request, 'test_player_1', 'test_password_1');
    const adminHeaders = bearer(admin.accessToken);

    const anonymous = await request.get('/api/ai-effect-extraction/admin/config');
    expect(anonymous.status()).toBe(401);
    await expectErrorCode(anonymous, 'UNAUTHORIZED');

    const forbidden = await request.get('/api/ai-effect-extraction/admin/config', {
      headers: bearer(player.accessToken),
    });
    expect(forbidden.status()).toBe(403);
    await expectErrorCode(forbidden, 'FORBIDDEN');

    const original = await apiData<AiConfig>(
      await request.get('/api/ai-effect-extraction/admin/config', { headers: adminHeaders })
    );
    expect(original).not.toHaveProperty('apiKey');
    expect(original).not.toHaveProperty('encryptedApiKey');

    const invalidCandidate = await request.post('/api/ai-effect-extraction/admin/test', {
      headers: adminHeaders,
      data: {
        baseUrl: 'https://untrusted.example/v1',
        modelId: 'candidate-model',
        apiKey: { action: 'REPLACE', value: 'e2e-temporary-secret' },
      },
    });
    expect(invalidCandidate.status()).toBe(422);
    await expectErrorCode(invalidCandidate, 'AI_EFFECT_HOST_NOT_ALLOWED');
    expect(await invalidCandidate.text()).not.toContain('e2e-temporary-secret');

    const arbitraryImageUrl = await request.post('/api/ai-effect-extraction/admin/extract', {
      headers: adminHeaders,
      data: {
        cardCode: 'PL!-sd1-004-SD',
        imageUrl: 'http://127.0.0.1/latest/meta-data',
      },
    });
    expect(arbitraryImageUrl.status()).toBe(400);
    await expectErrorCode(arbitraryImageUrl, 'INVALID_REQUEST');

    const savePayload = {
      expectedRevision: original.revision,
      enabled: false,
      baseUrl: original.baseUrl,
      modelId: original.modelId,
      apiKey: { action: 'KEEP' as const },
    };
    const saved = await apiData<AiConfig>(
      await request.put('/api/ai-effect-extraction/admin/config', {
        headers: adminHeaders,
        data: savePayload,
      })
    );
    expect(saved.revision).toBe(original.revision + 1);

    const stale = await request.put('/api/ai-effect-extraction/admin/config', {
      headers: adminHeaders,
      data: savePayload,
    });
    expect(stale.status()).toBe(409);
    await expectErrorCode(stale, 'AI_EFFECT_CONFIG_REVISION_CONFLICT');

    const disabledExtraction = await request.post('/api/ai-effect-extraction/admin/extract', {
      headers: adminHeaders,
      data: { cardCode: 'PL!-sd1-004-SD' },
    });
    expect(disabledExtraction.status()).toBe(409);
    await expectErrorCode(disabledExtraction, 'AI_EFFECT_EXTRACTION_DISABLED');

    const publicConfig = (await (await request.get('/api/config')).json()) as {
      readonly data: Record<string, unknown>;
    };
    expect(publicConfig.data).not.toHaveProperty('aiEffectExtraction');

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/?page=admin-center');
    await expect(page.getByRole('heading', { name: '运营管理中心' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '内容与平台' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '卡牌与规则' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '对局与赛季' })).toBeVisible();
    await page.screenshot({
      path: '../output/playwright/admin-center-desktop.png',
      fullPage: true,
    });

    await page.getByRole('button', { name: /卡牌效果 AI 提取/u }).click();
    await expect(page.getByRole('heading', { name: '卡牌效果 AI 提取' })).toBeVisible();
    await expect(
      page.getByText(
        original.apiKeyConfigured
          ? '已有 Key 已加密保存，页面不会读取或显示原值。'
          : '当前尚未配置 Key。'
      )
    ).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    const baseUrlInput = page.getByRole('textbox', { name: /Base URL/u });
    await baseUrlInput.fill('https://candidate.example/v1');
    const leaveDialogPromise = page.waitForEvent('dialog').then(async (leaveDialog) => {
      expect(leaveDialog.message()).toContain('有未保存修改');
      await leaveDialog.dismiss();
    });
    await Promise.all([
      leaveDialogPromise,
      page.getByRole('button', { name: '打开卡牌数据' }).click(),
    ]);
    await expect(page.getByRole('heading', { name: '卡牌效果 AI 提取' })).toBeVisible();
    await baseUrlInput.fill(original.baseUrl);

    await page.screenshot({
      path: '../output/playwright/ai-effect-config-desktop.png',
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '返回管理中心' }).click();
    await expect(page.getByRole('button', { name: /快捷表情/u })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '选择管理分类' })).toHaveCount(0);
    await page.screenshot({ path: '../output/playwright/admin-center-mobile.png', fullPage: true });
  });
});

async function login(
  request: APIRequestContext,
  usernameOrEmail: string,
  password: string
): Promise<LoginResult> {
  return apiData<LoginResult>(
    await request.post('/api/auth/login', { data: { usernameOrEmail, password } })
  );
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function expectErrorCode(response: APIResponse, code: string): Promise<void> {
  const payload = (await response.json()) as { readonly error?: { readonly code?: string } };
  expect(payload.error?.code).toBe(code);
}

async function apiData<T>(response: APIResponse): Promise<T> {
  const payload = (await response.json()) as {
    readonly data: T | null;
    readonly error: { readonly message: string } | null;
  };
  expect(response.ok(), payload.error?.message).toBe(true);
  expect(payload.data).not.toBeNull();
  return payload.data as T;
}
