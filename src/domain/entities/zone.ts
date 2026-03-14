/**
 * Loveca 区域实体定义
 * 基于 detail_rules.md 第 4 章
 */

import {
  ZoneType,
  ZoneVisibility,
  SlotPosition,
  OrientationState,
  FaceState,
} from '../../shared/types/enums';
import {
  CardInstance,
  CardWithState,
  CardZoneState,
  MemberCardInstance,
  EnergyCardInstance,
  createDefaultCardState,
} from './card';

// ============================================
// 区域引用（用于跨区域操作）
// ============================================

/**
 * 区域引用
 * 用于标识卡牌所在的具体位置
 */
export interface ZoneRef {
  /** 区域类型 */
  readonly zoneType: ZoneType;
  /** 所属玩家 ID（共享区域为 null） */
  readonly playerId: string | null;
  /** 成员区域的槽位位置 */
  readonly slotPosition?: SlotPosition;
}

/**
 * 创建区域引用
 */
export function createZoneRef(
  zoneType: ZoneType,
  playerId: string | null,
  slotPosition?: SlotPosition
): ZoneRef {
  return { zoneType, playerId, slotPosition };
}

// ============================================
// 基础区域接口
// ============================================

/**
 * 区域配置
 * 定义区域的基本属性
 */
export interface ZoneConfig {
  /** 区域类型 */
  readonly zoneType: ZoneType;
  /** 可见性 */
  readonly visibility: ZoneVisibility;
  /** 是否管理顺序 */
  readonly isOrdered: boolean;
  /** 是否追踪卡牌状态（方向/显示面） */
  readonly hasCardState: boolean;
  /** 最大容量（undefined 表示无限） */
  readonly maxCapacity?: number;
}

/**
 * 区域配置映射
 * 参考规则第 4 章各区域定义
 */
export const ZONE_CONFIGS: Record<ZoneType, ZoneConfig> = {
  [ZoneType.HAND]: {
    zoneType: ZoneType.HAND,
    visibility: ZoneVisibility.PRIVATE,
    isOrdered: false,
    hasCardState: false,
  },
  [ZoneType.MAIN_DECK]: {
    zoneType: ZoneType.MAIN_DECK,
    visibility: ZoneVisibility.PRIVATE,
    isOrdered: true, // 参考规则 4.8.2
    hasCardState: false,
  },
  [ZoneType.ENERGY_DECK]: {
    zoneType: ZoneType.ENERGY_DECK,
    visibility: ZoneVisibility.PRIVATE,
    isOrdered: false, // 参考规则 4.9.2
    hasCardState: false,
  },
  [ZoneType.MEMBER_SLOT]: {
    zoneType: ZoneType.MEMBER_SLOT,
    visibility: ZoneVisibility.PUBLIC,
    isOrdered: false,
    hasCardState: true,
    maxCapacity: 1, // 每个槽位最多1张
  },
  [ZoneType.ENERGY_ZONE]: {
    zoneType: ZoneType.ENERGY_ZONE,
    visibility: ZoneVisibility.PUBLIC,
    isOrdered: false,
    hasCardState: true, // 需要追踪活跃/等待状态
  },
  [ZoneType.LIVE_ZONE]: {
    zoneType: ZoneType.LIVE_ZONE,
    visibility: ZoneVisibility.PUBLIC,
    isOrdered: false,
    hasCardState: true, // 可能背面朝上
  },
  [ZoneType.SUCCESS_ZONE]: {
    zoneType: ZoneType.SUCCESS_ZONE,
    visibility: ZoneVisibility.PUBLIC,
    isOrdered: true, // 参考规则 4.10.2
    hasCardState: false,
  },
  [ZoneType.WAITING_ROOM]: {
    zoneType: ZoneType.WAITING_ROOM,
    visibility: ZoneVisibility.PUBLIC,
    isOrdered: false,
    hasCardState: false,
  },
  [ZoneType.EXILE_ZONE]: {
    zoneType: ZoneType.EXILE_ZONE,
    visibility: ZoneVisibility.PUBLIC,
    isOrdered: false,
    hasCardState: true, // 参考规则 4.13.2
  },
  [ZoneType.RESOLUTION_ZONE]: {
    zoneType: ZoneType.RESOLUTION_ZONE,
    visibility: ZoneVisibility.PUBLIC,
    isOrdered: false,
    hasCardState: false,
  },
};

