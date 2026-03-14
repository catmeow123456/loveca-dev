/**
 * Loveca 卡牌实体定义
 * 基于 detail_rules.md 第 2 章
 */

import {
  CardType,
  HeartColor,
  BladeHeartEffect,
  OrientationState,
  FaceState,
} from '../../shared/types/enums';

// ============================================
// 值对象定义
// ============================================

/**
 * Heart 图标
 * 参考规则 2.1, 2.9
 */
export interface HeartIcon {
  /** Heart 颜色 */
  readonly color: HeartColor;
  /** 数量（重叠表示时的数量） */
  readonly count: number;
}

/**
 * Blade Heart 效果项
 * 参考规则 2.7
 * Cheer 时公开卡牌或 Live 成功时的奖励效果
 *
 * 一个卡牌可以有多个 bladeHeart 效果
 */
export interface BladeHeartItem {
  /** 效果类型 */
  readonly effect: BladeHeartEffect;
  /** 对应的 Heart 颜色（仅当 effect 为 HEART 时有效） */
  readonly heartColor?: HeartColor;
}

/**
 * Blade Heart 效果列表
 * 一个卡牌可以有多个效果
 */
export type BladeHearts = readonly BladeHeartItem[];

/**
 * Heart 需求条件（Live 卡所需）
 * 参考规则 2.11
 */
export interface HeartRequirement {
  /**
   * 各颜色的 Heart 需求
   * key: HeartColor, value: 所需数量
   */
  readonly colorRequirements: ReadonlyMap<HeartColor, number>;

  /**
   * Heart 总数需求
   * 参考规则 2.11.3 第二条
   */
  readonly totalRequired: number;
}

// ============================================
// 卡牌基类接口
// ============================================

/**
 * 卡牌基础信息
 * 所有卡牌共有的属性
 */
export interface BaseCardData {
  /**
   * 卡牌编号
   * 用于卡组构筑检查（成员卡同编号最多4张）
   * 参考规则 2.14, 6.1.1.2
   */
  readonly cardCode: string;

  /**
   * 卡牌名称
   * 参考规则 2.3
   */
  readonly name: string;

  /**
   * 组合名称（偶像组合）
   * 参考规则 2.4
   */
  readonly groupName?: string;

  /**
   * 小组名称
   * 参考规则 2.5
   */
  readonly unitName?: string;

  /**
   * 卡牌文本（能力描述）
   * 参考规则 2.12
   */
  readonly cardText?: string;

  /**
   * 卡牌类型
   */
  readonly cardType: CardType;

  /**
   * 图片文件名
   * 用于获取正确的图片 URL（cardCode 可能与文件名不同）
   */
  readonly imageFilename?: string;

  /**
   * 稀有度（管理/展示用，不参与游戏逻辑）
   */
  readonly rare?: string;

  /**
   * 收录商品（管理/展示用，不参与游戏逻辑）
   */
  readonly product?: string;
}

/**
 * 卡牌实例
 * 游戏中实际存在的卡牌对象
 */
export interface CardInstance {
  /**
   * 实例唯一 ID
   * 游戏内追踪具体卡牌用
   */
  readonly instanceId: string;

  /**
   * 卡牌基础数据引用
   */
  readonly data: BaseCardData;

  /**
   * 拥有者玩家 ID
   * 参考规则 3.1.1
   */
  readonly ownerId: string;
}

// ============================================
// 成员卡定义
// ============================================

/**
 * 成员卡数据
 * 参考规则 2.2.2.2
 */
export interface MemberCardData extends BaseCardData {
  readonly cardType: CardType.MEMBER;

  /**
   * 费用
   * 播放成员卡所需支付的能量数
   * 参考规则 2.6
   */
  readonly cost: number;

  /**
   * Blade 数值
   * Cheer 时公开的卡牌数量
   * 参考规则 2.8
   */
  readonly blade: number;

  /**
   * Heart 图标列表
   * Live 判定时提供的 Heart
   * 参考规则 2.9
   */
  readonly hearts: readonly HeartIcon[];

  /**
   * Blade Heart 效果列表
   * Cheer 时的特殊效果（可以有多个）
   * 参考规则 2.7
   */
  readonly bladeHearts?: BladeHearts;
}

/**
 * 成员卡实例
 */
export interface MemberCardInstance extends CardInstance {
  readonly data: MemberCardData;
}

// ============================================
// Live 卡定义
// ============================================

/**
 * Live 卡数据
 * 参考规则 2.2.2.1
 */
export interface LiveCardData extends BaseCardData {
  readonly cardType: CardType.LIVE;

  /**
   * 分数
   * Live 成功时获得的分数
   * 参考规则 2.10
   */
  readonly score: number;

  /**
   * 所需 Heart
   * Live 成功判定的条件
   * 参考规则 2.11
   */
  readonly requirements: HeartRequirement;

