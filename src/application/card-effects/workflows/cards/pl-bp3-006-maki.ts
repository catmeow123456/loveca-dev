import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { BP3_006_LIVE_START_DISCARD_GAIN_BLADE_BY_SUCCESS_COUNT_ABILITY_ID } from '../../ability-ids.js';
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
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const BP3_006_SELECT_DISCARD_STEP_ID = 'BP3_006_SELECT_DISCARD_FOR_SUCCESS_COUNT_BLADE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp3006MakiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    BP3_006_LIVE_START_DISCARD_GAIN_BLADE_BY_SUCCESS_COUNT_ABILITY_ID,
    (game, ability, options, context) =>
      startBp3006MakiLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP3_006_LIVE_START_DISCARD_GAIN_BLADE_BY_SUCCESS_COUNT_ABILITY_ID,
    BP3_006_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishBp3006MakiDiscardGainBlade(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startBp3006MakiLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;
  if (!player || sourceSlot === null) {
    return skipPendingAbility(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_NOT_ON_STAGE'
    );
  }
  if (player.hand.cardIds.length === 0) {
    return skipPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_HAND_TO_DISCARD'
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(
        BP3_006_LIVE_START_DISCARD_GAIN_BLADE_BY_SUCCESS_COUNT_ABILITY_ID
      ),
      stepId: BP3_006_SELECT_DISCARD_STEP_ID,
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
      metadata: {
        sourceSlot,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'START_SELECT_DISCARD',
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishBp3006MakiDiscardGainBlade(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP3_006_LIVE_START_DISCARD_GAIN_BLADE_BY_SUCCESS_COUNT_ABILITY_ID ||
    effect.stepId !== BP3_006_SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, effect.sourceCardId) : null;
  if (!player || sourceSlot === null || !player.hand.cardIds.includes(discardCardId)) {
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

  const successLiveCount = player.successZone.cardIds.length;
  const bladeBonus = successLiveCount * 2;
  if (bladeBonus === 0) {
    return continuePendingCardEffects(
      addAction(
        { ...discardResult.gameState, activeEffect: null },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'DISCARD_HAND_CARD_NO_SUCCESS_LIVE',
          sourceSlot,
          discardedCardId: discardResult.discardedCardIds[0],
          successLiveCount,
          bladeBonus,
        }
      ),
      effect.metadata?.orderedResolution === true
    );
  }

  const bladeResult = addBladeLiveModifierForSourceMember(discardResult.gameState, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: bladeBonus,
  });
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...bladeResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD_GAIN_BLADE_BY_SUCCESS_LIVE_COUNT',
      sourceSlot,
      discardedCardId: discardResult.discardedCardIds[0],
      successLiveCount,
      bladeBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function skipPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step,
        sourceSlot: ability.sourceSlot,
      }
    ),
    orderedResolution
  );
}