// ============================================
// 区域数据结构
// ============================================

/**
 * 基础区域状态
 * 存储卡牌列表的简单区域
 */
export interface BaseZoneState {
  /** 区域类型 */
  readonly zoneType: ZoneType;
  /** 所属玩家 ID */
  readonly playerId: string;
  /** 卡牌实例 ID 列表（有序区域按顺序存储） */
  readonly cardIds: readonly string[];
}

/**
 * 带状态的区域（能量区、Live区等）
 * 需要追踪每张卡牌的状态
 */
export interface StatefulZoneState extends BaseZoneState {
  /** 卡牌状态映射：instanceId -> CardZoneState */
  readonly cardStates: ReadonlyMap<string, CardZoneState>;
}

/**
 * 成员槽位区域
 * 参考规则 4.5
 */
export interface MemberSlotZoneState {
  /** 区域类型 */
  readonly zoneType: ZoneType.MEMBER_SLOT;
  /** 所属玩家 ID */
  readonly playerId: string;
  /** 三个槽位的卡牌 ID（null 表示空槽） */
  readonly slots: Readonly<Record<SlotPosition, string | null>>;
  /** 卡牌状态映射（仅成员卡持有方向/面状态） */
  readonly cardStates: ReadonlyMap<string, CardZoneState>;
  /**
   * 每个槽位下方的能量卡列表（按叠放顺序，下方在前）
   * 参考规则 4.5.5：成员卡下方可重叠能量卡
   * 这些能量卡不持有方向状态（规则 4.5.5.2）
   */
  readonly energyBelow: Readonly<Record<SlotPosition, readonly string[]>>;
}

/**
 * 解决区域状态（共享区域）
 * 参考规则 4.14
 */
export interface ResolutionZoneState {
  /** 区域类型 */
  readonly zoneType: ZoneType.RESOLUTION_ZONE;
  /** 卡牌实例 ID 列表 */
  readonly cardIds: readonly string[];
}

// ============================================
// 区域操作函数（纯函数，返回新状态）
// ============================================

/**
 * 向基础区域添加卡牌
 * @param zone 当前区域状态
 * @param cardId 要添加的卡牌 ID
 * @param position 插入位置（undefined 表示末尾，用于有序区域）
 */
export function addCardToZone(
  zone: BaseZoneState,
  cardId: string,
  position?: number
): BaseZoneState {
  const newCardIds =
    position !== undefined
      ? [...zone.cardIds.slice(0, position), cardId, ...zone.cardIds.slice(position)]
      : [...zone.cardIds, cardId];

  return {
    ...zone,
    cardIds: newCardIds,
  };
}

/**
 * 从基础区域移除卡牌
 */
export function removeCardFromZone(zone: BaseZoneState, cardId: string): BaseZoneState {
  return {
    ...zone,
    cardIds: zone.cardIds.filter((id) => id !== cardId),
  };
}

/**
 * 向带状态区域添加卡牌
 */
export function addCardToStatefulZone(
  zone: StatefulZoneState,
  cardId: string,
  state?: CardZoneState
): StatefulZoneState {
  const newCardStates = new Map(zone.cardStates);
  newCardStates.set(cardId, state ?? createDefaultCardState());

  return {
    ...zone,
    cardIds: [...zone.cardIds, cardId],
    cardStates: newCardStates,
  };
}

/**
 * 从带状态区域移除卡牌
 */
export function removeCardFromStatefulZone(
  zone: StatefulZoneState,
  cardId: string
): StatefulZoneState {
  const newCardStates = new Map(zone.cardStates);
  newCardStates.delete(cardId);

  return {
    ...zone,
    cardIds: zone.cardIds.filter((id) => id !== cardId),
    cardStates: newCardStates,
  };
}

/**
 * 更新卡牌状态
 */
export function updateCardState(
  zone: StatefulZoneState,
  cardId: string,
  newState: Partial<CardZoneState>
): StatefulZoneState {
  const currentState = zone.cardStates.get(cardId);
  if (!currentState) return zone;

  const newCardStates = new Map(zone.cardStates);
  newCardStates.set(cardId, { ...currentState, ...newState });

  return {
    ...zone,
    cardStates: newCardStates,
  };
}

// ============================================
// 成员槽位操作
// ============================================

/**
 * 创建空的成员槽位区域
 */
