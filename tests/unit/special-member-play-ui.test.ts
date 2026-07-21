import { describe, expect, it } from 'vitest';
import {
  LL_BP7_001_SPECIAL_PLAY_UI_CARD_CODE,
  getSpecialMemberPlayTargetSlots,
} from '../../client/src/lib/specialMemberPlay';
import { SlotPosition } from '../../src/shared/types/enums';

describe('special-member-play UI helper', () => {
  it('keeps the entry exact and reads only server-projected legal slots', () => {
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

    expect(LL_BP7_001_SPECIAL_PLAY_UI_CARD_CODE).toBe('LL-bp7-001-R+');
    expect(getSpecialMemberPlayTargetSlots(hint, sourceObjectId)).toEqual([
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
    ]);
    expect(getSpecialMemberPlayTargetSlots(hint, 'obj_nearby-rarity')).toEqual([]);
  });
});
