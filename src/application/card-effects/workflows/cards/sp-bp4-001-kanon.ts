import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { placeEnergyFromDeckToZone } from '../../../effects/energy.js';
import { SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const isLiellaCard = groupAliasIs('Liella!');

export function registerSpBp4001KanonWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpBp4001KanonOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpBp4001KanonOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stageMemberCardIds = Object.values(player.memberSlots.slots).filter(
    (cardId): cardId is string => cardId !== null
  );
  const allStageMembersAreLiella =
    stageMemberCardIds.length > 0 &&
    stageMemberCardIds.every((cardId) => {
      const card = getCardById(game, cardId);
      return card !== null && isLiellaCard(card);
    });
  const energyZoneCount = player.energyZone.cardIds.length;
  const conditionMet = allStageMembersAreLiella && energyZoneCount >= 7;
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
      step: 'PLACE_WAITING_ENERGY_IF_LIELLA_STAGE_SEVEN_ENERGY',
      allStageMembersAreLiella,
      energyZoneCount,
      conditionMet,
      placedEnergyCardIds: energyPlacement?.placedEnergyCardIds ?? [],
    }),
    orderedResolution
  );
}