export function createEmptyMemberSlotZone(playerId: string): MemberSlotZoneState {
  return {
    zoneType: ZoneType.MEMBER_SLOT,
    playerId,
    slots: {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    },
    cardStates: new Map(),
    energyBelow: {
      [SlotPosition.LEFT]: [],
      [SlotPosition.CENTER]: [],
      [SlotPosition.RIGHT]: [],
    },
  };
}

/**
 * 在槽位放置成员卡
 */
export function placeCardInSlot(
  zone: MemberSlotZoneState,
  position: SlotPosition,
  cardId: string,
  state?: CardZoneState
): MemberSlotZoneState {
  const newCardStates = new Map(zone.cardStates);
  newCardStates.set(cardId, state ?? createDefaultCardState());

  return {
    ...zone,
    slots: {
      ...zone.slots,
      [position]: cardId,
    },
    cardStates: newCardStates,
  };
}

/**
 * 从槽位移除成员卡
 */
export function removeCardFromSlot(
  zone: MemberSlotZoneState,
  position: SlotPosition
): MemberSlotZoneState {
  const cardId = zone.slots[position];
  if (!cardId) return zone;

  const newCardStates = new Map(zone.cardStates);
  newCardStates.delete(cardId);

  return {
    ...zone,
    slots: {
      ...zone.slots,
      [position]: null,
    },
    cardStates: newCardStates,
  };
}

/**
 * 获取槽位中的卡牌 ID
 */
export function getCardInSlot(zone: MemberSlotZoneState, position: SlotPosition): string | null {
  return zone.slots[position];
}

/**
 * 获取所有非空槽位的卡牌 ID
 */
export function getAllMemberCardIds(zone: MemberSlotZoneState): string[] {
  return Object.values(zone.slots).filter((id): id is string => id !== null);
}

/**
 * 检查槽位是否为空
 */
export function isSlotEmpty(zone: MemberSlotZoneState, position: SlotPosition): boolean {
  return zone.slots[position] === null;
}

/**
 * 获取相邻槽位
 * 参考规则 4.5.2.3
 */
export function getAdjacentSlots(position: SlotPosition): SlotPosition[] {
  switch (position) {
    case SlotPosition.LEFT:
      return [SlotPosition.CENTER];
    case SlotPosition.CENTER:
      return [SlotPosition.LEFT, SlotPosition.RIGHT];
    case SlotPosition.RIGHT:
      return [SlotPosition.CENTER];
  }
}

/**
 * 切换成员卡的方向状态（活跃 ↔ 等待）
 * 参考规则 4.3.2
 */
export function toggleMemberOrientation(
  zone: MemberSlotZoneState,
  cardId: string
): MemberSlotZoneState {
  const currentState = zone.cardStates.get(cardId);
  if (!currentState) return zone;

  const newOrientation =
    currentState.orientation === OrientationState.ACTIVE
      ? OrientationState.WAITING
      : OrientationState.ACTIVE;

  const newCardStates = new Map(zone.cardStates);
  newCardStates.set(cardId, { ...currentState, orientation: newOrientation });

  return { ...zone, cardStates: newCardStates };
}

/**
 * 将所有成员卡恢复为活跃状态
 * 参考规则 7.4.1 - 活跃阶段
 */
export function untapAllMembers(zone: MemberSlotZoneState): MemberSlotZoneState {
  const newCardStates = new Map<string, CardZoneState>();
  for (const [cardId, state] of zone.cardStates) {
    newCardStates.set(cardId, { ...state, orientation: OrientationState.ACTIVE });
  }
  return { ...zone, cardStates: newCardStates };
}

/**
 * 向槽位下方添加能量卡
 * 参考规则 4.5.5：能量卡可重叠在成员卡下方
 *
 * @param zone 成员槽位区域
 * @param position 目标槽位
 * @param energyCardId 能量卡实例 ID
 * @returns 更新后的区域状态
 */
export function addEnergyBelowMember(
  zone: MemberSlotZoneState,
  position: SlotPosition,
  energyCardId: string
): MemberSlotZoneState {
  return {
    ...zone,
    energyBelow: {
      ...zone.energyBelow,
      [position]: [...(zone.energyBelow?.[position] ?? []), energyCardId],
    },
  };
}

