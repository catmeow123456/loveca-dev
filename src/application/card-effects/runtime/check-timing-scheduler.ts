import type { EnergyMovedToDeckEvent } from '../../../domain/events/game-events.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  markGameEnded,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';
import {
  applyRuleActionResult,
  ruleActionProcessor,
  RuleActionType,
  type RuleActionResult,
} from '../../../domain/rules/rule-actions.js';
import { GameEndReason, TriggerCondition } from '../../../shared/types/enums.js';

export const CHECK_TIMING_RULE_PROCESSING_LIMIT = 100;
export const CHECK_TIMING_ABILITY_ITERATION_LIMIT = 1000;

export interface CheckTimingRuleProcessingResult {
  readonly gameState: GameState;
  readonly ruleActions: readonly RuleActionResult[];
  readonly energyMovedToDeckEvents: readonly EnergyMovedToDeckEvent[];
  readonly gameEnded: boolean;
}

/**
 * Runs rule processing at the head of one 9.5.3 check-timing iteration.
 *
 * This module deliberately knows nothing about card-effect workflows. The runner
 * owns trigger enqueue and ability startup; this function only applies domain
 * rule actions and returns the new rule events that the runner must dispatch.
 */
export function processCheckTimingRuleActions(
  game: GameState,
  maxIterations: number = CHECK_TIMING_RULE_PROCESSING_LIMIT
): CheckTimingRuleProcessingResult {
  let state = game;
  const eventLogStartIndex = game.eventLog.length;
  const appliedRuleActions: RuleActionResult[] = [];

  for (let iteration = 1; ; iteration++) {
    if (iteration > maxIterations) {
      throw new Error(
        `Check timing rule processing exceeded ${maxIterations} iterations; pending rule actions were not discarded`
      );
    }

    const pendingActions = ruleActionProcessor.collectPendingRuleActions(state, (cardId) =>
      getCardById(state, cardId)?.data.cardType ?? null
    );
    if (pendingActions.length === 0) {
      break;
    }

    let winnerId: string | null = null;
    let isDraw = false;
    for (const action of pendingActions) {
      appliedRuleActions.push(action);
      if (action.type === RuleActionType.VICTORY) {
        winnerId = action.winnerId ?? null;
        isDraw = action.description.includes('平局');
        continue;
      }
      state = applyRuleActionWithLog(state, action);
    }

    if (isDraw || winnerId) {
      state = isDraw
        ? markGameEnded(state, GameEndReason.DRAW, null)
        : markGameEnded(state, GameEndReason.VICTORY_CONDITION, winnerId);
      return {
        gameState: { ...state, checkTimingContext: null },
        ruleActions: appliedRuleActions,
        energyMovedToDeckEvents: collectEnergyMovedToDeckEvents(state, eventLogStartIndex),
        gameEnded: true,
      };
    }
  }

  return {
    gameState: state,
    ruleActions: appliedRuleActions,
    energyMovedToDeckEvents: collectEnergyMovedToDeckEvents(state, eventLogStartIndex),
    gameEnded: false,
  };
}

export function getCheckTimingAbilityCandidates(
  game: GameState,
  supportedAbilities: readonly PendingAbilityState[]
): readonly PendingAbilityState[] {
  const activePlayerId =
    game.checkTimingContext?.activePlayerId ?? game.players[game.activePlayerIndex]?.id;
  if (activePlayerId) {
    const activePlayerAbilities = supportedAbilities.filter(
      (ability) => ability.controllerId === activePlayerId
    );
    if (activePlayerAbilities.length > 0) {
      return activePlayerAbilities;
    }
  }

  const nonActivePlayerId = game.players.find((player) => player.id !== activePlayerId)?.id;
  if (!nonActivePlayerId) {
    return [];
  }
  const nonActivePlayerAbilities = supportedAbilities.filter(
    (ability) => ability.controllerId === nonActivePlayerId
  );
  if (nonActivePlayerAbilities.length > 0) {
    return nonActivePlayerAbilities;
  }
  return [];
}

export function openCheckTimingContext(game: GameState): GameState {
  if (game.checkTimingContext) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id;
  if (!activePlayerId) {
    return game;
  }
  return {
    ...game,
    checkTimingContext: {
      id: `check-timing:${game.eventSequence}:${game.actionSequence}`,
      activePlayerId,
      iterationCount: 0,
    },
  };
}

export function advanceCheckTimingIteration(game: GameState): GameState {
  const context = game.checkTimingContext;
  if (!context) {
    return game;
  }
  if (context.iterationCount >= CHECK_TIMING_ABILITY_ITERATION_LIMIT) {
    throw new Error(
      `Check timing ${context.id} exceeded ${CHECK_TIMING_ABILITY_ITERATION_LIMIT} ability iterations; pending abilities were not discarded`
    );
  }
  return {
    ...game,
    checkTimingContext: { ...context, iterationCount: context.iterationCount + 1 },
  };
}

export function closeCheckTimingContextIfIdle(game: GameState): GameState {
  if (
    !game.checkTimingContext ||
    game.activeEffect ||
    game.pendingChoice ||
    game.pendingCostPayment ||
    game.pendingAbilities.length > 0
  ) {
    return game;
  }
  return { ...game, checkTimingContext: null };
}

function applyRuleActionWithLog(game: GameState, result: RuleActionResult): GameState {
  const beforePlayer =
    result.affectedPlayerId !== null ? getPlayerById(game, result.affectedPlayerId) : null;
  const nextState = applyRuleActionResult(game, result, (cardId) =>
    getCardById(game, cardId)?.data.cardType ?? null
  );
  const afterPlayer =
    result.affectedPlayerId !== null ? getPlayerById(nextState, result.affectedPlayerId) : null;
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

function collectEnergyMovedToDeckEvents(
  game: GameState,
  eventLogStartIndex: number
): readonly EnergyMovedToDeckEvent[] {
  return game.eventLog
    .slice(eventLogStartIndex)
    .map((entry) => entry.event)
    .filter(
      (event): event is EnergyMovedToDeckEvent =>
        event.eventType === TriggerCondition.ON_ENERGY_MOVED_TO_DECK
    );
}
