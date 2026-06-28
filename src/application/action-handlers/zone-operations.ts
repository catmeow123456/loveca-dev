/**
 * 区域操作辅助函数
 *
 * 使用映射表替代 switch-case，消除重复代码
 */

import type { GameState } from '../../domain/entities/game.js';
import type { PlayerState } from '../../domain/entities/player.js';
import { emitGameEvent, getCardById, getPlayerById, updatePlayer } from '../../domain/entities/game.js';
import { recordPositionMove } from '../../domain/entities/player.js';
import { createLeaveStageEvent, createMemberSlotMovedEvent } from '../../domain/events/game-events.js';
import { ZoneType, SlotPosition } from '../../shared/types/enums.js';
import { isSpecialMemberCard } from '../../shared/utils/card-code.js';
import { returnEnergyBelowMemberToEnergyDeckForPlayer } from '../effects/energy-below.js';
import {
  addCardToZone,
  addCardsToZone,
  removeCardFromZone,
  addCardToStatefulZone,
  removeCardFromStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
  getCardInSlot,
  addEnergyBelowMember,
  removeEnergyBelowMember,
  findEnergyBelowSlot,
  moveEnergyBelowWithMember,
  addMemberBelowMember,
  removeMemberBelowMember,
  findMemberBelowSlot,
  moveMemberBelowWithMember,
  popMemberBelowMember,
} from '../../domain/entities/zone.js';

// ============================================
// 区域访问器类型
// ============================================

/**
 * 区域访问器接口
 */
interface ZoneAccessor {
  /** 从区域移除卡牌 */
  remove: (player: PlayerState, cardId: string) => PlayerState;
  /** 向区域添加卡牌 */
  add: (player: PlayerState, cardId: string, options?: ZoneAddOptions) => PlayerState;
}

/**
 * 添加卡牌到区域的选项
 */
interface ZoneAddOptions {
  /** 目标槽位（仅用于成员区） */
  targetSlot?: SlotPosition;
  /** 卡组位置（仅用于卡组） */
  position?: 'TOP' | 'BOTTOM';
  /**
   * 是否以能量卡附加模式放置（附加到成员下方）
   * 参考规则 4.5.5：能量牌拖到成员区应附加到成员下方，而非替换成员
   */
  asEnergyBelow?: boolean;
  /**
   * 是否以成员堆叠模式放置（附加到特殊成员下方）
   * 特殊成员卡效果：可在其下方堆叠成员卡
   */
  asMemberBelow?: boolean;
  /**
   * 来源槽位（仅在成员区之间移动时使用）
   * 参考规则 4.5.5.3：成员移动到其他成员区时，其下方的能量卡同时跟随移动
   */
  sourceSlot?: SlotPosition;
}

// ============================================
// 区域访问器映射表
// ============================================

/**
 * 简单区域访问器（使用 Zone 类型）
 */
const SIMPLE_ZONE_ACCESSORS: Partial<Record<ZoneType, ZoneAccessor>> = {
  [ZoneType.HAND]: {
    remove: (p, cardId) => ({ ...p, hand: removeCardFromZone(p.hand, cardId) }),
    add: (p, cardId) => ({ ...p, hand: addCardToZone(p.hand, cardId) }),
  },
  [ZoneType.WAITING_ROOM]: {
    remove: (p, cardId) => ({ ...p, waitingRoom: removeCardFromZone(p.waitingRoom, cardId) }),
    add: (p, cardId) => ({ ...p, waitingRoom: addCardToZone(p.waitingRoom, cardId) }),
  },
  [ZoneType.SUCCESS_ZONE]: {
    remove: (p, cardId) => ({ ...p, successZone: removeCardFromZone(p.successZone, cardId) }),
    add: (p, cardId) => ({ ...p, successZone: addCardToZone(p.successZone, cardId) }),
  },
};

/**
 * 卡组区域访问器（支持 TOP/BOTTOM 位置）
 */
