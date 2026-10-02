import { describe, expect, it } from 'vitest';
import { OrientationState } from '../../src/shared/types/enums';
import {
  getLandingCardGeometry,
  getNeighborImpactHinge,
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

describe('impact-facing card edge', () => {
  it.each([0, 90, -90, 180])(
    'lifts the edge toward the impact at resting rotation %s',
    (rotation) => {
      const radians = (rotation * Math.PI) / 180;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const hinge = getNeighborImpactHinge(dx!, dy!, rotation, 100, 140)!;
        const corners = [
          [-50, -70],
          [-50, 70],
          [50, -70],
          [50, 70],
        ]
          .map(([x, y]) => {
            const screenX = x! * Math.cos(radians) - y! * Math.sin(radians);
            const screenY = x! * Math.sin(radians) + y! * Math.cos(radians);
            // Rodrigues' rotation: positive Z is toward the viewer.
            const z =
              (hinge.axisX * (y! - hinge.pivotY) - hinge.axisY * (x! - hinge.pivotX)) *
              Math.sin(Math.PI / 4);
            return { proximity: screenX * dx! + screenY * dy!, z };
          })
          .sort((a, b) => a.proximity - b.proximity);
        expect(corners[3]!.z).toBeGreaterThan(corners[0]!.z + 30);
        expect(corners.every((corner) => corner.z >= -0.001)).toBe(true);
      }
    }
  );
  it('does not invent a direction for coincident centers', () => {
    expect(getNeighborImpactHinge(0, 0, 90, 100, 140)).toBeNull();
  });
});
