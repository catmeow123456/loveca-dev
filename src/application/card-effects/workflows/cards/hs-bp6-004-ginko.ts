import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, cardNameIs, typeIs } from '../../../effects/card-selectors.js';
import { HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  addBladeLiveModifierForSourceMember,
  discardOneHandCardToWaitingRoomForPlayer,
} from '../../runtime/actions.js';
import {
  enqueueEnterWaitingRoomTriggersFromDiscardResult,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const HS_BP6_004_SELECT_DISCARD_STEP_ID = 'HS_BP6_004_SELECT_DISCARD_FOR_BLADE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const ginkoMember = and(typeIs(CardType.MEMBER), cardNameIs('百生吟子'));

export function registerHsBp6004GinkoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID,
    (game, ability, options) =>
      startHsBp6GinkoLiveStartDiscardGainBlade(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID,
    HS_BP6_004_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishHsBp6GinkoDiscardGainBlade(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startHsBp6GinkoLiveStartDiscardGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID),
      stepId: HS_BP6_004_SELECT_DISCARD_STEP_ID,
      selectableCardIds,
      orderedResolution,
      metadata: {
        sourceSlot: ability.sourceSlot,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      sourceSlot: ability.sourceSlot,
      selectableCardIds,
    },
  });
}

function finishHsBp6GinkoDiscardGainBlade(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== HS_BP6_004_SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const discardCard = getCardById(game, discardCardId);
  if (!player || !discardCard || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomForPlayer(game, player.id, discardCardId, {
    candidateCardIds: effect.selectableCardIds ?? [],
  });
  if (!discardResult) {
    return game;
  }
  const stateWithEnterWaitingRoomTriggers = enqueueEnterWaitingRoomTriggersFromDiscardResult(
    discardResult.gameState,
    discardResult,
    enqueueTriggeredCardEffects
  );

  const discardedWasGinko = ginkoMember(discardCard);
  const bladeBonus = discardedWasGinko ? 2 : 1;
  const bladeResult = addBladeLiveModifierForSourceMember(stateWithEnterWaitingRoomTriggers, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: bladeBonus,
  });
  if (!bladeResult) {
    return game;
  }

  const state = { ...bladeResult.gameState, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD_GAIN_BLADE',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: discardResult.discardedCardIds[0],
      discardedWasGinko,
      bladeBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}
