import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { N_BP7_030_LIVE_SUCCESS_RETURN_SELF_TO_HAND_DISCARD_ONE_ABILITY_ID } from '../../ability-ids.js';
import { returnLiveZoneCardToHandForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const EXACT_CARD_CODE = 'PL!N-bp7-030-L';
const DISCARD_AFTER_RETURN_STEP_ID = 'N_BP7_030_DISCARD_ONE_AFTER_RETURN';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp7030CheerModeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    N_BP7_030_LIVE_SUCCESS_RETURN_SELF_TO_HAND_DISCARD_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      startReturnSelfThenDiscard(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    N_BP7_030_LIVE_SUCCESS_RETURN_SELF_TO_HAND_DISCARD_ONE_ABILITY_ID,
    DISCARD_AFTER_RETURN_STEP_ID,
    (game, input, context) =>
      finishDiscardAfterReturn(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startReturnSelfThenDiscard(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  if (!isExactOwnLiveSource(game, player.id, ability.sourceCardId)) {
    return finishPendingAsNoOp(game, ability, orderedResolution, continuePendingCardEffects);
  }

  const returnResult = returnLiveZoneCardToHandForPlayer(game, player.id, ability.sourceCardId);
  if (!returnResult) {
    return finishPendingAsNoOp(game, ability, orderedResolution, continuePendingCardEffects);
  }
  const currentPlayer = getPlayerById(returnResult.gameState, player.id);
  if (!currentPlayer || currentPlayer.hand.cardIds.length === 0) {
    return finishPendingAsNoOp(
      returnResult.gameState,
      ability,
      orderedResolution,
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(returnResult.gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: DISCARD_AFTER_RETURN_STEP_ID,
      stepText: '请选择1张手牌放置入休息室。',
      awaitingPlayerId: player.id,
      selectableCardIds: currentPlayer.hand.cardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择要放置入休息室的卡牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: false,
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'RETURN_SOURCE_TO_HAND_START_DISCARD',
      movedCardIds: returnResult.movedCardId ? [returnResult.movedCardId] : [],
      enterHandEventId: returnResult.enterHandEvent.eventId,
    },
  });
}

function finishDiscardAfterReturn(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== N_BP7_030_LIVE_SUCCESS_RETURN_SELF_TO_HAND_DISCARD_ONE_ABILITY_ID ||
    effect.stepId !== DISCARD_AFTER_RETURN_STEP_ID ||
    !player ||
    !selectedCardId
  ) {
    return game;
  }
  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...discardResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_AFTER_RETURN',
      returnedCardId: effect.sourceCardId,
      discardedCardIds: discardResult.discardedCardIds,
      enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingAsNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SOURCE_NOT_IN_LIVE_ZONE_NO_OP',
        returnedCardIds: [],
        discardedCardIds: [],
      }
    ),
    orderedResolution
  );
}

function isExactOwnLiveSource(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    player?.liveZone.cardIds.includes(sourceCardId) === true &&
    sourceCard !== null &&
    sourceCard.ownerId === playerId &&
    isLiveCardData(sourceCard.data) &&
    sourceCard.data.cardCode === EXACT_CARD_CODE
  );
}
