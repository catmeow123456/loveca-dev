import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { BP5_005_ON_ENTER_SUCCESS_SCORE_PLACE_ACTIVE_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  successLiveScoreAtLeast,
  sumSuccessfulLiveScore,
} from '../../../effects/conditions.js';
import { placeEnergyFromDeckToZone } from '../../../effects/energy.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerBp5005RinWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    BP5_005_ON_ENTER_SUCCESS_SCORE_PLACE_ACTIVE_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolveBp5RinOnEnterSuccessScorePlaceActiveEnergy(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveBp5RinOnEnterSuccessScorePlaceActiveEnergy(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const successLiveScore = sumSuccessfulLiveScore(game, player.id);
  const conditionMet = successLiveScoreAtLeast(game, player.id, 6);
  const energyPlacement = conditionMet
    ? placeEnergyFromDeckToZone(game, player.id, 1, OrientationState.ACTIVE)
    : null;
  const state = {
    ...(energyPlacement?.gameState ?? game),
    pendingAbilities: (energyPlacement?.gameState ?? game).pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'PLACE_ACTIVE_ENERGY_IF_SUCCESS_LIVE_SCORE',
      successLiveScore,
      conditionMet,
      placedEnergyCardIds: energyPlacement?.placedEnergyCardIds ?? [],
    }),
    orderedResolution
  );
}
