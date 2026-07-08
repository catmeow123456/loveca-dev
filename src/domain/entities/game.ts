/**
 * Loveca 游戏状态实体定义
 * 基于 detail_rules.md 第 7、8 章游戏流程
 */

import {
  GamePhase,
  TurnType,
  GameEndReason,
  LiveResult,
  ZoneType,
  SubPhase,
  EffectWindowType,
  SlotPosition,
  HeartColor,
} from '../../shared/types/enums.js';
import { CardInstance, type HeartIcon } from './card.js';
import {
  ResolutionZoneState,
  InspectionZoneState,
  createEmptyResolutionZone,
  createEmptyInspectionZone,
} from './zone.js';
import {
  PlayerState,
  createPlayerState,
  hasReachedVictoryCondition,
  getSuccessLiveCount,
  needsRefresh,
} from './player.js';
import type { GameEvent } from '../events/game-events.js';

// ============================================
// 游戏配置常量
// ============================================

/**
 * 游戏配置常量
 * 参考规则 6.1
 */
export const GAME_CONFIG = {
  /** 主卡组成员卡数量 */
  MAIN_DECK_MEMBER_COUNT: 48,
  /** 主卡组 Live 卡数量 */
  MAIN_DECK_LIVE_COUNT: 12,
  /** 主卡组总数 */
  MAIN_DECK_TOTAL: 60,
  /** 能量卡组数量 */
  ENERGY_DECK_COUNT: 12,
  /** 同编号卡牌最大数量 */
  MAX_SAME_CARD: 4,
  /** 初始手牌数量 */
  INITIAL_HAND_SIZE: 6,
  /** 初始能量数量 */
  INITIAL_ENERGY_COUNT: 3,
  /** 胜利所需成功 Live 数量 */
  VICTORY_LIVE_COUNT: 3,
  /** Live 阶段最大放置卡牌数 */
  MAX_LIVE_CARDS_PER_PHASE: 3,
  /** 无限循环检测阈值 */
  INFINITE_LOOP_THRESHOLD: 1000,
} as const;

// ============================================
// 游戏事件日志
// ============================================

/**
 * 游戏动作类型
 */
export type GameActionType =
  | 'DRAW_CARD'
  | 'PLAY_MEMBER'
  | 'PLAY_ABILITY'
  | 'SET_LIVE_CARD'
  | 'CHEER'
  | 'LIVE_JUDGMENT'
  | 'PAY_COST'
  | 'RELAY'
  | 'MOVE_CARD'
  | 'SHUFFLE'
  | 'REFRESH'
  | 'PHASE_CHANGE'
  | 'TURN_CHANGE'
  | 'TRIGGER_ABILITY'
  | 'RESOLVE_ABILITY'
  | 'RULE_ACTION'
  | 'TAP_MEMBER'
  | 'TAP_ENERGY';

/**
 * 游戏动作记录
 */
export interface GameAction {
  /** 动作 ID */
  readonly id: string;
  /** 动作类型 */
  readonly type: GameActionType;
  /** 执行玩家 ID */
  readonly playerId: string | null;
  /** 动作时间戳 */
  readonly timestamp: number;
  /** 动作详细数据 */
  readonly payload: Record<string, unknown>;
  /** 动作序号（用于排序） */
  readonly sequence: number;
}

export interface LiveProhibitionState {
  readonly playerId: string;
  readonly sourceCardId: string;
  readonly abilityId: string;
  readonly expiresAt: 'LIVE_END';
}

export interface LiveStartSuppressionState {
  readonly playerId: string;
  readonly suppressedMemberCardId: string;
  readonly sourceCardId: string;
  readonly abilityId: string;
  readonly expiresAt: 'LIVE_END';
}

export interface MemberActivePhaseSkipState {
  readonly playerId: string;
  readonly memberCardId: string;
  readonly sourceCardId: string;
  readonly abilityId: string;
}

/**
 * 权威规则事件日志条目。
 *
 * 与 actionHistory 不同，eventLog 记录“规则上发生了什么事件”，用于后续自动能力触发匹配。
 */
export interface GameEventLogEntry {
  /** 事件日志序号（用于稳定排序） */
  readonly sequence: number;
  /** 标准规则事件 */
  readonly event: GameEvent;
  /** 促成此事件的动作 ID；没有对应动作时可为空 */
  readonly causedByActionId?: string;
}

// ============================================
// Live 阶段相关状态
// ============================================

/**
 * Live 结算状态
 */
export interface LiveRequirementModifierState {
  readonly color: HeartColor;
  readonly countDelta: number;
}

export interface SuccessLivePlacementRestrictionState {
  readonly playerId: string;
  readonly sourceCardId: string;
  readonly abilityId: string;
  readonly appliesWhen: 'TIED_LIVE_SCORE';
  readonly expiresAt: 'LIVE_END';
}

export interface LiveModifierVisibilityDependency {
  readonly kind: 'PLAYER_LIVE_ZONE_CONTENTS';
  readonly playerId: string;
}

