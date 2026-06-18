import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { EnterStageEvent } from '../../../../domain/events/game-events.js';
import {
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID } from '../../ability-ids.js';
import { finishSkippedActiveEffect } from '../../runtime/active-effect.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { costLte } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { playMembersFromWaitingRoomToEmptySlots } from '../../../effects/member-state.js';

const DECLINE_OPTION_LABEL = '不发动';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const YOSHIKO_PAY_COST_STEP_ID = 'YOSHIKO_PAY_COST';
const YOSHIKO_SELECT_WAITING_ROOM_MEMBERS_STEP_ID = 'YOSHIKO_SELECT_WAITING_ROOM_LOW_COST_MEMBERS';
const YOSHIKO_SELECT_STAGE_SLOT_STEP_ID = 'YOSHIKO_SELECT_STAGE_SLOT';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
  }
) => GameState;

export interface YoshikoPlayLowCostMembersWorkflowDependencies {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}

export function registerYoshikoPlayLowCostMembersWorkflowHandlers(
  dependencies: YoshikoPlayLowCostMembersWorkflowDependencies
): void {
  registerPendingAbilityStarterHandler(
    YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID,
    (game, ability, options) =>
      startYoshikoOnEnterPlayLowCostMembers(game, ability, options)
  );
  registerActiveEffectStepHandler(
    YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID,
    YOSHIKO_PAY_COST_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? startYoshikoWaitingRoomSelectionAfterCost(game)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID,
    YOSHIKO_SELECT_WAITING_ROOM_MEMBERS_STEP_ID,
    (game, input, context) =>
      startYoshikoSelectStageSlot(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID,
    YOSHIKO_SELECT_STAGE_SLOT_STEP_ID,
    (game, input, context) =>
      finishYoshikoSelectStageSlot(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        dependencies
      )
  );
}

function startYoshikoOnEnterPlayLowCostMembers(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(game, player.id);
  const emptySlots = getEmptyMemberSlots(game, player.id);
  const canPay = activeEnergyCardIds.length >= 4 && emptySlots.length > 0;
  const selectableOptions = canPay
    ? [
        { id: 'pay', label: '支付4能量' },
        { id: 'decline', label: DECLINE_OPTION_LABEL },
      ]
    : [{ id: 'decline', label: DECLINE_OPTION_LABEL }];

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID),
        stepId: YOSHIKO_PAY_COST_STEP_ID,
        stepText: canPay
          ? '可以支付4张活跃能量发动此效果。'
          : '当前无法支付4张活跃能量或没有空成员区，可以不发动。',
        awaitingPlayerId: player.id,
        selectableOptions,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          activeEnergyCardIds,
          emptySlots,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_OPTION',
      canPay,
      activeEnergyCardIds,
      emptySlots,
    }
  );
}

function startYoshikoWaitingRoomSelectionAfterCost(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 4 },
  ]);
  if (!costPayment) {
    return game;
  }

  const selectableCardIds = getCardIdsInZoneMatching(
    costPayment.gameState,
    player.id,
    ZoneType.WAITING_ROOM,
    costLte(4)
  );
  const emptySlots = getEmptyMemberSlots(game, player.id);
  const state = addAction(costPayment.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });

  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: YOSHIKO_SELECT_WAITING_ROOM_MEMBERS_STEP_ID,
        stepText: '请选择至多2张费用合计小于等于4的成员卡。也可以不选择。',
        selectableCardIds,
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: Math.min(2, selectableCardIds.length, emptySlots.length),
        canSkipSelection: true,
        selectableOptions: undefined,
        selectionLabel: '选择要从休息室登场的成员',
        confirmSelectionLabel: '确认选择',
        metadata: {
          ...effect.metadata,
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
          selectableCardIds,
          emptySlots,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_COST_SELECT_WAITING_ROOM_MEMBERS',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      selectableCardIds,
      emptySlots,
    }
  );
}

