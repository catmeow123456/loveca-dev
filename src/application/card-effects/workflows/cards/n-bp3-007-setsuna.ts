import { isMemberCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, getPlayerById, type GameState } from '../../../../domain/entities/game.js';
import type { EnterStageEvent, EnterWaitingRoomEvent, LeaveStageEvent } from '../../../../domain/events/game-events.js';
import { CardType, GamePhase, OrientationState, SlotPosition, SubPhase, TriggerCondition, ZoneType } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { PL_N_BP3_007_ACTIVATED_PAY_TWO_SEND_SELF_PLAY_SETUNA_ATTACH_ENERGY_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import { paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../runtime/leave-stage-triggers.js';
import { playMemberFromZoneToEmptySlot } from '../../runtime/play-member-to-stage.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';
import { and, cardNameAliasIs, costLte, typeIs } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import { stackEnergyFromEnergyZoneBelowMember } from '../../../effects/energy-below.js';

const SELECT_HAND_SETUNA_STEP_ID = 'N_BP3_007_SELECT_HAND_SETUNA_TO_PLAY';
const BASE_CARD_CODE = 'PL!N-bp3-007';
const SETSUNA_SELECTOR = and(typeIs(CardType.MEMBER), costLte(13), cardNameAliasIs('優木せつ菜'));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
    readonly leaveStageEvents?: readonly LeaveStageEvent[];
  }
) => GameState;

export function registerNBp3007SetsunaWorkflowHandlers(dependencies: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(ABILITY_ID, (game, playerId, sourceCardId) =>
    startWorkflow(game, playerId, sourceCardId, dependencies)
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_HAND_SETUNA_STEP_ID, (game, input, context) =>
    finishWorkflow(game, input.selectedCardId ?? null, context.continuePendingCardEffects, dependencies)
  );
}

function getLegalHandTargetIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  return getCardIdsInZoneMatching(game, playerId, ZoneType.HAND, SETSUNA_SELECTOR).filter(
    (cardId) => cardId !== sourceCardId
  );
}

function startWorkflow(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  dependencies: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects }
): GameState {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, sourceCardId);
  const activeEnergyCount =
    player?.energyZone.cardIds.filter(
      (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
    ).length ?? 0;
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.currentSubPhase !== SubPhase.NONE ||
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, BASE_CARD_CODE) ||
    sourceSlot === null ||
    activeEnergyCount < 2 ||
    player.energyZone.cardIds.length < 3 ||
    getLegalHandTargetIds(game, playerId, sourceCardId).length === 0
  ) {
    return game;
  }

  const payment = paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
    game,
    playerId,
    sourceCardId,
    dependencies.enqueueTriggeredCardEffects,
    { additionalCostsBeforeSourceMemberToWaitingRoom: [{ kind: 'TAP_ACTIVE_ENERGY', count: 2 }] }
  );
  if (!payment || payment.sourceSlot === undefined) return game;

  const selectableCardIds = getLegalHandTargetIds(payment.gameState, playerId, sourceCardId);
  if (selectableCardIds.length === 0) return game;
  let state = recordPayCostAction(payment.gameState, playerId, {
    abilityId: ABILITY_ID,
    sourceCardId,
    energyCardIds: payment.paidEnergyCardIds,
    paidEnergyCardIds: payment.paidEnergyCardIds,
    movedToWaitingRoomCardIds: payment.movedToWaitingRoomCardIds,
    sourceSlot: payment.sourceSlot,
    amount: payment.paidEnergyCardIds.length,
  });
  state = {
    ...state,
    activeEffect: {
      id: `${ABILITY_ID}:${sourceCardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: ABILITY_ID,
      sourceCardId,
      controllerId: playerId,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: SELECT_HAND_SETUNA_STEP_ID,
      stepText: '请选择自己手牌中1张费用13以下的「優木せつ菜」成员卡，登场到此成员原本所在区域。',
      awaitingPlayerId: playerId,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      canSkipSelection: false,
      selectionLabel: '选择要登场的「優木せつ菜」成员卡',
      confirmSelectionLabel: '登场并放置能量',
      metadata: {
        paidEnergyCardIds: payment.paidEnergyCardIds,
        movedToWaitingRoomCardIds: payment.movedToWaitingRoomCardIds,
        sourceSlot: payment.sourceSlot,
      },
    },
  };
  return state;
}

function finishWorkflow(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  dependencies: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects }
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || selectedCardId === null || !effect.selectableCardIds?.includes(selectedCardId)) return game;
  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = effect.metadata?.sourceSlot;
  const selectedCard = getCardById(game, selectedCardId);
  if (!player || typeof sourceSlot !== 'string' || !Object.values(SlotPosition).includes(sourceSlot as SlotPosition) || player.memberSlots.slots[sourceSlot as SlotPosition] !== null || !player.hand.cardIds.includes(selectedCardId) || !selectedCard || selectedCard.ownerId !== player.id || !SETSUNA_SELECTOR(selectedCard)) return game;

  const playResult = playMemberFromZoneToEmptySlot(game, player.id, {
    cardId: selectedCardId,
    sourceZone: ZoneType.HAND,
    toSlot: sourceSlot as SlotPosition,
  });
  if (!playResult) return game;
  const stackResult = stackEnergyFromEnergyZoneBelowMember(playResult.gameState, player.id, playResult.toSlot, 1);
  if (!stackResult) return game;

  let state = addAction(stackResult.gameState, 'RESOLVE_ABILITY', player.id, {
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
    step: 'PLAY_SETUNA_ATTACH_ENERGY',
    paidEnergyCardIds: effect.metadata?.paidEnergyCardIds ?? [],
    movedToWaitingRoomCardIds: effect.metadata?.movedToWaitingRoomCardIds ?? [],
    playedCardId: selectedCardId,
    sourceSlot: playResult.toSlot,
    stackedEnergyCardIds: stackResult.stackedEnergyCardIds,
  });
  state = dependencies.enqueueTriggeredCardEffects(state, [TriggerCondition.ON_ENTER_STAGE], {
    enterStageEvents: getNewEnterStageEvents(game, state),
  });
  return continuePendingCardEffects({ ...state, activeEffect: null }, false);
}
