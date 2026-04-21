/**
 * 规则处理模块
 * 基于 detail_rules.md 第 10 章 - 规则处理
 */

import { CardType, ZoneType, SlotPosition } from '../../shared/types/enums.js';
import type { GameState } from '../entities/game.js';
import type { PlayerState } from '../entities/player.js';

// ============================================
// 规则处理类型
// ============================================

/**
 * 规则处理类型枚举
 */
export enum RuleActionType {
  /** 刷新处理 - 规则 10.2 */
  REFRESH = 'REFRESH',
  /** 胜利处理 - 规则 10.3 */
  VICTORY = 'VICTORY',
  /** 重复成员处理 - 规则 10.4 */
  DUPLICATE_MEMBER = 'DUPLICATE_MEMBER',
  /** 非法卡牌处理 - 规则 10.5 */
  ILLEGAL_CARD = 'ILLEGAL_CARD',
  /** 非法解决区域处理 - 规则 10.6 */
  ILLEGAL_RESOLUTION = 'ILLEGAL_RESOLUTION',
}

/**
 * 规则处理结果
 */
export interface RuleActionResult {
  /** 处理类型 */
  readonly type: RuleActionType;
  /** 是否执行了处理 */
  readonly executed: boolean;
  /** 影响的玩家 ID */
  readonly affectedPlayerId: string | null;
  /** 处理描述 */
  readonly description: string;
  /** 移动的卡牌信息 */
  readonly movedCards?: readonly {
    cardId: string;
    from: ZoneType;
    to: ZoneType;
  }[];
  /** 是否导致游戏结束 */
  readonly causesGameEnd?: boolean;
  /** 获胜玩家 ID（如果导致游戏结束） */
  readonly winnerId?: string;
}

/**
 * 刷新检查结果
 * 参考规则 10.2.2
 */
export interface RefreshCheckResult {
  /** 是否需要刷新 */
  readonly needsRefresh: boolean;
  /** 需要刷新的玩家 ID */
  readonly playerId: string | null;
  /** 触发原因 */
  readonly reason: 'empty_deck' | 'check_top' | null;
}

/**
 * 胜利检查结果
 * 参考规则 10.3
 */
export interface VictoryCheckResult {
  /** 是否有玩家达成胜利条件 */
  readonly hasWinner: boolean;
  /** 获胜玩家 ID 列表（可能双方同时达成） */
  readonly winnerIds: readonly string[];
  /** 是否平局（双方同时达成） */
  readonly isDraw: boolean;
}

/**
 * 重复成员检查结果
 * 参考规则 10.4
 */
export interface DuplicateMemberCheckResult {
  /** 是否存在重复成员 */
  readonly hasDuplicate: boolean;
  /** 需要处理的槽位信息 */
  readonly duplicateSlots: readonly {
    playerId: string;
    position: SlotPosition;
    cardIds: readonly string[];
    keepCardId: string;
  }[];
}

/**
 * 非法卡牌检查结果
 * 参考规则 10.5
 */
export interface IllegalCardCheckResult {
  /** 是否存在非法卡牌 */
  readonly hasIllegalCard: boolean;
  /** 非法卡牌信息 */
  readonly illegalCards: readonly {
    playerId: string;
    cardId: string;
    cardType: CardType;
    currentZone: ZoneType;
    targetZone: ZoneType;
    reason: string;
  }[];
}

// ============================================
// 规则处理器类
// ============================================

/**
 * 规则处理器
 * 处理游戏中的各种规则处理
 */
export class RuleActionProcessor {
  /**
   * 检查是否需要刷新
   * 参考规则 10.2.2
   *
   * @param player 玩家状态
   * @param checkTopCount 检视卡组顶部的张数（可选）
   * @returns 刷新检查结果
   */
  checkRefreshNeeded(player: PlayerState, checkTopCount?: number): RefreshCheckResult {
    // 10.2.2.1: 主卡组为空且休息室有卡
    if (player.mainDeck.cardIds.length === 0 && player.waitingRoom.cardIds.length > 0) {
      return {
        needsRefresh: true,
        playerId: player.id,
        reason: 'empty_deck',
      };
    }

    // 10.2.2.2: 检视卡组顶部时张数不足
    if (
      checkTopCount !== undefined &&
      player.mainDeck.cardIds.length < checkTopCount &&
      player.waitingRoom.cardIds.length > 0
    ) {
      return {
        needsRefresh: true,
        playerId: player.id,
        reason: 'check_top',
      };
    }

    return {
      needsRefresh: false,
      playerId: null,
      reason: null,
    };
  }