/**
 * 从槽位下方移除能量卡
 *
 * @param zone 成员槽位区域
 * @param position 槽位
 * @param energyCardId 能量卡实例 ID
 * @returns 更新后的区域状态
 */
export function removeEnergyBelowMember(
  zone: MemberSlotZoneState,
  position: SlotPosition,
  energyCardId: string
): MemberSlotZoneState {
  return {
    ...zone,
    energyBelow: {
      ...zone.energyBelow,
      [position]: (zone.energyBelow?.[position] ?? []).filter((id) => id !== energyCardId),
    },
  };
}

/**
 * 获取某槽位下方的所有能量卡 ID
 *
 * @param zone 成员槽位区域
 * @param position 槽位
 * @returns 能量卡 ID 列表
 */
export function getEnergyBelowMember(
  zone: MemberSlotZoneState,
  position: SlotPosition
): readonly string[] {
  return zone.energyBelow?.[position] ?? [];
}

/**
 * 查找某张能量卡所在的槽位（在 energyBelow 中查找）
 *
 * @param zone 成员槽位区域
 * @param energyCardId 能量卡实例 ID
 * @returns 所在槽位，未找到返回 null
 */
export function findEnergyBelowSlot(
  zone: MemberSlotZoneState,
  energyCardId: string
): SlotPosition | null {
  for (const position of Object.values(SlotPosition)) {
    if ((zone.energyBelow?.[position] ?? []).includes(energyCardId)) {
      return position;
    }
  }
  return null;
}

/**
 * 将成员从一个槽位移到另一个槽位时，同步移动其下方的能量卡
 * 参考规则 4.5.5.3
 *
 * @param zone 成员槽位区域
 * @param fromPosition 来源槽位
 * @param toPosition 目标槽位
 * @returns 更新后的区域状态
 */
export function moveEnergyBelowWithMember(
  zone: MemberSlotZoneState,
  fromPosition: SlotPosition,
  toPosition: SlotPosition
): MemberSlotZoneState {
  const energyIds = zone.energyBelow?.[fromPosition] ?? [];
  return {
    ...zone,
    energyBelow: {
      ...zone.energyBelow,
      [fromPosition]: [],
      // 合并到目标槽位（目标槽位原有的能量卡在下方，移动来的在上方）
      [toPosition]: [...(zone.energyBelow?.[toPosition] ?? []), ...energyIds],
    },
  };
}

/**
 * 清空某槽位下方的所有能量卡（成员离开槽位时，能量卡留在原位等待规则处理）
 * 参考规则 4.5.5.4
 * 注意：此函数只清空 energyBelow 记录，实际能量卡的归属由调用方处理（移入能量卡组）
 *
 * @param zone 成员槽位区域
 * @param position 槽位
 * @returns [更新后的区域状态, 被清空的能量卡 ID 列表]
 */
export function popEnergyBelowMember(
  zone: MemberSlotZoneState,
  position: SlotPosition
): [MemberSlotZoneState, readonly string[]] {
  const energyIds = zone.energyBelow?.[position] ?? [];
  const newZone: MemberSlotZoneState = {
    ...zone,
    energyBelow: {
      ...zone.energyBelow,
      [position]: [],
    },
  };
  return [newZone, energyIds];
}

/**
 * 获取所有槽位下方的所有能量卡 ID（扁平列表）
 */
export function getAllEnergyBelowIds(zone: MemberSlotZoneState): string[] {
  const result: string[] = [];
  for (const position of Object.values(SlotPosition)) {
    result.push(...(zone.energyBelow?.[position] ?? []));
  }
  return result;
}

// ============================================
// 能量区域操作
// ============================================

/**
 * 创建空的能量区域
 */
export function createEmptyEnergyZone(playerId: string): StatefulZoneState {
  return {
    zoneType: ZoneType.ENERGY_ZONE,
    playerId,
    cardIds: [],
    cardStates: new Map(),
  };
}

/**
 * 将能量卡设为等待状态（横置）
 * 参考规则 5.9
 */
export function tapEnergy(zone: StatefulZoneState, cardId: string): StatefulZoneState {
  return updateCardState(zone, cardId, { orientation: OrientationState.WAITING });
}

/**
 * 将所有能量卡恢复为活跃状态
 * 参考规则 7.4.1
 */
