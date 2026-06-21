import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  emitGameEvent,
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
} from '../../../../domain/entities/game.js';
import type {
  EnterStageEvent,
  EnterWaitingRoomEvent,
  LeaveStageEvent,
} from '../../../../domain/events/game-events.js';
import {
  createEnterStageEvent,
  createEnterWaitingRoomEvent,
  createLeaveStageEvent,
} from '../../../../domain/events/game-events.js';
import {
  addCardsToZone,
  addCardToZone,
  placeCardInSlot,
  popMemberBelowMember,
  removeCardFromSlot,
  removeCardFromZone,
} from '../../../../domain/entities/zone.js';
import {
  GamePhase,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { PL_N_BP1_002_ACTIVATED_FROM_WAITING_ROOM_PAY_TWO_DISCARD_ONE_PLAY_SELF_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const N_BP1_002_SELECT_DISCARD_STEP_ID = 'N_BP1_002_SELECT_DISCARD';
export const N_BP1_002_SELECT_STAGE_SLOT_STEP_ID = 'N_BP1_002_SELECT_STAGE_SLOT';

type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
    readonly leaveStageEvents?: readonly LeaveStageEvent[];
  }
) => GameState;

const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

export function registerNBp1002KasumiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    PL_N_BP1_002_ACTIVATED_FROM_WAITING_ROOM_PAY_TWO_DISCARD_ONE_PLAY_SELF_ABILITY_ID,
    (game, playerId, cardId) => startKasumiFromWaitingRoomActivated(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(
    PL_N_BP1_002_ACTIVATED_FROM_WAITING_ROOM_PAY_TWO_DISCARD_ONE_PLAY_SELF_ABILITY_ID,
    N_BP1_002_SELECT_DISCARD_STEP_ID,
    (game, input) =>
      finishKasumiDiscardCost(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP1_002_ACTIVATED_FROM_WAITING_ROOM_PAY_TWO_DISCARD_ONE_PLAY_SELF_ABILITY_ID,
    N_BP1_002_SELECT_STAGE_SLOT_STEP_ID,
    (game, input, context) =>
      finishKasumiPlaySelfFromWaitingRoom(
        game,
        input.selectedSlot ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startKasumiFromWaitingRoomActivated(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!N-bp1-002') ||
    !player.waitingRoom.cardIds.includes(cardId) ||
    player.hand.cardIds.length === 0 ||
    getActiveEnergyCardIds(game, player.id).length < 2
  ) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${PL_N_BP1_002_ACTIVATED_FROM_WAITING_ROOM_PAY_TWO_DISCARD_ONE_PLAY_SELF_ABILITY_ID}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId:
          PL_N_BP1_002_ACTIVATED_FROM_WAITING_ROOM_PAY_TWO_DISCARD_ONE_PLAY_SELF_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          PL_N_BP1_002_ACTIVATED_FROM_WAITING_ROOM_PAY_TWO_DISCARD_ONE_PLAY_SELF_ABILITY_ID
        ),
        stepId: N_BP1_002_SELECT_DISCARD_STEP_ID,
        stepText: '请选择1张手牌放置入休息室，并支付2张活跃能量。',
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '支付费用',
        canSkipSelection: false,
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: PL_N_BP1_002_ACTIVATED_FROM_WAITING_ROOM_PAY_TWO_DISCARD_ONE_PLAY_SELF_ABILITY_ID,
      sourceCardId: cardId,
      step: 'START_SELECT_DISCARD_COST',
      selectableCardIds: player.hand.cardIds,
      activeEnergyCardIds: getActiveEnergyCardIds(game, player.id),
    }
  );
}

function finishKasumiDiscardCost(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP1_002_ACTIVATED_FROM_WAITING_ROOM_PAY_TWO_DISCARD_ONE_PLAY_SELF_ABILITY_ID ||
    effect.stepId !== N_BP1_002_SELECT_DISCARD_STEP_ID ||
    !player ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId) ||
    !player.waitingRoom.cardIds.includes(effect.sourceCardId)
  ) {
    return game;
  }

  const energyPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!energyPayment) {
    return game;
  }

  const stateWithPayCost = addAction(energyPayment.gameState, 'PAY_COST', player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: energyPayment.paidEnergyCardIds,
    amount: energyPayment.paidEnergyCardIds.length,
    discardCardId: selectedCardId,
  });
  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    stateWithPayCost,
    player.id,
    selectedCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  return addAction(
    {
      ...discardResult.gameState,
      activeEffect: {
        ...effect,
        stepId: N_BP1_002_SELECT_STAGE_SLOT_STEP_ID,
        stepText: '请选择此卡要登场的成员区。',
        selectableCardIds: undefined,
        selectableCardVisibility: 'PUBLIC',
        selectableSlots: MEMBER_SLOT_ORDER,
        selectionLabel: '选择登场成员区',
        confirmSelectionLabel: '登场',
        metadata: {
          paidEnergyCardIds: energyPayment.paidEnergyCardIds,
          discardedCardIds: discardResult.discardedCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_COST_SELECT_STAGE_SLOT',
      paidEnergyCardIds: energyPayment.paidEnergyCardIds,
      discardedCardIds: discardResult.discardedCardIds,
      selectableSlots: MEMBER_SLOT_ORDER,
    }
  );
}

function finishKasumiPlaySelfFromWaitingRoom(
  game: GameState,
  selectedSlot: SlotPosition | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: (game: GameState, orderedResolution: boolean) => GameState
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP1_002_ACTIVATED_FROM_WAITING_ROOM_PAY_TWO_DISCARD_ONE_PLAY_SELF_ABILITY_ID ||
    effect.stepId !== N_BP1_002_SELECT_STAGE_SLOT_STEP_ID ||
    !player ||
    selectedSlot === null ||
    effect.selectableSlots?.includes(selectedSlot) !== true ||
    !player.waitingRoom.cardIds.includes(effect.sourceCardId)
  ) {
    return game;
  }

  const playResult = playKasumiFromWaitingRoomToStageSlot(game, player.id, effect.sourceCardId, selectedSlot);
  if (!playResult) {
    return game;
  }

  const state = addAction(playResult.gameState, 'RESOLVE_ABILITY', player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'PLAY_SELF_FROM_WAITING_ROOM',
    playedCardId: effect.sourceCardId,
    toSlot: selectedSlot,
    paidEnergyCardIds: getStringArray(effect.metadata?.paidEnergyCardIds),
    discardedCardIds: getStringArray(effect.metadata?.discardedCardIds),
    replacedMemberCardId: playResult.replacedMemberCardId,
    replacedMemberEffectiveCost: playResult.replacedMemberEffectiveCost,
  });
  const stateWithOnEnter = enqueueTriggeredCardEffects(
    state,
    [
      ...(playResult.leaveStageEvent ? [TriggerCondition.ON_LEAVE_STAGE] : []),
      ...(playResult.enterWaitingRoomEvent ? [TriggerCondition.ON_ENTER_WAITING_ROOM] : []),
      TriggerCondition.ON_ENTER_STAGE,
    ],
    {
      leaveStageEvents: playResult.leaveStageEvent ? [playResult.leaveStageEvent] : [],
      enterWaitingRoomEvents: playResult.enterWaitingRoomEvent
        ? [playResult.enterWaitingRoomEvent]
        : [],
      enterStageEvents: getNewEnterStageEvents(game, state),
    }
  );

  return continuePendingCardEffects({ ...stateWithOnEnter, activeEffect: null }, false);
}

