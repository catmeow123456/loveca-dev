import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const ACTIVATE_ENERGY_COUNT = 2;

export function registerOnEnterActivateWaitingEnergyWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolveOnEnterActivateWaitingEnergy(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveOnEnterActivateWaitingEnergy(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );
  const activationCount = Math.min(ACTIVATE_ENERGY_COUNT, waitingEnergyCardIds.length);
  const activationResult = activateWaitingEnergyCardsForPlayer(game, player.id, activationCount);
  if (!activationResult) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...activationResult.gameState,
    pendingAbilities: activationResult.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'ACTIVATE_WAITING_ENERGY',
      requestedActivationCount: ACTIVATE_ENERGY_COUNT,
      waitingEnergyCardIds,
      activatedEnergyCardIds: activationResult.activatedEnergyCardIds,
      previousOrientations: activationResult.previousOrientations,
      nextOrientation: activationResult.nextOrientation,
    }),
    orderedResolution
  );
}
