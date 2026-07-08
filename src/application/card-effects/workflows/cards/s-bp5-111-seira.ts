import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { MemberSlotMovedEvent } from '../../../../domain/events/game-events.js';
import { OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { resolveStageMemberOrientationTargetSelection } from '../../../effects/stage-member-target-selection.js';
import {
  S_BP5_111_ACTIVATED_PAY_ENERGY_POSITION_CHANGE_TO_AQOURS_OR_SAINTSNOW_MEMBER_ABILITY_ID,
  S_BP5_111_AUTO_ON_THIS_MEMBER_MOVED_WAIT_OPPONENT_LOW_PRINTED_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForMemberSlotMoved } from '../../runtime/member-slot-moved-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { registerPayEnergyPositionChangeToGroupMemberAreaWorkflowHandlers } from '../shared/pay-energy-position-change-to-group-member-area.js';

const POSITION_CHANGE_STEP_ID = 'S_BP5_111_SELECT_AQOURS_OR_SAINTSNOW_MEMBER_SLOT';
const SELECT_OPPONENT_MEMBER_STEP_ID = 'S_BP5_111_SELECT_OPPONENT_LOW_BLADE_MEMBER_TO_WAIT';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp5111SeiraWorkflowHandlers(deps: {
  readonly enqueueMemberSlotMovedCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
  readonly enqueueMemberStateChangedCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPayEnergyPositionChangeToGroupMemberAreaWorkflowHandlers(
    {
      abilityId:
        S_BP5_111_ACTIVATED_PAY_ENERGY_POSITION_CHANGE_TO_AQOURS_OR_SAINTSNOW_MEMBER_ABILITY_ID,
      baseCardCode: 'PL!S-bp5-111',
      stepId: POSITION_CHANGE_STEP_ID,
      targetGroupAliases: ['Aqours', 'SaintSnow'],
      stepText: '请选择有『Aqours』或『SaintSnow』成员的其他区域进行站位变换。',
      selectionLabel: '选择移动区域',
      confirmSelectionLabel: '站位变换',
    },
    { enqueueMemberSlotMovedCardEffects: deps.enqueueMemberSlotMovedCardEffects }
  );

  registerPendingAbilityStarterHandler(
    S_BP5_111_AUTO_ON_THIS_MEMBER_MOVED_WAIT_OPPONENT_LOW_PRINTED_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startSeiraMovedAuto(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP5_111_AUTO_ON_THIS_MEMBER_MOVED_WAIT_OPPONENT_LOW_PRINTED_BLADE_ABILITY_ID,
    SELECT_OPPONENT_MEMBER_STEP_ID,
    (game, input, context) =>
      finishSeiraOpponentWait(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueMemberStateChangedCardEffects
      )
  );
}

function startSeiraMovedAuto(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const moveEvent = getPendingMoveEvent(game, ability);
  const movedThisMember =
    moveEvent?.controllerId === player.id && moveEvent.cardInstanceId === ability.sourceCardId;
  if (!movedThisMember) {
    return finishPendingAbility(
      game,
      player.id,
      ability,
      orderedResolution,
      {
        step: 'CONDITION_NOT_MET',
        conditionMet: false,
        moveEventId: moveEvent?.eventId ?? null,
        movedCardId: moveEvent?.cardInstanceId ?? null,
        fromSlot: moveEvent?.fromSlot ?? null,
        toSlot: moveEvent?.toSlot ?? null,
      },
      continuePendingCardEffects
    );
  }

  const opponentTargetIds = getOpponentLowPrintedBladeTargetIds(game, opponent.id);
  if (opponentTargetIds.length === 0) {
    return finishPendingAbility(
      game,
      player.id,
      ability,
      orderedResolution,
      {
        step: 'NO_OPPONENT_LOW_PRINTED_BLADE_TARGET',
        conditionMet: true,
        moveEventId: moveEvent.eventId,
        movedCardId: moveEvent.cardInstanceId,
        fromSlot: moveEvent.fromSlot,
        toSlot: moveEvent.toSlot,
        opponentTargetIds: [],
      },
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_OPPONENT_MEMBER_STEP_ID,
      stepText: '请选择对方舞台上1名原本 BLADE 数小于等于2的成员变为待机状态。',
      awaitingPlayerId: player.id,
      selectableCardIds: opponentTargetIds,
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '选择对方原本 BLADE 小于等于2的成员',
      confirmSelectionLabel: '变为待机状态',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        stageMemberOrientationTarget: true,
        targetPlayerId: opponent.id,
        targetOrientation: OrientationState.WAITING,
        moveEventId: moveEvent.eventId,
        movedCardId: moveEvent.cardInstanceId,
        fromSlot: moveEvent.fromSlot,
        toSlot: moveEvent.toSlot,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_OPPONENT_LOW_PRINTED_BLADE_MEMBER',
      moveEventId: moveEvent.eventId,
      movedCardId: moveEvent.cardInstanceId,
      fromSlot: moveEvent.fromSlot,
      toSlot: moveEvent.toSlot,
      opponentTargetIds,
    },
  });
}

function finishSeiraOpponentWait(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueMemberStateChangedCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP5_111_AUTO_ON_THIS_MEMBER_MOVED_WAIT_OPPONENT_LOW_PRINTED_BLADE_ABILITY_ID ||
    effect.stepId !== SELECT_OPPONENT_MEMBER_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !selectedCardId || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const targetPlayerId =
    typeof effect.metadata?.targetPlayerId === 'string' ? effect.metadata.targetPlayerId : null;
  if (!targetPlayerId || !getOpponentLowPrintedBladeTargetIds(game, targetPlayerId).includes(selectedCardId)) {
    return finishActiveEffect(
      game,
      player.id,
      effect,
      {
        step: 'SKIP_OPPONENT_TARGET_UNAVAILABLE',
        targetCardId: selectedCardId,
      },
      continuePendingCardEffects
    );
  }

  const orientationChange = resolveStageMemberOrientationTargetSelection(game, effect, selectedCardId);
  if (!orientationChange) {
    return finishActiveEffect(
      game,
      player.id,
      effect,
      {
        step: 'SKIP_OPPONENT_TARGET_UNAVAILABLE',
        targetCardId: selectedCardId,
      },
      continuePendingCardEffects
    );
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueMemberStateChangedCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) =>
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
            step: 'WAIT_OPPONENT_LOW_PRINTED_BLADE_MEMBER',
            targetPlayerId,
            targetCardId: selectedCardId,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
          }
        ),
    }
  );

  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingAbility(
  game: GameState,
  playerId: string,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  payload: Record<string, unknown>,
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
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function finishActiveEffect(
  game: GameState,
  playerId: string,
  effect: NonNullable<GameState['activeEffect']>,
  payload: Record<string, unknown>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== effect.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        ...payload,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function getPendingMoveEvent(
  game: GameState,
  ability: PendingAbilityState
): MemberSlotMovedEvent | null {
  const eventIds = new Set(ability.eventIds);
  for (const entry of game.eventLog) {
    const event = entry.event;
    if (
      event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
      'fromSlot' in event &&
      'toSlot' in event &&
      'cardInstanceId' in event &&
      eventIds.has(event.eventId)
    ) {
      return event as MemberSlotMovedEvent;
    }
  }
  return null;
}

function getOpponentLowPrintedBladeTargetIds(
  game: GameState,
  opponentPlayerId: string
): readonly string[] {
  const opponent = getPlayerById(game, opponentPlayerId);
  if (!opponent) {
    return [];
  }
  return getStageMemberCardIdsMatching(game, opponentPlayerId, (card) => {
    const orientation = opponent.memberSlots.cardStates.get(card.instanceId)?.orientation;
    return (
      orientation !== OrientationState.WAITING &&
      isMemberCardData(card.data) &&
      card.data.blade <= 2
    );
  });
}