  collectPendingRefreshActions(
    game: GameState,
    options?: {
      checkTopPlayerId?: string;
      checkTopCount?: number;
    }
  ): RuleActionResult[] {
    const results: RuleActionResult[] = [];
    const orderedPlayers =
      game.firstPlayerIndex === 0 ? [...game.players] : [game.players[1], game.players[0]];

    for (const player of orderedPlayers) {
      const refreshCheck = this.checkRefreshNeeded(
        player,
        player.id === options?.checkTopPlayerId ? options?.checkTopCount : undefined
      );
      if (refreshCheck.needsRefresh && refreshCheck.playerId) {
        results.push(this.executeRefresh(refreshCheck.playerId));
      }
    }

    return results;
  }

  /**
   * 检查胜利条件
   * 参考规则 10.3
   *
   * @param players 双方玩家状态
   * @returns 胜利检查结果
   */
  checkVictoryCondition(players: readonly [PlayerState, PlayerState]): VictoryCheckResult {
    const VICTORY_THRESHOLD = 3;

    const winnersWithCount = players
      .filter((p) => p.successZone.cardIds.length >= VICTORY_THRESHOLD)
      .map((p) => p.id);

    if (winnersWithCount.length === 0) {
      return {
        hasWinner: false,
        winnerIds: [],
        isDraw: false,
      };
    }

    // 双方同时达到 3 张，平局
    if (winnersWithCount.length === 2) {
      return {
        hasWinner: true,
        winnerIds: winnersWithCount,
        isDraw: true,
      };
    }

    return {
      hasWinner: true,
      winnerIds: winnersWithCount,
      isDraw: false,
    };
  }

  /**
   * 检查重复成员
   * 参考规则 10.4
   * 注意：在这个游戏中，每个成员区域只能有一张成员卡
   * 如果有多张，需要保留最后放置的那张
   *
   * @param player 玩家状态
   * @param slotCardHistory 各槽位卡牌放置历史（用于确定最后放置的卡牌）
   * @returns 重复成员检查结果
   */
  checkDuplicateMembers(
    player: PlayerState,
    slotCardHistory: Map<SlotPosition, string[]>
  ): DuplicateMemberCheckResult {
    const duplicateSlots: {
      playerId: string;
      position: SlotPosition;
      cardIds: readonly string[];
      keepCardId: string;
    }[] = [];

    // 检查每个槽位
    const positions = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT];

    for (const position of positions) {
      const history = slotCardHistory.get(position) ?? [];

      if (history.length > 1) {
        // 保留最后放置的卡牌
        const keepCardId = history[history.length - 1];
        duplicateSlots.push({
          playerId: player.id,
          position,
          cardIds: history,
          keepCardId,
        });
      }
    }

