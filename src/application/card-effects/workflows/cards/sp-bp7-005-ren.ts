import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  placeWaitingEnergyWithActivePhaseSkip,
  type EnqueueTriggeredCardEffectsForWaitingEnergyPlacement,
} from '../../runtime/waiting-energy-placement.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type Continue = (game: GameState, ordered: boolean) => GameState;
type Enqueue = EnqueueTriggeredCardEffectsForWaitingEnergyPlacement;

export function registerSpBp7005RenWorkflowHandlers(deps: {
  enqueueTriggeredCardEffects: Enqueue;
}): void {
  registerPendingAbilityStarterHandler(
    SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolvePlacement(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function resolvePlacement(
  game: GameState,
  ability: PendingAbilityState,
  ordered: boolean,
  next: Continue,
  enqueue: Enqueue
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? findMemberSlot(player, ability.sourceCardId) : null;
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id),
  };
  let placedEnergyCardIds: readonly string[] = [];
  if (player && sourceSlot !== null) {
    state = recordAbilityUseForContext(state, player.id, {
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
    });
    const result = placeWaitingEnergyWithActivePhaseSkip(state, {
      count: 1,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        pendingAbilityId: ability.id,
      },
      enqueueTriggeredCardEffects: enqueue,
    });
    if (result) {
      placedEnergyCardIds = result.placedEnergyCardIds;
      state = result.gameState;
    }
  }
  return next(
    addAction(state, 'RESOLVE_ABILITY', player?.id ?? ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      placedEnergyCardIds,
      sourceStillOnStage: sourceSlot !== null,
    }),
    ordered
  );
}
