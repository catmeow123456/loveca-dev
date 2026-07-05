import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember, drawCardsForPlayer } from '../../runtime/actions.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_DISCARD_STEP_ID = 'SP_PR_LIVE_START_SELECT_DISCARD_FOR_BLADE_DRAW';
const BLADE_BONUS = 1;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerLiveStartDiscardGainBladeDrawIfLiveWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startLiveStartDiscardGainBladeDrawIfLive(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishLiveStartDiscardGainBladeDrawIfLive(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_DISCARD',
          })
  );
}

function startLiveStartDiscardGainBladeDrawIfLive(
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
      effectText: getAbilityEffectText(SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID),
      stepId: SELECT_DISCARD_STEP_ID,
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

function finishLiveStartDiscardGainBladeDrawIfLive(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, effect.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return consumeActiveEffectNoOp(game, continuePendingCardEffects, 'SOURCE_NOT_ON_STAGE');
  }
  if (!player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const discardedCard = getCardById(game, discardCardId);
  const discardedLive = discardedCard ? isLiveCardData(discardedCard.data) : false;
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

  const bladeResult = addBladeLiveModifierForSourceMember(discardResult.gameState, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: BLADE_BONUS,
  });
  if (!bladeResult) {
    return consumeActiveEffectNoOp(discardResult.gameState, continuePendingCardEffects, 'SOURCE_NOT_ON_STAGE');
  }

  const drawResult = discardedLive
    ? drawCardsForPlayer(bladeResult.gameState, player.id, 1)
    : null;
  const stateAfterEffect = discardedLive && drawResult ? drawResult.gameState : bladeResult.gameState;

  return continuePendingCardEffects(
    addAction({ ...stateAfterEffect, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: discardedLive ? 'DISCARD_LIVE_GAIN_BLADE_DRAW_ONE' : 'DISCARD_GAIN_BLADE',
      sourceSlot,
      discardedCardId: discardResult.discardedCardIds[0],
      discardedLive,
      bladeBonus: BLADE_BONUS,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
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

function consumeActiveEffectNoOp(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
    }),
    effect.metadata?.orderedResolution === true
  );
}
