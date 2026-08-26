import { describe, expect, it } from 'vitest';
import { computeActivityCoverCrop, inferActivityCoverZoom } from './activityCoverCrop';

describe('activity cover crop projection', () => {
  it('derives independent 16:7 and 4:3 crops from one landscape source', () => {
    expect(computeActivityCoverCrop(2400, 1350, 'WIDE', { x: 0.5, y: 0.5 })).toEqual({
      x: 0,
      y: expect.closeTo(1 / 9),
      width: 1,
      height: expect.closeTo(7 / 9),
    });
    expect(computeActivityCoverCrop(2400, 1350, 'COMPACT', { x: 0.5, y: 0.5 })).toEqual({
      x: 0.125,
      y: 0,
      width: 0.75,
      height: 1,
    });
  });

  it('keeps a zoomed crop inside the source while centering the chosen subject', () => {
    const crop = computeActivityCoverCrop(2400, 1350, 'WIDE', { x: 0.95, y: 0.2 }, 1.5);

    expect(crop.x + crop.width).toBeCloseTo(1);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1);
    expect(inferActivityCoverZoom(2400, 1350, 'WIDE', crop)).toBeCloseTo(1.5);
  });
});
