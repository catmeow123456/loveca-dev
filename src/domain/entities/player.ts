/**
 * Loveca 玩家状态实体定义
 * 基于 detail_rules.md 第 3 章及各区域相关规则
 */

import { ZoneType, SlotPosition } from '../../shared/types/enums';
import { CardInstance, MemberCardInstance } from './card';
import {
  BaseZoneState,
  StatefulZoneState,
  MemberSlotZoneState,
  createEmptyBaseZone,
  createEmptyStatefulZone,
  createEmptyMemberSlotZone,
  createEmptyEnergyZone,
  getActiveEnergyCount,
  getAllMemberCardIds,
  getZoneCardCount,
} from './zone';

// ============================================
// 玩家状态定义
// ============================================

/**
 * 玩家状态
 * 包含玩家的所有区域和状态信息
 */
export interface PlayerState {
  /** 玩家唯一 ID */
  readonly id: string;

  /** 玩家显示名称 */
  readonly name: string;

  /**
   * 是否为先攻玩家
   * 参考规则 7.1.1
   */
  readonly isFirstPlayer: boolean;

  // ---- 区域状态 ----

  /**
   * 手牌
   * 参考规则 4.11
   */
  readonly hand: BaseZoneState;

  /**
   * 主卡组放置区
   * 参考规则 4.8
   */
  readonly mainDeck: BaseZoneState;

  /**
   * 能量卡组放置区
   * 参考规则 4.9
   */
  readonly energyDeck: BaseZoneState;

  /**
   * 成员区域（舞台）
   * 参考规则 4.5
   */
  readonly memberSlots: MemberSlotZoneState;

  /**
   * 能量放置区
   * 参考规则 4.7
   */
  readonly energyZone: StatefulZoneState;

  /**
   * Live 卡放置区
   * 参考规则 4.6
   */
  readonly liveZone: StatefulZoneState;

  /**
   * 成功 Live 卡放置区
   * 参考规则 4.10
   */
  readonly successZone: BaseZoneState;

  /**
   * 休息室（控备室）
   * 参考规则 4.12
   */
  readonly waitingRoom: BaseZoneState;

  /**
   * 除外区域
   * 参考规则 4.13
   */
  readonly exileZone: StatefulZoneState;

  // ---- 临时状态标记 ----

  /**
   * 本回合已从非舞台区域移动到舞台区域的卡牌 ID 列表
   * 用于规则 9.6.2.1.2.1 检查
   */
  readonly movedToStageThisTurn: readonly string[];

  /**
   * 待命中的自动能力 ID 列表
   * 参考规则 9.7.2
   */
  readonly pendingAutoAbilities: readonly string[];
}

// ============================================
// 玩家状态工厂函数
// ============================================

/**
 * 创建初始玩家状态
 */
export function createPlayerState(
  id: string,
  name: string,
  isFirstPlayer: boolean = false
): PlayerState {
  return {
    id,
    name,
    isFirstPlayer,

    // 初始化所有区域为空
    hand: createEmptyBaseZone(id, ZoneType.HAND),
    mainDeck: createEmptyBaseZone(id, ZoneType.MAIN_DECK),
    energyDeck: createEmptyBaseZone(id, ZoneType.ENERGY_DECK),
    memberSlots: createEmptyMemberSlotZone(id),
    energyZone: createEmptyEnergyZone(id),
    liveZone: createEmptyStatefulZone(id, ZoneType.LIVE_ZONE),
    successZone: createEmptyBaseZone(id, ZoneType.SUCCESS_ZONE),
    waitingRoom: createEmptyBaseZone(id, ZoneType.WAITING_ROOM),
    exileZone: createEmptyStatefulZone(id, ZoneType.EXILE_ZONE),

    // 初始化临时状态
    movedToStageThisTurn: [],
    pendingAutoAbilities: [],
  };
}

// ============================================
// 玩家状态查询函数
// ============================================

/**
 * 获取手牌数量
 */
export function getHandCount(player: PlayerState): number {
  return player.hand.cardIds.length;
}

/**
 * 获取主卡组剩余数量
 */
export function getMainDeckCount(player: PlayerState): number {
  return player.mainDeck.cardIds.length;
}

/**
 * 获取能量卡组剩余数量
 */
export function getEnergyDeckCount(player: PlayerState): number {
  return player.energyDeck.cardIds.length;
}