interface PlayKasumiFromWaitingRoomToStageSlotResult {
  readonly gameState: GameState;
  readonly replacedMemberCardId: string | null;
  readonly replacedMemberEffectiveCost: number | null;
  readonly leaveStageEvent: LeaveStageEvent | null;
  readonly enterWaitingRoomEvent: EnterWaitingRoomEvent | null;
}

function playKasumiFromWaitingRoomToStageSlot(
  game: GameState,
  playerId: string,
  cardId: string,
  targetSlot: SlotPosition
): PlayKasumiFromWaitingRoomToStageSlotResult | null {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  if (!player || !card || !player.waitingRoom.cardIds.includes(cardId)) {
    return null;
  }

  const replacedMemberCardId = player.memberSlots.slots[targetSlot];
  const replacedMemberCard = replacedMemberCardId
    ? getCardById(game, replacedMemberCardId)
    : null;
  if (replacedMemberCardId && !replacedMemberCard) {
    return null;
  }
  const replacedMemberEffectiveCost = replacedMemberCardId
    ? getMemberEffectiveCost(game, playerId, replacedMemberCardId)
    : null;
  let replacedMemberBelowIds: readonly string[] = [];

  let state = game;
  if (replacedMemberCardId && replacedMemberCard) {
    state = updatePlayer(state, playerId, (currentPlayer) => {
      const [slotsWithoutMemberBelow, memberBelowIds] = popMemberBelowMember(
        currentPlayer.memberSlots,
        targetSlot
      );
      replacedMemberBelowIds = memberBelowIds;
      const slotsWithoutReplacedMember = removeCardFromSlot(slotsWithoutMemberBelow, targetSlot);
      const waitingRoom = addCardsToZone(
        addCardToZone(currentPlayer.waitingRoom, replacedMemberCardId),
        memberBelowIds
      );
      return {
        ...currentPlayer,
        memberSlots: slotsWithoutReplacedMember,
        waitingRoom,
      };
    });
  }

  state = updatePlayer(state, playerId, (currentPlayer) => ({
    ...currentPlayer,
    waitingRoom: removeCardFromZone(currentPlayer.waitingRoom, cardId),
    memberSlots: placeCardInSlot(currentPlayer.memberSlots, targetSlot, cardId),
    movedToStageThisTurn: [...currentPlayer.movedToStageThisTurn, cardId],
  }));

  const leaveStageEvent =
    replacedMemberCardId && replacedMemberCard
      ? createLeaveStageEvent(
          replacedMemberCardId,
          targetSlot,
          ZoneType.WAITING_ROOM,
          replacedMemberCard.ownerId,
          playerId,
          cardId
        )
      : null;
  if (leaveStageEvent) {
    state = emitGameEvent(state, leaveStageEvent);
  }

  const enterWaitingRoomEvent =
    replacedMemberCardId && replacedMemberCard
      ? createEnterWaitingRoomEvent(
          [replacedMemberCardId, ...replacedMemberBelowIds],
          ZoneType.MEMBER_SLOT,
          replacedMemberCard.ownerId,
          playerId
        )
      : null;
  if (enterWaitingRoomEvent) {
    state = emitGameEvent(state, enterWaitingRoomEvent);
  }

  state = emitGameEvent(
    state,
    createEnterStageEvent(cardId, ZoneType.WAITING_ROOM, targetSlot, card.ownerId, playerId, {
      replacedMemberCardId,
      replacedMemberEffectiveCost,
    })
  );

  return {
    gameState: state,
    replacedMemberCardId,
    replacedMemberEffectiveCost,
    leaveStageEvent,
    enterWaitingRoomEvent,
  };
}

function getActiveEnergyCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return player
    ? player.energyZone.cardIds.filter(
        (cardId) =>
          player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
      )
    : [];
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}