    return {
      hasDuplicate: duplicateSlots.length > 0,
      duplicateSlots,
    };
  }

  /**
   * 检查非法卡牌
   * 参考规则 10.5
   *
   * @param player 玩家状态
   * @param getCardType 获取卡牌类型的函数
   * @returns 非法卡牌检查结果
   */
  checkIllegalCards(
    player: PlayerState,
    getCardType: (cardId: string) => CardType | null
  ): IllegalCardCheckResult {
    const illegalCards: {
      playerId: string;
      cardId: string;
      cardType: CardType;
      currentZone: ZoneType;
      targetZone: ZoneType;
      reason: string;
    }[] = [];

    // 10.5.1: Live 区有非 Live 卡的表侧卡牌
    for (const cardId of player.liveZone.cardIds) {
      const cardType = getCardType(cardId);
      const cardState = player.liveZone.cardStates.get(cardId);

      // 只检查表侧卡牌
      if (cardState?.face === 'FACE_UP' && cardType !== CardType.LIVE) {
        if (cardType === CardType.ENERGY) {
          illegalCards.push({
            playerId: player.id,
            cardId,
            cardType,
            currentZone: ZoneType.LIVE_ZONE,
            targetZone: ZoneType.ENERGY_DECK,
            reason: 'Live 区存在非 Live 卡（能量卡）',
          });
        } else if (cardType === CardType.MEMBER) {
          illegalCards.push({
            playerId: player.id,
            cardId,
            cardType,
            currentZone: ZoneType.LIVE_ZONE,
            targetZone: ZoneType.WAITING_ROOM,
            reason: 'Live 区存在非 Live 卡（成员卡）',
          });
        }
      }
    }

    // 10.5.2: 能量区有非能量卡
    for (const cardId of player.energyZone.cardIds) {
      const cardType = getCardType(cardId);

      if (cardType !== CardType.ENERGY && cardType !== null) {
        illegalCards.push({
          playerId: player.id,
          cardId,
          cardType,
          currentZone: ZoneType.ENERGY_ZONE,
          targetZone: ZoneType.WAITING_ROOM,
          reason: '能量区存在非能量卡',
        });
      }
    }

    // 10.5.3: 成员区槽位中存在无上方成员卡的能量卡 → 移动到能量卡组
    // 参考规则 4.5.5.4 + 10.5.3
    for (const position of Object.values(SlotPosition)) {
      const hasMember = player.memberSlots.slots[position] !== null;
      const energyBelow = player.memberSlots.energyBelow?.[position] ?? [];
      if (!hasMember && energyBelow.length > 0) {
        for (const energyCardId of energyBelow) {
          illegalCards.push({
            playerId: player.id,
            cardId: energyCardId,
            cardType: CardType.ENERGY,
            currentZone: ZoneType.MEMBER_SLOT,
            targetZone: ZoneType.ENERGY_DECK,
            reason: `成员区 ${position} 槽位无成员卡，下方能量卡移动到能量卡组（规则 10.5.3）`,
          });
        }
      }
    }

    return {
      hasIllegalCard: illegalCards.length > 0,
      illegalCards,
    };
  }

  /**
   * 执行刷新处理
   * 参考规则 10.2.3
   *
   * @param playerId 执行刷新的玩家 ID
   * @returns 规则处理结果
   */
  executeRefresh(playerId: string): RuleActionResult {
    return {
      type: RuleActionType.REFRESH,
      executed: true,
      affectedPlayerId: playerId,
      description: `玩家 ${playerId} 执行卡组刷新：将休息室所有卡牌洗牌后放入卡组底部`,
      movedCards: [], // 实际移动的卡牌将在应用状态时确定
    };
  }

  /**
   * 执行胜利处理
   * 参考规则 10.3
   *
   * @param winnerId 获胜玩家 ID
   * @param isDraw 是否平局
   * @returns 规则处理结果
   */
  executeVictory(winnerId: string | null, isDraw: boolean): RuleActionResult {
    if (isDraw) {
      return {
        type: RuleActionType.VICTORY,
        executed: true,
        affectedPlayerId: null,
        description: '双方玩家同时达成胜利条件，游戏平局',
        causesGameEnd: true,
      };
    }

    return {
      type: RuleActionType.VICTORY,
      executed: true,
      affectedPlayerId: winnerId,
      description: `玩家 ${winnerId} 达成胜利条件（成功 Live 卡达到 3 张）`,
      causesGameEnd: true,
      winnerId: winnerId ?? undefined,
    };
  }

  /**
   * 执行重复成员处理
   * 参考规则 10.4
   *
   * @param playerId 玩家 ID
   * @param position 槽位位置
   * @param cardIdsToRemove 需要移除的卡牌 ID
   * @returns 规则处理结果
   */
  executeDuplicateMemberRemoval(
    playerId: string,
    position: SlotPosition,
    cardIdsToRemove: readonly string[]
  ): RuleActionResult {
    return {
      type: RuleActionType.DUPLICATE_MEMBER,
      executed: true,
      affectedPlayerId: playerId,
      description: `移除 ${position} 槽位的重复成员卡`,
      movedCards: cardIdsToRemove.map((cardId) => ({
        cardId,
        from: ZoneType.MEMBER_SLOT,
        to: ZoneType.WAITING_ROOM,
      })),
    };
  }

  /**
   * 执行非法卡牌处理
   * 参考规则 10.5
   *
   * @param playerId 玩家 ID
   * @param cardId 卡牌 ID
   * @param fromZone 来源区域
   * @param toZone 目标区域
   * @param reason 原因
   * @returns 规则处理结果
   */
  executeIllegalCardRemoval(
    playerId: string,
    cardId: string,
    fromZone: ZoneType,
    toZone: ZoneType,
    reason: string
  ): RuleActionResult {
    return {
      type: RuleActionType.ILLEGAL_CARD,
      executed: true,
      affectedPlayerId: playerId,
      description: reason,
      movedCards: [{ cardId, from: fromZone, to: toZone }],
    };
  }

  /**
   * 收集所有需要执行的规则处理
   * 参考规则 10.1.3 - 需要同时执行多个规则处理的场合，全部同时执行
   *
   * 执行顺序（参考规则 10.1.2）：
   * 1. 刷新处理 (10.2)
   * 2. 胜利处理 (10.3)
   * 3. 重复成员处理 (10.4)
   * 4. 非法卡牌处理 (10.5)
   *
   * @param game 游戏状态
   * @param getCardType 获取卡牌类型的函数
   * @returns 需要执行的规则处理列表
   */
  collectPendingRuleActions(
    game: GameState,
    getCardType: (cardId: string) => CardType | null
  ): RuleActionResult[] {
    const results: RuleActionResult[] = [];

    // 1. 检查刷新处理（双方玩家）- 规则 10.2
    results.push(...this.collectPendingRefreshActions(game));

    // 2. 检查胜利条件 - 规则 10.3
    const victoryCheck = this.checkVictoryCondition(game.players);
    if (victoryCheck.hasWinner) {
      const winnerId = victoryCheck.isDraw ? null : victoryCheck.winnerIds[0];
      results.push(this.executeVictory(winnerId, victoryCheck.isDraw));
    }

    // 3. 检查非法卡牌（双方玩家）- 规则 10.5
    for (const player of game.players) {
      const illegalCheck = this.checkIllegalCards(player, getCardType);
      for (const illegal of illegalCheck.illegalCards) {
        results.push(
          this.executeIllegalCardRemoval(
            illegal.playerId,
            illegal.cardId,
            illegal.currentZone,
            illegal.targetZone,
            illegal.reason
          )
        );
      }
    }

    return results;
  }
}