export type LiveModifierState =
  | {
      readonly kind: 'SCORE';
      readonly playerId: string;
      readonly countDelta: number;
      /** 指定时表示“此 Live 卡分数”修正；未指定时表示玩家 LIVE 合计分数修正 */
      readonly liveCardId?: string;
      readonly sourceCardId?: string;
      readonly abilityId?: string;
      readonly visibilityDependency?: LiveModifierVisibilityDependency;
    }
  | {
      readonly kind: 'HEART';
      readonly target: 'SOURCE_MEMBER';
      readonly playerId: string;
      readonly hearts: readonly HeartIcon[];
      readonly sourceCardId: string;
      readonly abilityId?: string;
      readonly visibilityDependency?: LiveModifierVisibilityDependency;
    }
  | {
      readonly kind: 'HEART';
      readonly target: 'PLAYER';
      readonly playerId: string;
      readonly hearts: readonly HeartIcon[];
      readonly sourceCardId?: string;
      readonly abilityId?: string;
      readonly visibilityDependency?: LiveModifierVisibilityDependency;
    }
  | {
      readonly kind: 'HEART';
      readonly target: 'TARGET_MEMBER';
      readonly playerId: string;
      readonly targetMemberCardId: string;
      readonly hearts: readonly HeartIcon[];
      readonly sourceCardId?: string;
      readonly abilityId?: string;
      readonly visibilityDependency?: LiveModifierVisibilityDependency;
    }
  | {
      readonly kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT';
      readonly playerId: string;
      readonly memberCardId: string;
      readonly color: HeartColor;
      readonly sourceCardId?: string;
      readonly abilityId?: string;
      readonly visibilityDependency?: LiveModifierVisibilityDependency;
    }
  | {
      readonly kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT';
      readonly playerId: string;
      readonly memberCardId: string;
      readonly count: number;
      readonly sourceCardId?: string;
      readonly abilityId?: string;
      readonly visibilityDependency?: LiveModifierVisibilityDependency;
    }
  | {
      readonly kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT';
      readonly playerId: string;
      readonly fromColors: readonly HeartColor[];
      readonly toColor: HeartColor;
      readonly sourceCardId?: string;
      readonly abilityId?: string;
      readonly visibilityDependency?: LiveModifierVisibilityDependency;
    }
  | {
      readonly kind: 'BLADE';
      readonly playerId: string;
      readonly countDelta: number;
      readonly sourceCardId?: string;
      readonly abilityId?: string;
      readonly visibilityDependency?: LiveModifierVisibilityDependency;
    }
  | {
      readonly kind: 'CHEER_COUNT';
      readonly playerId: string;
      readonly countDelta: number;
      readonly sourceCardId?: string;
      readonly abilityId?: string;
      readonly visibilityDependency?: LiveModifierVisibilityDependency;
    }
  | {
      readonly kind: 'MEMBER_COST';
      readonly playerId: string;
      readonly memberCardId: string;
      readonly countDelta: number;
      readonly sourceCardId?: string;
      readonly abilityId?: string;
      readonly visibilityDependency?: LiveModifierVisibilityDependency;
    }
  | {
      readonly kind: 'MEMBER_COST_SET';
      readonly playerId: string;
      readonly memberCardId: string;
      readonly setTo: number;
      readonly sourceCardId?: string;
      readonly abilityId?: string;
      readonly visibilityDependency?: LiveModifierVisibilityDependency;
    }
  | {
      readonly kind: 'REQUIREMENT';
      readonly liveCardId: string;
      readonly modifiers: readonly LiveRequirementModifierState[];
      readonly sourceCardId?: string;
      readonly abilityId?: string;
      readonly visibilityDependency?: LiveModifierVisibilityDependency;
    }
  | {
      readonly kind: 'SUPPRESS_ABILITY';
      readonly sourceCardId: string;
      readonly suppressedAbilityId: string;
      readonly abilityId?: string;
      readonly visibilityDependency?: LiveModifierVisibilityDependency;
    };

export interface LiveResolutionState {
  /** 是否正在进行 Live */
  readonly isInLive: boolean;
  /** 当前手番玩家 ID（表演阶段） */
  readonly performingPlayerId: string | null;
  /** 先攻玩家的 Cheer 卡牌 ID 列表 */
  readonly firstPlayerCheerCardIds: readonly string[];
  /** 后攻玩家的 Cheer 卡牌 ID 列表 */
  readonly secondPlayerCheerCardIds: readonly string[];
  /** Live 判定结果（按 Live 卡 ID 映射） */
  readonly liveResults: ReadonlyMap<string, boolean>;
  /** 各玩家的 Live 分数 */
  readonly playerScores: ReadonlyMap<string, number>;
  /** 本次 Live 判定后各玩家的余剰/剩余 Heart（plain data，不保存 HeartPool 实例） */
  readonly playerRemainingHearts: ReadonlyMap<string, readonly HeartIcon[]>;
  /** 本次 Live 判定时各玩家可用于判定的 Heart 总量（plain data，不保存 HeartPool 实例） */
  readonly playerLiveJudgmentHearts: ReadonlyMap<string, readonly HeartIcon[]>;
  /** 兼容投影：本次 Live 中各玩家的临时分数修正；新增逻辑优先写 liveModifiers */
  readonly playerScoreBonuses: ReadonlyMap<string, number>;
  /** 兼容投影：本次 Live 中各玩家的临时 Heart 修正；新增逻辑优先写 liveModifiers */
  readonly playerHeartBonuses: ReadonlyMap<string, readonly HeartIcon[]>;
  /** 兼容投影：本次 Live 中各 Live 卡的无色/All 必要 Heart 减少数量 */
  readonly liveRequirementReductions: ReadonlyMap<string, number>;
  /** 兼容投影：本次 Live 中各 Live 卡的必要 Heart 修正列表 */
  readonly liveRequirementModifiers: ReadonlyMap<string, readonly LiveRequirementModifierState[]>;
  /** 本次 Live 结束前的成功 LIVE 卡区放置限制 */
  readonly successLivePlacementRestrictions: readonly SuccessLivePlacementRestrictionState[];
  /** 本次 Live 结束前的统一临时修正流水线；旧 Map 字段仅作为兼容投影保留 */
  readonly liveModifiers: readonly LiveModifierState[];
  /** 已确认分数的玩家 ID 列表 */
  readonly scoreConfirmedBy: readonly string[];
  /** Live 胜利玩家 ID 列表 */
  readonly liveWinnerIds: readonly string[];
  /** 已完成结果动画的玩家 ID 列表 */
  readonly animationConfirmedBy: readonly string[];
  /**
   * 已移动卡牌到成功区的玩家 ID 列表
   * 用于追踪谁执行了 SELECT_SUCCESS_CARD 动作
   * 在结算阶段用于追踪哪些胜者已完成选卡
   */
  readonly successCardMovedBy: readonly string[];
  /** 已确认结算完成的玩家 ID 列表 */
  readonly settlementConfirmedBy: readonly string[];
}

