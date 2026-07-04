import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import type {
  EnterStageEvent,
  EnterWaitingRoomEvent,
  LeaveStageEvent,
  MemberStateChangedEvent,
} from '../../../../domain/events/game-events.js';
import { GamePhase, OrientationState, SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { S_BP3_006_ACTIVATED_WAIT_SELF_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID } from '../../ability-ids.js';
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
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import {
  getOwnStageGroupMemberUpgradeTargets,
  registerStageMemberUpgradeReplacementStepHandlers,
  startStageMemberUpgradeTargetSelection,
  type StageMemberUpgradeReplacementWorkflowConfig,
} from '../shared/stage-member-upgrade-replacement.js';

const AQOURS = 'Aqours';
const COST_DELTA = 2;
const SELECT_DISCARD_STEP_ID = 'S_BP3_006_SELECT_DISCARD_HAND_COST';
const SELECT_UPGRADE_TARGET_STEP_ID = 'S_BP3_006_SELECT_AQOURS_STAGE_UPGRADE_TARGET';
const SELECT_REPLACEMENT_STEP_ID = 'S_BP3_006_SELECT_AQOURS_REPLACEMENT_MEMBER';

type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged &
  ((
    game: GameState,
    triggerConditions: readonly TriggerCondition[],
    options?: {
      readonly enterStageEvents?: readonly EnterStageEvent[];
      readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
      readonly leaveStageEvents?: readonly LeaveStageEvent[];
      readonly memberStateChangedEvents?: readonly MemberStateChangedEvent[];
    }
  ) => GameState);

const STAGE_MEMBER_UPGRADE_CONFIG: StageMemberUpgradeReplacementWorkflowConfig = {
  abilityId: S_BP3_006_ACTIVATED_WAIT_SELF_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID,
  groupAlias: AQOURS,
  groupLabel: AQOURS,
  costDelta: COST_DELTA,
  selectTargetStepId: SELECT_UPGRADE_TARGET_STEP_ID,
  selectReplacementStepId: SELECT_REPLACEMENT_STEP_ID,
  selectTargetStepText: '请选择此成员以外的自己舞台上1名『Aqours』成员放置入休息室。',
  targetSelectionLabel: '选择要放置入休息室的 Aqours 成员',
  targetConfirmLabel: '放置入休息室',
  replacementSelectionLabel: '选择要登场的 Aqours 成员',
  replacementConfirmLabel: '登场',
};

export function registerSBp3006YoshikoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    S_BP3_006_ACTIVATED_WAIT_SELF_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID,
    (game, playerId, cardId) => startYoshikoActivatedWorkflow(game, playerId, cardId, deps)
  );
  registerActiveEffectStepHandler(
    S_BP3_006_ACTIVATED_WAIT_SELF_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input) =>
      finishDiscardCost(game, input.selectedCardId ?? null, deps.enqueueTriggeredCardEffects)
  );
  registerStageMemberUpgradeReplacementStepHandlers(STAGE_MEMBER_UPGRADE_CONFIG, deps);
}

function startYoshikoActivatedWorkflow(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceState = player?.memberSlots.cardStates.get(cardId) ?? null;
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!S-bp3-006') ||
    sourceSlot !== SlotPosition.CENTER ||
    sourceState?.orientation !== OrientationState.ACTIVE ||
    player.hand.cardIds.length === 0 ||
    getOwnStageGroupMemberUpgradeTargets(game, player.id, {
      groupAlias: AQOURS,
      excludeCardId: cardId,
    }).length === 0
  ) {
    return game;
  }

  const waitResult = setMemberOrientation(game, player.id, cardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId: player.id,
    sourceCardId: cardId,
    abilityId: S_BP3_006_ACTIVATED_WAIT_SELF_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID,
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
        recordPayCostAction(stateAfterWait, player.id, {
          abilityId: S_BP3_006_ACTIVATED_WAIT_SELF_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID,
          sourceCardId: cardId,
          sourceSlot,
          waitedMemberCardId: cardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  return addAction(
    {
      ...stateWithMemberStateTriggers.gameState,
      activeEffect: {
        id: `${S_BP3_006_ACTIVATED_WAIT_SELF_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID}:${cardId}:turn-${stateWithMemberStateTriggers.gameState.turnCount}:action-${stateWithMemberStateTriggers.gameState.actionHistory.length}`,
        abilityId: S_BP3_006_ACTIVATED_WAIT_SELF_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          S_BP3_006_ACTIVATED_WAIT_SELF_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID
        ),
        stepId: SELECT_DISCARD_STEP_ID,
        stepText: '请选择1张要作为费用放置入休息室的手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
        metadata: {
          sourceSlot,
          waitedMemberCardId: cardId,
          memberStateChangedEventIds: stateWithMemberStateTriggers.memberStateChangedEvents.map(
            (event) => event.eventId
          ),
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: S_BP3_006_ACTIVATED_WAIT_SELF_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot,
      step: 'WAIT_SELF_START_SELECT_DISCARD_HAND',
      waitedMemberCardId: cardId,
      memberStateChangedEventIds: stateWithMemberStateTriggers.memberStateChangedEvents.map(
        (event) => event.eventId
      ),
    }
  );
}

function finishDiscardCost(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== S_BP3_006_ACTIVATED_WAIT_SELF_UPGRADE_OTHER_AQOURS_MEMBER_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const stateAfterDiscardCost = recordPayCostAction(discardResult.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot,
    discardedCardIds: discardResult.discardedCardIds,
    enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId,
  });
  const stateAfterUse = recordAbilityUseForContext(stateAfterDiscardCost, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });

  return startStageMemberUpgradeTargetSelection(
    stateAfterUse,
    STAGE_MEMBER_UPGRADE_CONFIG,
    {
      effect,
      playerId: player.id,
      extraActionPayload: {
        discardedCardIds: discardResult.discardedCardIds,
        enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId,
      },
    }
  );
}
