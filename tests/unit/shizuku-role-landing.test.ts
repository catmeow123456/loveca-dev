import { describe, expect, it } from 'vitest';
import { OrientationState } from '../../src/shared/types/enums';
import { getShizukuStackFrame, shizukuTiming } from '../../client/src/lib/shizukuRole';

describe('Shizuku image to real under-card handoff', () => {
  const active = { left: 150, top: 250, width: 100, height: 140 };
  const waiting = { left: 130, top: 270, width: 140, height: 100 };

  it.each([
    { member: active, orientation: OrientationState.ACTIVE },
    { member: waiting, orientation: OrientationState.WAITING },
  ])(
    'lands on the measured pile, independent of host orientation: $orientation',
    ({ member, orientation }) => {
      // A deeper pile and different card border dimensions must not use a fixed 8% offset.
      const stacked = { left: 176, top: 285, width: 104, height: 145 };
      expect(getShizukuStackFrame(member, stacked, orientation, shizukuTiming.role)).toMatchObject({
        x: 228,
        y: 357.5,
        width: 104,
        height: 145,
        rotation: 0,
        opacity: 1,
      });
      expect(getShizukuStackFrame(member, stacked, orientation, 1490)).toMatchObject({
        x: 200,
        y: 320,
        width: 100,
        height: 140,
        opacity: 0,
        rotation: orientation === OrientationState.WAITING ? 90 : 0,
      });
    }
  );

  it('hands off while still moving and settles before the unchanged deadline', () => {
    const stacked = { left: 160, top: 264, width: 100, height: 140 };
    const frame = (time: number) =>
      getShizukuStackFrame(active, stacked, OrientationState.ACTIVE, time);
    expect(frame(1589).opacity).toBe(0);
    const overlap = frame(1640);
    expect(overlap.opacity).toBeGreaterThan(0);
    expect(overlap.opacity).toBeLessThan(1);
    expect(overlap.x).toBeGreaterThan(frame(1490).x);
    expect(overlap.x).toBeLessThan(frame(1790).x);
    expect(frame(1690).opacity).toBe(1);
    expect(frame(1790)).toEqual(frame(shizukuTiming.role));
    expect(shizukuTiming.role).toBe(1840);
  });
});
