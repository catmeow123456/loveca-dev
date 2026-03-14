/**
 * Loveca 游戏事件系统
 * 基于 detail_rules.md 第 9.7 章 - 自动能力触发
 */

import { TriggerCondition, ZoneType, GamePhase, SlotPosition } from '../../shared/types/enums';
import type { CardInstance } from '../entities/card';

// ============================================
// 事件基础定义
// ============================================

/**
 * 游戏事件基础接口
 */
export interface BaseGameEvent {
  /** 事件唯一 ID */
  readonly eventId: string;
  /** 事件类型（对应 TriggerCondition） */
  readonly eventType: TriggerCondition;
  /** 事件发生时间戳 */
  readonly timestamp: number;
  /** 触发玩家 ID（如果适用） */
  readonly triggerPlayerId?: string;
}

// ============================================
// 阶段相关事件
// ============================================

/**
 * 游戏开始事件
 */
export interface GameStartEvent extends BaseGameEvent {
  readonly eventType: TriggerCondition.ON_GAME_START;
  /** 先攻玩家 ID */
  readonly firstPlayerId: string;
  /** 后攻玩家 ID */
  readonly secondPlayerId: string;
}

/**
 * 回合开始事件
 */
export interface TurnStartEvent extends BaseGameEvent {
  readonly eventType: TriggerCondition.ON_TURN_START;
  /** 回合数 */
  readonly turnNumber: number;
  /** 当前回合玩家 ID */
  readonly currentPlayerId: string;
}

/**
 * 回合结束事件
 */
export interface TurnEndEvent extends BaseGameEvent {
  readonly eventType: TriggerCondition.ON_TURN_END;
  /** 回合数 */
  readonly turnNumber: number;
  /** 当前回合玩家 ID */
  readonly currentPlayerId: string;
}

/**
 * 阶段开始事件
 */
export interface PhaseStartEvent extends BaseGameEvent {
  readonly eventType:
    | TriggerCondition.ON_ACTIVE_PHASE_START
    | TriggerCondition.ON_ENERGY_PHASE_START
    | TriggerCondition.ON_DRAW_PHASE_START
    | TriggerCondition.ON_MAIN_PHASE_START
    | TriggerCondition.ON_LIVE_PHASE_START
    | TriggerCondition.ON_LIVE_SET_PHASE_START
    | TriggerCondition.ON_PERFORMANCE_PHASE_START
    | TriggerCondition.ON_LIVE_RESULT_PHASE_START;
  /** 游戏阶段 */
  readonly phase: GamePhase;
  /** 当前回合玩家 ID */
  readonly currentPlayerId: string;
}

// ============================================
// 区域移动事件
// ============================================

/**
 * 卡牌移动事件（区域移动诱发基础）
 * 参考规则 9.7.4
 */
export interface CardMoveEvent extends BaseGameEvent {
  /** 移动的卡牌实例 ID */
  readonly cardInstanceId: string;
  /** 来源区域 */
  readonly fromZone: ZoneType;
  /** 目标区域 */
  readonly toZone: ZoneType;
  /** 来源槽位（如果从成员区域移动） */
  readonly fromSlot?: SlotPosition;
  /** 目标槽位（如果移动到成员区域） */
  readonly toSlot?: SlotPosition;
  /** 卡牌持有者 ID */
  readonly ownerId: string;
  /** 卡牌掌控者 ID */
  readonly controllerId: string;
}

/**
 * 成员登场事件
 */
export interface EnterStageEvent extends CardMoveEvent {
  readonly eventType: TriggerCondition.ON_ENTER_STAGE;
  readonly toZone: ZoneType.MEMBER_SLOT;
  /** 登场的槽位 */
  readonly toSlot: SlotPosition;
}

/**
 * 成员离场事件
 */
export interface LeaveStageEvent extends CardMoveEvent {
  readonly eventType: TriggerCondition.ON_LEAVE_STAGE;
  readonly fromZone: ZoneType.MEMBER_SLOT;
  /** 离场的槽位 */
  readonly fromSlot: SlotPosition;
}

/**
 * 卡牌进入手牌事件
 */
export interface EnterHandEvent extends CardMoveEvent {
  readonly eventType: TriggerCondition.ON_ENTER_HAND;
  readonly toZone: ZoneType.HAND;
}

/**
 * 卡牌进入休息室事件
 */
export interface EnterWaitingRoomEvent extends CardMoveEvent {
  readonly eventType: TriggerCondition.ON_ENTER_WAITING_ROOM;
  readonly toZone: ZoneType.WAITING_ROOM;
}

// ============================================
// Live 相关事件
// ============================================

/**
 * Live 开始事件
 */