// ============================================
// 规则处理应用函数
// ============================================

import { updatePlayer } from '../entities/game.js';
import {
  addCardToZone,
  removeCardFromZone,
  removeCardFromStatefulZone,
  shuffleZone,
  removeEnergyBelowMember,
  findEnergyBelowSlot,
} from '../entities/zone.js';

/**
 * 应用规则处理结果到游戏状态
 *
 * @param game 当前游戏状态
 * @param result 规则处理结果
 * @param getCardType 获取卡牌类型的函数
 * @returns 更新后的游戏状态
 */
export function applyRuleActionResult(
  game: GameState,
  result: RuleActionResult,
  getCardType: (cardId: string) => CardType | null
): GameState {
  let state = game;

  switch (result.type) {
    case RuleActionType.REFRESH: {
      // 刷新处理：仅将休息室洗牌后压到现有主卡组下方，保留原主卡组顺序。
      if (result.affectedPlayerId) {
        state = updatePlayer(state, result.affectedPlayerId, (player) => {
          const waitingRoomCards = [...player.waitingRoom.cardIds];
          const shuffledCards = shuffleArray(waitingRoomCards);

          return {
            ...player,
            waitingRoom: {
              ...player.waitingRoom,
              cardIds: [],
            },
            mainDeck: {
              ...player.mainDeck,
              cardIds: [...player.mainDeck.cardIds, ...shuffledCards],
            },
          };
        });
      }
      break;
    }

    case RuleActionType.ILLEGAL_CARD: {
      // 非法卡牌处理：移动卡牌到目标区域
      if (result.movedCards && result.affectedPlayerId) {
        for (const move of result.movedCards) {
          state = moveCardForRuleAction(
            state,
            result.affectedPlayerId,
            move.cardId,
            move.from,
            move.to,
            getCardType
          );
        }
      }
      break;
    }

    case RuleActionType.DUPLICATE_MEMBER: {
      // 重复成员处理：移除多余的成员卡
      if (result.movedCards && result.affectedPlayerId) {
        for (const move of result.movedCards) {
          state = moveCardForRuleAction(
            state,
            result.affectedPlayerId,
            move.cardId,
            move.from,
            move.to,
            getCardType
          );
        }
      }
      break;
    }

    case RuleActionType.VICTORY: {
      // 胜利处理在外部处理（需要调用 markGameEnded）
      break;
    }

    default:
      break;
  }

  return state;
}

