import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiClient } from '../../client/src/lib/apiClient';
import {
  getPlayerWallpaperErrorMessage,
  publishPlayerWallpaper,
} from '../../client/src/lib/playerWallpaperClient';

describe('player wallpaper client', () => {
  it('uses a dedicated upload timeout without changing the shared API default', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        changed: false,
        wallpaper: {
          version: 0,
          wideMode: 'DEFAULT',
          compactMode: 'INHERIT_PC',
          wideSolidPreset: null,
          compactSolidPreset: null,
          wide: null,
          compact: null,
          wideSource: null,
          compactSource: null,
          canPublishToday: true,
          nextChangeAt: null,
          lastPublishedAt: null,
        },
      },
      error: null,
    });

    await publishPlayerWallpaper({
      expectedVersion: 0,
      idempotencyKey: 'wallpaper-request-key',
      wideMode: 'DEFAULT',
      compactMode: 'INHERIT_PC',
      wideSolidPreset: null,
      compactSolidPreset: null,
      wide: null,
      compact: null,
    });

    expect(post).toHaveBeenCalledWith('/api/player-wallpapers', expect.any(FormData), 90_000);
  });

  it('turns known resolution and gateway failures into simple player messages', () => {
    expect(
      getPlayerWallpaperErrorMessage(
        new ApiClientError({
          code: 'WALLPAPER_CROP_TOO_SMALL',
          message: 'technical detail',
          status: 400,
        }),
        '保存壁纸失败。'
      )
    ).toBe('图片分辨率不足，请换一张尺寸更大的图片。');
    expect(
      getPlayerWallpaperErrorMessage(
        new ApiClientError({
          code: 'INVALID_RESPONSE',
          message: '服务器返回了非预期的响应 (504)',
          status: 504,
        }),
        '保存壁纸失败。'
      )
    ).toBe('服务器暂时无法处理壁纸，请稍后重试。');
  });
});
