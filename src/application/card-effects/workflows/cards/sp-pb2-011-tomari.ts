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
import { OrientationState, SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { CardAbilityCategory, CardAbilitySourceZone } from '../../ability-definition-types.js';
import { SP_PB2_011_AUTO_CENTER_MEMBER_MOVED_CHOOSE_BLADE_WAIT_OR_DRAW_ABILITY_ID } from '../../ability-ids.js';
import { getCardAbilityDefinitionsForCardCode } from '../../definitions/lookup.js';
import { addBladeLiveModifierForSourceMember, drawCardsForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerMemberSlotMovedObserver } from '../../runtime/member-slot-moved-observers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const SELECT_OPTION_STEP_ID = 'SP_PB2_011_SELECT_CENTER_MOVE_OPTION';
const SELECT_OPPONENT_MEMBER_STEP_ID = 'SP_PB2_011_SELECT_OPPONENT_LOW_BLADE_MEMBER_TO_WAIT';

const GAIN_BLADE_OPTION_ID = 'gain-blade';
const WAIT_OPPONENT_OPTION_ID = 'wait-opponent';
const DRAW_OPTION_ID = 'draw';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerSpPb2011TomariWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerMemberSlotMovedObserver((game, context) =>
    enqueueSpPb2011CenterMemberMovedObserver(game, context.events)
  );
  registerPendingAbilityStarterHandler(
    SP_PB2_011_AUTO_CENTER_MEMBER_MOVED_CHOOSE_BLADE_WAIT_OR_DRAW_ABILITY_ID,
    (game, ability, options, context) =>
      startSpPb2011TomariAutoWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_011_AUTO_CENTER_MEMBER_MOVED_CHOOSE_BLADE_WAIT_OR_DRAW_ABILITY_ID,
    SELECT_OPTION_STEP_ID,
    (game, input, context) =>
      finishSpPb2011TomariOption(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_011_AUTO_CENTER_MEMBER_MOVED_CHOOSE_BLADE_WAIT_OR_DRAW_ABILITY_ID,
    SELECT_OPPONENT_MEMBER_STEP_ID,
    (game, input, context) =>
      finishSpPb2011TomariOpponentWait(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function enqueueSpPb2011CenterMemberMovedObserver(
  game: GameState,
  events: readonly MemberSlotMovedEvent[]
): GameState {
  let state = game;
  for (const event of events) {
    if (event.fromSlot !== SlotPosition.CENTER) {
      continue;
    }
    const player = getPlayerById(state, event.controllerId);
    if (!player) {
      continue;
    }

    for (const sourceSlot of [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const) {
      const sourceCardId = player.memberSlots.slots[sourceSlot];
      const sourceCard = sourceCardId ? getCardById(state, sourceCardId) : null;
      if (!sourceCardId || !sourceCard) {
        continue;
      }

      const abilityId = SP_PB2_011_AUTO_CENTER_MEMBER_MOVED_CHOOSE_BLADE_WAIT_OR_DRAW_ABILITY_ID;
      const hasTomariCenterMoveAbility = getCardAbilityDefinitionsForCardCode(
        sourceCard.data.cardCode
      ).some(
        (ability) =>
          ability.abilityId === abilityId &&
          ability.sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
          ability.category === CardAbilityCategory.AUTO &&
          ability.triggerCondition === TriggerCondition.ON_MEMBER_SLOT_MOVED
      );
      if (
        !hasTomariCenterMoveAbility ||
        hasUsedAbilityThisTurn(state, player.id, abilityId, sourceCardId)
      ) {
        continue;
      }

      const pendingAbilityId = `${abilityId}:${sourceCardId}:${event.eventId}`;
      if (hasAbilityInstance(state, pendingAbilityId)) {
        continue;
      }

      const pendingAbility: PendingAbilityState = {
        id: pendingAbilityId,
        abilityId,
        sourceCardId,
        controllerId: player.id,
        mandatory: true,
        timingId: TriggerCondition.ON_MEMBER_SLOT_MOVED,
        eventIds: [event.eventId],
        sourceSlot,
        metadata: {
          movedCardId: event.cardInstanceId,
          fromSlot: event.fromSlot,
          toSlot: event.toSlot,
          swappedCardInstanceId: event.swappedCardInstanceId ?? null,
        },
      };

      state = addAction(
        {
          ...state,
          pendingAbilities: [...state.pendingAbilities, pendingAbility],
        },
        'TRIGGER_ABILITY',
        player.id,
        {
          pendingAbilityId,
          abilityId,
          sourceCardId,
          timingId: pendingAbility.timingId,
          movedCardId: event.cardInstanceId,
          fromSlot: event.fromSlot,
          toSlot: event.toSlot,
          sourceSlot,
        }
      );
    }
  }

  return state;
}

function startSpPb2011TomariAutoWorkflow(
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
  const movedOwnCenterMember =
    moveEvent?.controllerId === player.id && moveEvent.fromSlot === SlotPosition.CENTER;
  if (!movedOwnCenterMember) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'CONDITION_NOT_MET',
        conditionMet: false,
        moveEventId: moveEvent?.eventId ?? null,
        movedCardId: moveEvent?.cardInstanceId ?? null,
        fromSlot: moveEvent?.fromSlot ?? null,
        toSlot: moveEvent?.toSlot ?? null,
      }),
      orderedResolution
    );
  }

  const opponentTargetIds = getOpponentLowPrintedBladeTargetIds(game, opponent.id);
  const selectableOptions = [
    { id: GAIN_BLADE_OPTION_ID, label: 'BLADE +2' },
    ...(opponentTargetIds.length > 0
      ? [{ id: WAIT_OPPONENT_OPTION_ID, label: '对方低 BLADE 成员待机' }]
      : []),
    { id: DRAW_OPTION_ID, label: '抽1张卡' },
  ];

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_OPTION_STEP_ID,
      stepText: '请选择此自动能力的1个效果。',
      awaitingPlayerId: player.id,
      selectableCardIds: [],
      selectableCardVisibility: 'PUBLIC',
      selectableOptions,
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        opponentPlayerId: opponent.id,
        opponentTargetIds,
        moveEventId: moveEvent?.eventId ?? null,
        movedCardId: moveEvent?.cardInstanceId ?? null,
        fromSlot: moveEvent?.fromSlot ?? null,
        toSlot: moveEvent?.toSlot ?? null,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_CENTER_MEMBER_MOVED_OPTION',
      moveEventId: moveEvent?.eventId ?? null,
      movedCardId: moveEvent?.cardInstanceId ?? null,
      fromSlot: moveEvent?.fromSlot ?? null,
      toSlot: moveEvent?.toSlot ?? null,
      selectableOptionIds: selectableOptions.map((option) => option.id),
      opponentTargetIds,
    },
  });
}