/**
 * 获取成功 Live 卡数量
 */
export function getSuccessLiveCount(player: PlayerState): number {
  return player.successZone.cardIds.length;
}

/**
 * 检查玩家是否已达成胜利条件
 * 参考规则 1.2.1.1 - 成功 Live 卡达到 3 张
 */
export function hasReachedVictoryCondition(player: PlayerState): boolean {
  return getSuccessLiveCount(player) >= 3;
}

/**
 * 获取可用能量数量（活跃状态的能量卡）
 */
export function getAvailableEnergyCount(player: PlayerState): number {
  return getActiveEnergyCount(player.energyZone);
}

/**
 * 获取舞台上的成员卡数量
 */
export function getMemberCount(player: PlayerState): number {
  return getAllMemberCardIds(player.memberSlots).length;
}

/**
 * 获取舞台上所有成员卡的 ID
 */
export function getAllMemberIds(player: PlayerState): string[] {
  return getAllMemberCardIds(player.memberSlots);
}

/**
 * 检查玩家是否可以支付指定费用
 */
export function canPayCost(player: PlayerState, cost: number): boolean {
  return getAvailableEnergyCount(player) >= cost;
}

/**
 * 获取休息室卡牌数量
 */
export function getWaitingRoomCount(player: PlayerState): number {
  return player.waitingRoom.cardIds.length;
}

/**
 * 检查是否需要刷新
 * 参考规则 10.2.2
 */
export function needsRefresh(player: PlayerState): boolean {
  return player.mainDeck.cardIds.length === 0 && player.waitingRoom.cardIds.length > 0;
}

// ============================================
// 玩家状态更新函数（纯函数）
// ============================================

/**
 * 更新玩家的特定区域
 */
export function updatePlayerZone<K extends keyof PlayerState>(
  player: PlayerState,
  zoneKey: K,
  zone: PlayerState[K]
): PlayerState {
  return {
    ...player,
    [zoneKey]: zone,
  };
}

/**
 * 设置先攻/后攻状态
 */
export function setFirstPlayer(player: PlayerState, isFirst: boolean): PlayerState {
  return {
    ...player,
    isFirstPlayer: isFirst,
  };
}

/**
 * 记录卡牌本回合移动到舞台
 */
export function recordMoveToStage(player: PlayerState, cardId: string): PlayerState {
  return {
    ...player,
    movedToStageThisTurn: [...player.movedToStageThisTurn, cardId],
  };
}

/**
 * 清除本回合移动记录（回合结束时调用）
 */
export function clearTurnMoveRecords(player: PlayerState): PlayerState {
  return {
    ...player,
    movedToStageThisTurn: [],
  };
}

/**
 * 添加待命自动能力
 */
export function addPendingAutoAbility(player: PlayerState, abilityId: string): PlayerState {
  return {
    ...player,
    pendingAutoAbilities: [...player.pendingAutoAbilities, abilityId],
  };
}

/**
 * 移除待命自动能力
 */
export function removePendingAutoAbility(player: PlayerState, abilityId: string): PlayerState {
  return {
    ...player,
    pendingAutoAbilities: player.pendingAutoAbilities.filter((id) => id !== abilityId),
  };
}

/**
 * 清除所有待命自动能力
 */
export function clearPendingAutoAbilities(player: PlayerState): PlayerState {
  return {
    ...player,
    pendingAutoAbilities: [],
  };
}

/**
 * 检查卡牌本回合是否已移动到舞台
 * 用于规则 9.6.2.1.2.1
 */
export function hasMovedToStageThisTurn(player: PlayerState, cardId: string): boolean {
  return player.movedToStageThisTurn.includes(cardId);
}

// ============================================
// 玩家区域批量操作
// ============================================

/**
 * 获取玩家所有区域的卡牌总数
 */
export function getTotalCardCount(player: PlayerState): number {
  return (
    player.hand.cardIds.length +
    player.mainDeck.cardIds.length +
    player.energyDeck.cardIds.length +
    getAllMemberCardIds(player.memberSlots).length +
    player.energyZone.cardIds.length +
    player.liveZone.cardIds.length +
    player.successZone.cardIds.length +
    player.waitingRoom.cardIds.length +
    player.exileZone.cardIds.length
  );
}

/**
 * 查找卡牌所在区域
 */
