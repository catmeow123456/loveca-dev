/**
 * 区域 ID 解析工具
 *
 * 用于前端拖拽系统中区域 ID 和 ZoneType 之间的转换
 */

import { ZoneType, SlotPosition } from '@game/shared/types/enums';

const SCOPED_ZONE_DELIMITER = '::';

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

function extractLogicalZoneId(zoneId: string): string {
  const delimiterIndex = zoneId.lastIndexOf(SCOPED_ZONE_DELIMITER);
  return delimiterIndex >= 0 ? zoneId.slice(delimiterIndex + SCOPED_ZONE_DELIMITER.length) : zoneId;
}

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
  const logicalZoneId = extractLogicalZoneId(zoneId);

  // 处理成员槽位: slot-LEFT, slot-CENTER, slot-RIGHT
  if (logicalZoneId.startsWith('slot-')) {
    const slotName = logicalZoneId.replace('slot-', '') as keyof typeof SlotPosition;
    const slot = SlotPosition[slotName];
    if (slot) {
      return { zoneType: ZoneType.MEMBER_SLOT, slotPosition: slot };
    }
    return null;
  }

  // 查找映射表
  const zoneType = ZONE_ID_MAP[logicalZoneId];
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

export function createScopedZoneId(
  scope: string,
  zoneType: ZoneType,
  slotPosition?: SlotPosition
): string {
  return `${scope}${SCOPED_ZONE_DELIMITER}${createZoneId(zoneType, slotPosition)}`;
}
