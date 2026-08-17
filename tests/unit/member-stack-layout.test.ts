import { describe, expect, it } from 'vitest';
import {
  getEnergyBelowCardZIndex,
  getMainMemberCardZIndex,
  getMemberBelowCardZIndex,
} from '../../client/src/lib/memberStackLayout';

describe('member stack layout', () => {
  it('preserves the existing main-member layer for a short stack', () => {
    expect(getMainMemberCardZIndex(0, 0)).toBe(10);
    expect(getMainMemberCardZIndex(0, 5)).toBe(10);
  });

  it.each([
    { energyBelowCount: 0, memberBelowCount: 1 },
    { energyBelowCount: 0, memberBelowCount: 6 },
    { energyBelowCount: 0, memberBelowCount: 7 },
    { energyBelowCount: 2, memberBelowCount: 7 },
    { energyBelowCount: 7, memberBelowCount: 2 },
  ])(
    'keeps the main member above $energyBelowCount energy and $memberBelowCount member cards',
    ({ energyBelowCount, memberBelowCount }) => {
      const mainMemberZIndex = getMainMemberCardZIndex(energyBelowCount, memberBelowCount);

      for (let reverseIndex = 0; reverseIndex < energyBelowCount; reverseIndex += 1) {
        expect(mainMemberZIndex).toBeGreaterThan(getEnergyBelowCardZIndex(reverseIndex));
      }

      for (let reverseIndex = 0; reverseIndex < memberBelowCount; reverseIndex += 1) {
        expect(mainMemberZIndex).toBeGreaterThan(
          getMemberBelowCardZIndex(energyBelowCount, reverseIndex)
        );
      }
    }
  );

  it('covers the former seven-member boundary', () => {
    expect(getMemberBelowCardZIndex(0, 6)).toBe(11);
    expect(getMainMemberCardZIndex(0, 7)).toBe(12);
  });
});