/**
 * 创建空的 Live 结算状态
 */
export function createEmptyLiveResolutionState(): LiveResolutionState {
  return {
    isInLive: false,
    performingPlayerId: null,
    firstPlayerCheerCardIds: [],
    secondPlayerCheerCardIds: [],
    liveResults: new Map(),
    playerScores: new Map(),
    playerRemainingHearts: new Map(),
    playerLiveJudgmentHearts: new Map(),
    playerScoreBonuses: new Map(),
    playerHeartBonuses: new Map(),
    liveRequirementReductions: new Map(),
    liveRequirementModifiers: new Map(),
    successLivePlacementRestrictions: [],
    liveModifiers: [],
    scoreConfirmedBy: [],
    liveWinnerIds: [],
    animationConfirmedBy: [],
    successCardMovedBy: [],
    settlementConfirmedBy: [],
  };
}

export interface InspectionContextState {
  /** 当前检视流程的拥有者 */
  readonly ownerPlayerId: string;
  /** 当前检视流程中实际查看/操作检视牌的玩家；默认等同 ownerPlayerId */
  readonly viewerPlayerId?: string;
  /** 检视来源区域 */
  readonly sourceZone: ZoneType.MAIN_DECK | ZoneType.ENERGY_DECK;
}

// ============================================
// 用户操作记录（用于撤销功能）
// ============================================

/**
 * 用户操作类型
 */
export type UserOperationType =
  | 'MOVE_CARD'
  | 'ACTIVATE_ABILITY'
  | 'CONFIRM_JUDGMENT'
  | 'ADJUST_SCORE'
  | 'SELECT_WINNER'
  | 'CHEER_ADJUST';

/**
 * 用户操作记录
 * 用于支持撤销功能
 */
export interface UserOperation {
  /** 操作 ID */
  readonly id: string;
  /** 操作类型 */
  readonly type: UserOperationType;
  /** 操作时间戳 */
  readonly timestamp: number;
  /** 执行玩家 ID */
  readonly playerId: string;
  /** 操作详情 */
  readonly details: {
    /** 卡牌 ID */
    cardId?: string;
    /** 来源区域 */
    fromZone?: ZoneType;
    /** 目标区域 */
    toZone?: ZoneType;
    /** 其他数据 */
    [key: string]: unknown;
  };
  /** 是否可撤销 */
  readonly canUndo: boolean;
}

// ============================================
// 游戏结束状态
// ============================================

/**
 * 游戏结束信息
 */
export interface GameEndInfo {
  /** 结束原因 */
  readonly reason: GameEndReason;
  /** 获胜玩家 ID（平局时为 null） */
  readonly winnerId: string | null;
  /** 失败玩家 ID（平局时为 null） */
  readonly loserId: string | null;
  /** 是否为平局 */
  readonly isDraw: boolean;
  /** 结束时间戳 */
  readonly endTimestamp: number;
  /** 最终回合数 */
  readonly finalTurnCount: number;
}

// ============================================
// 卡效待处理状态
// ============================================

/**
 * 检查时点发现、但尚未执行的能力。
 * 这里只记录“哪张牌的哪个能力正在排队”，不记录玩家选择结果。
 */
