import { describe, expect, it } from 'vitest';
import { entranceBlinkAmount, entranceBlinkFrame } from '../../client/src/lib/cardEntranceBlink';
import { cardEntranceProfiles } from '../../client/src/lib/cardEntranceProfiles';
import { entranceTimeline } from '../../client/src/lib/cardEntranceTimeline';

const blink = cardEntranceProfiles.find((p) => p.id === 'rurino')!.blink!.faces[0]!;
describe('portrait blink', () => {
  it('closes once, holds briefly and opens more slowly during the clear portrait phase', () => {
    expect(blink.start * 1000).toBeGreaterThan(entranceTimeline.portrait.enter);
    const end = blink.start + blink.close + blink.hold + blink.open;
    expect(end * 1000).toBeLessThan(entranceTimeline.portrait.fadeAt);
    expect(blink.open).toBeGreaterThan(blink.close);
    expect(entranceBlinkAmount(blink.start, blink, false)).toBe(0);
    expect(entranceBlinkAmount(blink.start + blink.close / 2, blink, false)).toBeCloseTo(0.5);
    expect(entranceBlinkAmount(blink.start + blink.close + blink.hold / 2, blink, false)).toBe(1);
    expect(entranceBlinkAmount(end - blink.open / 2, blink, false)).toBeCloseTo(0.5);
    expect(entranceBlinkAmount(end + 0.001, blink, false)).toBe(0);
  });
  it('derives pose from elapsed time: a dropped frame or repeat does not replay the blink', () => {
    expect(entranceBlinkAmount(5, blink, false)).toBe(0);
    expect(entranceBlinkAmount(0.95, blink, false)).toBe(1);
    expect(entranceBlinkAmount(5, blink, false)).toBe(0);
    for (const t of [0, 0.9, 0.95, 1.025, 2]) expect(entranceBlinkAmount(t, blink, true)).toBe(0);
  });
});

describe('group portrait blink', () => {
  it('selects each face independently and restores original eyes between and after blinks', () => {
    const faces = [
      { ...blink, start: 0.72 },
      { ...blink, start: 1.16 },
    ];
    expect(entranceBlinkFrame(0.8, faces, false)?.face).toBe(faces[0]);
    expect(entranceBlinkFrame(1, faces, false)).toBeNull();
    expect(entranceBlinkFrame(1.24, faces, false)?.face).toBe(faces[1]);
    expect(entranceBlinkFrame(2, faces, false)).toBeNull();
    expect(entranceBlinkFrame(0.8, faces, true)).toBeNull();
    expect(entranceBlinkFrame(1.24, faces, true)).toBeNull();
    expect(entranceBlinkFrame(1.24, [], false)).toBeNull();
  });
  it('keeps registered face windows separate and inside the clear portrait phase', () => {
    for (const profile of cardEntranceProfiles) {
      let previousEnd = entranceTimeline.portrait.enter / 1000;
      for (const face of profile.blink?.faces ?? []) {
        expect(face.start).toBeGreaterThanOrEqual(previousEnd);
        previousEnd = face.start + face.close + face.hold + face.open;
        expect(previousEnd * 1000).toBeLessThan(entranceTimeline.portrait.fadeAt);
      }
    }
  });
});
