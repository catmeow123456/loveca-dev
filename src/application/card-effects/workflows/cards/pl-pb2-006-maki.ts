import {
  calculateTotalHearts,
  isMemberCardData,
  type CardInstance,
} from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import {
  createStageMemberOrientationTargetSelection,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import {
  PL_PB2_006_ACTIVATED_WAIT_SELF_DISCARD_WAIT_LOW_ORIGINAL_HEART_OPPONENT_ABILITY_ID,
  PL_PB2_006_LIVE_START_WAIT_SELF_DISCARD_WAIT_LOW_ORIGINAL_HEART_OPPONENT_ABILITY_ID,
} from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const BASE_CARD_CODE = 'PL!-pb2-006';
const CHOOSE_LIVE_START_ACTIVATION_STEP_ID = 'PL_PB2_006_CHOOSE_LIVE_START_ACTIVATION';
const SELECT_HAND_DISCARD_STEP_ID = 'PL_PB2_006_SELECT_HAND_CARD_TO_DISCARD';
const SELECT_OPPONENT_MEMBER_STEP_ID =
  'PL_PB2_006_SELECT_LOW_ORIGINAL_HEART_OPPONENT_MEMBER_TO_WAIT';
const ACTIVATE_OPTION_ID = 'activate';

const lowOriginalHeartMemberSelector = (card: CardInstance) =>
  isMemberCardData(card.data) && calculateTotalHearts(card.data) <= 1;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

interface WorkflowDeps {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}

export function registerPlPb2006MakiWorkflowHandlers(deps: WorkflowDeps): void {
  registerActivatedAbilityHandler(
    PL_PB2_006_ACTIVATED_WAIT_SELF_DISCARD_WAIT_LOW_ORIGINAL_HEART_OPPONENT_ABILITY_ID,
    (game, playerId, cardId) => startActivated(game, playerId, cardId, deps)
  );
  registerPendingAbilityStarterHandler(
    PL_PB2_006_LIVE_START_WAIT_SELF_DISCARD_WAIT_LOW_ORIGINAL_HEART_OPPONENT_ABILITY_ID,
    (game, ability, options, context) =>
      startLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );

  for (const abilityId of [
    PL_PB2_006_ACTIVATED_WAIT_SELF_DISCARD_WAIT_LOW_ORIGINAL_HEART_OPPONENT_ABILITY_ID,
    PL_PB2_006_LIVE_START_WAIT_SELF_DISCARD_WAIT_LOW_ORIGINAL_HEART_OPPONENT_ABILITY_ID,
  ]) {
    registerActiveEffectStepHandler(
      abilityId,
      SELECT_HAND_DISCARD_STEP_ID,
      (game, input, context) =>
        finishDiscardCost(
          game,
          input.selectedCardId ?? null,
          deps,
          context.continuePendingCardEffects
        )
    );
    registerActiveEffectStepHandler(
      abilityId,
      SELECT_OPPONENT_MEMBER_STEP_ID,
      (game, input, context) =>
        finishOpponentTarget(
          game,
          input.selectedCardId ?? null,
          deps,
          context.continuePendingCardEffects
        )
    );
  }

  registerActiveEffectStepHandler(
    PL_PB2_006_LIVE_START_WAIT_SELF_DISCARD_WAIT_LOW_ORIGINAL_HEART_OPPONENT_ABILITY_ID,
    CHOOSE_LIVE_START_ACTIVATION_STEP_ID,
    (game, input, context) =>
      finishLiveStartActivation(
        game,
        input.selectedOptionId ?? null,
        deps,
        context.continuePendingCardEffects
      )
  );
}

function startActivated(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: WorkflowDeps
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) return game;

  const player = getPlayerById(game, playerId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceState = player?.memberSlots.cardStates.get(cardId);
  if (
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !isMakiSource(game, playerId, cardId) ||
    sourceSlot === null ||
    sourceState?.orientation !== OrientationState.ACTIVE ||
    player.hand.cardIds.length === 0
  ) {
    return game;
  }

  const abilityId =
    PL_PB2_006_ACTIVATED_WAIT_SELF_DISCARD_WAIT_LOW_ORIGINAL_HEART_OPPONENT_ABILITY_ID;
  const effect: ActiveEffectState = {
    id: `${abilityId}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
    abilityId,
    sourceCardId: cardId,
    controllerId: playerId,
    effectText: getAbilityEffectText(abilityId),
    stepId: SELECT_HAND_DISCARD_STEP_ID,
    stepText:
      '请选择1张手牌放置入休息室。之后选择对方舞台上1名原本HEART小于等于1的成员变为待机状态。',
    awaitingPlayerId: playerId,
    metadata: { orderedResolution: false, sourceSlot, timingId: 'ACTIVATED' },
  };
  return paySourceWaitCostAndOpenDiscard(game, effect, deps);
}

function startLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  const sourceState = player?.memberSlots.cardStates.get(ability.sourceCardId);
  const stateWithoutPending = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  if (
    !player ||
    !isMakiSource(game, ability.controllerId, ability.sourceCardId) ||
    sourceSlot === null ||
    sourceState?.orientation !== OrientationState.ACTIVE ||
    player.hand.cardIds.length === 0
  ) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', ability.controllerId, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'COST_NOT_PAYABLE',
        sourceSlot,
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...stateWithoutPending,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceLifecycleId: ability.sourceLifecycleId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: CHOOSE_LIVE_START_ACTIVATION_STEP_ID,
        stepText: '可以将此成员变为待机状态并将1张手牌放置入休息室，以发动此效果。',
        awaitingPlayerId: player.id,
        selectableOptions: [{ id: ACTIVATE_OPTION_ID, label: '发动' }],
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: {
          orderedResolution,
          sourceSlot,
          eventIds: ability.eventIds,
          timingId: ability.timingId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_CHOOSE_ACTIVATION',
      sourceSlot,
    }
  );
}

function finishLiveStartActivation(
  game: GameState,
  selectedOptionId: string | null,
  deps: WorkflowDeps,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_PB2_006_LIVE_START_WAIT_SELF_DISCARD_WAIT_LOW_ORIGINAL_HEART_OPPONENT_ABILITY_ID ||
    effect.stepId !== CHOOSE_LIVE_START_ACTIVATION_STEP_ID
  ) {
    return game;
  }

  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (selectedOptionId === null) {
    return finishWithoutTarget(
      game,
      effect,
      continuePendingCardEffects,
      'DECLINED',
      orderedResolution
    );
  }
  if (
    selectedOptionId !== ACTIVATE_OPTION_ID ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = getSourceMemberSlot(game, effect.controllerId, effect.sourceCardId);
  const sourceState = player?.memberSlots.cardStates.get(effect.sourceCardId);
  if (
    !player ||
    !isMakiSource(game, effect.controllerId, effect.sourceCardId) ||
    sourceSlot === null ||
    sourceState?.orientation !== OrientationState.ACTIVE ||
    player.hand.cardIds.length === 0
  ) {
    return finishWithoutTarget(
      game,
      effect,
      continuePendingCardEffects,
      'COST_NOT_PAYABLE_AT_CONFIRMATION',
      orderedResolution
    );
  }

  return paySourceWaitCostAndOpenDiscard(
    game,
    {
      ...effect,
      stepId: SELECT_HAND_DISCARD_STEP_ID,
      metadata: { ...effect.metadata, sourceSlot },
    },
    deps
  );
}

function paySourceWaitCostAndOpenDiscard(
  game: GameState,
  effect: ActiveEffectState,
  deps: WorkflowDeps
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = getSourceMemberSlot(game, effect.controllerId, effect.sourceCardId);
  const sourceState = player?.memberSlots.cardStates.get(effect.sourceCardId);
  if (
    !player ||
    !isMakiSource(game, player.id, effect.sourceCardId) ||
    sourceSlot === null ||
    sourceState?.orientation !== OrientationState.ACTIVE ||
    player.hand.cardIds.length === 0
  ) {
    return game;
  }

  const orientationChange = setMemberOrientation(
    game,
    player.id,
    effect.sourceCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (
    !orientationChange ||
    !orientationChange.changed ||
    orientationChange.previousOrientation !== OrientationState.ACTIVE
  ) {
    return game;
  }

  return enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) => {
        const handCardIds = getPlayerById(stateAfterWait, player.id)?.hand.cardIds ?? [];
        return addAction(
          {
            ...stateAfterWait,
            activeEffect: {
              id: effect.id,
              abilityId: effect.abilityId,
              sourceCardId: effect.sourceCardId,
              sourceLifecycleId: effect.sourceLifecycleId,
              controllerId: effect.controllerId,
              effectText: effect.effectText,
              stepId: SELECT_HAND_DISCARD_STEP_ID,
              stepText:
                '请选择1张手牌放置入休息室。之后选择对方舞台上1名原本HEART小于等于1的成员变为待机状态。',
              awaitingPlayerId: player.id,
              selectableCardIds: handCardIds,
              selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
              selectionLabel: '选择要放置入休息室的手牌',
              confirmSelectionLabel: '放置入休息室',
              canSkipSelection: false,
              metadata: {
                ...effect.metadata,
                sourceSlot,
                waitedMemberCardId: effect.sourceCardId,
                memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
              },
            },
          },
          'PAY_COST',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            sourceSlot,
            waitedMemberCardId: effect.sourceCardId,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
            memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
          }
        );
      },
    }
  ).gameState;
}

function finishDiscardCost(
  game: GameState,
  selectedCardId: string | null,
  deps: WorkflowDeps,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.stepId !== SELECT_HAND_DISCARD_STEP_ID ||
    !isSupportedAbilityId(effect.abilityId) ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  if (!player.hand.cardIds.includes(selectedCardId)) {
    if (player.hand.cardIds.length > 0) {
      return { ...game, activeEffect: { ...effect, selectableCardIds: player.hand.cardIds } };
    }
    return finishWithoutTarget(
      game,
      effect,
      continuePendingCardEffects,
      'DISCARD_COST_BECAME_UNPAYABLE_AFTER_SOURCE_WAIT',
      effect.metadata?.orderedResolution === true,
      { staleDiscardCardId: selectedCardId, partialCostPaid: true }
    );
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    deps.enqueueTriggeredCardEffects
  );
  if (!discardResult) return game;

  let state = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot,
    waitedMemberCardId: effect.sourceCardId,
    discardedCardId: selectedCardId,
    discardedCardIds: discardResult.discardedCardIds,
    enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
  });
  if (
    effect.abilityId ===
    PL_PB2_006_ACTIVATED_WAIT_SELF_DISCARD_WAIT_LOW_ORIGINAL_HEART_OPPONENT_ABILITY_ID
  ) {
    state = recordAbilityUseForContext(state, player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    });
  }

  const opponent = getOpponent(state, player.id);
  const targetSelection = opponent
    ? createOpponentTargetSelection(state, effect, opponent.id)
    : null;
  if (!opponent || !targetSelection || targetSelection.activeEffect === null) {
    return finishWithoutTarget(
      state,
      effect,
      continuePendingCardEffects,
      'PAID_COST_NO_TARGET',
      effect.metadata?.orderedResolution === true,
      {
        discardedCardIds: discardResult.discardedCardIds,
        enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
      }
    );
  }

  return addAction(
    {
      ...state,
      activeEffect: {
        ...targetSelection.activeEffect,
        sourceLifecycleId: effect.sourceLifecycleId,
        metadata: {
          ...targetSelection.activeEffect.metadata,
          ...effect.metadata,
          targetPlayerId: opponent.id,
          discardedCardIds: discardResult.discardedCardIds,
          enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_SELECT_OPPONENT_LOW_ORIGINAL_HEART_MEMBER',
      targetPlayerId: opponent.id,
      selectableCardIds: targetSelection.selectableCardIds,
    }
  );
}

function finishOpponentTarget(
  game: GameState,
  selectedCardId: string | null,
  deps: WorkflowDeps,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.stepId !== SELECT_OPPONENT_MEMBER_STEP_ID ||
    !isSupportedAbilityId(effect.abilityId) ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const targetPlayerId =
    typeof effect.metadata?.targetPlayerId === 'string' ? effect.metadata.targetPlayerId : null;
  if (!targetPlayerId) return game;

  const currentSelection = createOpponentTargetSelection(game, effect, targetPlayerId);
  if (!currentSelection.selectableCardIds.includes(selectedCardId)) {
    if (currentSelection.activeEffect) {
      return {
        ...game,
        activeEffect: {
          ...effect,
          selectableCardIds: currentSelection.selectableCardIds,
        },
      };
    }
    return finishWithoutTarget(
      game,
      effect,
      continuePendingCardEffects,
      'STALE_TARGET_NO_TARGET',
      effect.metadata?.orderedResolution === true,
      { staleTargetCardId: selectedCardId }
    );
  }

  const orientationChange = resolveStageMemberOrientationTargetSelection(
    game,
    { ...effect, selectableCardIds: currentSelection.selectableCardIds },
    selectedCardId
  );
  if (!orientationChange?.changed) return game;

  const stateWithTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, memberStateChangedEvents) =>
        addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot,
          step: 'WAIT_OPPONENT_LOW_ORIGINAL_HEART_MEMBER',
          targetPlayerId,
          targetCardId: selectedCardId,
          targetOriginalHeartCount: getOriginalHeartCount(game, selectedCardId),
          discardedCardIds: effect.metadata?.discardedCardIds,
          enterWaitingRoomEventId: effect.metadata?.enterWaitingRoomEventId ?? null,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );
  return continuePendingCardEffects(
    stateWithTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function createOpponentTargetSelection(
  game: GameState,
  effect: ActiveEffectState,
  targetPlayerId: string
) {
  const ability: PendingAbilityState = {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceLifecycleId: effect.sourceLifecycleId,
    controllerId: effect.controllerId,
    mandatory: true,
    timingId:
      typeof effect.metadata?.timingId === 'string' ? effect.metadata.timingId : 'ACTIVATED',
    eventIds: getStringArray(effect.metadata?.eventIds),
  };
  return createStageMemberOrientationTargetSelection(game, {
    ability,
    effectText: effect.effectText,
    stepId: SELECT_OPPONENT_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名原本持有的HEART数量小于等于1且当前非待机的成员变为待机状态。',
    awaitingPlayerId: effect.controllerId,
    targetPlayerId,
    selector: lowOriginalHeartMemberSelector,
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择要变为待机状态的成员',
    confirmSelectionLabel: '变为待机状态',
    orderedResolution: effect.metadata?.orderedResolution === true,
  });
}

function finishWithoutTarget(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  orderedResolution: boolean,
  extraPayload: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step,
      ...extraPayload,
    }),
    orderedResolution
  );
}

function isMakiSource(game: GameState, playerId: string, sourceCardId: string): boolean {
  const card = getCardById(game, sourceCardId);
  return (
    card?.ownerId === playerId &&
    isMemberCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, BASE_CARD_CODE)
  );
}

function isSupportedAbilityId(abilityId: string): boolean {
  return (
    abilityId ===
      PL_PB2_006_ACTIVATED_WAIT_SELF_DISCARD_WAIT_LOW_ORIGINAL_HEART_OPPONENT_ABILITY_ID ||
    abilityId ===
      PL_PB2_006_LIVE_START_WAIT_SELF_DISCARD_WAIT_LOW_ORIGINAL_HEART_OPPONENT_ABILITY_ID
  );
}

function getOriginalHeartCount(game: GameState, cardId: string): number | null {
  const card = getCardById(game, cardId);
  return card && isMemberCardData(card.data) ? calculateTotalHearts(card.data) : null;
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((candidate) => typeof candidate === 'string')
    ? value
    : [];
}
