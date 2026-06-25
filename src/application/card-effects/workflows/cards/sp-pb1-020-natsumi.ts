import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { SP_PB1_020_AUTO_ON_MOVE_DRAW_ONE_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb1020NatsumiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PB1_020_AUTO_ON_MOVE_DRAW_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPb1020NatsumiOnMoveDrawOne(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpPb1020NatsumiOnMoveDrawOne(
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
  const drawResult = drawCardsForPlayer(stateAfterUseRecord, player.id, 1);
  if (!drawResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(drawResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'ON_MOVE_DRAW_ONE',
      sourceSlot: ability.sourceSlot,
      fromSlot: ability.metadata?.fromSlot,
      toSlot: ability.metadata?.toSlot,
      swappedCardInstanceId: ability.metadata?.swappedCardInstanceId,
      drawnCardIds: drawResult.drawnCardIds,
    }),
    orderedResolution
  );
}