const DECK_ZONE_ACCESSORS: Partial<Record<ZoneType, ZoneAccessor>> = {
  [ZoneType.MAIN_DECK]: {
    remove: (p, cardId) => ({ ...p, mainDeck: removeCardFromZone(p.mainDeck, cardId) }),
    add: (p, cardId, options) => {
      if (options?.position === 'BOTTOM') {
        return {
          ...p,
          mainDeck: {
            ...p.mainDeck,
            cardIds: [...p.mainDeck.cardIds, cardId],
          },
        };
      }
      return {
        ...p,
        mainDeck: {
          ...p.mainDeck,
          cardIds: [cardId, ...p.mainDeck.cardIds],
        },
      };
    },
  },
  [ZoneType.ENERGY_DECK]: {
    remove: (p, cardId) => ({ ...p, energyDeck: removeCardFromZone(p.energyDeck, cardId) }),
    add: (p, cardId, options) => {
      if (options?.position === 'BOTTOM') {
        return {
          ...p,
          energyDeck: {
            ...p.energyDeck,
            cardIds: [...p.energyDeck.cardIds, cardId],
          },
        };
      }
      return {
        ...p,
        energyDeck: {
          ...p.energyDeck,
          cardIds: [cardId, ...p.energyDeck.cardIds],
        },
      };
    },
  },
};

/**
 * 带状态区域访问器（使用 StatefulZone 类型）
 */
const STATEFUL_ZONE_ACCESSORS: Partial<Record<ZoneType, ZoneAccessor>> = {
  [ZoneType.ENERGY_ZONE]: {
    remove: (p, cardId) => ({ ...p, energyZone: removeCardFromStatefulZone(p.energyZone, cardId) }),
    add: (p, cardId) => ({ ...p, energyZone: addCardToStatefulZone(p.energyZone, cardId) }),
  },
  [ZoneType.LIVE_ZONE]: {
    remove: (p, cardId) => ({ ...p, liveZone: removeCardFromStatefulZone(p.liveZone, cardId) }),
    add: (p, cardId) => ({ ...p, liveZone: addCardToStatefulZone(p.liveZone, cardId) }),
  },
};

/**
 * 成员槽位访问器（特殊处理）
 *
 * remove 行为：
 *   - 优先从 slots（成员卡）中查找并移除
 *   - 其次从 energyBelow（成员下方能量卡）中查找并移除
 *
 * add 行为：
 *   - asEnergyBelow=true 时：将卡牌附加到目标槽位成员下方（规则 4.5.5）
 *   - asEnergyBelow=false/undefined 时：按原逻辑放置成员卡（换手）
 */