export interface PendingAbilityState {
  /** 待处理能力实例 ID */
  readonly id: string;
  /** 能力定义 ID */
  readonly abilityId: string;
  /** 能力来源卡牌实例 ID */
  readonly sourceCardId: string;
  /** 能力控制者 ID */
  readonly controllerId: string;
  /** 是否强制发动 */
  readonly mandatory: boolean;
  /** 触发/检查时点 ID */
  readonly timingId: string;
  /** 促成本能力待处理的事件 ID 列表 */
  readonly eventIds: readonly string[];
  /** 能力来源成员在舞台上的槽位；用于左/中/右区域条件 */
  readonly sourceSlot?: SlotPosition;
  /** 待处理能力的触发来源元数据 */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type PendingChoiceKind = 'CONFIRM_OPTIONAL' | 'SELECT_CARDS' | 'SELECT_TARGET';

/**
 * 卡效执行中等待玩家作出的选择。
 * 与 PendingAbilityState 分离，避免把“能力排队”和“玩家选择”混在一起。
 */
export interface PendingChoiceState {
  /** 待选择事项 ID */
  readonly id: string;
  /** 需要作出选择的玩家 ID */
  readonly playerId: string;
  /** 选择类型 */
  readonly kind: PendingChoiceKind;
  /** 产生此选择的能力 ID */
  readonly sourceAbilityId: string;
  /** 给玩家看的提示文本 */
  readonly promptText?: string;
  /** 可选卡牌 ID 列表 */
  readonly candidateCardIds?: readonly string[];
  /** 最少选择数量 */
  readonly minCount?: number;
  /** 最多选择数量 */
  readonly maxCount?: number;
}

export type ActiveEffectSelectableCardVisibility = 'PUBLIC' | 'AWAITING_PLAYER_ONLY';

export interface ActiveEffectNumericInputState {
  readonly min?: number;
  readonly max?: number;
  readonly integerOnly?: boolean;
  readonly label?: string;
  readonly placeholder?: string;
  readonly confirmLabel?: string;
}

export interface ActiveEffectStageFormationSlotState {
  readonly slot: SlotPosition;
  readonly cardId: string | null;
  readonly originalSlot: SlotPosition;
  readonly energyBelowCount: number;
  readonly memberBelowCount: number;
}

export interface ActiveEffectStageFormationState {
  readonly playerId: string;
  readonly slots: readonly ActiveEffectStageFormationSlotState[];
}

export interface ActiveEffectState {
  /** 当前处理中的效果实例 ID */
  readonly id: string;
  /** 能力定义 ID */
  readonly abilityId: string;
  /** 能力来源卡牌实例 ID */
  readonly sourceCardId: string;
  /** 能力控制者 ID */
  readonly controllerId: string;
  /** 展示给玩家的效果文本 */
  readonly effectText: string;
  /** 当前效果步骤 ID */
  readonly stepId: string;
  /** 展示给玩家的当前步骤说明 */
  readonly stepText: string;
  /** 当前需要确认/选择的玩家 ID */
  readonly awaitingPlayerId: string | null;
  /** 当前步骤已公开给双方的卡牌 */
  readonly revealedCardIds?: readonly string[];
  /** 当前步骤涉及的检视区卡牌 */
  readonly inspectionCardIds?: readonly string[];
  /** 当前步骤可选择的卡牌 */
  readonly selectableCardIds?: readonly string[];
  /** 当前步骤可选择卡牌对非等待玩家的可见性 */
  readonly selectableCardVisibility?: ActiveEffectSelectableCardVisibility;
  /** 当前卡牌选择模式 */
  readonly selectableCardMode?: 'SINGLE' | 'ORDERED_MULTI';
  /** 多选步骤最少选择数量 */
  readonly minSelectableCards?: number;
  /** 多选步骤最多选择数量 */
  readonly maxSelectableCards?: number;
  /** 当前步骤可选择的成员槽位 */
  readonly selectableSlots?: readonly SlotPosition[];
  /** 当前步骤可选择的通用选项 */
  readonly selectableOptions?: readonly { readonly id: string; readonly label: string }[];
  /** 当前步骤的站位变换交互状态 */
  readonly stageFormation?: ActiveEffectStageFormationState;
  /** 当前步骤需要玩家输入的数字 */
  readonly numericInput?: ActiveEffectNumericInputState;
  /** 当前可选卡牌区的标题文案 */
  readonly selectionLabel?: string;
  /** 当前选择确认按钮文案 */
  readonly confirmSelectionLabel?: string;
  /** 是否允许按当前队列顺序继续发动后续同一时点能力 */
  readonly canResolveInOrder?: boolean;
  /** 当前步骤是否允许不选择卡牌继续 */
  readonly canSkipSelection?: boolean;
  /** 允许不选择时的按钮文案 */
  readonly skipSelectionLabel?: string;
  /** 步骤私有元数据 */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type PendingCostPaymentSource = 'PLAY_MEMBER' | 'ACTIVATE_ABILITY';

export interface PendingCostPaymentState {
  /** 当前费用支付实例 ID */
  readonly id: string;
  /** 需要支付费用的玩家 */
  readonly playerId: string;
  /** 费用来源 */
  readonly source: PendingCostPaymentSource;
  /** 来源卡牌实例 ID */
  readonly sourceCardId: string;
  /** 目标成员槽位（成员登场费用时使用） */
  readonly targetSlot?: SlotPosition;
  /** 基础费用 */
  readonly baseCost: number;
  /** 换手或效果减免后的最终能量费用 */
  readonly finalEnergyCost: number;
  /** 换手减免 */
  readonly relayDiscount: number;
  /** 目标槽位原成员 */
  readonly replacedMemberCardId: string | null;
  /** 本次换手的完整成员列表；旧单换手长度为 1，双换手长度为 2。 */
  readonly relayReplacements?: readonly {
    readonly cardId: string;
    readonly slot: SlotPosition;
    readonly effectiveCost: number;
  }[];
  /** 可用于支付的活跃能量 */
  readonly payableEnergyCardIds: readonly string[];
  /** 费用计算说明，给 UI 和调试使用 */
  readonly explanation?: string;
}

// ============================================
// 游戏状态定义
// ============================================

/**
 * 游戏状态
 * 包含完整的游戏状态信息
 */
export interface GameState {
  /** 游戏唯一 ID */
  readonly gameId: string;

  /** 游戏创建时间戳 */
  readonly createdAt: number;

  /**
   * 双方玩家状态
   * 索引 0 为先攻初始玩家，索引 1 为后攻初始玩家
   */
  readonly players: readonly [PlayerState, PlayerState];