export interface LiveStartEvent extends BaseGameEvent {
  readonly eventType: TriggerCondition.ON_LIVE_START;
  /** 表演者（当前回合玩家） ID */
  readonly performerId: string;
  /** Live 卡实例 ID 列表 */
  readonly liveCardIds: readonly string[];
}

/**
 * Live 成功事件
 */
export interface LiveSuccessEvent extends BaseGameEvent {
  readonly eventType: TriggerCondition.ON_LIVE_SUCCESS;
  /** Live 成功的玩家 ID */
  readonly playerId: string;
  /** 成功的 Live 卡实例 ID 列表 */
  readonly successfulLiveCardIds: readonly string[];
  /** 获得的分数 */
  readonly score: number;
}

/**
 * Live 失败事件
 */
export interface LiveFailEvent extends BaseGameEvent {
  readonly eventType: TriggerCondition.ON_LIVE_FAIL;
  /** Live 失败的玩家 ID */
  readonly playerId: string;
  /** 失败的 Live 卡实例 ID 列表 */
  readonly failedLiveCardIds: readonly string[];
}

// ============================================
// 动作事件
// ============================================

/**
 * Cheer 事件
 */
export interface CheerEvent extends BaseGameEvent {
  readonly eventType: TriggerCondition.ON_CHEER;
  /** 执行 Cheer 的玩家 ID */
  readonly playerId: string;
  /** Cheer 公开的卡牌实例 ID */
  readonly revealedCardIds: readonly string[];
  /** 总光棒数 */
  readonly totalBlade: number;
}

/**
 * 接力传递事件
 */
export interface RelayEvent extends BaseGameEvent {
  readonly eventType: TriggerCondition.ON_RELAY;
  /** 执行接力的玩家 ID */
  readonly playerId: string;
  /** 被送入休息室的成员卡实例 ID */
  readonly replacedMemberCardId: string;
  /** 新登场的成员卡实例 ID */
  readonly newMemberCardId: string;
  /** 减免的费用值 */
  readonly costReduction: number;
}

/**
 * 抽卡事件
 */
export interface DrawEvent extends BaseGameEvent {
  readonly eventType: TriggerCondition.ON_DRAW;
  /** 抽卡的玩家 ID */
  readonly playerId: string;
  /** 抽到的卡牌实例 ID 列表 */
  readonly drawnCardIds: readonly string[];
  /** 抽卡张数 */
  readonly count: number;
}

/**
 * 支付费用事件
 */
export interface PayCostEvent extends BaseGameEvent {
  readonly eventType: TriggerCondition.ON_PAY_COST;
  /** 支付费用的玩家 ID */
  readonly playerId: string;
  /** 支付的门票数量 */
  readonly ticketsPaid: number;
  /** 变为等待状态的能量卡实例 ID 列表 */
  readonly energyCardIds: readonly string[];
}

// ============================================
// 状态触发事件
// ============================================

/**
 * 手牌为空事件
 */
export interface HandEmptyEvent extends BaseGameEvent {
  readonly eventType: TriggerCondition.ON_HAND_EMPTY;
  /** 手牌为空的玩家 ID */
  readonly playerId: string;
}

/**
 * 卡组为空事件
 */
export interface DeckEmptyEvent extends BaseGameEvent {
  readonly eventType: TriggerCondition.ON_DECK_EMPTY;
  /** 卡组为空的玩家 ID */
  readonly playerId: string;
}

// ============================================
// 事件联合类型
// ============================================

/**
 * 所有游戏事件的联合类型
 */
export type GameEvent =
  | GameStartEvent
  | TurnStartEvent
  | TurnEndEvent
  | PhaseStartEvent
  | CardMoveEvent
  | EnterStageEvent
  | LeaveStageEvent
  | EnterHandEvent
  | EnterWaitingRoomEvent
  | LiveStartEvent
  | LiveSuccessEvent
  | LiveFailEvent
  | CheerEvent
  | RelayEvent
  | DrawEvent
  | PayCostEvent
  | HandEmptyEvent
  | DeckEmptyEvent;

// ============================================
// 类型守卫
// ============================================

/**
 * 判断是否为区域移动事件
 */
export function isCardMoveEvent(event: GameEvent): event is CardMoveEvent {
  return (
    event.eventType === TriggerCondition.ON_ENTER_STAGE ||
    event.eventType === TriggerCondition.ON_LEAVE_STAGE ||
    event.eventType === TriggerCondition.ON_ENTER_HAND ||
    event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
  );
}

/**
 * 判断是否为阶段开始事件
 */