const MEMBER_SLOT_ACCESSOR: ZoneAccessor = {
  remove: (p, cardId) => {
    // 先查找成员卡槽位
    for (const slot of Object.values(SlotPosition)) {
      if (getCardInSlot(p.memberSlots, slot) === cardId) {
        // 裸 remove 也必须守住空主槽不能残留下方卡的 invariant。
        const energyReturnResult = returnEnergyBelowMemberToEnergyDeckForPlayer(p, slot);
        const [slotsWithoutMemberBelow, memberBelowIds] = popMemberBelowMember(
          energyReturnResult.playerState.memberSlots,
          slot
        );
        return {
          ...energyReturnResult.playerState,
          memberSlots: removeCardFromSlot(slotsWithoutMemberBelow, slot),
          waitingRoom: addCardsToZone(energyReturnResult.playerState.waitingRoom, memberBelowIds),
        };
      }
    }
    // 再查找 energyBelow（从成员区拖出能量卡）
    const energySlot = findEnergyBelowSlot(p.memberSlots, cardId);
    if (energySlot !== null) {
      return {
        ...p,
        memberSlots: removeEnergyBelowMember(p.memberSlots, energySlot, cardId),
      };
    }
    // 再查找 memberBelow（从成员区拖出堆叠成员卡）
    const memberSlot = findMemberBelowSlot(p.memberSlots, cardId);
    if (memberSlot !== null) {
      return {
        ...p,
        memberSlots: removeMemberBelowMember(p.memberSlots, memberSlot, cardId),
      };
    }
    return p;
  },
  add: (p, cardId, options) => {
    if (!options?.targetSlot) return p;

    // 能量卡附加到成员下方（规则 4.5.5）
    if (options.asEnergyBelow) {
      // 目标槽位必须有成员卡，否则无处附加
      const memberCardId = getCardInSlot(p.memberSlots, options.targetSlot);
      if (!memberCardId) return p; // 无成员卡，拒绝附加
      return {
        ...p,
        memberSlots: addEnergyBelowMember(p.memberSlots, options.targetSlot, cardId),
      };
    }

    // 成员卡堆叠到特殊成员下方
    if (options.asMemberBelow) {
      const memberCardId = getCardInSlot(p.memberSlots, options.targetSlot);
      if (!memberCardId) {
        return p;
      }
      return {
        ...p,
        memberSlots: addMemberBelowMember(p.memberSlots, options.targetSlot, cardId),
      };
    }

    // 普通成员卡放置（换手逻辑）
    const existingCardId = getCardInSlot(p.memberSlots, options.targetSlot);
    let updatedPlayer = p;

    if (existingCardId && existingCardId !== cardId) {
      // 将原有成员卡及其下方成员卡移到休息室，下方能量返回能量卡组。
      const energyReturnResult = returnEnergyBelowMemberToEnergyDeckForPlayer(
        updatedPlayer,
        options.targetSlot
      );
      updatedPlayer = energyReturnResult.playerState;
      const [slotsWithoutMemberBelow, memberBelowIds] = popMemberBelowMember(
        updatedPlayer.memberSlots,
        options.targetSlot
      );
      updatedPlayer = {
        ...updatedPlayer,
        memberSlots: removeCardFromSlot(slotsWithoutMemberBelow, options.targetSlot),
        waitingRoom: addCardsToZone(
          addCardToZone(updatedPlayer.waitingRoom, existingCardId),
          memberBelowIds
        ),
      };
    }

    // 放置新成员卡到槽位
    return {
      ...updatedPlayer,
      memberSlots: placeCardInSlot(updatedPlayer.memberSlots, options.targetSlot, cardId),
    };
  },
};

// ============================================
// 统一访问函数
// ============================================

/**
 * 获取区域访问器
 */
function getZoneAccessor(zone: ZoneType): ZoneAccessor | undefined {
  return (
    SIMPLE_ZONE_ACCESSORS[zone] ||
    DECK_ZONE_ACCESSORS[zone] ||
    STATEFUL_ZONE_ACCESSORS[zone] ||
    (zone === ZoneType.MEMBER_SLOT ? MEMBER_SLOT_ACCESSOR : undefined)
  );
}

function canAddMemberBelowToSlot(
  game: GameState,
  playerId: string,
  targetSlot?: SlotPosition
): boolean {
  if (!targetSlot) {
    return false;
  }
  const player = getPlayerById(game, playerId);
  const targetMemberCardId = player ? getCardInSlot(player.memberSlots, targetSlot) : null;
  if (!targetMemberCardId) {
    return false;
  }
  const targetMemberCard = getCardById(game, targetMemberCardId);
  return targetMemberCard !== null && isSpecialMemberCard(targetMemberCard.data.cardCode);
}

/**
 * 从玩家的指定区域移除卡牌
 *
 * @param game 游戏状态
 * @param playerId 玩家 ID
 * @param cardId 卡牌实例 ID
 * @param zone 来源区域
 * @returns 更新后的游戏状态
 */
export function removeCardFromPlayerZone(
  game: GameState,
  playerId: string,
  cardId: string,
  zone: ZoneType
): GameState {
  const accessor = getZoneAccessor(zone);
  if (!accessor) {
    console.warn(`未知的区域类型: ${zone}`);
    return game;
  }

  return updatePlayer(game, playerId, (player) => accessor.remove(player, cardId));
}