  /**
   * 所有卡牌实例映射
   * instanceId -> CardInstance
   */
  readonly cardRegistry: ReadonlyMap<string, CardInstance>;

  // ---- 回合与阶段状态 ----

  /**
   * 当前回合数
   * 从 1 开始计数
   */
  readonly turnCount: number;

  /**
   * 当前游戏阶段
   */
  readonly currentPhase: GamePhase;

  /**
   * 当前回合类型
   */
  readonly currentTurnType: TurnType;

  /**
   * 当前先攻玩家索引（0 或 1）
   * 参考规则 8.4.13 - Live 胜利可能改变先攻
   */
  readonly firstPlayerIndex: number;

  /**
   * 当前主动玩家索引（0 或 1）
   * 参考规则 7.2
   */
  readonly activePlayerIndex: number;

  // ---- 子阶段状态（用于 Live 阶段详细流程控制） ----

  /**
   * 当前子阶段
   * 用于细化 Live 阶段的流程控制
   */
  readonly currentSubPhase: SubPhase;

  /**
   * 效果发动窗口类型
   * 标识当前窗口可发动的效果类型
   */
  readonly effectWindowType: EffectWindowType;

  /**
   * 当前可发动的能力 ID 列表（仅作为提示，不强制发动）
   */
  readonly availableAbilityIds: readonly string[];

  /**
   * 已经由检查时点发现、等待执行的能力队列
   */
  readonly pendingAbilities: readonly PendingAbilityState[];

  /**
   * 卡效执行中等待玩家作出的一个选择
   */
  readonly pendingChoice: PendingChoiceState | null;

  /**
   * 正在分步处理的卡牌效果。
   */
  readonly activeEffect: ActiveEffectState | null;

  /**
   * 正在等待玩家支付的费用。
   */
  readonly pendingCostPayment: PendingCostPaymentState | null;

  /**
   * 用户操作历史栈（用于撤销功能）
   */
  readonly operationHistory: readonly UserOperation[];

  /**
   * Live 设置阶段：各玩家盖牌数量（用于后续抽卡）
   */
  readonly liveSetCardCounts: ReadonlyMap<string, number>;

  // ---- 共享区域 ----

  /**
   * 解决区域（共享）
   * 参考规则 4.14
   */
  readonly resolutionZone: ResolutionZoneState;
  /** 检视区域（独立于解决区域） */
  readonly inspectionZone: InspectionZoneState;
  /** 当前进行中的检视流程上下文 */
  readonly inspectionContext: InspectionContextState | null;

  // ---- Live 相关状态 ----

  /**
   * Live 结算状态
   */
  readonly liveResolution: LiveResolutionState;
  /**
   * 卡效造成的“不能 Live”临时限制。
   *
   * 当前仅承接“直到 Live 结束时为止”语义；由 LIVE 结束清理点统一移除。
   */
  readonly liveProhibitions: readonly LiveProhibitionState[];
  /**
   * 卡效造成的“某成员全部 LIVE 开始时能力无效”临时标记。
   *
   * 当前仅承接“直到 Live 结束时为止”语义；由 LIVE 结束清理点统一移除。
   */
  readonly liveStartSuppressions: readonly LiveStartSuppressionState[];
  /**
   * 卡效造成的“下次自己的活跃阶段不变为活跃状态”临时标记。
   */
  readonly memberActivePhaseSkips: readonly MemberActivePhaseSkipState[];

  // ---- 游戏进程状态 ----

  /**
   * 游戏是否已开始
   */
  readonly isStarted: boolean;

  /**
   * 游戏是否已结束
   */
  readonly isEnded: boolean;

  /**
   * 游戏结束信息
   */
  readonly endInfo: GameEndInfo | null;

  // ---- 历史记录 ----

  /**
   * 游戏动作历史
   */
  readonly actionHistory: readonly GameAction[];

  /**
   * 当前动作序号计数器
   */
  readonly actionSequence: number;

  /**
   * 标准规则事件历史。
   *
   * 后续 AUTO/trigger matcher 应以此日志为权威事实来源；当前 actionHistory 仍保留给审计、UI 与既有流程。
   */
  readonly eventLog: readonly GameEventLogEntry[];

  /**
   * 当前规则事件序号计数器
   */
  readonly eventSequence: number;

  // ---- 临时状态 ----

  /**
   * 等待玩家输入的标记
   */
  readonly waitingForInput: boolean;

  /**
   * 等待输入的玩家 ID
   */
  readonly waitingPlayerId: string | null;

  /**
   * 当前循环计数（用于无限循环检测）
   */
  readonly loopCounter: number;

  // ---- Live 设置阶段追踪 ----

  /**
   * 已完成 Live 卡设置的玩家 ID 列表
   * 用于追踪 Live 设置阶段的进度（规则 8.2）
   */
  readonly liveSetCompletedPlayers: readonly string[];

  // ---- 换牌阶段追踪 ----

