/**
 * 游戏动作定义
 * 定义所有玩家可执行的游戏动作类型
 */

import { SlotPosition, ZoneType, SubPhase } from '../shared/types/enums';

// ============================================
// 动作类型枚举
// ============================================

/**
 * 游戏动作类型
 */
export enum GameActionType {
  /** 打出成员卡 */
  PLAY_MEMBER = 'PLAY_MEMBER',
  /** 使用起动能力 */
  ACTIVATE_ABILITY = 'ACTIVATE_ABILITY',
  /** 结束当前阶段 */
  END_PHASE = 'END_PHASE',
  /** 放置 Live 卡 */
  SET_LIVE_CARD = 'SET_LIVE_CARD',
  /** 选择卡牌（响应效果） */
  SELECT_CARDS = 'SELECT_CARDS',
  /** 确认可选效果 */
  CONFIRM_OPTIONAL = 'CONFIRM_OPTIONAL',
  /** 接力传递 */
  RELAY = 'RELAY',
  /** 选择槽位 */
  SELECT_SLOT = 'SELECT_SLOT',
  /** 换牌（Mulligan） */
  MULLIGAN = 'MULLIGAN',
  /** 切换成员状态（活跃/等待） */
  TAP_MEMBER = 'TAP_MEMBER',

  // ============ 阶段十新增动作 ============
  /** 确认当前子阶段完成 */
  CONFIRM_SUB_PHASE = 'CONFIRM_SUB_PHASE',
  /** 手动移动卡牌（自由拖拽） */
  MANUAL_MOVE_CARD = 'MANUAL_MOVE_CARD',
  /** 确认 Live 判定结果 */
  CONFIRM_JUDGMENT = 'CONFIRM_JUDGMENT',
  /** 确认分数（用户可调整） */
  CONFIRM_SCORE = 'CONFIRM_SCORE',
  /** 选择成功 Live 卡移到成功区 */
  SELECT_SUCCESS_CARD = 'SELECT_SUCCESS_CARD',
  /** 撤销上一步操作 */
  UNDO_OPERATION = 'UNDO_OPERATION',
  /** 执行应援（Cheer） */
  PERFORM_CHEER = 'PERFORM_CHEER',
}

// ============================================
// 动作接口定义
// ============================================

/**
 * 基础动作接口
 */
export interface BaseGameAction {
  /** 动作类型 */
  readonly type: GameActionType;
  /** 执行玩家 ID */
  readonly playerId: string;
  /** 时间戳 */
  readonly timestamp: number;
}

/**
 * 打出成员卡动作
 */
export interface PlayMemberAction extends BaseGameAction {
  readonly type: GameActionType.PLAY_MEMBER;
  /** 要打出的成员卡实例 ID */
  readonly cardId: string;
  /** 目标槽位 */
  readonly targetSlot: SlotPosition;
  /** 是否接力传递（从相邻槽位） */
  readonly isRelay?: boolean;
  /** 接力来源槽位（如果是接力） */
  readonly relayFromSlot?: SlotPosition;
}

/**
 * 使用起动能力动作
 */
export interface ActivateAbilityAction extends BaseGameAction {
  readonly type: GameActionType.ACTIVATE_ABILITY;
  /** 能力所在卡牌实例 ID */
  readonly cardId: string;
  /** 能力 ID */
  readonly abilityId: string;
}

/**
 * 结束阶段动作
 */
export interface EndPhaseAction extends BaseGameAction {
  readonly type: GameActionType.END_PHASE;
}

/**
 * 放置 Live 卡动作
 */
export interface SetLiveCardAction extends BaseGameAction {
  readonly type: GameActionType.SET_LIVE_CARD;
  /** 要放置的 Live 卡实例 ID */
  readonly cardId: string;
  /** 是否正面朝下 */
  readonly faceDown: boolean;
}


/**
 * 选择卡牌动作（响应效果选择）
 */
export interface SelectCardsAction extends BaseGameAction {
  readonly type: GameActionType.SELECT_CARDS;
  /** 选择的卡牌 ID 列表 */
  readonly selectedCardIds: readonly string[];
}

/**
 * 确认可选效果动作
 */
export interface ConfirmOptionalAction extends BaseGameAction {
  readonly type: GameActionType.CONFIRM_OPTIONAL;
  /** 是否执行可选效果 */
  readonly confirmed: boolean;
}

/**
 * 接力传递动作
 */
export interface RelayAction extends BaseGameAction {
  readonly type: GameActionType.RELAY;
  /** 被替换的成员卡实例 ID */
  readonly targetCardId: string;
  /** 新成员卡实例 ID */
  readonly newCardId: string;
  /** 目标槽位 */
  readonly slot: SlotPosition;
}

/**
 * 选择槽位动作
 */
export interface SelectSlotAction extends BaseGameAction {
  readonly type: GameActionType.SELECT_SLOT;
  /** 选择的槽位 */
  readonly slot: SlotPosition;
}

/**
 * 换牌动作（Mulligan）
 * 玩家选择要换的牌，洗入牌库后重新抽取相同数量
 */
