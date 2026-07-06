import { addAction, getCardById, getPlayerById, type GameState } from '../../domain/entities/game.js';
import {
  applyRuleActionResult,
  ruleActionProcessor,
  RuleActionType,
  type RuleActionResult,
} from '../../domain/rules/rule-actions.js';

export function applyPendingRefreshForPlayer(game: GameState, playerId: string): GameState {
  const refreshAction = ruleActionProcessor
    .collectPendingRefreshActions(game)
    .find((action) => action.affectedPlayerId === playerId);

  return refreshAction ? applyRuleActionWithLog(game, refreshAction) : game;
}

export function applyCheckTopRefreshForPlayer(
  game: GameState,
  playerId: string,
  checkTopCount: number
): GameState {
  const refreshAction = ruleActionProcessor
    .collectPendingRefreshActions(game, {
      checkTopPlayerId: playerId,
      checkTopCount,
    })
    .find((action) => action.affectedPlayerId === playerId);

  return refreshAction ? applyRuleActionWithLog(game, refreshAction) : game;
}

export function applyRuleActionWithLog(game: GameState, result: RuleActionResult): GameState {
  const beforePlayer =
    result.affectedPlayerId !== null ? getPlayerById(game, result.affectedPlayerId) : null;
  const nextState = applyRuleActionResult(game, result, (cardId) => {
    const card = getCardById(game, cardId);
    return card?.data.cardType ?? null;
  });
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
