import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import type { EnterStageEvent, LeaveStageEvent } from '../../../../domain/events/game-events.js';
import {
  CardType,
  GamePhase,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import { paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../runtime/leave-stage-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  and,
  costLte,
  groupAliasIs,
  typeIs,
} from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import { playMembersFromWaitingRoomToEmptySlots } from '../../../effects/member-state.js';

const HS_BP1_002_SELECT_WAITING_ROOM_MEMBER_STEP_ID =
  'HS_BP1_002_SELECT_WAITING_ROOM_MEMBER_TO_PLAY';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
    readonly leaveStageEvents?: readonly LeaveStageEvent[];
  }
) => GameState;

export interface HsBp1002SayakaWorkflowDependencies {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}

export function registerHsBp1002SayakaWorkflowHandlers(
  dependencies: HsBp1002SayakaWorkflowDependencies
): void {
  registerActivatedAbilityHandler(
    HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
    (game, playerId, cardId) => startHsBp1SayakaActivatedPlayMemberToSourceSlot(
      game,
      playerId,
      cardId,
      dependencies
    )
  );
  registerActiveEffectStepHandler(
    HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
    HS_BP1_002_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    (game, input, context) =>
      finishHsBp1SayakaPlayMemberToSourceSlot(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        dependencies
      )
  );
}

function startHsBp1SayakaActivatedPlayMemberToSourceSlot(
  game: GameState,
  playerId: string,
  cardId: string,
  dependencies: HsBp1002SayakaWorkflowDependencies
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
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!HS-bp1-002') ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot === null
  ) {
    return game;
  }

  const costPayment = paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
    game,
    player.id,
    cardId,
    dependencies.enqueueTriggeredCardEffects,
    {
      additionalCostsBeforeSourceMemberToWaitingRoom: [
        { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
      ],
    }
  );
  if (!costPayment || !costPayment.sourceSlot) {
    return game;
  }

  const selector = and(typeIs(CardType.MEMBER), costLte(15), groupAliasIs('蓮ノ空'));
  const selectableCardIds = getCardIdsInZoneMatching(
    costPayment.gameState,
    player.id,
    ZoneType.WAITING_ROOM,
    selector
  );
  if (selectableCardIds.length === 0) {
    return game;
  }

  let state = addAction(costPayment.gameState, 'PAY_COST', player.id, {
    abilityId: HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
    sourceCardId: cardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
    movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
    sourceSlot: costPayment.sourceSlot,
  });

  state = {
    ...state,
    activeEffect: {
      id: `${HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
      sourceCardId: cardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID),
      stepId: HS_BP1_002_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
      stepText:
        '请选择自己的休息室中1张费用小于等于15的『莲之空』成员卡登场至此成员原本所在的区域。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      canSkipSelection: false,
      selectionLabel: '选择要从休息室登场的成员',
      confirmSelectionLabel: '登场',
      metadata: {
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
        movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
        sourceSlot: costPayment.sourceSlot,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
    sourceCardId: cardId,
    step: 'PAY_COST_SELECT_WAITING_ROOM_MEMBER_TO_PLAY',
    paidEnergyCardIds: costPayment.paidEnergyCardIds,
    movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
    sourceSlot: costPayment.sourceSlot,
    selectableCardIds,
  });
}

function finishHsBp1SayakaPlayMemberToSourceSlot(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  dependencies: HsBp1002SayakaWorkflowDependencies
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot =
    typeof effect.metadata?.sourceSlot === 'string' &&
    Object.values(SlotPosition).includes(effect.metadata.sourceSlot as SlotPosition)
      ? (effect.metadata.sourceSlot as SlotPosition)
      : null;
  if (!player || sourceSlot === null || !player.waitingRoom.cardIds.includes(selectedCardId)) {
    return game;
  }

  const playResult = playMembersFromWaitingRoomToEmptySlots(game, player.id, [
    { cardId: selectedCardId, toSlot: sourceSlot },
  ]);
  if (!playResult) {
    return game;
  }

  const state = addAction(playResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'PLAY_MEMBER_FROM_WAITING_ROOM_TO_SOURCE_SLOT',
    playedCardId: selectedCardId,
    toSlot: sourceSlot,
  });
  const stateWithOnEnter = dependencies.enqueueTriggeredCardEffects(
    state,
    [TriggerCondition.ON_ENTER_STAGE],
    {
      enterStageEvents: getNewEnterStageEvents(game, state),
    }
  );

  return continuePendingCardEffects({ ...stateWithOnEnter, activeEffect: null }, false);
}
