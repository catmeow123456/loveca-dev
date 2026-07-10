import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';
import { SP_BP2_003_AUTO_ON_MOVE_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp2003ChisatoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP2_003_AUTO_ON_MOVE_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpBp2003ChisatoOnMove(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpBp2003ChisatoOnMove(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const placement = placeEnergyFromDeckToZoneByCardEffect(
    game,
    player.id,
    1,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      pendingAbilityId: ability.id,
    }
  );
  if (!placement) {
    return game;
  }

  const placedEnergyCardIds = placement.placedEnergyCardIds;
  const stateAfterUseRecord =
    placedEnergyCardIds.length > 0
      ? recordAbilityUseForContext(placement.gameState, player.id, {
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
        })
      : placement.gameState;
  const stateWithoutPending: GameState = {
    ...stateAfterUseRecord,
    pendingAbilities: stateAfterUseRecord.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step:
        placedEnergyCardIds.length > 0
          ? 'ON_MOVE_PLACE_WAITING_ENERGY'
          : 'ENERGY_DECK_EMPTY',
      sourceSlot: ability.sourceSlot,
      fromSlot: ability.metadata?.fromSlot,
      toSlot: ability.metadata?.toSlot,
      swappedCardInstanceId: ability.metadata?.swappedCardInstanceId,
      placedEnergyCardIds,
      nextOrientation: OrientationState.WAITING,
    }),
    orderedResolution
  );
}
