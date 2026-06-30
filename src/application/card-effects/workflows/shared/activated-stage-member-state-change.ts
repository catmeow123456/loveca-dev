import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { GamePhase, OrientationState, CardType } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID,
  BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
} from '../../ability-ids.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import {
  sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers,
  type EnqueueTriggeredCardEffectsForLeaveStage,
} from '../../runtime/leave-stage-triggers.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsByOrientation } from '../../../effects/stage-targets.js';
import { and, costLte, typeIs } from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';

const BP6_008_SELECT_OWN_WAITING_MEMBER_STEP_ID = 'BP6_008_SELECT_OWN_WAITING_MEMBER_TO_ACTIVE';
const BP6_010_SELECT_OPPONENT_COST_FOUR_MEMBER_STEP_ID =
  'BP6_010_SELECT_OPPONENT_COST_FOUR_MEMBER_TO_WAIT';

type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged &
  EnqueueTriggeredCardEffectsForLeaveStage;
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp6008And010ActivatedStateWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID,
    (game, playerId, cardId) => startBp6008WaitSelfActivateOther(game, playerId, cardId, deps)
  );
  registerActiveEffectStepHandler(
    BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID,
    BP6_008_SELECT_OWN_WAITING_MEMBER_STEP_ID,
    (game, input, context) =>
      finishBp6008ActivateOtherMember(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps
      )
  );

  registerActivatedAbilityHandler(
    BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
    (game, playerId, cardId) => startBp6010SendSelfWaitOpponent(game, playerId, cardId, deps)
  );
  registerActiveEffectStepHandler(
    BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
    BP6_010_SELECT_OPPONENT_COST_FOUR_MEMBER_STEP_ID,
    (game, input, context) =>
      finishBp6010WaitOpponentMember(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps
      )
  );
}

function startBp6008WaitSelfActivateOther(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const source = getValidActivatedSource(game, playerId, cardId, 'PL!-bp6-008');
  if (!source || source.sourceState !== OrientationState.ACTIVE) {
    return game;
  }

  const waitResult = setMemberOrientation(game, playerId, cardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId,
    sourceCardId: cardId,
    abilityId: BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID,
  });
  if (!waitResult || waitResult.previousOrientation !== OrientationState.ACTIVE) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) =>
        addAction(stateAfterWait, 'PAY_COST', playerId, {
          abilityId: BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID,
          sourceCardId: cardId,
          sourceSlot: source.sourceSlot,
          waitedMemberCardId: cardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  const stateAfterUse = recordAbilityUseForContext(
    stateWithMemberStateTriggers.gameState,
    playerId,
    {
      abilityId: BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID,
      sourceCardId: cardId,
    }
  );
  const selectableCardIds = getOtherWaitingStageMemberIds(stateAfterUse, playerId, cardId);
  if (selectableCardIds.length === 0) {
    return addAction(stateAfterUse, 'RESOLVE_ABILITY', playerId, {
      abilityId: BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot: source.sourceSlot,
      step: 'NO_TARGET_AFTER_COST',
    });
  }

  const effectId = `${BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID}:${cardId}:turn-${stateAfterUse.turnCount}:action-${stateAfterUse.actionHistory.length}`;
  return addAction(
    {
      ...stateAfterUse,
      activeEffect: {
        id: effectId,
        abilityId: BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: playerId,
        effectText: getAbilityEffectText(BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID),
        stepId: BP6_008_SELECT_OWN_WAITING_MEMBER_STEP_ID,
        stepText: '请选择自己舞台上其他1名待机状态的成员变为活跃状态。',
        awaitingPlayerId: playerId,
        selectableCardIds,
        selectionLabel: '选择要变为活跃状态的成员',
        canSkipSelection: false,
        metadata: {
          sourceSlot: source.sourceSlot,
          stageMemberOrientationTarget: true,
          orderedResolution: false,
          targetPlayerId: playerId,
          targetOrientation: OrientationState.ACTIVE,
        },
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot: source.sourceSlot,
      step: 'START_SELECT_OWN_WAITING_MEMBER',
      selectableCardIds,
    }
  );
}

function finishBp6008ActivateOtherMember(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects }
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const targetMetadata = getStageMemberOrientationTargetMetadata(effect);
  if (!player || !targetMetadata || !selectedCardId || selectedCardId === effect.sourceCardId) {
    return game;
  }

  const orientationChange = resolveStageMemberOrientationTargetSelection(
    game,
    effect,
    selectedCardId
  );
  if (!orientationChange || orientationChange.previousOrientation !== OrientationState.WAITING) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, memberStateChangedEvents) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            sourceSlot: effect.metadata?.sourceSlot,
            step: 'ACTIVATE_OTHER_MEMBER',
            targetPlayerId: targetMetadata.targetPlayerId,
            targetCardId: selectedCardId,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
            memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
          }
        ),
    }
  );
  return continuePendingCardEffects(stateWithMemberStateTriggers.gameState, false);
}

