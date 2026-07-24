import { describe, expect, it } from 'vitest';
import {
  getSpecialMemberPlayTargetSlots,
  isLlBp7001SpecialPlayCardCode,
  LL_BP7_001_SPECIAL_PLAY_UI_BASE_CARD_CODE,
} from '../../client/src/lib/specialMemberPlay';
import { SlotPosition } from '../../src/shared/types/enums';

describe('special-member-play UI helper', () => {
  it('shares the entry across the base card family and reads only server-projected legal slots', () => {
    const sourceObjectId = 'obj_source';
    const hint = {
      command: 'BEGIN_SPECIAL_MEMBER_PLAY',
      enabled: true,
      scope: { objectIds: [sourceObjectId] },
      params: {
        targetSlotsByObjectId: {
          [sourceObjectId]: [SlotPosition.LEFT, SlotPosition.RIGHT],
        },
      },
    };

    expect(LL_BP7_001_SPECIAL_PLAY_UI_BASE_CARD_CODE).toBe('LL-bp7-001');
    expect(isLlBp7001SpecialPlayCardCode('LL-bp7-001-R+')).toBe(true);
    expect(isLlBp7001SpecialPlayCardCode('LL-bp7-001-P')).toBe(true);
    expect(isLlBp7001SpecialPlayCardCode('LL-bp7-002-R+')).toBe(false);
    expect(getSpecialMemberPlayTargetSlots(hint, sourceObjectId)).toEqual([
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
    ]);
    expect(getSpecialMemberPlayTargetSlots(hint, 'obj_nearby-rarity')).toEqual([]);
  });
});