/**
 * 添加卡牌到玩家的指定区域
 *
 * @param game 游戏状态
 * @param playerId 玩家 ID
 * @param cardId 卡牌实例 ID
 * @param zone 目标区域
 * @param options 可选参数（槽位、卡组位置等）
 * @returns 更新后的游戏状态
 */
export function addCardToPlayerZone(
  game: GameState,
  playerId: string,
  cardId: string,
  zone: ZoneType,
  options?: ZoneAddOptions
): GameState {
  if (zone === ZoneType.MEMBER_SLOT && options?.asMemberBelow) {
    if (!canAddMemberBelowToSlot(game, playerId, options.targetSlot)) {
      return game;
    }
  }

  const accessor = getZoneAccessor(zone);
  if (!accessor) {
    console.warn(`未知的区域类型: ${zone}`);
    return game;
  }

  return updatePlayer(game, playerId, (player) => accessor.add(player, cardId, options));
}

/**
 * 移动卡牌从一个区域到另一个区域
 *
 * @param game 游戏状态
 * @param playerId 玩家 ID
 * @param cardId 卡牌实例 ID
 * @param fromZone 来源区域
 * @param toZone 目标区域
 * @param options 可选参数
 * @returns 更新后的游戏状态
 */
export function moveCardBetweenZones(
  game: GameState,
  playerId: string,
  cardId: string,
  fromZone: ZoneType,
  toZone: ZoneType,
  options?: ZoneAddOptions
): GameState {
  if (
    toZone === ZoneType.MEMBER_SLOT &&
    options?.asMemberBelow &&
    !canAddMemberBelowToSlot(game, playerId, options.targetSlot)
  ) {
    return game;
  }

  let state = removeCardFromPlayerZone(game, playerId, cardId, fromZone);
  state = addCardToPlayerZone(state, playerId, cardId, toZone, options);
  return state;
}

// ============================================
// 解决区域操作（共享区域，不属于任何玩家）
// ============================================

/**
 * 添加卡牌到解决区域
 *
 * @param game 游戏状态
 * @param cardId 卡牌实例 ID
 * @returns 更新后的游戏状态
 */
export function addCardToResolutionZone(game: GameState, cardId: string): GameState {
  return {
    ...game,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: [...game.resolutionZone.cardIds, cardId],
    },
  };
}

/**
 * 从解决区域移除卡牌
 *
 * @param game 游戏状态
 * @param cardId 卡牌实例 ID
 * @returns 更新后的游戏状态
 */
export function removeCardFromResolutionZone(game: GameState, cardId: string): GameState {
  return {
    ...game,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: game.resolutionZone.cardIds.filter((id) => id !== cardId),
      revealedCardIds: game.resolutionZone.revealedCardIds.filter((id) => id !== cardId),
    },
  };
}

// ============================================
// 检视区域操作（共享区域，独立于解决区域）
// ============================================

/**
 * 添加卡牌到检视区域
 */
export function addCardToInspectionZone(game: GameState, cardId: string): GameState {
  return {
    ...game,
    inspectionZone: {
      ...game.inspectionZone,
      cardIds: [...game.inspectionZone.cardIds, cardId],
    },
  };
}

/**
 * 从检视区域移除卡牌
 */
export function removeCardFromInspectionZone(game: GameState, cardId: string): GameState {
  return {
    ...game,
    inspectionZone: {
      ...game.inspectionZone,
      cardIds: game.inspectionZone.cardIds.filter((id) => id !== cardId),
      revealedCardIds: game.inspectionZone.revealedCardIds.filter((id) => id !== cardId),
    },
  };
}

/**
 * 将检视区中的卡牌公开给双方
 */
export function revealInspectionZoneCard(game: GameState, cardId: string): GameState {
  if (!game.inspectionZone.cardIds.includes(cardId)) {
    return game;
  }

  if (game.inspectionZone.revealedCardIds.includes(cardId)) {
    return game;
  }

  return {
    ...game,
    inspectionZone: {
      ...game.inspectionZone,
      revealedCardIds: [...game.inspectionZone.revealedCardIds, cardId],
    },
  };
}

