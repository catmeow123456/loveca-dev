import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import type { EnterStageEvent } from '../../../../domain/events/game-events.js';
import {
  CardType,
  GamePhase,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { and, costLte, typeIs } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { playMembersFromWaitingRoomToEmptySlots } from '../../../effects/member-state.js';

const HS_BP5_002_SELECT_WAITING_ROOM_MEMBER_STEP_ID =
  'HS_BP5_002_SELECT_WAITING_ROOM_LOW_COST_MEMBER';
const HS_BP5_002_SELECT_EMPTY_STAGE_SLOT_STEP_ID = 'HS_BP5_002_SELECT_EMPTY_STAGE_SLOT';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
  }
) => GameState;

export function registerHsBp5002SayakaWorkflowHandlers(dependencies: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID,
    (game, playerId, cardId) => startHsBp5002SayakaActivated(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(
    HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID,
    HS_BP5_002_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    (game, input) => selectHsBp5002SayakaWaitingRoomMember(game, input.selectedCardId ?? null)
  );
  registerActiveEffectStepHandler(
    HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID,
    HS_BP5_002_SELECT_EMPTY_STAGE_SLOT_STEP_ID,
    (game, input, context) =>
      finishHsBp5002SayakaPlayMember(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        dependencies.enqueueTriggeredCardEffects
      )
  );
}

function startHsBp5002SayakaActivated(
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
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!HS-bp5-002') ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot === null
  ) {
    return game;
  }

  const selectableCardIds = getLowCostWaitingRoomMemberCardIds(game, player.id);
  const emptySlots = getEmptyMemberSlots(game, player.id);
  if (selectableCardIds.length === 0 || emptySlots.length === 0) {
    return game;
  }

  let state = recordAbilityUseForContext(game, player.id, {
    abilityId: HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID,
    sourceCardId: cardId,
  });
  const costPayment = payImmediateEffectCosts(state, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!costPayment) {
    return game;
  }
  state = recordPayCostAction(costPayment.gameState, player.id, {
    abilityId: HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID,
    sourceCardId: cardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });

  return addAction(
    {
      ...state,
      activeEffect: {
        id: `${HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
        abilityId: HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID
        ),
        stepId: HS_BP5_002_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
        stepText: '请选择自己的休息室中1张费用小于等于2的成员卡。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        canSkipSelection: false,
        selectionLabel: '选择要登场的休息室成员',
        confirmSelectionLabel: '选择登场区域',
        metadata: {
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
          sourceSlot,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID,
      sourceCardId: cardId,
      step: 'PAY_COST_SELECT_WAITING_ROOM_LOW_COST_MEMBER',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      selectableCardIds,
      emptySlots,
    }
  );
}

function selectHsBp5002SayakaWaitingRoomMember(
  game: GameState,
  selectedCardId: string | null
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID ||
    effect.stepId !== HS_BP5_002_SELECT_WAITING_ROOM_MEMBER_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.waitingRoom.cardIds.includes(selectedCardId)) {
    return game;
  }

  const emptySlots = getEmptyMemberSlots(game, player.id);
  if (emptySlots.length === 0) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: HS_BP5_002_SELECT_EMPTY_STAGE_SLOT_STEP_ID,
        stepText: '请选择该成员要登场的空成员区。',
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectableSlots: emptySlots,
        selectionLabel: '选择登场区域',
        confirmSelectionLabel: '登场',
        metadata: {
          ...effect.metadata,
          selectedWaitingRoomCardId: selectedCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_EMPTY_STAGE_SLOT',
      selectedCardId,
      emptySlots,
    }
  );
}

function finishHsBp5002SayakaPlayMember(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID ||
    effect.stepId !== HS_BP5_002_SELECT_EMPTY_STAGE_SLOT_STEP_ID ||
    selectedSlot === null ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const selectedCardId =
    typeof effect.metadata?.selectedWaitingRoomCardId === 'string'
      ? effect.metadata.selectedWaitingRoomCardId
      : null;
  if (!player || selectedCardId === null || !player.waitingRoom.cardIds.includes(selectedCardId)) {
    return game;
  }

  const playResult = playMembersFromWaitingRoomToEmptySlots(
    game,
    player.id,
    [{ cardId: selectedCardId, toSlot: selectedSlot }],
    OrientationState.ACTIVE
  );
  if (!playResult) {
    return game;
  }

  const state = addAction(playResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'PLAY_LOW_COST_MEMBER_FROM_WAITING_ROOM',
    playedCardId: selectedCardId,
    toSlot: selectedSlot,
  });
  const stateWithOnEnter = enqueueTriggeredCardEffects(state, [TriggerCondition.ON_ENTER_STAGE], {
    enterStageEvents: getNewEnterStageEvents(game, state),
  });

  return continuePendingCardEffects({ ...stateWithOnEnter, activeEffect: null }, false);
}

function getLowCostWaitingRoomMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getCardIdsInZoneMatching(
    game,
    playerId,
    ZoneType.WAITING_ROOM,
    and(typeIs(CardType.MEMBER), costLte(2))
  );
}

function getEmptyMemberSlots(game: GameState, playerId: string): SlotPosition[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return MEMBER_SLOT_ORDER.filter((slot) => player.memberSlots.slots[slot] === null);
}