  /**
   * 已完成换牌的玩家 ID 列表
   * 用于追踪 Mulligan 阶段的进度
   */
  readonly mulliganCompletedPlayers: readonly string[];
}

// ============================================
// 游戏状态工厂函数
// ============================================

/**
 * 创建初始游戏状态
 */
export function createGameState(
  gameId: string,
  player1Id: string,
  player1Name: string,
  player2Id: string,
  player2Name: string
): GameState {
  const now = Date.now();

  return {
    gameId,
    createdAt: now,

    players: [
      createPlayerState(player1Id, player1Name, true),
      createPlayerState(player2Id, player2Name, false),
    ],

    cardRegistry: new Map(),

    turnCount: 0,
    currentPhase: GamePhase.SETUP,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,

    // 子阶段状态
    currentSubPhase: SubPhase.NONE,
    effectWindowType: EffectWindowType.NONE,
    availableAbilityIds: [],
    pendingAbilities: [],
    pendingChoice: null,
    activeEffect: null,
    pendingCostPayment: null,
    operationHistory: [],
    liveSetCardCounts: new Map(),

    resolutionZone: createEmptyResolutionZone(),
    inspectionZone: createEmptyInspectionZone(),
    inspectionContext: null,
    liveResolution: createEmptyLiveResolutionState(),
    liveProhibitions: [],
    liveStartSuppressions: [],
    memberActivePhaseSkips: [],

    isStarted: false,
    isEnded: false,
    endInfo: null,

    actionHistory: [],
    actionSequence: 0,
    eventLog: [],
    eventSequence: 0,

    waitingForInput: false,
    waitingPlayerId: null,
    loopCounter: 0,

    liveSetCompletedPlayers: [],
    mulliganCompletedPlayers: [],
  };
}

// ============================================
// 游戏状态查询函数
// ============================================

/**
 * 获取先攻玩家
 */
export function getFirstPlayer(game: GameState): PlayerState {
  return game.players[game.firstPlayerIndex];
}

/**
 * 获取后攻玩家
 */
export function getSecondPlayer(game: GameState): PlayerState {
  return game.players[game.firstPlayerIndex === 0 ? 1 : 0];
}

/**
 * 获取主动玩家
 * 参考规则 7.2
 */
export function getActivePlayer(game: GameState): PlayerState {
  return game.players[game.activePlayerIndex];
}

/**
 * 获取非主动玩家
 */
export function getNonActivePlayer(game: GameState): PlayerState {
  return game.players[game.activePlayerIndex === 0 ? 1 : 0];
}

/**
 * 根据 ID 获取玩家
 */
export function getPlayerById(game: GameState, playerId: string): PlayerState | null {
  return game.players.find((p) => p.id === playerId) ?? null;
}

/**
 * 是否存在需要先处理完、不能继续自动推进的能力或玩家选择。
 */
export function hasPendingAbilityOrChoice(game: GameState): boolean {
  return (
    game.pendingAbilities.length > 0 ||
    game.pendingChoice !== null ||
    game.activeEffect !== null ||
    game.pendingCostPayment !== null
  );
}

/**
 * 根据 ID 获取玩家索引
 */
export function getPlayerIndex(game: GameState, playerId: string): number {
  return game.players.findIndex((p) => p.id === playerId);
}

/**
 * 获取对手玩家
 */
export function getOpponent(game: GameState, playerId: string): PlayerState | null {
  const playerIndex = getPlayerIndex(game, playerId);
  if (playerIndex === -1) return null;
  return game.players[playerIndex === 0 ? 1 : 0];
}

/**
 * 根据实例 ID 获取卡牌
 */
export function getCardById(game: GameState, instanceId: string): CardInstance | null {
  return game.cardRegistry.get(instanceId) ?? null;
}

/**
 * 检查游戏是否处于指定阶段
 */
export function isInPhase(game: GameState, phase: GamePhase): boolean {
  return game.currentPhase === phase;
}

/**
 * 检查是否为指定玩家的回合
 */
export function isPlayerTurn(game: GameState, playerId: string): boolean {
  const activePlayer = getActivePlayer(game);
  return activePlayer.id === playerId;
}

/**
 * 检查是否有玩家达成胜利条件
 */
export function checkVictoryCondition(game: GameState): string | null {
  for (const player of game.players) {
    if (hasReachedVictoryCondition(player)) {
      return player.id;
    }
  }
  return null;
}

/**
 * 检查是否有玩家需要刷新卡组
 */
export function checkRefreshNeeded(game: GameState): string[] {
  return game.players.filter((p) => needsRefresh(p)).map((p) => p.id);
}

/**
 * 检查是否检测到无限循环
 */
export function isInfiniteLoopDetected(game: GameState): boolean {
  return game.loopCounter >= GAME_CONFIG.INFINITE_LOOP_THRESHOLD;
}

// ============================================
// 游戏状态更新函数（纯函数）
// ============================================

/**
 * 更新玩家状态
 */
export function updatePlayer(
  game: GameState,
  playerId: string,
  updater: (player: PlayerState) => PlayerState
): GameState {
  const playerIndex = getPlayerIndex(game, playerId);
  if (playerIndex === -1) return game;

  const newPlayers = [...game.players] as [PlayerState, PlayerState];
  newPlayers[playerIndex] = updater(newPlayers[playerIndex]);

  return {
    ...game,
    players: newPlayers,
  };
}

/**
 * 更新双方玩家状态
 */
export function updateBothPlayers(
  game: GameState,
  updater: (player: PlayerState) => PlayerState
): GameState {
  return {
    ...game,
    players: [updater(game.players[0]), updater(game.players[1])],
  };
}

/**
 * 设置游戏阶段
 */
export function setPhase(game: GameState, phase: GamePhase): GameState {
  return {
    ...game,
    currentPhase: phase,
  };
}

/**
 * 设置回合类型
 */
export function setTurnType(game: GameState, turnType: TurnType): GameState {
  return {
    ...game,
    currentTurnType: turnType,
  };
}

/**
 * 设置主动玩家
 */
export function setActivePlayer(game: GameState, playerIndex: number): GameState {
  return {
    ...game,
    activePlayerIndex: playerIndex,
  };
}

/**
 * 切换先攻玩家
 * 参考规则 8.4.13
 */
export function switchFirstPlayer(game: GameState): GameState {
  const newFirstPlayerIndex = game.firstPlayerIndex === 0 ? 1 : 0;
  const newPlayers = [
    { ...game.players[0], isFirstPlayer: newFirstPlayerIndex === 0 },
    { ...game.players[1], isFirstPlayer: newFirstPlayerIndex === 1 },
  ] as [PlayerState, PlayerState];

  return {
    ...game,
    firstPlayerIndex: newFirstPlayerIndex,
    players: newPlayers,
  };
}

/**
 * 增加回合数
 */
export function incrementTurn(game: GameState): GameState {
  return {
    ...game,
    turnCount: game.turnCount + 1,
  };
}

/**
 * 注册卡牌到游戏
 */
export function registerCard(game: GameState, card: CardInstance): GameState {
  const newRegistry = new Map(game.cardRegistry);
  newRegistry.set(card.instanceId, card);

  return {
    ...game,
    cardRegistry: newRegistry,
  };
}

/**
 * 批量注册卡牌
 */
export function registerCards(game: GameState, cards: CardInstance[]): GameState {
  const newRegistry = new Map(game.cardRegistry);
  for (const card of cards) {
    newRegistry.set(card.instanceId, card);
  }

  return {
    ...game,
    cardRegistry: newRegistry,
  };
}

/**
 * 添加游戏动作到历史
 */
export function addAction(
  game: GameState,
  type: GameActionType,
  playerId: string | null,
  payload: Record<string, unknown>
): GameState {
  const action: GameAction = {
    id: `${game.gameId}-${game.actionSequence + 1}`,
    type,
    playerId,
    timestamp: Date.now(),
    payload,
    sequence: game.actionSequence + 1,
  };

  return {
    ...game,
    actionHistory: [...game.actionHistory, action],
    actionSequence: game.actionSequence + 1,
  };
}

/**
 * 添加标准规则事件到权威事件日志。
 */
export function emitGameEvent(
  game: GameState,
  event: GameEvent,
  metadata: { readonly causedByActionId?: string } = {}
): GameState {
  const entry: GameEventLogEntry = {
    sequence: game.eventSequence + 1,
    event,
    causedByActionId: metadata.causedByActionId,
  };

  return {
    ...game,
    eventLog: [...game.eventLog, entry],
    eventSequence: game.eventSequence + 1,
  };
}

/**
 * 设置等待玩家输入状态
 */
export function setWaitingForInput(game: GameState, playerId: string | null): GameState {
  return {
    ...game,
    waitingForInput: playerId !== null,
    waitingPlayerId: playerId,
  };
}

/**
 * 增加循环计数器
 */
export function incrementLoopCounter(game: GameState): GameState {
  return {
    ...game,
    loopCounter: game.loopCounter + 1,
  };
}

/**
 * 重置循环计数器
 */
export function resetLoopCounter(game: GameState): GameState {
  return {
    ...game,
    loopCounter: 0,
  };
}

/**
 * 更新 Live 结算状态
 */
export function updateLiveResolution(
  game: GameState,
  updater: (state: LiveResolutionState) => LiveResolutionState
): GameState {
  return {
    ...game,
    liveResolution: updater(game.liveResolution),
  };
}

/**
 * 更新解决区域
 */
export function updateResolutionZone(
  game: GameState,
  updater: (zone: ResolutionZoneState) => ResolutionZoneState
): GameState {
  return {
    ...game,
    resolutionZone: updater(game.resolutionZone),
  };
}

/**
 * 更新检视区域
 */
export function updateInspectionZone(
  game: GameState,
  updater: (zone: InspectionZoneState) => InspectionZoneState
): GameState {
  return {
    ...game,
    inspectionZone: updater(game.inspectionZone),
  };
}

export function setInspectionContext(
  game: GameState,
  inspectionContext: InspectionContextState | null
): GameState {
  return {
    ...game,
    inspectionContext,
  };
}

/**
 * 标记游戏开始（进入换牌阶段）
 */
export function markGameStarted(game: GameState): GameState {
  return {
    ...game,
    isStarted: true,
    turnCount: 1,
    currentPhase: GamePhase.MULLIGAN_PHASE,
    currentSubPhase: SubPhase.MULLIGAN_FIRST_PLAYER,
  };
}

/**
 * 标记换牌阶段完成，进入活跃阶段
 */
export function markMulliganCompleted(game: GameState): GameState {
  return {
    ...game,
    currentPhase: GamePhase.ACTIVE_PHASE,
    currentSubPhase: SubPhase.NONE,
    mulliganCompletedPlayers: [],
  };
}

/**
 * 添加已完成换牌的玩家
 */
export function addMulliganCompletedPlayer(game: GameState, playerId: string): GameState {
  if (game.mulliganCompletedPlayers.includes(playerId)) {
    return game;
  }
  return {
    ...game,
    mulliganCompletedPlayers: [...game.mulliganCompletedPlayers, playerId],
  };
}

/**
 * 检查是否所有玩家都完成了换牌
 */
export function isAllMulliganCompleted(game: GameState): boolean {
  return game.mulliganCompletedPlayers.length >= 2;
}

/**
 * 设置子阶段
 */
export function setSubPhase(game: GameState, subPhase: SubPhase): GameState {
  return {
    ...game,
    currentSubPhase: subPhase,
  };
}

/**
 * 设置效果发动窗口类型
 */
export function setEffectWindowType(game: GameState, windowType: EffectWindowType): GameState {
  return {
    ...game,
    effectWindowType: windowType,
  };
}

/**
 * 更新可发动能力列表
 */
export function setAvailableAbilities(game: GameState, abilityIds: readonly string[]): GameState {
  return {
    ...game,
    availableAbilityIds: abilityIds,
  };
}

/**
 * 添加用户操作到历史栈
 */
export function pushOperation(game: GameState, operation: UserOperation): GameState {
  return {
    ...game,
    operationHistory: [...game.operationHistory, operation],
  };
}

/**
 * 撤销最后一个操作
 */
export function popOperation(game: GameState): {
  game: GameState;
  operation: UserOperation | null;
} {
  if (game.operationHistory.length === 0) {
    return { game, operation: null };
  }
  const lastOperation = game.operationHistory[game.operationHistory.length - 1];
  return {
    game: {
      ...game,
      operationHistory: game.operationHistory.slice(0, -1),
    },
    operation: lastOperation,
  };
}

/**
 * 清空操作历史栈
 */
export function clearOperationHistory(game: GameState): GameState {
  return {
    ...game,
    operationHistory: [],
  };
}

/**
 * 更新 Live 设置阶段盖牌数量
 */
export function setLiveSetCardCount(game: GameState, playerId: string, count: number): GameState {
  const newCounts = new Map(game.liveSetCardCounts);
  newCounts.set(playerId, count);
  return {
    ...game,
    liveSetCardCounts: newCounts,
  };
}

/**
 * 清空 Live 设置阶段盖牌数量
 */
export function clearLiveSetCardCounts(game: GameState): GameState {
  return {
    ...game,
    liveSetCardCounts: new Map(),
  };
}

/**
 * 标记游戏结束
 */
export function markGameEnded(
  game: GameState,
  reason: GameEndReason,
  winnerId: string | null
): GameState {
  const loserId =
    winnerId !== null ? (game.players.find((p) => p.id !== winnerId)?.id ?? null) : null;

  const endInfo: GameEndInfo = {
    reason,
    winnerId,
    loserId,
    isDraw: winnerId === null,
    endTimestamp: Date.now(),
    finalTurnCount: game.turnCount,
  };

  return {
    ...game,
    isEnded: true,
    endInfo,
    currentPhase: GamePhase.GAME_END,
  };
}

// ============================================
// 阶段流转辅助函数
// ============================================

/**
 * 获取下一个阶段
 * 参考规则 7.3 和 8.1
 */
export function getNextPhase(game: GameState): GamePhase {
  const { currentPhase, currentTurnType } = game;

  switch (currentPhase) {
    case GamePhase.SETUP:
      return GamePhase.MULLIGAN_PHASE;

    case GamePhase.MULLIGAN_PHASE:
      return GamePhase.ACTIVE_PHASE;

    // 通常阶段流程
    case GamePhase.ACTIVE_PHASE:
      return GamePhase.ENERGY_PHASE;
    case GamePhase.ENERGY_PHASE:
      return GamePhase.DRAW_PHASE;
    case GamePhase.DRAW_PHASE:
      return GamePhase.MAIN_PHASE;
    case GamePhase.MAIN_PHASE:
      // 先攻结束后进入后攻，后攻结束后进入 Live
      if (currentTurnType === TurnType.FIRST_PLAYER_TURN) {
        return GamePhase.ACTIVE_PHASE; // 会切换到后攻
      } else {
        return GamePhase.LIVE_SET_PHASE;
      }

    // Live 阶段流程
    case GamePhase.LIVE_SET_PHASE:
      return GamePhase.PERFORMANCE_PHASE;
    case GamePhase.PERFORMANCE_PHASE:
      // 先攻表演后是后攻表演，后攻表演后是判定
      if (currentTurnType === TurnType.FIRST_PLAYER_TURN) {
        return GamePhase.PERFORMANCE_PHASE; // 会切换到后攻
      } else {
        return GamePhase.LIVE_RESULT_PHASE;
      }
    case GamePhase.LIVE_RESULT_PHASE:
      return GamePhase.ACTIVE_PHASE; // 新回合开始

    case GamePhase.GAME_END:
      return GamePhase.GAME_END;

    default:
      return currentPhase;
  }
}

// ============================================
// 游戏状态快照（用于网络传输）
// ============================================

/**
 * 游戏状态快照
 * 序列化友好的格式
 */
export interface GameStateSnapshot {
  readonly gameId: string;
  readonly turnCount: number;
  readonly currentPhase: GamePhase;
  readonly currentTurnType: TurnType;
  readonly firstPlayerIndex: number;
  readonly activePlayerIndex: number;
  readonly isStarted: boolean;
  readonly isEnded: boolean;
  readonly endInfo: GameEndInfo | null;
}

/**
 * 生成游戏状态快照
 */
export function createGameSnapshot(game: GameState): GameStateSnapshot {
  return {
    gameId: game.gameId,
    turnCount: game.turnCount,
    currentPhase: game.currentPhase,
    currentTurnType: game.currentTurnType,
    firstPlayerIndex: game.firstPlayerIndex,
    activePlayerIndex: game.activePlayerIndex,
    isStarted: game.isStarted,
    isEnded: game.isEnded,
    endInfo: game.endInfo,
  };
}