export interface MulliganAction extends BaseGameAction {
  readonly type: GameActionType.MULLIGAN;
  /** 要换掉的卡牌 ID 列表（可以为空，表示不换牌） */
  readonly cardIdsToMulligan: readonly string[];
}

/**
 * 切换成员状态动作
 * 将成员卡在活跃（ACTIVE）和等待（WAITING）状态之间切换
 */
export interface TapMemberAction extends BaseGameAction {
  readonly type: GameActionType.TAP_MEMBER;
  /** 要切换状态的成员卡实例 ID */
  readonly cardId: string;
  /** 目标槽位（用于验证卡牌位置） */
  readonly slot: SlotPosition;
}

// ============================================
// 阶段十新增动作接口
// ============================================

/**
 * 确认子阶段完成动作
 * 用户确认当前子阶段的操作已完成
 */
export interface ConfirmSubPhaseAction extends BaseGameAction {
  readonly type: GameActionType.CONFIRM_SUB_PHASE;
  /** 确认完成的子阶段 */
  readonly subPhase: SubPhase;
}

/**
 * 手动移动卡牌动作
 * 在自由操作窗口中，用户手动移动卡牌
 */
export interface ManualMoveCardAction extends BaseGameAction {
  readonly type: GameActionType.MANUAL_MOVE_CARD;
  /** 要移动的卡牌 ID */
  readonly cardId: string;
  /** 来源区域 */
  readonly fromZone: ZoneType;
  /** 目标区域 */
  readonly toZone: ZoneType;
  /** 目标槽位（如果是成员区域） */
  readonly targetSlot?: SlotPosition;
  /** 来源槽位（成员区域之间移动时使用，用于携带 energyBelow） */
  readonly sourceSlot?: SlotPosition;
  /** 放置位置（TOP/BOTTOM） */
  readonly position?: 'TOP' | 'BOTTOM';
}

/**
 * 确认 Live 判定结果动作
 * 用户手动确认每张 Live 卡的判定结果
 */
export interface ConfirmJudgmentAction extends BaseGameAction {
  readonly type: GameActionType.CONFIRM_JUDGMENT;
  /** Live 卡 ID -> 判定结果（成功/失败） */
  readonly judgmentResults: ReadonlyMap<string, boolean>;
}

/**
 * 确认分数动作
 * 用户可调整最终分数后确认
 */
export interface ConfirmScoreAction extends BaseGameAction {
  readonly type: GameActionType.CONFIRM_SCORE;
  /** 调整后的分数（可为 null 表示使用默认计算） */
  readonly adjustedScore?: number;
}

/**
 * 选择成功 Live 卡动作
 * 胜者选择要移到成功区的 Live 卡
 */
export interface SelectSuccessCardAction extends BaseGameAction {
  readonly type: GameActionType.SELECT_SUCCESS_CARD;
  /** 选择的 Live 卡 ID */
  readonly cardId: string;
}

/**
 * 撤销操作动作
 */
export interface UndoOperationAction extends BaseGameAction {
  readonly type: GameActionType.UNDO_OPERATION;
}

/**
 * 执行应援动作
 * 用户手动控制应援（Cheer）过程
 */
export interface PerformCheerAction extends BaseGameAction {
  readonly type: GameActionType.PERFORM_CHEER;
  /** 翻开的卡牌数量（可调整，默认为光棒数） */
  readonly cheerCount: number;
}

// ============================================
// 动作联合类型
// ============================================

/**
 * 所有游戏动作的联合类型
 */
export type GameAction =
  | PlayMemberAction
  | ActivateAbilityAction
  | EndPhaseAction
  | SetLiveCardAction
  | SelectCardsAction
  | ConfirmOptionalAction
  | RelayAction
  | SelectSlotAction
  | MulliganAction
  | TapMemberAction
  // 阶段十新增
  | ConfirmSubPhaseAction
  | ManualMoveCardAction
  | ConfirmJudgmentAction
  | ConfirmScoreAction
  | SelectSuccessCardAction
  | UndoOperationAction
  | PerformCheerAction;

// ============================================
// 动作创建工厂
// ============================================

/**
 * 创建打出成员卡动作
 */
export function createPlayMemberAction(
  playerId: string,
  cardId: string,
  targetSlot: SlotPosition,
  options?: { isRelay?: boolean; relayFromSlot?: SlotPosition }
): PlayMemberAction {
  return {
    type: GameActionType.PLAY_MEMBER,
    playerId,
    cardId,
    targetSlot,
    isRelay: options?.isRelay,
    relayFromSlot: options?.relayFromSlot,
    timestamp: Date.now(),
  };
}

/**
 * 创建使用起动能力动作
 */
export function createActivateAbilityAction(
  playerId: string,
  cardId: string,
  abilityId: string
): ActivateAbilityAction {
  return {
    type: GameActionType.ACTIVATE_ABILITY,
    playerId,
    cardId,
    abilityId,
    timestamp: Date.now(),
  };
}

/**
 * 创建结束阶段动作
 */
