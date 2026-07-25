import { describe, expect, it } from 'vitest';
import { getMemberPlayOptions } from '../../client/src/lib/memberPlayOptions';
import { SlotPosition } from '../../src/shared/types/enums';

describe('member-play-options UI helper', () => {
  it('reads multiple server-projected options for the selected hand object', () => {
    const sourceObjectId = 'obj_source';
    const hint = {
      command: 'BEGIN_SPECIAL_MEMBER_PLAY',
      enabled: true,
      scope: { objectIds: [sourceObjectId] },
      params: {
        memberPlayOptionsByObjectId: {
          [sourceObjectId]: [
            {
              id: 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO',
              label: '特殊登场',
              kind: 'CARD_DEFINED',
              title: '选择特殊登场区域',
              description: '选择一处成员区，并按卡牌指定的方式完成特殊登场。',
              targetSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
              mode: 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO',
            },
            {
              id: 'DOUBLE_RELAY',
              label: '双换手',
              kind: 'DOUBLE_RELAY',
              title: '选择双换手区域',
              description: '依次选择两个成员区。',
              targetSlots: [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT],
              selection: {
                minTargets: 2,
                maxTargets: 2,
                mustIncludeTarget: true,
              },
            },
          ],
        },
      },
    };

    expect(getMemberPlayOptions(hint, sourceObjectId)).toEqual([
      expect.objectContaining({
        id: 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO',
        kind: 'CARD_DEFINED',
        targetSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
      }),
      expect.objectContaining({
        id: 'DOUBLE_RELAY',
        kind: 'DOUBLE_RELAY',
        targetSlots: [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT],
        selection: {
          minTargets: 2,
          maxTargets: 2,
          mustIncludeTarget: true,
        },
      }),
    ]);
    expect(getMemberPlayOptions(hint, 'obj_nearby-rarity')).toEqual([]);
  });

  it('rejects malformed, duplicate, and undersized options without duplicating the server mode registry', () => {
    const sourceObjectId = 'obj_source';
    const hint = {
      command: 'BEGIN_SPECIAL_MEMBER_PLAY',
      enabled: true,
      scope: { objectIds: [sourceObjectId] },
      params: {
        memberPlayOptionsByObjectId: {
          [sourceObjectId]: [
            {
              id: 'DOUBLE_RELAY',
              label: '双换手',
              kind: 'DOUBLE_RELAY',
              title: '选择双换手区域',
              description: '依次选择两个成员区。',
              targetSlots: [SlotPosition.LEFT],
              selection: {
                minTargets: 2,
                maxTargets: 2,
                mustIncludeTarget: true,
              },
            },
            {
              id: 'LL_BP7_001_SPECIAL_PLAY',
              label: '特殊登场',
              kind: 'CARD_DEFINED',
              title: '选择特殊登场区域',
              description: '选择登场区域。',
              targetSlots: [SlotPosition.CENTER],
              mode: 'LL_BP7_001_SPECIAL_PLAY',
            },
            {
              id: 'LL_BP7_001_SPECIAL_PLAY',
              label: '重复选项',
              kind: 'CARD_DEFINED',
              title: '重复',
              description: '不会显示。',
              targetSlots: [SlotPosition.RIGHT],
              mode: 'LL_BP7_001_SPECIAL_PLAY',
            },
            {
              id: 'FUTURE_MODE',
              label: '新增方式',
              kind: 'CARD_DEFINED',
              title: '选择新增登场区域',
              description: '由服务端有限注册表提供。',
              targetSlots: [SlotPosition.LEFT],
              mode: 'FUTURE_MODE',
            },
            {
              id: 'DOUBLE_RELAY',
              label: '非法槽位',
              kind: 'DOUBLE_RELAY',
              title: '非法',
              description: '不会显示。',
              targetSlots: ['UP'],
              selection: {
                minTargets: 1,
                maxTargets: 1,
                mustIncludeTarget: true,
              },
            },
          ],
        },
      },
    };

    expect(getMemberPlayOptions(hint, sourceObjectId)).toEqual([
      expect.objectContaining({
        id: 'LL_BP7_001_SPECIAL_PLAY',
        targetSlots: [SlotPosition.CENTER],
      }),
      expect.objectContaining({
        id: 'FUTURE_MODE',
        kind: 'CARD_DEFINED',
        targetSlots: [SlotPosition.LEFT],
      }),
    ]);
  });

  it('returns no options for a disabled hint or an object outside command scope', () => {
    const hint = {
      command: 'BEGIN_SPECIAL_MEMBER_PLAY',
      enabled: false,
      scope: { objectIds: ['obj_source'] },
      params: {
        memberPlayOptionsByObjectId: {
          obj_source: [],
        },
      },
    };

    expect(getMemberPlayOptions(hint, 'obj_source')).toEqual([]);
    expect(getMemberPlayOptions({ ...hint, enabled: true }, 'obj_other')).toEqual([]);
  });
});
