import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

interface LoginResult {
  readonly accessToken: string;
}

interface AdminAsset {
  readonly id: string;
}

interface AdminEntry {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly sortOrder: number;
  readonly enabled: boolean;
  readonly asset: AdminAsset;
}

interface AdminCatalog {
  readonly version: string;
  readonly items: readonly AdminEntry[];
}

test.describe('快捷表情管理', () => {
  test.beforeEach(({ browser }, testInfo) => {
    void browser;
    test.skip(testInfo.project.name !== 'tablet-1024x768', '管理页自行覆盖桌面和移动端视口');
  });

  test('管理员原子发布目录，权限、非法资源和旧版本写入均由服务端拒绝', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const adminLogin = await login(page.context().request, 'test_admin', 'test_admin_password');
    const playerLogin = await login(request, 'test_player_1', 'test_password_1');
    const adminHeaders = bearer(adminLogin.accessToken);
    const original = await apiData<AdminCatalog>(
      await request.get('/api/match-emotes/admin/catalog', { headers: adminHeaders })
    );
    let published = false;

    try {
      const forbidden = await request.get('/api/match-emotes/admin/catalog', {
        headers: bearer(playerLogin.accessToken),
      });
      expect(forbidden.status()).toBe(403);
      await expectErrorCode(forbidden, 'FORBIDDEN');

      const invalidAsset = await request.post('/api/match-emotes/admin/assets', {
        headers: adminHeaders,
        multipart: {
          file: {
            name: 'not-allowed.svg',
            mimeType: 'image/svg+xml',
            buffer: Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>'
            ),
          },
        },
      });
      expect(invalidAsset.status()).toBe(422);
      await expectErrorCode(invalidAsset, 'MATCH_EMOTE_ASSET_FORMAT_INVALID');

      const oversizedAsset = await request.post('/api/match-emotes/admin/assets', {
        headers: adminHeaders,
        multipart: {
          file: {
            name: 'too-large.webp',
            mimeType: 'image/webp',
            buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
          },
        },
      });
      expect(oversizedAsset.status()).toBe(413);
      await expectErrorCode(oversizedAsset, 'MATCH_EMOTE_ASSET_TOO_LARGE');

      await page.setViewportSize({ width: 1600, height: 900 });
      await page.goto('/?page=match-emotes-admin');
      await expect(page.getByRole('heading', { name: '快捷表情' })).toBeVisible();
      await expect(page.getByText('6 / 12 项 · 6 项启用', { exact: true })).toBeVisible();
      await page.screenshot({ path: '../output/playwright/match-emote-admin-desktop.png' });

      const labelInput = page.locator('label').filter({ hasText: '完整名称' }).locator('input');
      const updatedLabel = `${original.items[0]!.label} E2E`;
      await labelInput.fill(updatedLabel);
      await page.getByRole('button', { name: '保存并生效' }).click();
      await expect(page.getByText('快捷表情目录已发布', { exact: true })).toBeVisible();
      published = true;

      const publicConfig = await apiData<{
        readonly matchEmotes: {
          readonly version: string;
          readonly items: readonly { readonly id: string; readonly label: string }[];
        };
      }>(await request.get('/api/config'));
      expect(publicConfig.matchEmotes.version).not.toBe(original.version);
      expect(
        publicConfig.matchEmotes.items.find((item) => item.id === original.items[0]!.id)?.label
      ).toBe(updatedLabel);

      const staleSave = await request.put('/api/match-emotes/admin/catalog', {
        headers: adminHeaders,
        data: savePayload(original),
      });
      expect(staleSave.status()).toBe(409);
      await expectErrorCode(staleSave, 'MATCH_EMOTE_CATALOG_VERSION_CONFLICT');

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole('region', { name: '快捷表情列表' })).toBeVisible();
      await page.getByRole('button', { name: new RegExp(updatedLabel, 'u') }).click();
      await expect(page.getByRole('button', { name: '返回快捷表情列表' })).toBeVisible();
      await labelInput.fill(`${updatedLabel} Mobile`);
      await expect(page.getByRole('button', { name: '保存并生效' })).toBeVisible();
      await expect(labelInput).toBeVisible();
      await page.screenshot({ path: '../output/playwright/match-emote-admin-mobile.png' });
      await page.getByRole('button', { name: '放弃修改' }).click();
      await expect(page.getByRole('button', { name: '保存并生效' })).toHaveCount(0);
    } finally {
      if (published) {
        const current = await apiData<AdminCatalog>(
          await request.get('/api/match-emotes/admin/catalog', { headers: adminHeaders })
        );
        await apiData<AdminCatalog>(
          await request.put('/api/match-emotes/admin/catalog', {
            headers: adminHeaders,
            data: {
              expectedVersion: current.version,
              items: original.items.map((item, sortOrder) => ({
                id: item.id,
                label: item.label,
                shortLabel: item.shortLabel,
                sortOrder,
                enabled: item.enabled,
                assetId: item.asset.id,
              })),
            },
          })
        );
      }
    }
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

function savePayload(catalog: AdminCatalog) {
  return {
    expectedVersion: catalog.version,
    items: catalog.items.map((item, sortOrder) => ({
      id: item.id,
      label: item.label,
      shortLabel: item.shortLabel,
      sortOrder,
      enabled: item.enabled,
      assetId: item.asset.id,
    })),
  };
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

async function expectErrorCode(response: APIResponse, code: string): Promise<void> {
  const payload = (await response.json()) as {
    readonly data: null;
    readonly error: { readonly code: string; readonly message: string };
  };
  expect(payload.data).toBeNull();
  expect(payload.error.code).toBe(code);
}
