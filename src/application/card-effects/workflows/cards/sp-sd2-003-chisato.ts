import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { hasMemberPositionMovedThisTurn } from '../../../effects/conditions.js';
import { SP_SD2_003_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_MOVED_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  maybeStartConfirmablePendingAbilityConfirmation,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpSd2003ChisatoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_SD2_003_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_MOVED_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options);
      if (confirmation) {
        return confirmation;
      }
      return resolveSpSd2003ChisatoLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function resolveSpSd2003ChisatoLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateAfterUseRecord = recordAbilityUseForContext(stateWithoutPending, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });
  const firstDrawResult = drawCardsForPlayer(stateAfterUseRecord, player.id, 1);
  if (!firstDrawResult) {
    return game;
  }

  const movedThisTurn = hasMemberPositionMovedThisTurn(
    firstDrawResult.gameState,
    player.id,
    ability.sourceCardId
  );
  const bonusDrawResult = movedThisTurn
    ? drawCardsForPlayer(firstDrawResult.gameState, player.id, 1)
    : null;
  const stateAfterDraws = bonusDrawResult?.gameState ?? firstDrawResult.gameState;
  const bonusDrawnCardIds = bonusDrawResult?.drawnCardIds ?? [];
  const totalDrawCount = firstDrawResult.drawnCardIds.length + bonusDrawnCardIds.length;

  return continuePendingCardEffects(
    addAction(stateAfterDraws, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_MOVED',
      sourceSlot: ability.sourceSlot,
      movedThisTurn,
      firstDrawnCardIds: firstDrawResult.drawnCardIds,
      bonusDrawnCardIds,
      totalDrawCount,
    }),
    orderedResolution
  );
}
