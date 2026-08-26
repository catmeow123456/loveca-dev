import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  ActivityCoverImageError,
  normalizeActivityCoverSource,
  renderActivityCoverLayout,
  validateActivityCoverCrop,
} from '../../src/server/services/activity-cover-image-service';

describe('activity cover image service', () => {
  it('normalizes one source and renders the frozen wide and compact WebP slots', async () => {
    const input = await sharp({
      create: {
        width: 2400,
        height: 1350,
        channels: 4,
        background: { r: 130, g: 42, b: 86, alpha: 0.82 },
      },
    })
      .png()
      .toBuffer();
    const master = await normalizeActivityCoverSource(input);
    const [wide, compact] = await Promise.all([
      renderActivityCoverLayout(master, 'WIDE', {
        x: 0,
        y: 0.111_111_111,
        width: 1,
        height: 0.777_777_778,
      }),
      renderActivityCoverLayout(master, 'COMPACT', {
        x: 0.125,
        y: 0,
        width: 0.75,
        height: 1,
      }),
    ]);

    expect(await sharp(master.buffer).metadata()).toMatchObject({ format: 'webp' });
    expect(await sharp(wide.buffer).metadata()).toMatchObject({
      format: 'webp',
      width: 1920,
      height: 840,
    });
    expect(await sharp(compact.buffer).metadata()).toMatchObject({
      format: 'webp',
      width: 960,
      height: 720,
    });
  });

  it('reports aspect and effective-pixel failures separately', () => {
    expect(() =>
      validateActivityCoverCrop({ x: 0, y: 0, width: 1, height: 1 }, 2400, 1350, 'WIDE')
    ).toThrow('裁切比例无效');
    expect(() =>
      validateActivityCoverCrop({ x: 0, y: 0, width: 1, height: 0.4375 }, 1200, 1200, 'WIDE')
    ).toThrow('当前裁切区域像素不足');
  });

  it('rejects animated WebP input', async () => {
    const frames = await Promise.all(
      ['#a33462', '#273f72'].map((background) =>
        sharp({ create: { width: 960, height: 720, channels: 4, background } })
          .png()
          .toBuffer()
      )
    );
    const animated = await sharp(frames, { join: { animated: true } })
      .webp({ loop: 0, delay: [80, 80], lossless: true })
      .toBuffer();

    await expect(normalizeActivityCoverSource(animated)).rejects.toMatchObject({
      name: ActivityCoverImageError.name,
      code: 'ACTIVITY_COVER_ANIMATED_IMAGE',
    });
  });
});
