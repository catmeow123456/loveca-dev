import type { GameState } from '../../domain/entities/game.js';
import {
  addAction,
  emitGameEvent,
  getCardById,
  getFirstPlayer,
  updatePlayer,
} from '../../domain/entities/game.js';
import { createCheerEvent, type CheerEvent } from '../../domain/events/game-events.js';
import { drawFromBottom, drawFromTop } from '../../domain/entities/zone.js';
import { CheerDeckEdge, getCheerDeckEdgeForPlayer } from '../../domain/rules/cheer-direction.js';
import {
  RuleActionType,
  applyRuleActionResult,
  ruleActionProcessor,
  type RuleActionResult,
} from '../../domain/rules/rule-actions.js';
import { getCheerCardEffectiveBladeHearts } from '../../domain/rules/live-modifiers.js';
import { BladeHeartEffect, type CardType } from '../../shared/types/enums.js';
import { drawCardsFromMainDeckToHand } from './draw.js';

export interface RevealCheerCardsOptions {
  readonly automated?: boolean;
  readonly additional?: boolean;
  /** Replaces only this player's current LIVE cheer facts. */
  readonly replaceCurrentCheerCards?: boolean;
}

export interface RevealCheerCardsResult {
  readonly gameState: GameState;
  readonly cheerCardIds: readonly string[];
  readonly cheerEvent: CheerEvent;
}

interface ResolveCheerDrawBladeHeartsResult {
  readonly gameState: GameState;
  readonly drawCount: number;
  readonly drawnCardIds: readonly string[];
  readonly alreadyResolved: boolean;
}

export function revealCheerCardsFromMainDeck(
  game: GameState,
  playerId: string,
  cheerCount: number,
  options: RevealCheerCardsOptions = {}
): RevealCheerCardsResult {
  let state = game;
  const cheerCardIds: string[] = [];
  let deckEdge = getCheerDeckEdgeForPlayer(state, playerId);

  for (let i = 0; i < cheerCount; i++) {
    const drawResult = drawMainDeckCardForCheer(state, playerId);
    state = drawResult.gameState;
    deckEdge = drawResult.deckEdge;
    if (drawResult.cardId) {
      cheerCardIds.push(drawResult.cardId);
    }
  }

  if (cheerCardIds.length > 0) {
    state = {
      ...state,
      resolutionZone: {
        ...state.resolutionZone,
        cardIds: [...state.resolutionZone.cardIds, ...cheerCardIds],
        revealedCardIds: [...state.resolutionZone.revealedCardIds, ...cheerCardIds],
      },
    };
  }

  const isFirstPlayer = playerId === getFirstPlayer(state).id;
  state = {
    ...state,
    liveResolution: {
      ...state.liveResolution,
      isInLive: true,
      performingPlayerId: playerId,
      firstPlayerCheerCardIds: isFirstPlayer
        ? options.replaceCurrentCheerCards === true
          ? cheerCardIds
          : [...state.liveResolution.firstPlayerCheerCardIds, ...cheerCardIds]
        : state.liveResolution.firstPlayerCheerCardIds,
      secondPlayerCheerCardIds: isFirstPlayer
        ? state.liveResolution.secondPlayerCheerCardIds
        : options.replaceCurrentCheerCards === true
          ? cheerCardIds
          : [...state.liveResolution.secondPlayerCheerCardIds, ...cheerCardIds],
    },
  };
  const cheerEvent = createCheerEvent(playerId, cheerCardIds, cheerCount, {
    automated: options.automated === true,
    additional: options.additional === true,
    deckEdge,
  });
  state = emitGameEvent(state, cheerEvent);

  const drawResolution = resolveCheerDrawBladeHearts(state, cheerEvent);
  state = drawResolution.gameState;

  state = addAction(state, 'CHEER', playerId, {
    cheerCount,
    cheerCardIds,
    revealedCardIds: cheerCardIds,
    automated: options.automated === true,
    additional: options.additional === true,
    deckEdge,
    ...(drawResolution.drawCount > 0
      ? {
          cheerEventId: cheerEvent.eventId,
          bladeHeartDrawCount: drawResolution.drawCount,
          bladeHeartDrawnCardIds: drawResolution.drawnCardIds,
        }
      : {}),
  });

  return {
    gameState: state,
    cheerCardIds,
    cheerEvent,
  };
}

