import { describe, expect, it } from 'vitest';
import { getDragActionDescriptor } from '../../client/src/lib/battleDragAction';
import { CardType, GamePhase, SlotPosition, ZoneType } from '../../src/shared/types/enums';

describe('getDragActionDescriptor', () => {
  it('labels blocked energy and LIVE drops before command dispatch', () => {
    expect(
      getDragActionDescriptor({
        fromZone: ZoneType.ENERGY_ZONE,
        toZone: ZoneType.HAND,
        targetOccupied: false,
        cardType: CardType.ENERGY,
        currentPhase: GamePhase.MAIN_PHASE,
      })
    ).toEqual({ label: '不能移入手牌', blocked: true });

    expect(
      getDragActionDescriptor({
        fromZone: ZoneType.LIVE_ZONE,
        toZone: ZoneType.MEMBER_SLOT,
        targetSlot: SlotPosition.CENTER,
        targetOccupied: false,
        cardType: CardType.LIVE,
        currentPhase: GamePhase.MAIN_PHASE,
      })
    ).toEqual({ label: '不能登场', blocked: true });
  });

  it('distinguishes member play, occupied-slot play, and position movement', () => {
    expect(
      getDragActionDescriptor({
        fromZone: ZoneType.HAND,
        toZone: ZoneType.MEMBER_SLOT,
        targetSlot: SlotPosition.LEFT,
        targetOccupied: false,
        cardType: CardType.MEMBER,
        currentPhase: GamePhase.MAIN_PHASE,
      })
    ).toEqual({ label: '登场', detail: '左侧' });

    expect(
      getDragActionDescriptor({
        fromZone: ZoneType.HAND,
        toZone: ZoneType.MEMBER_SLOT,
        targetSlot: SlotPosition.RIGHT,
        targetOccupied: true,
        cardType: CardType.MEMBER,
        currentPhase: GamePhase.MAIN_PHASE,
      })
    ).toEqual({ label: '在此登场', detail: '右侧' });

    expect(
      getDragActionDescriptor({
        fromZone: ZoneType.MEMBER_SLOT,
        toZone: ZoneType.MEMBER_SLOT,
        targetSlot: SlotPosition.CENTER,
        targetOccupied: false,
        cardType: CardType.MEMBER,
        currentPhase: GamePhase.MAIN_PHASE,
      })
    ).toEqual({ label: '成员换位', detail: '中心' });
  });

  it('allows face-down hand placement to the LIVE zone only during LIVE set', () => {
    expect(
      getDragActionDescriptor({
        fromZone: ZoneType.HAND,
        toZone: ZoneType.LIVE_ZONE,
        targetOccupied: false,
        cardType: CardType.MEMBER,
        currentPhase: GamePhase.MAIN_PHASE,
      })
    ).toEqual({ label: '不能放入 Live 区', blocked: true });

    expect(
      getDragActionDescriptor({
        fromZone: ZoneType.HAND,
        toZone: ZoneType.LIVE_ZONE,
        targetOccupied: false,
        cardType: CardType.MEMBER,
        currentPhase: GamePhase.LIVE_SET_PHASE,
      })
    ).toEqual({ label: 'Live 设置' });
  });

  it('labels special inspection and resolution targets', () => {
    expect(
      getDragActionDescriptor({
        fromZone: ZoneType.INSPECTION_ZONE,
        targetOccupied: false,
        cardType: CardType.MEMBER,
        currentPhase: GamePhase.MAIN_PHASE,
        specialTarget: { kind: 'inspection', action: 'MAIN_DECK_BOTTOM' },
      })
    ).toEqual({ label: '放回卡组底' });

    expect(
      getDragActionDescriptor({
        fromZone: ZoneType.RESOLUTION_ZONE,
        targetOccupied: false,
        cardType: CardType.LIVE,
        currentPhase: GamePhase.PERFORMANCE_PHASE,
        specialTarget: { kind: 'resolution', action: 'HAND' },
      })
    ).toEqual({ label: '回到手牌' });
  });
});
