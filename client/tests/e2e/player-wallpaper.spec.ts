import sharp from 'sharp';
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

interface LoginResult {
  readonly accessToken: string;
}

interface WallpaperAsset {
  readonly id: string;
  readonly url: string;
  readonly focus: { readonly x: number; readonly y: number };
  readonly crop: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
}

interface WallpaperView {
  readonly version: number;
  readonly wideMode: 'DEFAULT' | 'SOLID' | 'CUSTOM';
  readonly compactMode: 'INHERIT_PC' | 'SOLID' | 'CUSTOM';
  readonly wideSolidPreset: string | null;
  readonly compactSolidPreset: string | null;
  readonly wide: WallpaperAsset | null;
  readonly compact: WallpaperAsset | null;
  readonly wideSource: WallpaperAsset | null;
  readonly canPublishToday: boolean;
  readonly nextChangeAt: string | null;
}

interface PublishResult {
  readonly wallpaper: WallpaperView;
  readonly changed: boolean;
}

test.describe('玩家游戏桌壁纸', () => {
  test.beforeEach(({ browser }, testInfo) => {
    void browser;
    test.skip(testInfo.project.name !== 'tablet-1024x768', '壁纸闭环自行覆盖宽屏与窄屏视口');
  });

  test('原子发布双布局资源、隔离其他账号、限制同日变更并可恢复默认', async ({ page, request }) => {
    test.setTimeout(90_000);
    const username = `wallpaper_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const password = 'wallpaper_test_password';
    await expectOk(
      await page.context().request.post('/api/auth/register', {
        data: { username, password, displayName: 'Wallpaper E2E' },
      })
    );
    const owner = await login(page.context().request, username, password);
    const other = await login(request, 'test_player_2', 'test_password_2');
    const ownerHeaders = bearer(owner.accessToken);
    const original = await apiData<WallpaperView>(
      await request.get('/api/player-wallpapers?includeSources=true', { headers: ownerHeaders })
    );
    expect(original.version).toBe(0);
    expect(original.canPublishToday).toBe(true);

    const image = await createHighContrastFixture();
    const wideCrop = { x: 0, y: 0, width: 1, height: 1 };
    const compactCrop = {
      x: 0.341_796_875,
      y: 0,
      width: 0.316_406_25,
      height: 1,
    };
    let activeVersion: number | null = null;

    try {
      const published = await apiData<PublishResult>(
        await request.post('/api/player-wallpapers', {
          headers: ownerHeaders,
          multipart: {
            config: JSON.stringify({
              expectedVersion: 0,
              idempotencyKey: crypto.randomUUID(),
              wideMode: 'CUSTOM',
              compactMode: 'INHERIT_PC',
              wideSolidPreset: null,
              compactSolidPreset: null,
              wide: { source: 'UPLOAD', crop: wideCrop, focus: { x: 0.5, y: 0.5 } },
              compact: { crop: compactCrop, focus: { x: 0.5, y: 0.5 } },
            }),
            wide: { name: 'high-contrast.png', mimeType: 'image/png', buffer: image },
          },
        })
      );
      activeVersion = published.wallpaper.version;
      expect(published.changed).toBe(true);
      expect(published.wallpaper.wide?.id).toBeTruthy();
      expect(published.wallpaper.compact?.id).toBeTruthy();
      expect(published.wallpaper.wide?.id).not.toBe(published.wallpaper.compact?.id);
      expect(published.wallpaper.canPublishToday).toBe(false);
      expect(published.wallpaper.nextChangeAt).not.toBeNull();

      const ownAsset = await request.get(published.wallpaper.wide!.url, { headers: ownerHeaders });
      expect(ownAsset.status()).toBe(200);
      expect(ownAsset.headers()['content-type']).toBe('image/webp');
      expect((await ownAsset.body()).length).toBeGreaterThan(0);

      const otherAsset = await request.get(published.wallpaper.wide!.url, {
        headers: bearer(other.accessToken),
      });
      expect(otherAsset.status()).toBe(404);
      await expectErrorCode(otherAsset, 'WALLPAPER_ASSET_NOT_FOUND');

      const current = await apiData<WallpaperView>(
        await request.get('/api/player-wallpapers?includeSources=true', { headers: ownerHeaders })
      );
      const noChange = await apiData<PublishResult>(
        await request.post('/api/player-wallpapers', {
          headers: ownerHeaders,
          multipart: {
            config: JSON.stringify({
              expectedVersion: current.version,
              idempotencyKey: crypto.randomUUID(),
              wideMode: 'CUSTOM',
              compactMode: 'INHERIT_PC',
              wideSolidPreset: null,
              compactSolidPreset: null,
              wide: { source: 'CURRENT', crop: wideCrop, focus: { x: 0.5, y: 0.5 } },
              compact: { crop: compactCrop, focus: { x: 0.5, y: 0.5 } },
            }),
          },
        })
      );
      expect(noChange.changed).toBe(false);
      expect(noChange.wallpaper.version).toBe(current.version);

      const dailyBlocked = await request.post('/api/player-wallpapers', {
        headers: ownerHeaders,
        multipart: {
          config: JSON.stringify({
            expectedVersion: current.version,
            idempotencyKey: crypto.randomUUID(),
            wideMode: 'CUSTOM',
            compactMode: 'INHERIT_PC',
            wideSolidPreset: null,
            compactSolidPreset: null,
            wide: { source: 'CURRENT', crop: wideCrop, focus: { x: 0.5, y: 0.5 } },
            compact: {
              crop: { ...compactCrop, x: 0.273_437_5 },
              focus: { x: 0.4, y: 0.5 },
            },
          }),
        },
      });
      expect(dailyBlocked.status()).toBe(429);
      const dailyError = await expectErrorCode(dailyBlocked, 'WALLPAPER_DAILY_LIMIT');
      expect(dailyError.nextChangeAt).toBe(current.nextChangeAt);
      expect(Number(dailyBlocked.headers()['retry-after'])).toBeGreaterThan(0);

      await page.setViewportSize({ width: 1600, height: 900 });
      await page.goto('/?page=account');
      await page.getByRole('link', { name: '游戏桌外观', exact: true }).click();
      const settings = page
        .getByRole('heading', { name: '游戏桌外观', exact: true })
        .locator('xpath=ancestor::section[1]');
      await expect(settings).toBeVisible();
      await expect(settings.locator('[data-board-custom-wallpaper="true"]')).toHaveCount(2);
      await settings.getByRole('button', { name: '日间', exact: true }).click();
      await expect(settings.locator('[data-board-background-theme="light"]')).toHaveCount(2);
      await settings.screenshot({ path: '../output/playwright/player-wallpaper-custom-light.png' });
      await settings.getByRole('button', { name: '夜间', exact: true }).click();
      await expect(settings.locator('[data-board-background-theme="dark"]')).toHaveCount(2);
      await settings.screenshot({ path: '../output/playwright/player-wallpaper-desktop.png' });

      await page.setViewportSize({ width: 390, height: 844 });
      await settings.getByRole('button', { name: '手机', exact: true }).click();
      await expect(settings.locator('[data-wallpaper-preview-layout="COMPACT"]')).toBeVisible();
      await settings.screenshot({ path: '../output/playwright/player-wallpaper-mobile.png' });
      const saveButton = settings.getByRole('button', { name: '保存壁纸' });
      await saveButton.scrollIntoViewIfNeeded();
      await expect(saveButton).toBeVisible();
      await expect(settings.getByText('手机 / 紧凑壁纸', { exact: true })).toBeVisible();
      await page.screenshot({ path: '../output/playwright/player-wallpaper-mobile-controls.png' });
    } finally {
      if (activeVersion !== null) {
        const reset = await request.post('/api/player-wallpapers/reset', {
          headers: ownerHeaders,
          data: { expectedVersion: activeVersion, idempotencyKey: crypto.randomUUID() },
        });
        expect(reset.status()).toBe(200);
        const resetResult = await apiData<PublishResult>(reset);
        expect(resetResult.wallpaper.wideMode).toBe('DEFAULT');
        expect(resetResult.wallpaper.canPublishToday).toBe(false);
      }
    }
  });

  test('无需上传即可选择纯色，并用同一预览切换日间与夜间遮罩', async ({ page, request }) => {
    test.setTimeout(60_000);
    const username = `wallpaper_solid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const password = 'wallpaper_test_password';
    await expectOk(
      await page.context().request.post('/api/auth/register', {
        data: { username, password, displayName: 'Wallpaper Solid E2E' },
      })
    );
    const owner = await login(page.context().request, username, password);
    const ownerHeaders = bearer(owner.accessToken);
    let activeVersion: number | null = null;

    try {
      const invalidPreset = await request.post('/api/player-wallpapers', {
        headers: ownerHeaders,
        multipart: {
          config: JSON.stringify({
            expectedVersion: 0,
            idempotencyKey: crypto.randomUUID(),
            wideMode: 'SOLID',
            compactMode: 'INHERIT_PC',
            wideSolidPreset: '#ffffff',
            compactSolidPreset: null,
            wide: null,
            compact: null,
          }),
        },
      });
      expect(invalidPreset.status()).toBe(400);
      await expectErrorCode(invalidPreset, 'WALLPAPER_INVALID_REQUEST');

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/?page=account');
      await page.getByRole('link', { name: '游戏桌外观', exact: true }).click();
      const settings = page
        .getByRole('heading', { name: '游戏桌外观', exact: true })
        .locator('xpath=ancestor::section[1]');
      await expect(settings).toBeVisible();
      await settings.getByRole('button', { name: '使用深海蓝纯色' }).first().click();
      await expect(settings.locator('[data-board-solid-wallpaper="true"]')).toHaveCount(2);
      await expect(settings.getByText('纯色 · 深海蓝', { exact: true })).toBeVisible();

      await settings.getByRole('button', { name: '日间', exact: true }).click();
      await expect(settings.locator('[data-board-background-theme="light"]')).toHaveCount(2);
      await settings.screenshot({ path: '../output/playwright/player-wallpaper-solid-light.png' });
      await settings.getByRole('button', { name: '夜间', exact: true }).click();
      await expect(settings.locator('[data-board-background-theme="dark"]')).toHaveCount(2);

      await settings.getByRole('button', { name: '保存壁纸', exact: true }).click();
      const responsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/player-wallpapers'
      );
      await page.getByRole('dialog').getByRole('button', { name: '保存壁纸' }).click();
      const published = await apiData<PublishResult>(await responsePromise);
      activeVersion = published.wallpaper.version;
      expect(published.wallpaper.wideMode).toBe('SOLID');
      expect(published.wallpaper.compactMode).toBe('INHERIT_PC');
      expect(published.wallpaper.wideSolidPreset).toBe('OCEAN');
      expect(published.wallpaper.compactSolidPreset).toBeNull();
      expect(published.wallpaper.wide).toBeNull();
      expect(published.wallpaper.compact).toBeNull();
      await expect(settings.getByText('壁纸已保存。', { exact: true })).toBeVisible();
      await settings.screenshot({ path: '../output/playwright/player-wallpaper-solid-dark.png' });
    } finally {
      if (activeVersion !== null) {
        const reset = await request.post('/api/player-wallpapers/reset', {
          headers: ownerHeaders,
          data: { expectedVersion: activeVersion, idempotencyKey: crypto.randomUUID() },
        });
        expect(reset.status()).toBe(200);
      }
    }
  });
});