export function isPhaseStartEvent(event: GameEvent): event is PhaseStartEvent {
  return (
    event.eventType === TriggerCondition.ON_ACTIVE_PHASE_START ||
    event.eventType === TriggerCondition.ON_ENERGY_PHASE_START ||
    event.eventType === TriggerCondition.ON_DRAW_PHASE_START ||
    event.eventType === TriggerCondition.ON_MAIN_PHASE_START ||
    event.eventType === TriggerCondition.ON_LIVE_PHASE_START ||
    event.eventType === TriggerCondition.ON_LIVE_SET_PHASE_START ||
    event.eventType === TriggerCondition.ON_PERFORMANCE_PHASE_START ||
    event.eventType === TriggerCondition.ON_LIVE_RESULT_PHASE_START
  );
}

/**
 * 判断是否为 Live 相关事件
 */
export function isLiveEvent(
  event: GameEvent
): event is LiveStartEvent | LiveSuccessEvent | LiveFailEvent {
  return (
    event.eventType === TriggerCondition.ON_LIVE_START ||
    event.eventType === TriggerCondition.ON_LIVE_SUCCESS ||
    event.eventType === TriggerCondition.ON_LIVE_FAIL
  );
}

// ============================================
// 事件工厂函数
// ============================================

let eventIdCounter = 0;

/**
 * 生成事件 ID
 */
function generateEventId(): string {
  return `event_${Date.now()}_${++eventIdCounter}`;
}

/**
 * 创建游戏开始事件
 */
export function createGameStartEvent(
  firstPlayerId: string,
  secondPlayerId: string
): GameStartEvent {
  return {
    eventId: generateEventId(),
    eventType: TriggerCondition.ON_GAME_START,
    timestamp: Date.now(),
    firstPlayerId,
    secondPlayerId,
  };
}

/**
 * 创建回合开始事件
 */
export function createTurnStartEvent(turnNumber: number, currentPlayerId: string): TurnStartEvent {
  return {
    eventId: generateEventId(),
    eventType: TriggerCondition.ON_TURN_START,
    timestamp: Date.now(),
    turnNumber,
    currentPlayerId,
    triggerPlayerId: currentPlayerId,
  };
}

/**
 * 创建回合结束事件
 */
export function createTurnEndEvent(turnNumber: number, currentPlayerId: string): TurnEndEvent {
  return {
    eventId: generateEventId(),
    eventType: TriggerCondition.ON_TURN_END,
    timestamp: Date.now(),
    turnNumber,
    currentPlayerId,
    triggerPlayerId: currentPlayerId,
  };
}

/**
 * 创建阶段开始事件
 */
export function createPhaseStartEvent(phase: GamePhase, currentPlayerId: string): PhaseStartEvent {
  const eventTypeMap: Partial<Record<GamePhase, TriggerCondition>> = {
    [GamePhase.ACTIVE_PHASE]: TriggerCondition.ON_ACTIVE_PHASE_START,
    [GamePhase.ENERGY_PHASE]: TriggerCondition.ON_ENERGY_PHASE_START,
    [GamePhase.DRAW_PHASE]: TriggerCondition.ON_DRAW_PHASE_START,
    [GamePhase.MAIN_PHASE]: TriggerCondition.ON_MAIN_PHASE_START,
    [GamePhase.LIVE_SET_PHASE]: TriggerCondition.ON_LIVE_SET_PHASE_START,
    [GamePhase.PERFORMANCE_PHASE]: TriggerCondition.ON_PERFORMANCE_PHASE_START,
    [GamePhase.LIVE_RESULT_PHASE]: TriggerCondition.ON_LIVE_RESULT_PHASE_START,
  };

  const eventType = eventTypeMap[phase] || TriggerCondition.ON_ACTIVE_PHASE_START;

  return {
    eventId: generateEventId(),
    eventType: eventType as PhaseStartEvent['eventType'],
    timestamp: Date.now(),
    phase,
    currentPlayerId,
    triggerPlayerId: currentPlayerId,
  };
}

/**
 * 创建成员登场事件
 */
export function createEnterStageEvent(
  cardInstanceId: string,
  fromZone: ZoneType,
  toSlot: SlotPosition,
  ownerId: string,
  controllerId: string
): EnterStageEvent {
  return {
    eventId: generateEventId(),
    eventType: TriggerCondition.ON_ENTER_STAGE,
    timestamp: Date.now(),
    cardInstanceId,
    fromZone,
    toZone: ZoneType.MEMBER_SLOT,
    toSlot,
    ownerId,
    controllerId,
    triggerPlayerId: controllerId,
  };
}

/**
 * 创建成员离场事件
 */
