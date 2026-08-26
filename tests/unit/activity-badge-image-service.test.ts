import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  ActivityBadgeImageError,
  normalizeActivityBadgeImage,
} from '../../src/server/services/activity-badge-image-service';

describe('activity badge image service', () => {
  it('normalizes a transparent badge to a bounded static WebP', async () => {
    const input = await sharp({
      create: {
        width: 640,
        height: 512,
        channels: 4,
        background: { r: 204, g: 62, b: 132, alpha: 0.72 },
      },
    })
      .png()
      .toBuffer();

    const result = await normalizeActivityBadgeImage(input);

    expect(await sharp(result.buffer).metadata()).toMatchObject({
      format: 'webp',
      width: 512,
      height: 410,
      hasAlpha: true,
    });
  });

  it('rejects badge artwork smaller than the shelf-quality floor', async () => {
    const input = await sharp({
      create: { width: 127, height: 127, channels: 4, background: '#cc3e84' },
    })
      .png()
      .toBuffer();

    await expect(normalizeActivityBadgeImage(input)).rejects.toMatchObject({
      name: ActivityBadgeImageError.name,
      code: 'ACTIVITY_BADGE_PIXELS_TOO_SMALL',
    });
  });
});
