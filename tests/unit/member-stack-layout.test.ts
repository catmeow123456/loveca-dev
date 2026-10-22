import { describe, expect, it } from 'vitest';
import {
  getEnergyBelowCardZIndex,
  getMainMemberCardZIndex,
  getMemberBelowCardZIndex,
} from '../../client/src/lib/memberStackLayout';

describe('member stack layout', () => {
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
});