/**
 * Resolve the one-shot DRAW BLADE HEART effects for one completed cheer batch.
 *
 * Cheer-triggered AUTO abilities are only checked after this step. Persistent
 * HEART/SCORE contributions remain derived from the current cheer cards during
 * final LIVE judgment, so a later reroll can replace those contributions without
 * attempting to undo cards that were already drawn.
 */
function resolveCheerDrawBladeHearts(
  game: GameState,
  cheerEvent: CheerEvent
): ResolveCheerDrawBladeHeartsResult {
  const resolvedAction = game.actionHistory.find(
    (action) =>
      action.type === 'CHEER' &&
      action.payload.cheerEventId === cheerEvent.eventId &&
      typeof action.payload.bladeHeartDrawCount === 'number' &&
      Array.isArray(action.payload.bladeHeartDrawnCardIds)
  );
  if (resolvedAction) {
    const drawCount =
      typeof resolvedAction.payload.bladeHeartDrawCount === 'number'
        ? resolvedAction.payload.bladeHeartDrawCount
        : 0;
    const drawnCardIds = Array.isArray(resolvedAction.payload.bladeHeartDrawnCardIds)
      ? resolvedAction.payload.bladeHeartDrawnCardIds.filter(
          (cardId): cardId is string => typeof cardId === 'string'
        )
      : [];
    return {
      gameState: game,
      drawCount,
      drawnCardIds,
      alreadyResolved: true,
    };
  }

  const drawCount = cheerEvent.revealedCardIds.reduce(
    (count, cardId) =>
      count +
      getCheerCardEffectiveBladeHearts(game, cheerEvent.playerId, cardId).filter(
        (bladeHeart) => bladeHeart.effect === BladeHeartEffect.DRAW
      ).length,
    0
  );
  const drawResult =
    drawCount > 0 ? drawCardsFromMainDeckToHand(game, cheerEvent.playerId, drawCount) : null;
  const drawnCardIds = drawResult?.drawnCardIds ?? [];

  return {
    gameState: drawResult?.gameState ?? game,
    drawCount,
    drawnCardIds,
    alreadyResolved: false,
  };
}

function drawMainDeckCardForCheer(
  game: GameState,
  playerId: string
): {
  readonly gameState: GameState;
  readonly cardId: string | null;
  readonly deckEdge: CheerDeckEdge;
} {
  let state = applyImmediateRefreshesForCheer(game);
  const deckEdge = getCheerDeckEdgeForPlayer(state, playerId);

  let drawnCardId: string | null = null;
  state = updatePlayer(state, playerId, (player) => {
    const { zone: newDeck, cardId } =
      deckEdge === CheerDeckEdge.BOTTOM
        ? drawFromBottom(player.mainDeck)
        : drawFromTop(player.mainDeck);
    drawnCardId = cardId;
    return {
      ...player,
      mainDeck: newDeck,
    };
  });

  if (!drawnCardId) {
    return {
      gameState: state,
      cardId: null,
      deckEdge,
    };
  }

  state = applyImmediateRefreshesForCheer(state);
  return {
    gameState: state,
    cardId: drawnCardId,
    deckEdge,
  };
}

function applyImmediateRefreshesForCheer(game: GameState): GameState {
  let state = game;
  const ruleActions = ruleActionProcessor.collectPendingRefreshActions(state);

  for (const action of ruleActions) {
    state = applyRuleActionWithLog(state, action);
  }

  return state;
}

function applyRuleActionWithLog(game: GameState, result: RuleActionResult): GameState {
  const beforePlayer =
    result.affectedPlayerId !== null
      ? game.players.find((player) => player.id === result.affectedPlayerId)
      : null;
  const nextState = applyRuleActionResult(game, result, (cardId): CardType | null => {
    const card = getCardById(game, cardId);
    return card?.data.cardType ?? null;
  });
  const afterPlayer =
    result.affectedPlayerId !== null
      ? nextState.players.find((player) => player.id === result.affectedPlayerId)
      : null;

  const payload: Record<string, unknown> = {
    type: result.type,
    description: result.description,
    affectedPlayerId: result.affectedPlayerId,
  };

  if (result.type === RuleActionType.REFRESH && beforePlayer && afterPlayer) {
    payload.movedCount = beforePlayer.waitingRoom.cardIds.length;
    payload.mainDeckCountAfter = afterPlayer.mainDeck.cardIds.length;
  }

  return addAction(nextState, 'RULE_ACTION', null, payload);
}