  /**
   * Blade Heart 效果列表
   * Live 成功时获得的奖励效果（可以有多个）
   * 可以是获得特定颜色的 Heart、抽卡或分数加成
   */
  readonly bladeHearts?: BladeHearts;
}

/**
 * Live 卡实例
 */
export interface LiveCardInstance extends CardInstance {
  readonly data: LiveCardData;
}

// ============================================
// 能量卡定义
// ============================================

/**
 * 能量卡数据
 * 参考规则 2.2.2.3
 */
export interface EnergyCardData extends BaseCardData {
  readonly cardType: CardType.ENERGY;
  // 能量卡无额外属性
}

/**
 * 能量卡实例
 */
export interface EnergyCardInstance extends CardInstance {
  readonly data: EnergyCardData;
}

// ============================================
// 卡牌状态（游戏中的动态状态）
// ============================================

/**
 * 卡牌在区域中的状态
 * 参考规则 4.3
 */
export interface CardZoneState {
  /**
   * 方向状态（活跃/等待）
   * 参考规则 4.3.2
   */
  readonly orientation: OrientationState;

  /**
   * 显示面状态（正面/背面朝上）
   * 参考规则 4.3.3
   */
  readonly face: FaceState;
}

/**
 * 带状态的卡牌
 * 用于在特定区域中追踪卡牌状态
 */
export interface CardWithState<T extends CardInstance = CardInstance> {
  /** 卡牌实例 */
  readonly card: T;
  /** 区域状态 */
  readonly state: CardZoneState;
}

// ============================================
// 类型联合与类型守卫
// ============================================

/**
 * 所有卡牌数据类型的联合
 */
export type AnyCardData = MemberCardData | LiveCardData | EnergyCardData;

/**
 * 所有卡牌实例类型的联合
 */
export type AnyCardInstance = MemberCardInstance | LiveCardInstance | EnergyCardInstance;

// ---- 类型守卫函数 ----

/**
 * 判断是否为成员卡数据
 */
export function isMemberCardData(data: BaseCardData): data is MemberCardData {
  return data.cardType === CardType.MEMBER;
}

/**
 * 判断是否为 Live 卡数据
 */
export function isLiveCardData(data: BaseCardData): data is LiveCardData {
  return data.cardType === CardType.LIVE;
}

/**
 * 判断是否为能量卡数据
 */
export function isEnergyCardData(data: BaseCardData): data is EnergyCardData {
  return data.cardType === CardType.ENERGY;
}

/**
 * 判断是否为成员卡实例
 */
export function isMemberCardInstance(instance: CardInstance): instance is MemberCardInstance {
  return isMemberCardData(instance.data);
}

/**
 * 判断是否为 Live 卡实例
 */
export function isLiveCardInstance(instance: CardInstance): instance is LiveCardInstance {
  return isLiveCardData(instance.data);
}

/**
 * 判断是否为能量卡实例
 */
export function isEnergyCardInstance(instance: CardInstance): instance is EnergyCardInstance {
  return isEnergyCardData(instance.data);
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建 Heart 需求
 */
export function createHeartRequirement(
  colorRequirements: Record<string, number>,
  totalRequired?: number
): HeartRequirement {
  const colorMap = new Map<HeartColor, number>();
  let computedTotal = 0;

  for (const [color, count] of Object.entries(colorRequirements)) {
    if (count > 0) {
      colorMap.set(color as HeartColor, count);
      computedTotal += count;
    }
  }

  return {
    colorRequirements: colorMap,
    totalRequired: totalRequired ?? computedTotal,
  };
}

/**
 * 创建 Heart 图标
 */
export function createHeartIcon(color: HeartColor, count: number = 1): HeartIcon {
  return { color, count };
}

/**
 * 创建卡牌实例
 */
export function createCardInstance(
  data: BaseCardData,
  ownerId: string,
  instanceId: string
): CardInstance {
  return {
    instanceId,
    data,
    ownerId,
  };
}

/**
 * 创建默认卡牌状态
 * 参考规则 4.3.2.3 - 默认以活跃状态放置
 */
export function createDefaultCardState(): CardZoneState {
  return {
    orientation: OrientationState.ACTIVE,
    face: FaceState.FACE_UP,
  };
}

/**
 * 创建背面朝上的卡牌状态
 */
export function createFaceDownCardState(): CardZoneState {
  return {
    orientation: OrientationState.ACTIVE,
    face: FaceState.FACE_DOWN,
  };
}

// ============================================
// Heart 计算辅助
// ============================================

/**
 * 计算成员卡的总 Heart 数量
 */
export function calculateTotalHearts(memberData: MemberCardData): number {
  return memberData.hearts.reduce((sum, heart) => sum + heart.count, 0);
}

/**
 * 获取成员卡特定颜色的 Heart 数量
 */
export function getHeartCountByColor(memberData: MemberCardData, color: HeartColor): number {
  return memberData.hearts
    .filter((heart) => heart.color === color || heart.color === HeartColor.RAINBOW)
    .reduce((sum, heart) => sum + heart.count, 0);
}
