import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import { and, memberPrintedBladeLte, typeIs } from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_PR_035_ON_ENTER_BOTTOM_THREE_OPPONENT_WAITING_MEMBERS_WAIT_LOW_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { moveWaitingRoomCardsToDeckBottomForPlayer } from '../../runtime/actions.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_WAITING_MEMBERS_STEP_ID = 'HS_PR_035_SELECT_OPPONENT_WAITING_MEMBERS';
const SELECT_LOW_BLADE_MEMBER_STEP_ID = 'HS_PR_035_SELECT_OPPONENT_LOW_BLADE_MEMBER';
const REQUIRED_WAITING_MEMBER_COUNT = 3;
const lowPrintedBladeMemberSelector = and(typeIs(CardType.MEMBER), memberPrintedBladeLte(3));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsPr035GinkoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(
    HS_PR_035_ON_ENTER_BOTTOM_THREE_OPPONENT_WAITING_MEMBERS_WAIT_LOW_BLADE_ABILITY_ID,
    (game, ability, options) =>
      startSelectOpponentWaitingMembers(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    HS_PR_035_ON_ENTER_BOTTOM_THREE_OPPONENT_WAITING_MEMBERS_WAIT_LOW_BLADE_ABILITY_ID,
    SELECT_WAITING_MEMBERS_STEP_ID,
    (game, input, context) =>
      finishSelectOpponentWaitingMembers(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PR_035_ON_ENTER_BOTTOM_THREE_OPPONENT_WAITING_MEMBERS_WAIT_LOW_BLADE_ABILITY_ID,
    SELECT_LOW_BLADE_MEMBER_STEP_ID,
    (game, input, context) =>
      finishSelectLowBladeMember(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startSelectOpponentWaitingMembers(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) return game;

  const candidateCardIds = opponent.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isMemberCardData(card.data);
  });

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_WAITING_MEMBERS_STEP_ID,
      stepText: '可以选择对方休息室中的3张成员卡。选择顺序会成为放置到对方卡组底的顺序。',
      awaitingPlayerId: player.id,
      selectableCardIds: candidateCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      selectionLabel: '选择对方休息室中的3张成员卡',
      confirmSelectionLabel: '按此顺序放置到卡组底',
      minSelectableCards: REQUIRED_WAITING_MEMBER_COUNT,
      maxSelectableCards: REQUIRED_WAITING_MEMBER_COUNT,
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        publicCardSelectionConfirmation: {
          destination: 'MAIN_DECK_BOTTOM',
          ordered: true,
          sourcePlayerId: opponent.id,
        },
        orderedResolution,
        sourceSlot: ability.sourceSlot,
        eventIds: ability.eventIds,
        opponentPlayerId: opponent.id,
        waitingMemberCandidateIds: candidateCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_SELECT_OPPONENT_WAITING_MEMBERS',
      targetPlayerId: opponent.id,
      selectableCardIds: candidateCardIds,
      minSelectableCards: REQUIRED_WAITING_MEMBER_COUNT,
      maxSelectableCards: REQUIRED_WAITING_MEMBER_COUNT,
    },
  });
}

function finishSelectOpponentWaitingMembers(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!isExpectedStep(effect, SELECT_WAITING_MEMBERS_STEP_ID)) return game;
  const player = getPlayerById(game, effect.controllerId);
  const opponentPlayerId = getString(effect.metadata?.opponentPlayerId);
  const candidateCardIds = getStringArray(effect.metadata?.waitingMemberCandidateIds);
  if (!player || !opponentPlayerId) return game;

  if (selectedCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'DECLINE_BOTTOM_OPPONENT_WAITING_MEMBERS',
        targetPlayerId: opponentPlayerId,
        selectedCardIds: [],
        movedCardIds: [],
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const moveResult = moveWaitingRoomCardsToDeckBottomForPlayer(
    game,
    opponentPlayerId,
    selectedCardIds,
    {
      candidateCardIds,
      minCount: REQUIRED_WAITING_MEMBER_COUNT,
      maxCount: REQUIRED_WAITING_MEMBER_COUNT,
    }
  );
  if (!moveResult) return game;

  const stateAfterMove = addAction(moveResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot,
    step: 'BOTTOM_OPPONENT_WAITING_MEMBERS',
    targetPlayerId: opponentPlayerId,
    selectedCardIds: moveResult.selectedCardIds,
    movedCardIds: moveResult.movedCardIds,
    remainingCandidateIds: moveResult.remainingCandidateIds,
  });

  return startSelectLowBladeMember(
    stateAfterMove,
    effect,
    opponentPlayerId,
    moveResult.movedCardIds,
    continuePendingCardEffects
  );
}

function startSelectLowBladeMember(
  game: GameState,
  effect: ActiveEffectState,
  opponentPlayerId: string,
  movedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const selection = createStageMemberOrientationTargetSelection(game, {
    ability: {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: getStringArray(effect.metadata?.eventIds),
    },
    effectText: effect.effectText,
    stepId: SELECT_LOW_BLADE_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名原本持有的[BLADE]数量小于等于3的成员变为待机状态。',
    awaitingPlayerId: player.id,
    targetPlayerId: opponentPlayerId,
    selector: lowPrintedBladeMemberSelector,
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择对方舞台上的低原本[BLADE]成员',
    orderedResolution: effect.metadata?.orderedResolution === true,
    metadata: {
      sourceSlot: effect.metadata?.sourceSlot,
      movedCardIds,
    },
  });
  if (!selection.activeEffect) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'NO_OP_NO_LOW_BLADE_TARGET',
        targetPlayerId: opponentPlayerId,
        movedCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  return {
    ...game,
    activeEffect: selection.activeEffect,
  };
}

function finishSelectLowBladeMember(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!isExpectedStep(effect, SELECT_LOW_BLADE_MEMBER_STEP_ID) || !selectedCardId) return game;
  const player = getPlayerById(game, effect.controllerId);
  const targetMetadata = getStageMemberOrientationTargetMetadata(effect);
  if (!player || !targetMetadata) return game;
  const targetStillLegal = getStageMemberCardIdsMatching(
    game,
    targetMetadata.targetPlayerId,
    lowPrintedBladeMemberSelector
  ).includes(selectedCardId);
  const orientationChange = targetStillLegal
    ? resolveStageMemberOrientationTargetSelection(game, effect, selectedCardId)
    : null;
  if (!orientationChange) return game;

  const result = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, orientationResult, events) =>
        addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot,
          step: 'WAIT_OPPONENT_LOW_BLADE_MEMBER',
          targetPlayerId: targetMetadata.targetPlayerId,
          targetCardId: selectedCardId,
          movedCardIds: getStringArray(effect.metadata?.movedCardIds),
          previousOrientation: orientationResult.previousOrientation,
          nextOrientation: orientationResult.nextOrientation,
          memberStateChangedEventIds: events.map((event) => event.eventId),
        }),
    }
  );
  return continuePendingCardEffects(
    result.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function isExpectedStep(
  effect: ActiveEffectState | null,
  stepId: string
): effect is ActiveEffectState {
  return (
    effect?.abilityId ===
      HS_PR_035_ON_ENTER_BOTTOM_THREE_OPPONENT_WAITING_MEMBERS_WAIT_LOW_BLADE_ABILITY_ID &&
    effect.stepId === stepId
  );
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}
