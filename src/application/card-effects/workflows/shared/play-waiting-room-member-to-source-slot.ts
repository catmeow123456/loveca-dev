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
import {
  HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
  S_BP6_008_ACTIVATED_PLAY_AQOURS_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
} from '../../ability-ids.js';
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
const S_BP6_008_SELECT_WAITING_ROOM_MEMBER_STEP_ID =
  'S_BP6_008_SELECT_WAITING_ROOM_MEMBER_TO_PLAY';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
    readonly leaveStageEvents?: readonly LeaveStageEvent[];
  }
) => GameState;

export interface PlayWaitingRoomMemberToSourceSlotWorkflowDependencies {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}

interface PlayWaitingRoomMemberToSourceSlotConfig {
  readonly abilityId: string;
  readonly expectedBaseCardCodes: readonly string[];
  readonly selectStepId: string;
  readonly energyCost: number;
  readonly targetGroupAlias: string;
  readonly targetGroupLabel: string;
  readonly targetCostLte: number;
}

const PLAY_WAITING_ROOM_MEMBER_TO_SOURCE_SLOT_WORKFLOWS: readonly PlayWaitingRoomMemberToSourceSlotConfig[] = [
  {
    abilityId: HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
    expectedBaseCardCodes: ['PL!HS-bp1-002'],
    selectStepId: HS_BP1_002_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    energyCost: 2,
    targetGroupAlias: '蓮ノ空',
    targetGroupLabel: '莲之空',
    targetCostLte: 15,
  },
  {
    abilityId: S_BP6_008_ACTIVATED_PLAY_AQOURS_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
    expectedBaseCardCodes: ['PL!S-bp6-008'],
    selectStepId: S_BP6_008_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    energyCost: 2,
    targetGroupAlias: 'Aqours',
    targetGroupLabel: 'Aqours',
    targetCostLte: 17,
  },
];

export function registerPlayWaitingRoomMemberToSourceSlotWorkflowHandlers(
  dependencies: PlayWaitingRoomMemberToSourceSlotWorkflowDependencies
): void {
  for (const config of PLAY_WAITING_ROOM_MEMBER_TO_SOURCE_SLOT_WORKFLOWS) {
    registerActivatedAbilityHandler(config.abilityId, (game, playerId, cardId) =>
      startActivatedPlayMemberToSourceSlot(game, playerId, cardId, config, dependencies)
    );
    registerActiveEffectStepHandler(config.abilityId, config.selectStepId, (game, input, context) =>
      finishPlayMemberToSourceSlot(
        game,
        input.selectedCardId ?? null,
        config,
        context.continuePendingCardEffects,
        dependencies
      )
    );
  }
}

function startActivatedPlayMemberToSourceSlot(
  game: GameState,
  playerId: string,
  cardId: string,
  config: PlayWaitingRoomMemberToSourceSlotConfig,
  dependencies: PlayWaitingRoomMemberToSourceSlotWorkflowDependencies
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
    !config.expectedBaseCardCodes.some((baseCardCode) =>
      cardCodeMatchesBase(sourceCard.data.cardCode, baseCardCode)
    ) ||
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
        { kind: 'TAP_ACTIVE_ENERGY', count: config.energyCost },
      ],
    }
  );
  if (!costPayment || !costPayment.sourceSlot) {
    return game;
  }

  const selector = and(
    typeIs(CardType.MEMBER),
    costLte(config.targetCostLte),
    groupAliasIs(config.targetGroupAlias)
  );
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
    abilityId: config.abilityId,
    sourceCardId: cardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
    movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
    sourceSlot: costPayment.sourceSlot,
  });

  state = {
    ...state,
    activeEffect: {
      id: `${config.abilityId}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: config.abilityId,
      sourceCardId: cardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: config.selectStepId,
      stepText:
        `请选择自己的休息室中1张费用小于等于${config.targetCostLte}的『${config.targetGroupLabel}』成员卡登场至此成员原本所在的区域。`,
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
    abilityId: config.abilityId,
    sourceCardId: cardId,
    step: 'PAY_COST_SELECT_WAITING_ROOM_MEMBER_TO_PLAY',
    paidEnergyCardIds: costPayment.paidEnergyCardIds,
    movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
    sourceSlot: costPayment.sourceSlot,
    selectableCardIds,
  });
}

function finishPlayMemberToSourceSlot(
  game: GameState,
  selectedCardId: string | null,
  config: PlayWaitingRoomMemberToSourceSlotConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  dependencies: PlayWaitingRoomMemberToSourceSlotWorkflowDependencies
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
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