/**
 * 应用所有规则处理结果
 *
 * @param game 当前游戏状态
 * @param results 规则处理结果列表
 * @param getCardType 获取卡牌类型的函数
 * @returns 更新后的游戏状态和是否有胜利处理
 */
export function applyAllRuleActions(
  game: GameState,
  results: readonly RuleActionResult[],
  getCardType: (cardId: string) => CardType | null
): { state: GameState; hasVictory: boolean; winnerId: string | null; isDraw: boolean } {
  let state = game;
  let hasVictory = false;
  let winnerId: string | null = null;
  let isDraw = false;

  for (const result of results) {
    if (result.type === RuleActionType.VICTORY) {
      hasVictory = true;
      winnerId = result.winnerId ?? null;
      isDraw = result.description.includes('平局');
    } else {
      state = applyRuleActionResult(state, result, getCardType);
    }
  }

  return { state, hasVictory, winnerId, isDraw };
}

/**
 * 移动卡牌用于规则处理
 */
function moveCardForRuleAction(
  game: GameState,
  playerId: string,
  cardId: string,
  fromZone: ZoneType,
  toZone: ZoneType,
  getCardType: (cardId: string) => CardType | null
): GameState {
  let state = game;

  state = updatePlayer(state, playerId, (player) => {
    let updatedPlayer = { ...player };

    // 从源区域移除
    switch (fromZone) {
      case ZoneType.LIVE_ZONE:
        updatedPlayer = {
          ...updatedPlayer,
          liveZone: removeCardFromStatefulZone(player.liveZone, cardId),
        };
        break;
      case ZoneType.ENERGY_ZONE:
        updatedPlayer = {
          ...updatedPlayer,
          energyZone: removeCardFromStatefulZone(player.energyZone, cardId),
        };
        break;
      case ZoneType.HAND:
        updatedPlayer = {
          ...updatedPlayer,
          hand: removeCardFromZone(player.hand, cardId),
        };
        break;
      case ZoneType.MEMBER_SLOT: {
        // 规则 10.5.3：从 energyBelow 中移除孤立能量卡
        const slot = findEnergyBelowSlot(player.memberSlots, cardId);
        if (slot !== null) {
          updatedPlayer = {
            ...updatedPlayer,
            memberSlots: removeEnergyBelowMember(updatedPlayer.memberSlots, slot, cardId),
          };
        }
        break;
      }
      // 其他区域...
    }

    // 添加到目标区域
    const cardType = getCardType(cardId);
    switch (toZone) {
      case ZoneType.WAITING_ROOM:
        updatedPlayer = {
          ...updatedPlayer,
          waitingRoom: addCardToZone(updatedPlayer.waitingRoom, cardId),
        };
        break;
      case ZoneType.ENERGY_DECK:
        // 能量卡放到休息室时改放能量卡组（规则 10.5.4）
        if (cardType === CardType.ENERGY) {
          updatedPlayer = {
            ...updatedPlayer,
            energyDeck: addCardToZone(updatedPlayer.energyDeck, cardId),
          };
        }
        break;
      // 其他区域...
    }

    return updatedPlayer;
  });

  return state;
}

/**
 * 洗牌辅助函数
 */
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ============================================
// 导出单例实例
// ============================================

/**
 * 规则处理器单例
 */
export const ruleActionProcessor = new RuleActionProcessor();
