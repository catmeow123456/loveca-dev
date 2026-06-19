import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { discardOneHandCardToWaitingRoomForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import type { EffectCostDefinition } from '../../../effects/effect-costs.js';
import { placeEnergyFromDeckToZone } from '../../../effects/energy.js';

const KEKE_SELECT_DISCARD_STEP_ID = 'KEKE_SELECT_DISCARD_FOR_WAITING_ENERGY';
const DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL = '请选择要放置入休息室的卡牌';
const DISCARD_HAND_TO_ACTIVATE_STEP_TEXT = '请选择要放置入休息室的手牌。也可以选择不发动此效果。';
const DECLINE_OPTION_LABEL = '不发动';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerKekeOnEnterPlaceWaitingEnergyWorkflowHandlers(): void {
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
            context.continuePendingCardEffects
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
  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: 1,
    maxCount: 1,
    optional: true,
  };

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID),
      stepId: KEKE_SELECT_DISCARD_STEP_ID,
      stepText: DISCARD_HAND_TO_ACTIVATE_STEP_TEXT,
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL,
      canSkipSelection: true,
      skipSelectionLabel: DECLINE_OPTION_LABEL,
      metadata: {
        orderedResolution,
        effectCosts: [discardCost],
        handToWaitingRoomCost: {
          minCount: discardCost.minCount,
          maxCount: discardCost.maxCount,
          optional: discardCost.optional,
        },
      },
    },
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
  continuePendingCardEffects: ContinuePendingCardEffects
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

  const discardResult = discardOneHandCardToWaitingRoomForPlayer(game, player.id, discardCardId, {
    candidateCardIds: effect.selectableCardIds ?? [],
  });
  if (!discardResult) {
    return game;
  }

  const energyPlacement = placeEnergyFromDeckToZone(
    discardResult.gameState,
    player.id,
    1,
    OrientationState.WAITING
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
