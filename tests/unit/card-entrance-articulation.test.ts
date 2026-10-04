import { describe, expect, it } from 'vitest';
import {
  entranceArmProgress,
  entranceLayerFrame,
} from '../../client/src/lib/cardEntranceArticulation';

describe('portrait articulation timing', () => {
  it.each(['smoothstep', 'smootherstep'] as const)(
    '%s moves once and holds without reversal or overshoot',
    (easing) => {
      let previous = 0;
      for (let i = -20; i <= 200; i++) {
        const progress = entranceArmProgress(i / 100, 0.2, 1, easing);
        expect(progress).toBeGreaterThanOrEqual(previous);
        expect(progress).toBeLessThanOrEqual(1);
        previous = progress;
      }
      expect(entranceArmProgress(0.2, 0.2, 1, easing)).toBe(0);
      expect(entranceArmProgress(1.2, 0.2, 1, easing)).toBe(1);
    }
  );

  it('lets the torso lead the hand and settles cloth before the portrait fades', () => {
    const motion = {
      start: 0.2,
      duration: 1.08,
      easing: 'smoothstep' as const,
      bodyMotion: { start: 0.04, duration: 1.1, easing: 'smoothstep' as const },
    };
    const early = entranceLayerFrame(0.15, motion, false);
    expect(early.body).toBeGreaterThan(0);
    expect(early.arm).toBe(0);
    expect(early.follow).toBeGreaterThan(0);
    expect(entranceLayerFrame(1.5, motion, false)).toEqual({ arm: 1, body: 1, follow: 0 });
  });

  it('keeps existing profiles synchronized when no torso timing is supplied', () => {
    const motion = { start: 0.24, duration: 0.8 };
    for (const seconds of [0, 0.24, 0.5, 0.8, 1.04, 1.6]) {
      const frame = entranceLayerFrame(seconds, motion, false);
      expect(frame.arm).toBe(entranceArmProgress(seconds, motion.start, motion.duration));
      expect(frame.body).toBe(frame.arm);
    }
  });

  it('reduced motion selects a stable pose at every time without cloth follow', () => {
    const motion = { start: 0.2, duration: 1.08, bodyMotion: { start: 0.04, duration: 1.1 } };
    for (const seconds of [0, 0.3, 0.7, 1.2, 2.74]) {
      expect(entranceLayerFrame(seconds, motion, true)).toEqual({ arm: 1, body: 1, follow: 0 });
    }
  });
});