function startBp6010SendSelfWaitOpponent(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const source = getValidActivatedSource(game, playerId, cardId, 'PL!-bp6-010');
  const opponent = getOpponent(game, playerId);
  if (!source || !opponent) {
    return game;
  }

  const selector = and(typeIs(CardType.MEMBER), costLte(4));
  const costPayment = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
    game,
    playerId,
    cardId,
    deps.enqueueTriggeredCardEffects
  );
  if (!costPayment || !costPayment.sourceSlot) {
    return game;
  }

  const stateAfterPayCost = addAction(costPayment.gameState, 'PAY_COST', playerId, {
    abilityId: BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
    sourceCardId: cardId,
    sourceSlot: costPayment.sourceSlot,
    movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
    enterWaitingRoomEventId: costPayment.enterWaitingRoomEvent.eventId,
    leaveStageEventIds: costPayment.leaveStageEvents.map((event) => event.eventId),
  });
  const stateAfterUse = recordAbilityUseForContext(stateAfterPayCost, playerId, {
    abilityId: BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
    sourceCardId: cardId,
  });
  const effectId = `${BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID}:${cardId}:turn-${stateAfterUse.turnCount}:action-${stateAfterUse.actionHistory.length}`;
  const targetSelection = createStageMemberOrientationTargetSelection(stateAfterUse, {
    ability: {
      id: effectId,
      abilityId: BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
      sourceCardId: cardId,
      controllerId: playerId,
      mandatory: true,
      timingId: 'ACTIVATED',
      eventIds: [],
      sourceSlot: costPayment.sourceSlot,
    },
    effectText: getAbilityEffectText(
      BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID
    ),
    stepId: BP6_010_SELECT_OPPONENT_COST_FOUR_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于4的成员变为待机状态。',
    awaitingPlayerId: playerId,
    targetPlayerId: opponent.id,
    selector,
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择对方舞台上费用小于等于4的成员',
    orderedResolution: false,
    metadata: {
      sourceSlot: costPayment.sourceSlot,
      movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
    },
  });
  if (targetSelection.activeEffect === null) {
    return addAction(stateAfterUse, 'RESOLVE_ABILITY', playerId, {
      abilityId: BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot: costPayment.sourceSlot,
      step: 'NO_TARGET_AFTER_COST',
      movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
    });
  }

  return addAction(
    {
      ...stateAfterUse,
      activeEffect: targetSelection.activeEffect,
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot: costPayment.sourceSlot,
      step: 'PAY_COST_START_SELECT_OPPONENT_COST_FOUR_MEMBER',
      movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
      selectableCardIds: targetSelection.selectableCardIds,
    }
  );
}

function finishBp6010WaitOpponentMember(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects }
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID ||
    !selectedCardId
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const targetMetadata = getStageMemberOrientationTargetMetadata(effect);
  if (!player || !targetMetadata) {
    return game;
  }

  const orientationChange = resolveStageMemberOrientationTargetSelection(
    game,
    effect,
    selectedCardId
  );
  if (!orientationChange) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, memberStateChangedEvents) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            sourceSlot: effect.metadata?.sourceSlot,
            step: 'WAIT_OPPONENT_COST_FOUR_MEMBER',
            movedToWaitingRoomCardIds: effect.metadata?.movedToWaitingRoomCardIds ?? [],
            targetPlayerId: targetMetadata.targetPlayerId,
            targetCardId: selectedCardId,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
            memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
          }
        ),
    }
  );
  return continuePendingCardEffects(stateWithMemberStateTriggers.gameState, false);
}

function getValidActivatedSource(
  game: GameState,
  playerId: string,
  cardId: string,
  baseCardCode: string
): {
  readonly sourceSlot: NonNullable<ReturnType<typeof getSourceMemberSlot>>;
  readonly sourceState: OrientationState;
} | null {
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceState = player?.memberSlots.cardStates.get(cardId)?.orientation ?? null;
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, baseCardCode) ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot === null ||
    sourceState === null
  ) {
    return null;
  }

  return { sourceSlot, sourceState };
}

function getOtherWaitingStageMemberIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  return getStageMemberCardIdsByOrientation(game, playerId, OrientationState.WAITING).filter(
    (cardId) => cardId !== sourceCardId
  );
}
