import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { SP_PB1_007_LIVE_START_ACTIVATE_TWO_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { registerManualConfirmablePendingAbilityStarterHandler } from '../../runtime/workflow-helpers.js';

const REQUESTED_ACTIVATION_COUNT = 2;

export function registerSpPb1007MeiWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    SP_PB1_007_LIVE_START_ACTIVATE_TWO_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPb1007MeiLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    () => ({ stepText: '确认后结算此效果。' })
  );
}

function resolveSpPb1007MeiLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: (game: GameState, orderedResolution: boolean) => GameState
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );
  const activationCount = Math.min(REQUESTED_ACTIVATION_COUNT, waitingEnergyCardIds.length);
  const activation = activateWaitingEnergyCardsForPlayer(game, player.id, activationCount);
  if (!activation) return game;

  const stateWithoutPending: GameState = {
    ...activation.gameState,
    pendingAbilities: activation.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };
  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'ACTIVATE_WAITING_ENERGY',
      requestedActivationCount: REQUESTED_ACTIVATION_COUNT,
      waitingEnergyCardIds,
      activatedEnergyCardIds: activation.activatedEnergyCardIds,
      previousOrientations: activation.previousOrientations,
      nextOrientation: activation.nextOrientation,
    }),
    orderedResolution
  );
}