export function untapAllEnergy(zone: StatefulZoneState): StatefulZoneState {
  const newCardStates = new Map<string, CardZoneState>();

  for (const [cardId, state] of zone.cardStates) {
    newCardStates.set(cardId, {
      ...state,
      orientation: OrientationState.ACTIVE,
    });
  }

  return {
    ...zone,
    cardStates: newCardStates,
  };
}

/**
 * 获取活跃状态的能量卡数量
 */
export function getActiveEnergyCount(zone: StatefulZoneState): number {
  let count = 0;
  for (const state of zone.cardStates.values()) {
    if (state.orientation === OrientationState.ACTIVE) {
      count++;
    }
  }
  return count;
}

/**
 * 获取活跃状态的能量卡 ID 列表
 */
export function getActiveEnergyIds(zone: StatefulZoneState): string[] {
  const result: string[] = [];
  for (const [cardId, state] of zone.cardStates) {
    if (state.orientation === OrientationState.ACTIVE) {
      result.push(cardId);
    }
  }
  return result;
}

// ============================================
// 卡组操作
// ============================================

/**
 * 创建空的卡组区域
 */
export function createEmptyDeckZone(
  playerId: string,
  zoneType: ZoneType.MAIN_DECK | ZoneType.ENERGY_DECK
): BaseZoneState {
  return {
    zoneType,
    playerId,
    cardIds: [],
  };
}

/**
 * 从卡组顶部抽取卡牌
 * 参考规则 5.6
 */
export function drawFromTop(zone: BaseZoneState): { zone: BaseZoneState; cardId: string | null } {
  if (zone.cardIds.length === 0) {
    return { zone, cardId: null };
  }

  const [topCard, ...rest] = zone.cardIds;
  return {
    zone: { ...zone, cardIds: rest },
    cardId: topCard,
  };
}

/**
 * 查看卡组顶部卡牌（不移除）
 * 参考规则 5.7
 */
export function peekFromTop(zone: BaseZoneState, count: number): string[] {
  return zone.cardIds.slice(0, count);
}

/**
 * 将卡牌放到卡组底部
 */
export function addToBottom(zone: BaseZoneState, cardId: string): BaseZoneState {
  return {
    ...zone,
    cardIds: [...zone.cardIds, cardId],
  };
}

/**
 * 将卡牌放到卡组顶部
 */
export function addToTop(zone: BaseZoneState, cardId: string): BaseZoneState {
  return {
    ...zone,
    cardIds: [cardId, ...zone.cardIds],
  };
}

/**
 * 洗牌
 * 参考规则 5.5
 * 注意：这是一个不纯的函数，使用随机数
 */
export function shuffleZone(zone: BaseZoneState): BaseZoneState {
  const shuffled = [...zone.cardIds];

  // Fisher-Yates 洗牌算法
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return {
    ...zone,
    cardIds: shuffled,
  };
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建空的基础区域
 */
export function createEmptyBaseZone(playerId: string, zoneType: ZoneType): BaseZoneState {
  return {
    zoneType,
    playerId,
    cardIds: [],
  };
}

/**
 * 创建空的带状态区域
 */
export function createEmptyStatefulZone(playerId: string, zoneType: ZoneType): StatefulZoneState {
  return {
    zoneType,
    playerId,
    cardIds: [],
    cardStates: new Map(),
  };
}

/**
 * 创建空的解决区域
 */
export function createEmptyResolutionZone(): ResolutionZoneState {
  return {
    zoneType: ZoneType.RESOLUTION_ZONE,
    cardIds: [],
  };
}

// ============================================
// 查询函数
// ============================================

/**
 * 获取区域卡牌数量
 * 参考规则 4.1.2.2 - 所有玩家均可确认
 */
export function getZoneCardCount(zone: BaseZoneState | MemberSlotZoneState): number {
  if (zone.zoneType === ZoneType.MEMBER_SLOT) {
    const slotZone = zone as MemberSlotZoneState;
    return Object.values(slotZone.slots).filter((id) => id !== null).length;
  }
  return (zone as BaseZoneState).cardIds.length;
}

/**
 * 检查区域是否为空
 */
export function isZoneEmpty(zone: BaseZoneState | MemberSlotZoneState): boolean {
  return getZoneCardCount(zone) === 0;
}

/**
 * 检查卡牌是否在区域中
 */
export function isCardInZone(zone: BaseZoneState, cardId: string): boolean {
  return zone.cardIds.includes(cardId);
}
