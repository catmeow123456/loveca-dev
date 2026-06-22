import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState, HeartColor } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { hasStageMemberMatching } from '../../../effects/conditions.js';
import { placeEnergyFromDeckToZone } from '../../../effects/energy.js';
import {
  getRemainingHeartCount,
  getRemainingHeartTotalCount,
  hasRemainingHeartColor,
} from '../../../effects/remaining-hearts.js';
import { PL_N_BP3_027_LIVE_SUCCESS_GREEN_SURPLUS_NIJIGASAKI_MEMBER_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp3027LaBellaPatriaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP3_027_LIVE_SUCCESS_GREEN_SURPLUS_NIJIGASAKI_MEMBER_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolveNBp3027LaBellaPatriaLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveNBp3027LaBellaPatriaLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const remainingGreenHeartCount = getRemainingHeartCount(game, player.id, HeartColor.GREEN);
  const remainingHeartTotalCount = getRemainingHeartTotalCount(game, player.id);
  const hasGreenRemainingHeart = hasRemainingHeartColor(game, player.id, HeartColor.GREEN, 1);
  const hasNijigasakiStageMember = hasStageMemberMatching(game, player.id, groupAliasIs('虹ヶ咲'));
  const conditionMet = hasGreenRemainingHeart && hasNijigasakiStageMember;
  const energyPlacement = conditionMet
    ? placeEnergyFromDeckToZone(game, player.id, 1, OrientationState.WAITING)
    : null;
  const stateAfterPlacement = energyPlacement?.gameState ?? game;
  const state = {
    ...stateAfterPlacement,
    pendingAbilities: stateAfterPlacement.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'PLACE_WAITING_ENERGY_IF_GREEN_SURPLUS_AND_NIJIGASAKI_MEMBER',
      conditionMet,
      remainingGreenHeartCount,
      remainingHeartTotalCount,
      hasNijigasakiStageMember,
      placedEnergyCardIds: energyPlacement?.placedEnergyCardIds ?? [],
    }),
    orderedResolution
  );
}
