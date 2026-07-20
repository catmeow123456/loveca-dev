import {
  addAction,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  CardType,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../../../shared/types/enums.js';
import { and, costLte, typeIs } from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_CL1_004_ON_ENTER_MILL_THREE_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_OPTION_STEP_ID = 'HS_CL1_004_SELECT_ON_ENTER_OPTION';
const SELECT_OPPONENT_MEMBER_STEP_ID = 'HS_CL1_004_SELECT_OPPONENT_LOW_COST_MEMBER_TO_WAIT';
const MILL_OPTION_ID = 'mill-top-three';
const WAIT_OPPONENT_OPTION_ID = 'wait-opponent-low-cost-member';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerHsCl1004GinkoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    HS_CL1_004_ON_ENTER_MILL_THREE_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
    (game, ability, options, context) =>
      startHsCl1004Ginko(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_CL1_004_ON_ENTER_MILL_THREE_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
    SELECT_OPTION_STEP_ID,
    (game, input, context) =>
      finishHsCl1004OptionSelection(
        game,
        input.selectedOptionId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_CL1_004_ON_ENTER_MILL_THREE_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
    SELECT_OPPONENT_MEMBER_STEP_ID,
    (game, input, context) =>
      finishHsCl1004WaitOpponentSelection(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startHsCl1004Ginko(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return finishPendingNoOp(game, ability, null, orderedResolution, continuePendingCardEffects, {
      step: 'NO_OP_CONTROLLER_OR_OPPONENT_NOT_FOUND',
    });
  }

  const canMill = player.mainDeck.cardIds.length > 0 || player.waitingRoom.cardIds.length > 0;
  const opponentTargetIds = getOpponentLowCostWaitTargetIds(game, player.id);
  const selectableOptions = [
    ...(canMill ? [{ id: MILL_OPTION_ID, label: '将卡组顶3张放置入休息室' }] : []),
    ...(opponentTargetIds.length > 0
      ? [{ id: WAIT_OPPONENT_OPTION_ID, label: '将对方费用2以下成员变为待机' }]
      : []),
  ];

  if (selectableOptions.length === 0) {
    return finishPendingNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'SKIP_NO_AVAILABLE_OPTION',
      canMill,
      opponentTargetCount: opponentTargetIds.length,
    });
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
      stepId: SELECT_OPTION_STEP_ID,
      stepText: '请选择要执行的效果。',
      awaitingPlayerId: player.id,
      selectableOptions,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          {
            id: MILL_OPTION_ID,
            text: '从自己的卡组顶将3张卡放置入休息室。',
            selectable: canMill,
          },
          {
            id: WAIT_OPPONENT_OPTION_ID,
            text: '将对方舞台上1名费用小于等于2的成员变为待机状态。',
            selectable: opponentTargetIds.length > 0,
          },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
        eventIds: ability.eventIds,
        opponentPlayerId: opponent.id,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_SELECT_ON_ENTER_OPTION',
      selectableOptionIds: selectableOptions.map((option) => option.id),
      opponentTargetIds,
    },
  });
}

function finishHsCl1004OptionSelection(
  game: GameState,
  selectedOptionId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_CL1_004_ON_ENTER_MILL_THREE_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID ||
    effect.stepId !== SELECT_OPTION_STEP_ID ||
    !selectedOptionId ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }

  if (selectedOptionId === MILL_OPTION_ID) {
    return finishHsCl1004MillTopThree(
      game,
      effect,
      enqueueTriggeredCardEffects,
      continuePendingCardEffects
    );
  }
  if (selectedOptionId === WAIT_OPPONENT_OPTION_ID) {
    return startHsCl1004WaitOpponentSelection(game, effect, continuePendingCardEffects);
  }

  return game;
}

function finishHsCl1004MillTopThree(
  game: GameState,
  effect: ActiveEffectState,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const canMill = player.mainDeck.cardIds.length > 0 || player.waitingRoom.cardIds.length > 0;
  if (!canMill) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'NO_OP_NO_MILL_TARGET_AFTER_SELECTION',
        movedCardIds: [],
        refreshCount: 0,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const millResult = moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    game,
    player.id,
    3,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (gameState, movedCardIds, refreshCount) =>
        addAction({ ...gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot,
          step: 'MILL_TOP_THREE_TO_WAITING_ROOM',
          movedCardIds,
          movedCount: movedCardIds.length,
          refreshCount,
        }),
    }
  );
  if (!millResult) {
    return game;
  }

  const state = millResult.gameState;

  return continuePendingCardEffects(state, effect.metadata?.orderedResolution === true);
}

function startHsCl1004WaitOpponentSelection(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const targetSelection = createStageMemberOrientationTargetSelection(game, {
    ability: {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: getStringArray(effect.metadata?.eventIds),
      sourceSlot: getSlotPosition(effect.metadata?.sourceSlot) ?? undefined,
    },
    effectText: effect.effectText,
    stepId: SELECT_OPPONENT_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于2的成员变为待机状态。',
    awaitingPlayerId: player.id,
    targetPlayerId: opponent.id,
    selector: and(typeIs(CardType.MEMBER), costLte(2)),
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择对方舞台上费用小于等于2的成员',
    orderedResolution: effect.metadata?.orderedResolution === true,
    metadata: {
      sourceSlot: effect.metadata?.sourceSlot,
      selectedOptionId: WAIT_OPPONENT_OPTION_ID,
    },
  });

  if (targetSelection.activeEffect === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'NO_OP_NO_WAIT_TARGET_AFTER_OPTION',
        targetPlayerId: opponent.id,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: targetSelection.activeEffect,
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'START_SELECT_OPPONENT_COST_TWO_MEMBER',
      selectedOptionId: WAIT_OPPONENT_OPTION_ID,
      targetPlayerId: opponent.id,
      selectableCardIds: targetSelection.selectableCardIds,
    }
  );
}

function finishHsCl1004WaitOpponentSelection(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_CL1_004_ON_ENTER_MILL_THREE_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID ||
    effect.stepId !== SELECT_OPPONENT_MEMBER_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const targetMetadata = getStageMemberOrientationTargetMetadata(effect);
  if (!player || !targetMetadata) {
    return game;
  }

  const targetStillLegal = getOpponentLowCostWaitTargetIds(game, player.id).includes(
    selectedCardId
  );
  const orientationChange = targetStillLegal
    ? resolveStageMemberOrientationTargetSelection(game, effect, selectedCardId)
    : null;
  if (!orientationChange) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'NO_OP_WAIT_TARGET_NOT_FOUND',
        targetPlayerId: targetMetadata.targetPlayerId,
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
      prepareGameStateBeforeEnqueue: (state, result, memberStateChangedEvents) =>
        addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot,
          step: 'WAIT_OPPONENT_COST_TWO_MEMBER',
          targetPlayerId: targetMetadata.targetPlayerId,
          targetCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string | null,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
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
        sourceSlot: ability.sourceSlot,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getOpponentLowCostWaitTargetIds(game: GameState, playerId: string): readonly string[] {
  const opponent = getOpponent(game, playerId);
  if (!opponent) {
    return [];
  }
  return getStageMemberCardIdsMatching(
    game,
    opponent.id,
    and(typeIs(CardType.MEMBER), costLte(2))
  ).filter(
    (cardId) =>
      opponent.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function getSlotPosition(value: unknown): SlotPosition | null {
  return Object.values(SlotPosition).includes(value as SlotPosition) ? (value as SlotPosition) : null;
}
