import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { selectCurrentLiveRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import { placeEnergyFromDeckToZone } from '../../../effects/energy.js';
import { SP_PR_018_LIVE_SUCCESS_SEVEN_LIELLA_CHEER_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPr018KanonWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PR_018_LIVE_SUCCESS_SEVEN_LIELLA_CHEER_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getSpPr018KanonConfirmationEffectText(game, ability),
      });
      if (confirmation) {
        return confirmation;
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

function getSpPr018KanonConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const sourceOnStage = player ? findMemberSlot(player, ability.sourceCardId) !== null : false;
  const liellaCheerCardIds =
    player && sourceOnStage ? selectLiellaCheerCardIds(game, player.id) : [];
  const conditionMet = sourceOnStage && liellaCheerCardIds.length >= 7;
  return `${getAbilityEffectText(ability.abilityId)}（声援Liella!卡 ${liellaCheerCardIds.length}张，${conditionMet ? '满足条件，放置1张等待能量' : '未满足条件'}）`;
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
  const liellaCheerCardIds = sourceOnStage ? selectLiellaCheerCardIds(game, player.id) : [];
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

function selectLiellaCheerCardIds(game: GameState, playerId: string): readonly string[] {
  return selectCurrentLiveRevealedCheerCardIds(game, playerId, {
    cardTypes: [CardType.MEMBER, CardType.LIVE],
    groupAliases: ['Liella!'],
  });
}