/**
 * 重新排列检视区域中的卡牌
 */
export function reorderInspectionZoneCard(
  game: GameState,
  cardId: string,
  toIndex: number
): GameState {
  const cardIds = [...game.inspectionZone.cardIds];
  const fromIndex = cardIds.indexOf(cardId);
  if (fromIndex < 0 || toIndex < 0 || toIndex >= cardIds.length) {
    return game;
  }
  cardIds.splice(fromIndex, 1);
  cardIds.splice(toIndex, 0, cardId);
  return {
    ...game,
    inspectionZone: {
      ...game.inspectionZone,
      cardIds,
    },
  };
}

/**
 * 通用移动卡牌函数 - 支持解决区域
 *
 * 这个函数可以处理所有区域间的移动，包括解决区域（共享区域）
 *
 * @param game 游戏状态
 * @param playerId 玩家 ID（用于玩家区域操作）
 * @param cardId 卡牌实例 ID
 * @param fromZone 来源区域
 * @param toZone 目标区域
 * @param options 可选参数
 * @returns 更新后的游戏状态
 */
export function moveCardUniversal(
  game: GameState,
  playerId: string,
  cardId: string,
  fromZone: ZoneType,
  toZone: ZoneType,
  options?: ZoneAddOptions
): GameState {
  let state = game;

  if (
    toZone === ZoneType.MEMBER_SLOT &&
    options?.asMemberBelow &&
    !canAddMemberBelowToSlot(state, playerId, options.targetSlot)
  ) {
    return state;
  }

  // 特殊情况：成员卡在 MEMBER_SLOT 之间移动时，随成员一并移动 energyBelow（规则 4.5.5.3）
  if (
    fromZone === ZoneType.MEMBER_SLOT &&
    toZone === ZoneType.MEMBER_SLOT &&
    options?.sourceSlot &&
    options?.targetSlot &&
    options.sourceSlot !== options.targetSlot
  ) {
    const sourceSlot = options.sourceSlot;
    const targetSlot = options.targetSlot;
    const playerBefore = getPlayerById(state, playerId);
    const sourceCardIdBefore = playerBefore
      ? getCardInSlot(playerBefore.memberSlots, sourceSlot)
      : null;
    const targetCardIdBefore = playerBefore
      ? getCardInSlot(playerBefore.memberSlots, targetSlot)
      : null;
    state = updatePlayer(state, playerId, (player) => {
      const sourceCardId = getCardInSlot(player.memberSlots, sourceSlot);
      const targetCardId = getCardInSlot(player.memberSlots, targetSlot);

      // 交换逻辑：成员卡拖到另一个已有成员卡的槽位时，双方位置互换，
      // 且各自下方的能量卡（energyBelow）和成员卡（memberBelow）随成员一起移动。
      if (sourceCardId && sourceCardId === cardId && targetCardId && targetCardId !== cardId) {
        const sourceEnergyBelow = player.memberSlots.energyBelow?.[sourceSlot] ?? [];
        const targetEnergyBelow = player.memberSlots.energyBelow?.[targetSlot] ?? [];
        const sourceMemberBelow = player.memberSlots.memberBelow?.[sourceSlot] ?? [];
        const targetMemberBelow = player.memberSlots.memberBelow?.[targetSlot] ?? [];

        let nextPlayer = {
          ...player,
          memberSlots: {
            ...player.memberSlots,
            slots: {
              ...player.memberSlots.slots,
              [sourceSlot]: targetCardId,
              [targetSlot]: cardId,
            },
            energyBelow: {
              ...player.memberSlots.energyBelow,
              [sourceSlot]: [...targetEnergyBelow],
              [targetSlot]: [...sourceEnergyBelow],
            },
            memberBelow: {
              ...player.memberSlots.memberBelow,
              [sourceSlot]: [...targetMemberBelow],
              [targetSlot]: [...sourceMemberBelow],
            },
          },
        };
        nextPlayer = recordPositionMove(nextPlayer, cardId);
        return recordPositionMove(nextPlayer, targetCardId);
      }

      // 1. 先从来源槽位移除成员卡（不清除 energyBelow）
      let updated = { ...player, memberSlots: removeCardFromSlot(player.memberSlots, sourceSlot) };
      // 2. 将成员卡放入目标槽位（换手：将目标槽原有成员移到休息室）
      const existingCardId = getCardInSlot(updated.memberSlots, targetSlot);
      if (existingCardId && existingCardId !== cardId) {
        const energyReturnResult = returnEnergyBelowMemberToEnergyDeckForPlayer(
          updated,
          targetSlot
        );
        updated = energyReturnResult.playerState;
        updated = {
          ...updated,
          memberSlots: removeCardFromSlot(updated.memberSlots, targetSlot),
          waitingRoom: addCardToZone(updated.waitingRoom, existingCardId),
        };
      }
      updated = {
        ...updated,
        memberSlots: placeCardInSlot(updated.memberSlots, targetSlot, cardId),
      };
      // 3. 将 energyBelow 从来源槽位移到目标槽位（规则 4.5.5.3）
      updated = {
        ...updated,
        memberSlots: moveEnergyBelowWithMember(updated.memberSlots, sourceSlot, targetSlot),
      };
      // 4. 将 memberBelow 从来源槽位移到目标槽位
      updated = {
        ...updated,
        memberSlots: moveMemberBelowWithMember(updated.memberSlots, sourceSlot, targetSlot),
      };
      return recordPositionMove(updated, cardId);
    });
    if (sourceCardIdBefore === cardId) {
      state = emitGameEvent(
        state,
        createMemberSlotMovedEvent(
          cardId,
          playerId,
          sourceSlot,
          targetSlot,
          targetCardIdBefore ?? undefined
        )
      );
      if (targetCardIdBefore && targetCardIdBefore !== cardId) {
        state = emitGameEvent(
          state,
          createMemberSlotMovedEvent(targetCardIdBefore, playerId, targetSlot, sourceSlot, cardId)
        );
      }
    }
    return state;
  }

  const sourceSlot = options?.sourceSlot;
  const playerBeforeMove = getPlayerById(state, playerId);
  const cardBeforeMove = getCardById(state, cardId);
  const shouldEmitLeaveStage =
    fromZone === ZoneType.MEMBER_SLOT &&
    toZone === ZoneType.WAITING_ROOM &&
    sourceSlot !== undefined &&
    playerBeforeMove !== null &&
    cardBeforeMove !== null &&
    getCardInSlot(playerBeforeMove.memberSlots, sourceSlot) === cardId;

  // 从来源区域移除
  if (fromZone === ZoneType.RESOLUTION_ZONE) {
    state = removeCardFromResolutionZone(state, cardId);
  } else {
    state = removeCardFromPlayerZone(state, playerId, cardId, fromZone);
  }

  // 添加到目标区域
  if (toZone === ZoneType.RESOLUTION_ZONE) {
    state = addCardToResolutionZone(state, cardId);
  } else {
    state = addCardToPlayerZone(state, playerId, cardId, toZone, options);
  }

  if (shouldEmitLeaveStage) {
    state = moveMemberBelowToWaitingRoom(state, playerId, sourceSlot);

    state = emitGameEvent(
      state,
      createLeaveStageEvent(
        cardId,
        sourceSlot,
        ZoneType.WAITING_ROOM,
        cardBeforeMove.ownerId,
        playerId
      )
    );
  }

  return state;
}

function moveMemberBelowToWaitingRoom(
  game: GameState,
  playerId: string,
  sourceSlot: SlotPosition | undefined
): GameState {
  if (!sourceSlot) {
    return game;
  }

  return updatePlayer(game, playerId, (player) => {
    const [memberSlots, memberBelowIds] = popMemberBelowMember(player.memberSlots, sourceSlot);
    if (memberBelowIds.length === 0) {
      return player;
    }
    return {
      ...player,
      memberSlots,
      waitingRoom: addCardsToZone(player.waitingRoom, memberBelowIds),
    };
  });
}
