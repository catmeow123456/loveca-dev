import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import {
  startConfirmOnlyPendingAbilityEffect,
} from '../../runtime/active-effect.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { costGte, groupAliasIs } from '../../../effects/card-selectors.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsSd1001KahoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      startHsSd1001KahoRelayReplacedActivateEnergy(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
}

export function isHsSd1001HighCostHasunosoraRelayReplacement(
  game: GameState,
  replacingCardId: string | null | undefined
): boolean {
  if (!replacingCardId) {
    return false;
  }
  const replacingCard = getCardById(game, replacingCardId);
  return (
    replacingCard !== null &&
    isMemberCardData(replacingCard.data) &&
    groupAliasIs('蓮ノ空')(replacingCard) &&
    costGte(10)(replacingCard)
  );
}

function startHsSd1001KahoRelayReplacedActivateEnergy(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const replacingCardId =
    typeof ability.metadata?.replacingCardId === 'string' ? ability.metadata.replacingCardId : null;
  if (!player || !replacingCardId) {
    return game;
  }
  if (options.manualConfirmation === true && options.skipManualConfirmation !== true) {
    return startConfirmOnlyPendingAbilityEffect(game, {
      ability,
      effectText: getAbilityEffectText(HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID),
      orderedResolution: options.orderedResolution === true,
    });
  }

  if (!isHsSd1001HighCostHasunosoraRelayReplacement(game, replacingCardId)) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'CONDITION_NOT_MET',
        replacingCardId,
      }),
      options.orderedResolution === true
    );
  }

  const waitingEnergyCount = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  ).length;
  const activationCount = Math.min(2, waitingEnergyCount);
  const orientationChange = activateWaitingEnergyCardsForPlayer(game, player.id, activationCount);
  if (!orientationChange) {
    return game;
  }

  const state = {
    ...orientationChange.gameState,
    pendingAbilities: orientationChange.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'ACTIVATE_TWO_ENERGY_AFTER_RELAY',
      replacingCardId,
      activatedEnergyCardIds: orientationChange.activatedEnergyCardIds,
      previousOrientations: orientationChange.previousOrientations,
      nextOrientation: orientationChange.nextOrientation,
    }),
    options.orderedResolution === true
  );
}