export function createEndPhaseAction(playerId: string): EndPhaseAction {
  return {
    type: GameActionType.END_PHASE,
    playerId,
    timestamp: Date.now(),
  };
}

/**
 * 创建放置 Live 卡动作
 */
export function createSetLiveCardAction(
  playerId: string,
  cardId: string,
  faceDown: boolean = false
): SetLiveCardAction {
  return {
    type: GameActionType.SET_LIVE_CARD,
    playerId,
    cardId,
    faceDown,
    timestamp: Date.now(),
  };
}


/**
 * 创建选择卡牌动作
 */
export function createSelectCardsAction(
  playerId: string,
  selectedCardIds: readonly string[]
): SelectCardsAction {
  return {
    type: GameActionType.SELECT_CARDS,
    playerId,
    selectedCardIds,
    timestamp: Date.now(),
  };
}

/**
 * 创建确认可选效果动作
 */
export function createConfirmOptionalAction(
  playerId: string,
  confirmed: boolean
): ConfirmOptionalAction {
  return {
    type: GameActionType.CONFIRM_OPTIONAL,
    playerId,
    confirmed,
    timestamp: Date.now(),
  };
}

/**
 * 创建接力传递动作
 */
export function createRelayAction(
  playerId: string,
  targetCardId: string,
  newCardId: string,
  slot: SlotPosition
): RelayAction {
  return {
    type: GameActionType.RELAY,
    playerId,
    targetCardId,
    newCardId,
    slot,
    timestamp: Date.now(),
  };
}

/**
 * 创建选择槽位动作
 */
export function createSelectSlotAction(playerId: string, slot: SlotPosition): SelectSlotAction {
  return {
    type: GameActionType.SELECT_SLOT,
    playerId,
    slot,
    timestamp: Date.now(),
  };
}

/**
 * 创建换牌动作
 */
export function createMulliganAction(
  playerId: string,
  cardIdsToMulligan: readonly string[]
): MulliganAction {
  return {
    type: GameActionType.MULLIGAN,
    playerId,
    cardIdsToMulligan,
    timestamp: Date.now(),
  };
}

/**
 * 创建切换成员状态动作
 */
export function createTapMemberAction(
  playerId: string,
  cardId: string,
  slot: SlotPosition
): TapMemberAction {
  return {
    type: GameActionType.TAP_MEMBER,
    playerId,
    cardId,
    slot,
    timestamp: Date.now(),
  };
}

// ============================================
// 阶段十新增工厂函数
// ============================================

/**
 * 创建确认子阶段完成动作
 */
export function createConfirmSubPhaseAction(
  playerId: string,
  subPhase: SubPhase
): ConfirmSubPhaseAction {
  return {
    type: GameActionType.CONFIRM_SUB_PHASE,
    playerId,
    subPhase,
    timestamp: Date.now(),
  };
}

/**
 * 创建手动移动卡牌动作
 */
export function createManualMoveCardAction(
  playerId: string,
  cardId: string,
  fromZone: ZoneType,
  toZone: ZoneType,
  options?: { targetSlot?: SlotPosition; sourceSlot?: SlotPosition; position?: 'TOP' | 'BOTTOM' }
): ManualMoveCardAction {
  return {
    type: GameActionType.MANUAL_MOVE_CARD,
    playerId,
    cardId,
    fromZone,
    toZone,
    targetSlot: options?.targetSlot,
    sourceSlot: options?.sourceSlot,
    position: options?.position,
    timestamp: Date.now(),
  };
}

/**
 * 创建确认 Live 判定结果动作
 */
export function createConfirmJudgmentAction(
  playerId: string,
  judgmentResults: ReadonlyMap<string, boolean>
): ConfirmJudgmentAction {
  return {
    type: GameActionType.CONFIRM_JUDGMENT,
    playerId,
    judgmentResults,
    timestamp: Date.now(),
  };
}

/**
 * 创建确认分数动作
 */
export function createConfirmScoreAction(
  playerId: string,
  adjustedScore?: number
): ConfirmScoreAction {
  return {
    type: GameActionType.CONFIRM_SCORE,
    playerId,
    adjustedScore,
    timestamp: Date.now(),
  };
}

/**
 * 创建选择成功 Live 卡动作
 */
export function createSelectSuccessCardAction(
  playerId: string,
  cardId: string
): SelectSuccessCardAction {
  return {
    type: GameActionType.SELECT_SUCCESS_CARD,
    playerId,
    cardId,
    timestamp: Date.now(),
  };
}

/**
 * 创建撤销操作动作
 */
export function createUndoOperationAction(playerId: string): UndoOperationAction {
  return {
    type: GameActionType.UNDO_OPERATION,
    playerId,
    timestamp: Date.now(),
  };
}

/**
 * 创建执行应援动作
 */
export function createPerformCheerAction(playerId: string, cheerCount: number): PerformCheerAction {
  return {
    type: GameActionType.PERFORM_CHEER,
    playerId,
    cheerCount,
    timestamp: Date.now(),
  };
}
