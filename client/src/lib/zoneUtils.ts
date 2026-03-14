/**
 * 区域 ID 解析工具
 *
 * 用于前端拖拽系统中区域 ID 和 ZoneType 之间的转换
 */

import { ZoneType, SlotPosition } from '@game/shared/types/enums';
import type { GameState } from '@game/domain/entities/game';
import type { PlayerState } from '@game/domain/entities/player';

// ============================================
// 类型定义
// ============================================

/**
 * 解析后的区域信息
 */
export interface ParsedZoneId {
  zoneType: ZoneType;
  slotPosition?: SlotPosition;
}

/**
 * 区域 ID 到 ZoneType 的映射表
 */
const ZONE_ID_MAP: Record<string, ZoneType> = {
  'live-zone': ZoneType.LIVE_ZONE,
  'energy-zone': ZoneType.ENERGY_ZONE,
  'main-deck': ZoneType.MAIN_DECK,
  'energy-deck': ZoneType.ENERGY_DECK,
  'success-zone': ZoneType.SUCCESS_ZONE,
  'hand': ZoneType.HAND,
  'waiting-room': ZoneType.WAITING_ROOM,
  'resolution-zone': ZoneType.RESOLUTION_ZONE,
};

/**
 * ZoneType 到区域 ID 的反向映射表
 */
const ZONE_TYPE_TO_ID: Partial<Record<ZoneType, string>> = {
  [ZoneType.LIVE_ZONE]: 'live-zone',
  [ZoneType.ENERGY_ZONE]: 'energy-zone',
  [ZoneType.MAIN_DECK]: 'main-deck',
  [ZoneType.ENERGY_DECK]: 'energy-deck',
  [ZoneType.SUCCESS_ZONE]: 'success-zone',
  [ZoneType.HAND]: 'hand',
  [ZoneType.WAITING_ROOM]: 'waiting-room',
  [ZoneType.RESOLUTION_ZONE]: 'resolution-zone',
};

// ============================================
// 核心解析函数
// ============================================

/**
 * 解析区域 ID 到 ZoneType
 *
 * @param zoneId 区域 ID（如 "slot-LEFT", "live-zone", "hand" 等）
 * @returns 解析结果，包含 zoneType 和可选的 slotPosition；如果无法解析则返回 null
 *
 * @example
 * parseZoneId('slot-LEFT')    // { zoneType: MEMBER_SLOT, slotPosition: LEFT }
 * parseZoneId('live-zone')    // { zoneType: LIVE_ZONE }
 * parseZoneId('hand')         // { zoneType: HAND }
 * parseZoneId('unknown')      // null
 */
export function parseZoneId(zoneId: string): ParsedZoneId | null {
  // 处理成员槽位: slot-LEFT, slot-CENTER, slot-RIGHT
  if (zoneId.startsWith('slot-')) {
    const slotName = zoneId.replace('slot-', '') as keyof typeof SlotPosition;
    const slot = SlotPosition[slotName];
    if (slot) {
      return { zoneType: ZoneType.MEMBER_SLOT, slotPosition: slot };
    }
    return null;
  }

  // 查找映射表
  const zoneType = ZONE_ID_MAP[zoneId];
  if (zoneType) {
    return { zoneType };
  }

  return null;
}

/**
 * 从 ZoneType 生成区域 ID
 *
 * @param zoneType 区域类型
 * @param slotPosition 槽位位置（仅用于 MEMBER_SLOT）
 * @returns 区域 ID 字符串
 *
 * @example
 * createZoneId(ZoneType.MEMBER_SLOT, SlotPosition.LEFT)  // 'slot-LEFT'
 * createZoneId(ZoneType.LIVE_ZONE)                       // 'live-zone'
 * createZoneId(ZoneType.HAND)                            // 'hand'
 */