function startYoshikoSelectStageSlot(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const selectedAreValid =
    uniqueSelectedCardIds.length === selectedCardIds.length &&
    uniqueSelectedCardIds.length <= 2 &&
    uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true &&
        player.waitingRoom.cardIds.includes(cardId)
    ) &&
    calculateMemberCostSum(game, uniqueSelectedCardIds) <= 4;

  if (!selectedAreValid) {
    return game;
  }

  if (uniqueSelectedCardIds.length === 0) {
    const state = { ...game, activeEffect: null };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'FINISH_NO_SELECTION',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const nextCardId = uniqueSelectedCardIds[0];
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: YOSHIKO_SELECT_STAGE_SLOT_STEP_ID,
        stepText: '请选择该成员要登场的空成员区。',
        selectableCardIds: [nextCardId],
        selectableCardMode: 'SINGLE',
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectableSlots: getEmptyMemberSlots(game, player.id),
        selectionLabel: '选择登场槽位',
        confirmSelectionLabel: '登场',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          selectedWaitingRoomCardIds: uniqueSelectedCardIds,
          nextWaitingRoomCardIndex: 0,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_STAGE_SLOT',
      selectedCardIds: uniqueSelectedCardIds,
      nextCardId,
    }
  );
}

function finishYoshikoSelectStageSlot(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  dependencies: YoshikoPlayLowCostMembersWorkflowDependencies
): GameState {
  const effect = game.activeEffect;
  if (!effect || selectedSlot === null) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !effect.selectableSlots?.includes(selectedSlot)) {
    return game;
  }

  const selectedWaitingRoomCardIds = Array.isArray(effect.metadata?.selectedWaitingRoomCardIds)
    ? effect.metadata.selectedWaitingRoomCardIds.filter(
        (cardId): cardId is string => typeof cardId === 'string'
      )
    : [];
  const currentIndex =
    typeof effect.metadata?.nextWaitingRoomCardIndex === 'number'
      ? effect.metadata.nextWaitingRoomCardIndex
      : 0;
  const cardId = selectedWaitingRoomCardIds[currentIndex];
  if (!cardId) {
    return game;
  }

  const playResult = playMembersFromWaitingRoomToEmptySlots(game, player.id, [
    { cardId, toSlot: selectedSlot },
  ]);
  if (!playResult) {
    return game;
  }

  const nextIndex = currentIndex + 1;
  const nextCardId = selectedWaitingRoomCardIds[nextIndex];
  const state = addAction(playResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'PLAY_MEMBER_FROM_WAITING_ROOM',
    playedCardId: cardId,
    toSlot: selectedSlot,
  });
  const stateWithOnEnter = dependencies.enqueueTriggeredCardEffects(
    state,
    [TriggerCondition.ON_ENTER_STAGE],
    {
      enterStageEvents: getNewEnterStageEvents(game, state),
    }
  );

  if (!nextCardId) {
    return continuePendingCardEffects(
      { ...stateWithOnEnter, activeEffect: null },
      effect.metadata?.orderedResolution === true
    );
  }

  const nextPlayer = getPlayerById(stateWithOnEnter, player.id);
  if (!nextPlayer) {
    return game;
  }

  return {
    ...stateWithOnEnter,
    activeEffect: {
      ...effect,
      selectableCardIds: [nextCardId],
      selectableSlots: getEmptyMemberSlots(stateWithOnEnter, nextPlayer.id),
      metadata: {
        ...effect.metadata,
        selectedWaitingRoomCardIds,
        nextWaitingRoomCardIndex: nextIndex,
      },
    },
  };
}

function getActiveEnergyCardIds(game: GameState, playerId: string): string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function getEmptyMemberSlots(game: GameState, playerId: string): SlotPosition[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return MEMBER_SLOT_ORDER.filter((slot) => player.memberSlots.slots[slot] === null);
}

function calculateMemberCostSum(game: GameState, cardIds: readonly string[]): number {
  return cardIds.reduce((sum, cardId) => {
    const card = getCardById(game, cardId);
    return sum + (card && isMemberCardData(card.data) ? card.data.cost : Number.POSITIVE_INFINITY);
  }, 0);
}
