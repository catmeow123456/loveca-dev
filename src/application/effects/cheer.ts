import type { GameState } from '../../domain/entities/game.js';
import {
  addAction,
  emitGameEvent,
  getCardById,
  getFirstPlayer,
  updatePlayer,
} from '../../domain/entities/game.js';
import { createCheerEvent, type CheerEvent } from '../../domain/events/game-events.js';
import { drawFromTop } from '../../domain/entities/zone.js';
import {
  RuleActionType,
  applyRuleActionResult,
  ruleActionProcessor,
  type RuleActionResult,
} from '../../domain/rules/rule-actions.js';
import type { CardType } from '../../shared/types/enums.js';

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

export function revealCheerCardsFromMainDeck(
  game: GameState,
  playerId: string,
  cheerCount: number,
  options: RevealCheerCardsOptions = {}
): RevealCheerCardsResult {
  let state = game;
  const cheerCardIds: string[] = [];

  for (let i = 0; i < cheerCount; i++) {
    const drawResult = drawTopMainDeckCardForCheer(state, playerId);
    state = drawResult.gameState;
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
  });
  state = emitGameEvent(
    state,
    cheerEvent
  );

  state = addAction(state, 'CHEER', playerId, {
    cheerCount,
    cheerCardIds,
    automated: options.automated === true,
    additional: options.additional === true,
  });

  return {
    gameState: state,
    cheerCardIds,
    cheerEvent,
  };
}

function drawTopMainDeckCardForCheer(
  game: GameState,
  playerId: string
): { readonly gameState: GameState; readonly cardId: string | null } {
  let state = applyImmediateRefreshesForCheer(game);

  let drawnCardId: string | null = null;
  state = updatePlayer(state, playerId, (player) => {
    const { zone: newDeck, cardId } = drawFromTop(player.mainDeck);
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
    };
  }

  state = applyImmediateRefreshesForCheer(state);
  return {
    gameState: state,
    cardId: drawnCardId,
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