async function createHighContrastFixture(): Promise<Buffer> {
  const overlay = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#fff6ef"/>
          <stop offset="0.5" stop-color="#ff5f7e"/>
          <stop offset="1" stop-color="#211529"/>
        </linearGradient>
      </defs>
      <rect width="1920" height="1080" fill="url(#g)"/>
      <circle cx="960" cy="450" r="280" fill="#ffd54f"/>
      <path d="M0 900 L1920 610 L1920 1080 L0 1080 Z" fill="#321941"/>
    </svg>`);
  return sharp(overlay).png().toBuffer();
}

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

async function apiData<T>(response: APIResponse): Promise<T> {
  const payload = (await response.json()) as {
    readonly data: T | null;
    readonly error: { readonly message: string } | null;
  };
  expect(response.ok(), payload.error?.message).toBe(true);
  expect(payload.data).not.toBeNull();
  return payload.data as T;
}

async function expectOk(response: APIResponse): Promise<void> {
  const payload = (await response.json()) as {
    readonly error: { readonly message: string } | null;
  };
  expect(response.ok(), payload.error?.message).toBe(true);
}

async function expectErrorCode(
  response: APIResponse,
  code: string
): Promise<{ readonly nextChangeAt?: string }> {
  const payload = (await response.json()) as {
    readonly data: null;
    readonly error: {
      readonly code: string;
      readonly message: string;
      readonly nextChangeAt?: string;
    };
  };
  expect(payload.data).toBeNull();
  expect(payload.error.code).toBe(code);
  return payload.error;
}