export function createZoneId(zoneType: ZoneType, slotPosition?: SlotPosition): string {
  if (zoneType === ZoneType.MEMBER_SLOT && slotPosition) {
    return `slot-${slotPosition}`;
  }
  return ZONE_TYPE_TO_ID[zoneType] || '';
}

// ============================================
// 卡牌位置查找函数
// ============================================

/**
 * 在玩家的各区域中查找卡牌所在的区域类型
 *
 * @param cardId 卡牌实例 ID
 * @param player 玩家状态
 * @returns 卡牌所在的区域类型，如果找不到则返回 null
 */
function findCardInPlayerZones(cardId: string, player: PlayerState): ZoneType | null {
  // 手牌
  if (player.hand.cardIds.includes(cardId)) {
    return ZoneType.HAND;
  }

  // 成员槽位（包括成员卡和其下方的能量卡，规则 4.5.5）
  for (const slot of Object.values(SlotPosition)) {
    if (player.memberSlots.slots[slot] === cardId) {
      return ZoneType.MEMBER_SLOT;
    }
    // 检查成员下方的能量卡（energyBelow）
    if (player.memberSlots.energyBelow?.[slot]?.includes(cardId)) {
      return ZoneType.MEMBER_SLOT;
    }
  }

  // Live 区
  if (player.liveZone.cardIds.includes(cardId)) {
    return ZoneType.LIVE_ZONE;
  }

  // 能量区
  if (player.energyZone.cardIds.includes(cardId)) {
    return ZoneType.ENERGY_ZONE;
  }

  // 成功区
  if (player.successZone.cardIds.includes(cardId)) {
    return ZoneType.SUCCESS_ZONE;
  }

  // 休息室
  if (player.waitingRoom.cardIds.includes(cardId)) {
    return ZoneType.WAITING_ROOM;
  }

  // 主卡组
  if (player.mainDeck.cardIds.includes(cardId)) {
    return ZoneType.MAIN_DECK;
  }

  // 能量卡组
  if (player.energyDeck.cardIds.includes(cardId)) {
    return ZoneType.ENERGY_DECK;
  }

  // 除外区
  if (player.exileZone.cardIds.includes(cardId)) {
    return ZoneType.EXILE_ZONE;
  }

  return null;
}

/**
 * 在游戏状态中查找卡牌所在的区域类型
 *
 * @param cardId 卡牌实例 ID
 * @param gameState 游戏状态
 * @param playerId 优先搜索的玩家 ID（通常是当前视角玩家）
 * @returns 卡牌所在的区域类型，如果找不到则返回 null
 *
 * @example
 * const fromZone = findCardZone('card-123', gameState, viewingPlayerId);
 * if (fromZone) {
 *   manualMoveCard('card-123', fromZone, toZone);
 * }
 */
export function findCardZone(
  cardId: string,
  gameState: GameState,
  playerId?: string
): ZoneType | null {
  // 解决区域（共享）
  if (gameState.resolutionZone.cardIds.includes(cardId)) {
    return ZoneType.RESOLUTION_ZONE;
  }

  // 优先搜索指定玩家
  if (playerId) {
    const player = gameState.players.find((p) => p.id === playerId);
    if (player) {
      const zone = findCardInPlayerZones(cardId, player);
      if (zone) return zone;
    }
  }

  // 搜索所有玩家
  for (const player of gameState.players) {
    if (player.id === playerId) continue; // 已经搜索过
    const zone = findCardInPlayerZones(cardId, player);
    if (zone) return zone;
  }

  return null;
}

/**
 * 获取卡牌所在的槽位位置（仅用于成员区域）
 *
 * @param cardId 卡牌实例 ID
 * @param player 玩家状态
 * @returns 槽位位置，如果卡牌不在成员区域则返回 null
 */
export function findCardSlotPosition(
  cardId: string,
  player: PlayerState
): SlotPosition | null {
  for (const slot of Object.values(SlotPosition)) {
    if (player.memberSlots.slots[slot] === cardId) {
      return slot;
    }
  }
  return null;
}
