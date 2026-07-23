import { CardType, GamePhase, SlotPosition, ZoneType } from '@game/shared/types/enums';

export interface DragActionDescriptor {
  readonly label: string;
  readonly detail?: string;
  readonly blocked?: boolean;
}

export type SpecialDragTarget =
  | { kind: 'inspection'; action: 'HAND' | 'WAITING_ROOM' | 'MAIN_DECK_TOP' | 'MAIN_DECK_BOTTOM' }
  | { kind: 'resolution'; action: 'HAND' | 'WAITING_ROOM' | 'MAIN_DECK_TOP' };

const MEMBER_SLOT_LABELS: Record<SlotPosition, string> = {
  [SlotPosition.LEFT]: '左侧',
  [SlotPosition.CENTER]: '中心',
  [SlotPosition.RIGHT]: '右侧',
};

export function getSpecialTargetActionLabel(target: SpecialDragTarget): DragActionDescriptor {
  if (target.kind === 'inspection') {
    switch (target.action) {
      case 'HAND':
        return { label: '加入手牌' };
      case 'WAITING_ROOM':
        return { label: '放入休息室' };
      case 'MAIN_DECK_BOTTOM':
        return { label: '放回卡组底' };
      case 'MAIN_DECK_TOP':
      default:
        return { label: '放回卡组顶' };
    }
  }

  switch (target.action) {
    case 'HAND':
      return { label: '回到手牌' };
    case 'WAITING_ROOM':
      return { label: '放入休息室' };
    case 'MAIN_DECK_TOP':
    default:
      return { label: '放回卡组顶' };
  }
}

export function getDragActionDescriptor({
  fromZone,
  toZone,
  targetSlot,
  targetOccupied,
  cardType,
  currentPhase,
  specialTarget,
}: {
  readonly fromZone: ZoneType;
  readonly toZone?: ZoneType;
  readonly targetSlot?: SlotPosition;
  readonly targetOccupied: boolean;
  readonly cardType: CardType | null;
  readonly currentPhase: GamePhase | null;
  readonly specialTarget?: SpecialDragTarget | null;
}): DragActionDescriptor | null {
  if (specialTarget) {
    return getSpecialTargetActionLabel(specialTarget);
  }

  if (!toZone) {
    return null;
  }

  if (cardType === CardType.ENERGY) {
    if (toZone === ZoneType.HAND) return { label: '不能移入手牌', blocked: true };
    if (toZone === ZoneType.LIVE_ZONE) return { label: '不能放入 Live 区', blocked: true };
    if (toZone === ZoneType.SUCCESS_ZONE) return { label: '不能放入成功区', blocked: true };
    if (toZone === ZoneType.WAITING_ROOM) return { label: '请回能量卡组', blocked: true };
  }

  if (cardType === CardType.LIVE) {
    if (toZone === ZoneType.MEMBER_SLOT) return { label: '不能登场', blocked: true };
    if (toZone === ZoneType.ENERGY_ZONE || toZone === ZoneType.ENERGY_DECK) {
      return { label: '不能放入能量区', blocked: true };
    }
  }

  if (cardType === CardType.MEMBER) {
    if (
      currentPhase === GamePhase.MAIN_PHASE &&
      fromZone === ZoneType.HAND &&
      toZone === ZoneType.LIVE_ZONE
    ) {
      return { label: '不能放入 Live 区', blocked: true };
    }
    if (toZone === ZoneType.ENERGY_ZONE || toZone === ZoneType.ENERGY_DECK) {
      return { label: '不能放入能量区', blocked: true };
    }
  }

  if (toZone === ZoneType.SUCCESS_ZONE && cardType !== CardType.LIVE) {
    return { label: '仅 LIVE 可进成功区', blocked: true };
  }

  if (
    toZone === ZoneType.LIVE_ZONE &&
    cardType !== CardType.LIVE &&
    !(currentPhase === GamePhase.LIVE_SET_PHASE && fromZone === ZoneType.HAND)
  ) {
    return { label: '仅 LIVE 可自由放置', blocked: true };
  }

  switch (toZone) {
    case ZoneType.MEMBER_SLOT:
      if (cardType === CardType.ENERGY) {
        return {
          label: '附着能量',
          detail: targetSlot ? MEMBER_SLOT_LABELS[targetSlot] : undefined,
        };
      }
      if (fromZone === ZoneType.MEMBER_SLOT) {
        return {
          label: '成员换位',
          detail: targetSlot ? MEMBER_SLOT_LABELS[targetSlot] : undefined,
        };
      }
      if (cardType === CardType.MEMBER) {
        return {
          label: targetOccupied ? '在此登场' : '登场',
          detail: targetSlot ? MEMBER_SLOT_LABELS[targetSlot] : undefined,
        };
      }
      return { label: '移入成员区' };
    case ZoneType.HAND:
      return { label: fromZone === ZoneType.HAND ? '整理手牌' : '加入手牌' };
    case ZoneType.WAITING_ROOM:
      return { label: '放入休息室' };
    case ZoneType.MAIN_DECK:
      return { label: '放回卡组顶' };
    case ZoneType.ENERGY_DECK:
      return { label: '回能量卡组' };
    case ZoneType.ENERGY_ZONE:
      return { label: fromZone === ZoneType.ENERGY_DECK ? '放置能量' : '移入能量区' };
    case ZoneType.LIVE_ZONE:
      return {
        label:
          currentPhase === GamePhase.LIVE_SET_PHASE && fromZone === ZoneType.HAND
            ? 'Live 设置'
            : '放入 Live 区',
      };
    case ZoneType.SUCCESS_ZONE:
      return { label: '成功 Live' };
    case ZoneType.INSPECTION_ZONE:
      return { label: '移入检视区' };
    case ZoneType.RESOLUTION_ZONE:
      return { label: '移入解决区' };
    case ZoneType.EXILE_ZONE:
      return { label: '移入除外区' };
    default:
      return null;
  }
}
