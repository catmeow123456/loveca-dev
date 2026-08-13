import { computeWallpaperCrop } from '../../client/src/lib/playerWallpaperCrop';
import { describe, expect, it } from 'vitest';

describe('player wallpaper crop projection', () => {
  it('keeps a 16:9 source intact for the wide layout', () => {
    expect(computeWallpaperCrop(1920, 1080, 'WIDE', { x: 0.2, y: 0.8 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it('maps horizontal focus into a compact crop without reverting to center', () => {
    const left = computeWallpaperCrop(1920, 1080, 'COMPACT', { x: 0, y: 0.5 });
    const right = computeWallpaperCrop(1920, 1080, 'COMPACT', { x: 1, y: 0.5 });

    expect(left.x).toBe(0);
    expect(right.x).toBeCloseTo(1 - right.width, 8);
    expect(right.width / right.height).toBeCloseTo(81 / 256, 8);
  });

  it('maps vertical focus for a tall source into the wide crop', () => {
    const top = computeWallpaperCrop(1080, 1920, 'WIDE', { x: 0.5, y: 0 });
    const bottom = computeWallpaperCrop(1080, 1920, 'WIDE', { x: 0.5, y: 1 });

    expect(top.y).toBe(0);
    expect(bottom.y).toBeCloseTo(1 - bottom.height, 8);
    expect((top.width * 1080) / (top.height * 1920)).toBeCloseTo(16 / 9, 8);
  });
});