export function createLeaveStageEvent(
  cardInstanceId: string,
  fromSlot: SlotPosition,
  toZone: ZoneType,
  ownerId: string,
  controllerId: string
): LeaveStageEvent {
  return {
    eventId: generateEventId(),
    eventType: TriggerCondition.ON_LEAVE_STAGE,
    timestamp: Date.now(),
    cardInstanceId,
    fromZone: ZoneType.MEMBER_SLOT,
    toZone,
    fromSlot,
    ownerId,
    controllerId,
    triggerPlayerId: controllerId,
  };
}

/**
 * 创建抽卡事件
 */
export function createDrawEvent(
  playerId: string,
  drawnCardIds: readonly string[],
  count: number
): DrawEvent {
  return {
    eventId: generateEventId(),
    eventType: TriggerCondition.ON_DRAW,
    timestamp: Date.now(),
    playerId,
    drawnCardIds,
    count,
    triggerPlayerId: playerId,
  };
}

/**
 * 创建 Live 开始事件
 */
export function createLiveStartEvent(
  performerId: string,
  liveCardIds: readonly string[]
): LiveStartEvent {
  return {
    eventId: generateEventId(),
    eventType: TriggerCondition.ON_LIVE_START,
    timestamp: Date.now(),
    performerId,
    liveCardIds,
    triggerPlayerId: performerId,
  };
}

/**
 * 创建 Live 成功事件
 */
export function createLiveSuccessEvent(
  playerId: string,
  successfulLiveCardIds: readonly string[],
  score: number
): LiveSuccessEvent {
  return {
    eventId: generateEventId(),
    eventType: TriggerCondition.ON_LIVE_SUCCESS,
    timestamp: Date.now(),
    playerId,
    successfulLiveCardIds,
    score,
    triggerPlayerId: playerId,
  };
}

/**
 * 创建 Live 失败事件
 */
export function createLiveFailEvent(
  playerId: string,
  failedLiveCardIds: readonly string[]
): LiveFailEvent {
  return {
    eventId: generateEventId(),
    eventType: TriggerCondition.ON_LIVE_FAIL,
    timestamp: Date.now(),
    playerId,
    failedLiveCardIds,
    triggerPlayerId: playerId,
  };
}

/**
 * 创建 Cheer 事件
 */
export function createCheerEvent(
  playerId: string,
  revealedCardIds: readonly string[],
  totalBlade: number
): CheerEvent {
  return {
    eventId: generateEventId(),
    eventType: TriggerCondition.ON_CHEER,
    timestamp: Date.now(),
    playerId,
    revealedCardIds,
    totalBlade,
    triggerPlayerId: playerId,
  };
}

/**
 * 创建接力传递事件
 */
export function createRelayEvent(
  playerId: string,
  replacedMemberCardId: string,
  newMemberCardId: string,
  costReduction: number
): RelayEvent {
  return {
    eventId: generateEventId(),
    eventType: TriggerCondition.ON_RELAY,
    timestamp: Date.now(),
    playerId,
    replacedMemberCardId,
    newMemberCardId,
    costReduction,
    triggerPlayerId: playerId,
  };
}

// ============================================
// 事件总线
// ============================================

/**
 * 事件监听器类型
 */
export type EventListener = (event: GameEvent) => void;

/**
 * 事件总线类
 * 用于发布和订阅游戏事件
 */
export class EventBus {
  private listeners: Map<TriggerCondition, Set<EventListener>> = new Map();
  private globalListeners: Set<EventListener> = new Set();
  private eventHistory: GameEvent[] = [];
  private maxHistorySize: number;

  constructor(maxHistorySize: number = 1000) {
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * 订阅特定类型的事件
   */
  subscribe(eventType: TriggerCondition, listener: EventListener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);

    // 返回取消订阅函数
    return () => {
      this.listeners.get(eventType)?.delete(listener);
    };
  }

  /**
   * 订阅所有事件
   */
  subscribeAll(listener: EventListener): () => void {
    this.globalListeners.add(listener);

    return () => {
      this.globalListeners.delete(listener);
    };
  }

  /**
   * 发布事件
   */
  publish(event: GameEvent): void {
    // 记录到历史
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // 通知全局监听器
    for (const listener of this.globalListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Event listener error:', error);
      }
    }

    // 通知特定类型的监听器
    const typeListeners = this.listeners.get(event.eventType);
    if (typeListeners) {
      for (const listener of typeListeners) {
        try {
          listener(event);
        } catch (error) {
          console.error('Event listener error:', error);
        }
      }
    }
  }

  /**
   * 获取事件历史
   */
  getHistory(): readonly GameEvent[] {
    return this.eventHistory;
  }

  /**
   * 清空事件历史
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * 移除所有监听器
   */
  clear(): void {
    this.listeners.clear();
    this.globalListeners.clear();
  }
}

/**
 * 创建事件总线实例
 */
export function createEventBus(maxHistorySize?: number): EventBus {
  return new EventBus(maxHistorySize);
}
