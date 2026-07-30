import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { GamePhase } from '../../../../shared/types/enums.js';
import { resolveEnergySelectionForOperation } from '../../../effects/energy-selection.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  getZoneSelectionConfig,
} from '../../../effects/zone-selection.js';
import { SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID } from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import type { EnqueueTriggeredCardEffectsForEnergyReturn } from '../../runtime/energy-return.js';
import { resolveEnergyReturnByCardEffect } from '../../runtime/energy-return.js';
import { isDirectOrRenGrantedActivatedAbilitySource } from '../../runtime/granted-activated-abilities.js';
import {
  paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers,
  type EnqueueTriggeredCardEffectsForLeaveStage,
} from '../../runtime/leave-stage-triggers.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { clearPreviousStageMemberInstanceState } from '../../../effects/member-state.js';

const SELECT_WAITING_ROOM_CARD_STEP_ID = 'SP_BP7_010_SELECT_WAITING_ROOM_CARD';
const BASE_CARD_CODE = 'PL!SP-bp7-010';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForLeaveStage &
  EnqueueTriggeredCardEffectsForEnergyReturn;

export function registerSpBp7010MargareteWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID,
    (game, playerId, cardId) =>
      startMargareteActivated(game, playerId, cardId, deps.enqueueTriggeredCardEffects)
  );
  registerActiveEffectStepHandler(
    SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID,
    SELECT_WAITING_ROOM_CARD_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomRecovery(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startMargareteActivated(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.players[game.activePlayerIndex]?.id !== playerId
  ) {
    return game;
  }
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  const sourceSlot = player ? findMemberSlot(player, sourceCardId) : null;
  if (
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== player.id ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot === null ||
    !isDirectOrRenGrantedActivatedAbilitySource(
      game,
      player.id,
      sourceCardId,
      SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID,
      [BASE_CARD_CODE]
    )
  ) {
    return game;
  }

  const costPayment = paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
    game,
    player.id,
    sourceCardId,
    enqueueTriggeredCardEffects
  );
  if (!costPayment) return game;

  let state = clearPreviousStageMemberInstanceState(costPayment.gameState, player.id, sourceCardId);
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID,
    sourceCardId,
  });
  state = recordPayCostAction(state, player.id, {
    abilityId: SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID,
    sourceCardId,
    fromSlot: sourceSlot,
    movedCardIds: costPayment.movedToWaitingRoomCardIds,
  });

  let movedEnergyCardIds: readonly string[] = [];
  const energySelection = resolveEnergySelectionForOperation(
    state,
    player.id,
    'RETURN_TO_ENERGY_DECK',
    1
  );
  if (energySelection) {
    const energyReturn = resolveEnergyReturnByCardEffect(energySelection.gameState, {
      playerId: player.id,
      selectedEnergyCardIds: energySelection.selectedEnergyCardIds,
      exactCount: 1,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId,
        abilityId: SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID,
      },
      enqueueTriggeredCardEffects,
    });
    if (energyReturn) {
      state = energyReturn.gameState;
      movedEnergyCardIds = energyReturn.movedEnergyCardIds;
    }
  }

  const currentPlayer = getPlayerById(state, player.id);
  const selectableCardIds = currentPlayer?.waitingRoom.cardIds ?? [];
  if (selectableCardIds.length === 0) {
    return addAction(state, 'RESOLVE_ABILITY', player.id, {
      abilityId: SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID,
      sourceCardId,
      step: 'PAID_COST_NO_RECOVERY_TARGET',
      movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
      movedEnergyCardIds,
      recoveredCardIds: [],
    });
  }

  const zoneSelection = createWaitingRoomToHandSelectionConfig({
    minCount: 1,
    maxCount: 1,
    optional: false,
  });
  const effectId = `${SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID}:${sourceCardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`;
  state = {
    ...state,
    activeEffect: createWaitingRoomToHandEffectState({
      id: effectId,
      abilityId: SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID,
      sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(
        SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID
      ),
      stepId: SELECT_WAITING_ROOM_CARD_STEP_ID,
      stepText: '请选择自己休息室中的1张卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectionLabel: '选择要加入手牌的卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      metadata: {
        sourceSlot,
        movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
        movedEnergyCardIds,
      },
      zoneSelection,
    }),
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID,
    sourceCardId,
    step: 'PAY_COST_RETURN_ENERGY_SELECT_RECOVERY',
    fromSlot: sourceSlot,
    movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
    movedEnergyCardIds,
    selectableCardIds,
  });
}

function finishWaitingRoomRecovery(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_ROOM_CARD_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const orderedSelections =
    Array.isArray(selectedCardIds) && selectedCardIds.length > 0 ? selectedCardIds : [];
  const selectedCardIdsToMove =
    orderedSelections.length > 0
      ? orderedSelections
      : selectedCardId !== null
        ? [selectedCardId]
        : [];
  const zoneSelection = getZoneSelectionConfig(effect);
  const currentCandidates = (effect.selectableCardIds ?? []).filter((cardId) =>
    player.waitingRoom.cardIds.includes(cardId)
  );
  const recovery = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    selectedCardIdsToMove,
    {
      candidateCardIds: currentCandidates,
      minCount: zoneSelection.minCount,
      maxCount: zoneSelection.maxCount,
    }
  );
  if (!recovery) {
    if (!wasRestoredAfterPublicCardSelectionConfirmation(effect)) return game;
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'RECOVERY_TARGET_STALE',
        movedEnergyCardIds: effect.metadata?.movedEnergyCardIds ?? [],
        recoveredCardIds: [],
      }),
      false
    );
  }

  return continuePendingCardEffects(
    addAction({ ...recovery.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      movedToWaitingRoomCardIds: effect.metadata?.movedToWaitingRoomCardIds ?? [],
      movedEnergyCardIds: effect.metadata?.movedEnergyCardIds ?? [],
      recoveredCardIds: recovery.movedCardIds,
    }),
    false
  );
}
