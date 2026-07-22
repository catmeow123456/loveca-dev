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
} from '../../../../domain/events/game-events.js';
import {
  GamePhase,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { canPlayMemberInStageSlotThisTurn } from '../../../../domain/rules/member-turn-state.js';
import { PL_N_BP1_002_ACTIVATED_FROM_WAITING_ROOM_PAY_TWO_DISCARD_ONE_PLAY_SELF_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { discardOneHandCardToWaitingRoomAndEnqueueTriggers } from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueCardEffectPlacementTriggersWithStageSnapshot,
  playMemberFromZoneToStageSlotWithReplacement,
} from '../../runtime/play-member-to-stage.js';
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
    (game, input, context) =>
      finishKasumiDiscardCost(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
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
        stepText: '请选择1张手牌放置入休息室，并支付[E][E]。',
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
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: (game: GameState, orderedResolution: boolean) => GameState
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

  const selectableSlots = getLegalKasumiStageSlots(
    discardResult.gameState,
    player.id,
    effect.sourceCardId
  );
  if (selectableSlots.length === 0) {
    const noTargetState = addAction(
      { ...discardResult.gameState, activeEffect: null },
      'RESOLVE_ABILITY',
      player.id,
      {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_LEGAL_STAGE_SLOT_AFTER_COST',
        paidEnergyCardIds: energyPayment.paidEnergyCardIds,
        discardedCardIds: discardResult.discardedCardIds,
      }
    );
    return continuePendingCardEffects(noTargetState, false);
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
        selectableSlots,
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
      selectableSlots,
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
    !player.waitingRoom.cardIds.includes(effect.sourceCardId) ||
    !getLegalKasumiStageSlots(game, player.id, effect.sourceCardId).includes(selectedSlot)
  ) {
    return game;
  }

  const playResult = playMemberFromZoneToStageSlotWithReplacement(game, player.id, {
    cardId: effect.sourceCardId,
    sourceZone: ZoneType.WAITING_ROOM,
    toSlot: selectedSlot,
  });
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
    duplicateMemberRuleRemovedCardId: playResult.duplicateMemberRuleRemovedCardId,
  });
  const stateWithOnEnter = enqueueCardEffectPlacementTriggersWithStageSnapshot(
    game,
    state,
    playResult,
    enqueueTriggeredCardEffects
  );

  return continuePendingCardEffects({ ...stateWithOnEnter, activeEffect: null }, false);
}

function getLegalKasumiStageSlots(
  game: GameState,
  playerId: string,
  incomingCardId: string
): readonly SlotPosition[] {
  const player = getPlayerById(game, playerId);
  const incomingCard = getCardById(game, incomingCardId);
  if (
    !player ||
    !incomingCard ||
    incomingCard.ownerId !== player.id ||
    !isMemberCardData(incomingCard.data)
  ) {
    return [];
  }
  return MEMBER_SLOT_ORDER.filter((slot) =>
    canPlayMemberInStageSlotThisTurn(game, player.id, slot)
  );
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
