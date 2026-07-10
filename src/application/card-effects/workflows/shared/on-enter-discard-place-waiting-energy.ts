import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';

const KEKE_SELECT_DISCARD_STEP_ID = 'KEKE_SELECT_DISCARD_FOR_WAITING_ENERGY';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerKekeOnEnterPlaceWaitingEnergyWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options) =>
      startKekeOnEnterPlaceWaitingEnergy(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
    KEKE_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishKekeOnEnterPlaceWaitingEnergy(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startKekeOnEnterPlaceWaitingEnergy(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds.filter((cardId) => cardId !== ability.sourceCardId);

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID),
      stepId: KEKE_SELECT_DISCARD_STEP_ID,
      selectableCardIds,
      orderedResolution,
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds,
    },
  });
}

function finishKekeOnEnterPlaceWaitingEnergy(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID ||
    effect.stepId !== KEKE_SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    discardCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const energyPlacement = placeEnergyFromDeckToZoneByCardEffect(
    discardResult.gameState,
    player.id,
    1,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!energyPlacement) {
    return game;
  }

  const state = { ...energyPlacement.gameState, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PLACE_WAITING_ENERGY',
      discardCardId,
      placedEnergyCardIds: energyPlacement.placedEnergyCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}
