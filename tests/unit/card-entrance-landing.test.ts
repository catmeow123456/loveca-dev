import { describe, expect, it } from 'vitest';
import { OrientationState } from '../../src/shared/types/enums';
import {
  getLandingCardGeometry,
  sameEntranceTarget,
  type EntranceStageTarget,
} from '../../client/src/lib/cardEntranceLanding';

describe('card entrance landing', () => {
  it('ends at the exact active card bounds', () => {
    expect(
      getLandingCardGeometry(
        { left: 150, top: 250, width: 100, height: 140 },
        OrientationState.ACTIVE
      )
    ).toEqual({ x: 200, y: 320, width: 100, height: 140, rotation: 0 });
  });
  it('restores portrait dimensions before rotating into waiting bounds', () => {
    expect(
      getLandingCardGeometry(
        { left: 130, top: 270, width: 140, height: 100 },
        OrientationState.WAITING
      )
    ).toEqual({ x: 200, y: 320, width: 100, height: 140, rotation: 90 });
  });
  it('invalidates a landing when the member leaves, changes slot, orientation or identity', () => {
    const target: EntranceStageTarget = {
      objectId: 'obj_k',
      cardCode: 'PL!N-bp7-006-SEC',
      locationKey: 'FIRST:CENTER',
      orientation: OrientationState.ACTIVE,
    };
    expect(sameEntranceTarget(target, { ...target })).toBe(true);
    for (const next of [
      null,
      { ...target, locationKey: 'FIRST:LEFT' },
      { ...target, objectId: 'new' },
      { ...target, cardCode: 'OTHER' },
      { ...target, orientation: OrientationState.WAITING },
    ]) {
      expect(sameEntranceTarget(target, next)).toBe(false);
    }
  });
});
