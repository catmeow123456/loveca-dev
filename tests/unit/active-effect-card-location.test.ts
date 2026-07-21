import { describe, expect, it } from 'vitest';
import {
  formatActiveEffectCardLabelWithLocation,
  getActiveEffectCardLocationLabel,
} from '../../client/src/lib/activeEffectCardLocation';
import { CardType, SlotPosition, ZoneType } from '../../src/shared/types/enums';

describe('active effect card location label', () => {
  it.each([
    [SlotPosition.LEFT, '左'],
    [SlotPosition.CENTER, '中'],
    [SlotPosition.RIGHT, '右'],
  ] as const)('标注主成员槽中的 %s 位置', (slot, expected) => {
    expect(
      getActiveEffectCardLocationLabel({
        cardType: CardType.MEMBER,
        zone: ZoneType.MEMBER_SLOT,
        slot,
        isStageSlotOccupant: true,
      })
    ).toBe(expected);
  });

  it.each([
    [ZoneType.HAND, '手牌'],
    [ZoneType.WAITING_ROOM, '休息'],
  ] as const)('标注成员卡的 %s 区域', (zone, expected) => {
    expect(
      getActiveEffectCardLocationLabel({
        cardType: CardType.MEMBER,
        zone,
        slot: null,
        isStageSlotOccupant: false,
      })
    ).toBe(expected);
  });

  it('不把 memberBelow 或 overlay 误标为主舞台成员', () => {
    expect(
      getActiveEffectCardLocationLabel({
        cardType: CardType.MEMBER,
        zone: ZoneType.MEMBER_SLOT,
        slot: SlotPosition.CENTER,
        isStageSlotOccupant: false,
      })
    ).toBeNull();
  });

  it.each([CardType.LIVE, CardType.ENERGY])('不标注非成员卡 %s', (cardType) => {
    expect(
      getActiveEffectCardLocationLabel({
        cardType,
        zone: ZoneType.HAND,
        slot: null,
        isStageSlotOccupant: false,
      })
    ).toBeNull();
  });

  it.each([null, ZoneType.RESOLUTION_ZONE, ZoneType.INSPECTION_ZONE])(
    '不标注未知或不支持的成员区域 %s',
    (zone) => {
      expect(
        getActiveEffectCardLocationLabel({
          cardType: CardType.MEMBER,
          zone,
          slot: null,
          isStageSlotOccupant: false,
        })
      ).toBeNull();
    }
  );

  it('成员区缺少槽位时不标注', () => {
    expect(
      getActiveEffectCardLocationLabel({
        cardType: CardType.MEMBER,
        zone: ZoneType.MEMBER_SLOT,
        slot: null,
        isStageSlotOccupant: true,
      })
    ).toBeNull();
  });

  it('用一个空格连接简短位置与卡牌标签', () => {
    expect(
      formatActiveEffectCardLabelWithLocation('11 宫下爱 / 宫下爱', {
        cardType: CardType.MEMBER,
        zone: ZoneType.MEMBER_SLOT,
        slot: SlotPosition.LEFT,
        isStageSlotOccupant: true,
      })
    ).toBe('左 11 宫下爱 / 宫下爱');
  });
});