function finishSpPb2011TomariOption(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== SELECT_OPTION_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (
    !player ||
    !selectedOptionId ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }

  if (selectedOptionId === GAIN_BLADE_OPTION_ID) {
    const bladeResult = addBladeLiveModifierForSourceMember(game, {
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      amount: 2,
    });
    if (!bladeResult) {
      return game;
    }
    const state = recordAbilityUseForContext(
      { ...bladeResult.gameState, activeEffect: null },
      player.id,
      {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
      }
    );
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'GAIN_TWO_BLADE',
        bladeBonus: bladeResult.bladeBonus,
        selectedOptionId,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (selectedOptionId === DRAW_OPTION_ID) {
    const drawResult = drawCardsForPlayer(game, player.id, 1);
    if (!drawResult) {
      return game;
    }
    const state = recordAbilityUseForContext(
      { ...drawResult.gameState, activeEffect: null },
      player.id,
      {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
      }
    );
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DRAW_ONE',
        drawnCardIds: drawResult.drawnCardIds,
        selectedOptionId,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (selectedOptionId !== WAIT_OPPONENT_OPTION_ID) {
    return game;
  }

  const opponentPlayerId =
    typeof effect.metadata?.opponentPlayerId === 'string' ? effect.metadata.opponentPlayerId : null;
  const opponentTargetIds = opponentPlayerId
    ? getOpponentLowPrintedBladeTargetIds(game, opponentPlayerId)
    : [];
  if (!opponentPlayerId || opponentTargetIds.length === 0) {
    const state = recordAbilityUseForContext({ ...game, activeEffect: null }, player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    });
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_NO_OPPONENT_LOW_BLADE_TARGET_AFTER_OPTION',
        selectedOptionId,
        opponentPlayerId,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: SELECT_OPPONENT_MEMBER_STEP_ID,
      stepText: '请选择对方舞台上1名原本 BLADE 数小于等于2的成员变为待机状态。',
      selectableCardIds: opponentTargetIds,
      selectableOptions: undefined,
      selectionLabel: '选择对方原本 BLADE 小于等于2的成员',
      metadata: {
        ...effect.metadata,
        stageMemberOrientationTarget: true,
        targetPlayerId: opponentPlayerId,
        targetOrientation: OrientationState.WAITING,
        selectedOptionId,
      },
    },
  };
}

function finishSpPb2011TomariOpponentWait(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== SELECT_OPPONENT_MEMBER_STEP_ID) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !selectedCardId || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const orientationChange = resolveStageMemberOrientationTargetSelection(game, effect, selectedCardId);
  if (!orientationChange) {
    const state = recordAbilityUseForContext({ ...game, activeEffect: null }, player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    });
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_OPPONENT_LOW_BLADE_TARGET_UNAVAILABLE',
        targetCardId: selectedCardId,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) => {
        const stateWithUseRecord = recordAbilityUseForContext(
          {
            ...state,
            activeEffect: null,
          },
          player.id,
          {
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
          }
        );
        return addAction(stateWithUseRecord, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'WAIT_OPPONENT_LOW_BLADE_MEMBER',
          selectedOptionId: effect.metadata?.selectedOptionId ?? WAIT_OPPONENT_OPTION_ID,
          targetPlayerId: effect.metadata?.targetPlayerId ?? null,
          targetCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
        });
      },
    }
  );

  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
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

function hasAbilityInstance(game: GameState, pendingAbilityId: string): boolean {
  const alreadyPending = game.pendingAbilities.some((ability) => ability.id === pendingAbilityId);
  const alreadyActive = game.activeEffect?.id === pendingAbilityId;
  const alreadyResolved = game.actionHistory.some(
    (historyAction) =>
      historyAction.type === 'RESOLVE_ABILITY' &&
      historyAction.payload.pendingAbilityId === pendingAbilityId
  );
  return alreadyPending || alreadyActive || alreadyResolved;
}

function hasUsedAbilityThisTurn(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): boolean {
  return game.actionHistory.some(
    (historyAction) =>
      historyAction.type === 'RESOLVE_ABILITY' &&
      historyAction.playerId === playerId &&
      historyAction.payload.step === 'ABILITY_USE' &&
      historyAction.payload.turnCount === game.turnCount &&
      historyAction.payload.abilityId === abilityId &&
      historyAction.payload.sourceCardId === sourceCardId
  );
}