export function findCardZone(player: PlayerState, cardId: string): ZoneType | null {
  // 检查手牌
  if (player.hand.cardIds.includes(cardId)) {
    return ZoneType.HAND;
  }

  // 检查主卡组
  if (player.mainDeck.cardIds.includes(cardId)) {
    return ZoneType.MAIN_DECK;
  }

  // 检查能量卡组
  if (player.energyDeck.cardIds.includes(cardId)) {
    return ZoneType.ENERGY_DECK;
  }

  // 检查成员区域
  const memberIds = getAllMemberCardIds(player.memberSlots);
  if (memberIds.includes(cardId)) {
    return ZoneType.MEMBER_SLOT;
  }

  // 检查能量区
  if (player.energyZone.cardIds.includes(cardId)) {
    return ZoneType.ENERGY_ZONE;
  }

  // 检查 Live 区
  if (player.liveZone.cardIds.includes(cardId)) {
    return ZoneType.LIVE_ZONE;
  }

  // 检查成功 Live 区
  if (player.successZone.cardIds.includes(cardId)) {
    return ZoneType.SUCCESS_ZONE;
  }

  // 检查休息室
  if (player.waitingRoom.cardIds.includes(cardId)) {
    return ZoneType.WAITING_ROOM;
  }

  // 检查除外区
  if (player.exileZone.cardIds.includes(cardId)) {
    return ZoneType.EXILE_ZONE;
  }

  return null;
}

/**
 * 查找成员卡所在槽位
 */
export function findMemberSlot(player: PlayerState, cardId: string): SlotPosition | null {
  const { slots } = player.memberSlots;

  if (slots[SlotPosition.LEFT] === cardId) return SlotPosition.LEFT;
  if (slots[SlotPosition.CENTER] === cardId) return SlotPosition.CENTER;
  if (slots[SlotPosition.RIGHT] === cardId) return SlotPosition.RIGHT;

  return null;
}

// ============================================
// 玩家信息快照（用于客户端展示）
// ============================================

/**
 * 玩家公开信息
 * 对对手可见的信息
 */
export interface PlayerPublicInfo {
  readonly id: string;
  readonly name: string;
  readonly isFirstPlayer: boolean;

  // 区域数量信息
  readonly handCount: number;
  readonly mainDeckCount: number;
  readonly energyDeckCount: number;
  readonly memberCount: number;
  readonly energyCount: number;
  readonly activeEnergyCount: number;
  readonly liveZoneCount: number;
  readonly successLiveCount: number;
  readonly waitingRoomCount: number;
  readonly exileZoneCount: number;

  // 公开区域的卡牌 ID
  readonly memberSlots: Readonly<Record<SlotPosition, string | null>>;
  readonly energyCardIds: readonly string[];
  readonly successZoneCardIds: readonly string[];
  readonly waitingRoomCardIds: readonly string[];
}

/**
 * 生成玩家公开信息
 */
export function getPlayerPublicInfo(player: PlayerState): PlayerPublicInfo {
  return {
    id: player.id,
    name: player.name,
    isFirstPlayer: player.isFirstPlayer,

    handCount: player.hand.cardIds.length,
    mainDeckCount: player.mainDeck.cardIds.length,
    energyDeckCount: player.energyDeck.cardIds.length,
    memberCount: getAllMemberCardIds(player.memberSlots).length,
    energyCount: player.energyZone.cardIds.length,
    activeEnergyCount: getActiveEnergyCount(player.energyZone),
    liveZoneCount: player.liveZone.cardIds.length,
    successLiveCount: player.successZone.cardIds.length,
    waitingRoomCount: player.waitingRoom.cardIds.length,
    exileZoneCount: player.exileZone.cardIds.length,

    memberSlots: player.memberSlots.slots,
    energyCardIds: player.energyZone.cardIds,
    successZoneCardIds: player.successZone.cardIds,
    waitingRoomCardIds: player.waitingRoom.cardIds,
  };
}

/**
 * 玩家私有信息
 * 仅自己可见的信息（包含手牌等）
 */
export interface PlayerPrivateInfo extends PlayerPublicInfo {
  /** 手牌卡牌 ID */
  readonly handCardIds: readonly string[];
}

/**
 * 生成玩家私有信息
 */
export function getPlayerPrivateInfo(player: PlayerState): PlayerPrivateInfo {
  return {
    ...getPlayerPublicInfo(player),
    handCardIds: player.hand.cardIds,
  };
}
