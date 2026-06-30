import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { selectRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import { placeEnergyFromDeckToZone } from '../../../effects/energy.js';
import { SP_PR_018_LIVE_SUCCESS_SEVEN_LIELLA_CHEER_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { maybeStartManualPendingAbilityConfirmation } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPr018KanonWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PR_018_LIVE_SUCCESS_SEVEN_LIELLA_CHEER_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) => {
      const manualConfirmation = maybeStartManualPendingAbilityConfirmation(game, ability, options);
      if (manualConfirmation) {
        return manualConfirmation;
      }

      return resolveSpPr018KanonLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function resolveSpPr018KanonLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceOnStage = findMemberSlot(player, ability.sourceCardId) !== null;
  const liellaCheerCardIds = sourceOnStage
    ? selectRevealedCheerCardIds(game, player.id, groupAliasIs('Liella!'))
    : [];
  const conditionMet = sourceOnStage && liellaCheerCardIds.length >= 7;
  const energyPlacement = conditionMet
    ? placeEnergyFromDeckToZone(game, player.id, 1, OrientationState.WAITING)
    : null;
  const stateAfterPlacement = energyPlacement?.gameState ?? game;
  const stateWithoutPending: GameState = {
    ...stateAfterPlacement,
    pendingAbilities: stateAfterPlacement.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SEVEN_LIELLA_CHEER_PLACE_WAITING_ENERGY',
      sourceOnStage,
      conditionMet,
      qualifyingCheerCardIds: liellaCheerCardIds,
      qualifyingCheerCardCount: liellaCheerCardIds.length,
      placedEnergyCardIds: energyPlacement?.placedEnergyCardIds ?? [],
    }),
    orderedResolution
  );
}
