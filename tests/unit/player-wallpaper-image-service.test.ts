import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  PlayerWallpaperImageError,
  normalizeWallpaperSource,
  renderWallpaperLayout,
  validateNormalizedCrop,
} from '../../src/server/services/player-wallpaper-image-service';

describe('player wallpaper image service', () => {
  it('normalizes a still image and renders an immutable wide WebP', async () => {
    const input = await sharp({
      create: {
        width: 1920,
        height: 1080,
        channels: 4,
        background: { r: 230, g: 80, b: 120, alpha: 0.75 },
      },
    })
      .png()
      .toBuffer();

    const master = await normalizeWallpaperSource(input);
    const display = await renderWallpaperLayout(master, 'WIDE', {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    const metadata = await sharp(display.buffer).metadata();

    expect(master.width).toBe(1920);
    expect(master.height).toBe(1080);
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1080);
    expect(metadata.hasAlpha).toBe(true);
    expect(metadata.exif).toBeUndefined();
  });

  it('allows a recommended 1920x1080 PC image to derive a compact resource only in inherit mode', async () => {
    const input = await sharp({
      create: {
        width: 1920,
        height: 1080,
        channels: 3,
        background: { r: 40, g: 30, b: 50 },
      },
    })
      .jpeg()
      .toBuffer();
    const master = await normalizeWallpaperSource(input);
    const compactCrop = {
      x: (1 - 81 / 256) / 2,
      y: 0,
      width: 81 / 256,
      height: 1,
    };

    expect(() => validateNormalizedCrop(compactCrop, 1920, 1080, 'COMPACT')).toThrow(
      PlayerWallpaperImageError
    );
    const display = await renderWallpaperLayout(master, 'COMPACT', compactCrop, {
      inheritedWideSource: true,
    });
    expect(display.width).toBeGreaterThanOrEqual(540);
    expect(display.height).toBeGreaterThanOrEqual(960);
    expect(display.width / display.height).toBeCloseTo(9 / 16, 2);
  });

  it('rejects animated WebP input', async () => {
    const frames = await Promise.all(
      [
        { r: 10, g: 20, b: 30, alpha: 1 },
        { r: 220, g: 70, b: 120, alpha: 1 },
      ].map((background) =>
        sharp({ create: { width: 800, height: 800, channels: 4, background } })
          .png()
          .toBuffer()
      )
    );
    const animated = await sharp(frames, { join: { animated: true } })
      .webp({ delay: [100, 100], loop: 0, lossless: true })
      .toBuffer();

    await expect(normalizeWallpaperSource(animated)).rejects.toMatchObject({
      code: 'WALLPAPER_ANIMATED_IMAGE',
    });
  });

  it('returns a typed low-resolution error instead of a server failure', async () => {
    const input = await sharp({
      create: {
        width: 640,
        height: 640,
        channels: 3,
        background: { r: 40, g: 30, b: 50 },
      },
    })
      .jpeg()
      .toBuffer();

    await expect(normalizeWallpaperSource(input)).rejects.toMatchObject({
      code: 'WALLPAPER_PIXELS_TOO_SMALL',
      message: '图片分辨率过低，无法生成清晰的游戏桌壁纸。',
    });
  });

  it('rejects crops with the wrong aspect or insufficient pixels', () => {
    expect(() =>
      validateNormalizedCrop({ x: 0, y: 0, width: 1, height: 1 }, 1920, 1080, 'COMPACT')
    ).toThrow('壁纸裁切比例无效');
    expect(() =>
      validateNormalizedCrop({ x: 0, y: 0, width: 1, height: 1 }, 1000, 563, 'WIDE')
    ).toThrow('图片分辨率过低');
  });
});
