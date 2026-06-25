import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addHeartLiveModifierForMember,
  addMemberCostLiveModifierForMember,
} from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { sumStageMemberEffectiveCostMatching } from '../../../effects/conditions.js';
import { HS_BP6_005_LIVE_START_DISCARD_GAIN_COST_CONDITIONAL_BLUE_HEART_BLADE_ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const HS_BP6_005_SELECT_DISCARD_STEP_ID = 'HS_BP6_005_SELECT_DISCARD_FOR_COST_BONUS';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp6005KosuzuWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP6_005_LIVE_START_DISCARD_GAIN_COST_CONDITIONAL_BLUE_HEART_BLADE_ABILITY_ID,
    (game, ability, options) =>
      startHsBp6005KosuzuLiveStartDiscard(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    HS_BP6_005_LIVE_START_DISCARD_GAIN_COST_CONDITIONAL_BLUE_HEART_BLADE_ABILITY_ID,
    HS_BP6_005_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishHsBp6005KosuzuDiscardCost(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startHsBp6005KosuzuLiveStartDiscard(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(
        HS_BP6_005_LIVE_START_DISCARD_GAIN_COST_CONDITIONAL_BLUE_HEART_BLADE_ABILITY_ID
      ),
      stepId: HS_BP6_005_SELECT_DISCARD_STEP_ID,
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
      metadata: {
        sourceSlot: ability.sourceSlot,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD_FOR_COST_BONUS',
      sourceSlot: ability.sourceSlot,
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishHsBp6005KosuzuDiscardCost(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_BP6_005_LIVE_START_DISCARD_GAIN_COST_CONDITIONAL_BLUE_HEART_BLADE_ABILITY_ID ||
    effect.stepId !== HS_BP6_005_SELECT_DISCARD_STEP_ID ||
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
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const costResult = addMemberCostLiveModifierForMember(discardResult.gameState, {
    playerId: player.id,
    memberCardId: effect.sourceCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    countDelta: 6,
  });
  if (!costResult) {
    return game;
  }

  let state = costResult.gameState;
  const ownHasunosoraCostTotal = sumStageMemberEffectiveCostMatching(
    state,
    player.id,
    groupAliasIs('蓮ノ空')
  );
  const opponent = getOpponent(state, player.id);
  const opponentStageCostTotal = opponent
    ? sumStageMemberEffectiveCostMatching(state, opponent.id)
    : 0;
  const conditionMet = ownHasunosoraCostTotal > opponentStageCostTotal;

  if (conditionMet) {
    const heartResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: [{ color: HeartColor.BLUE, count: 1 }],
    });
    if (!heartResult) {
      return game;
    }
    const bladeResult = addBladeLiveModifierForSourceMember(heartResult.gameState, {
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      amount: 1,
    });
    if (!bladeResult) {
      return game;
    }
    state = bladeResult.gameState;
  }

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: conditionMet
        ? 'DISCARD_GAIN_COST_BLUE_HEART_BLADE'
        : 'DISCARD_GAIN_COST_CONDITION_NOT_MET',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: discardResult.discardedCardIds[0],
      costBonus: costResult.costDelta,
      ownHasunosoraCostTotal,
      opponentStageCostTotal,
      conditionMet,
      heartBonus: conditionMet ? [{ color: HeartColor.BLUE, count: 1 }] : [],
      bladeBonus: conditionMet ? 1 : 0,
    }),
    effect.metadata?.orderedResolution === true
  );
}
