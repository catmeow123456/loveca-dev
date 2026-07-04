import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { CardType, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import {
  activateWaitingEnergyCardsForPlayer,
  recoverCardsFromWaitingRoomToHandForPlayer,
} from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import {
  paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers,
  type EnqueueTriggeredCardEffectsForLeaveStage,
} from '../../runtime/leave-stage-triggers.js';
import {
  and,
  groupIs,
  typeIs,
} from '../../../effects/card-selectors.js';
import {
  successLiveScoreAtLeast,
  sumSuccessfulLiveScore,
} from '../../../effects/conditions.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  getZoneSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';

const PR_017_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID = 'PR_017_SELECT_WAITING_ROOM_MUSE_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForLeaveStage;

export interface Pr017NicoWorkflowDependencies {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}

export function registerPr017NicoWorkflowHandlers(
  dependencies: Pr017NicoWorkflowDependencies
): void {
  registerActivatedAbilityHandler(
    PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
    (game, playerId, cardId) => startPr017NicoActivatedEffect(game, playerId, cardId, dependencies)
  );
  registerActiveEffectStepHandler(
    PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
    PR_017_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID,
    (game, input, context) =>
      finishPr017NicoRecoverMuseLiveActivateEnergy(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startPr017NicoActivatedEffect(
  game: GameState,
  playerId: string,
  cardId: string,
  dependencies: Pr017NicoWorkflowDependencies
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  if (activePlayerId !== playerId) {
    return game;
  }
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  if (
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!-PR-017') ||
    !isMemberCardData(sourceCard.data)
  ) {
    return game;
  }
  const sourceSlot = findMemberSlot(player, cardId);
  if (!sourceSlot) {
    return game;
  }

  let state = recordAbilityUseForContext(game, player.id, {
    abilityId: PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
    sourceCardId: cardId,
  });
  const costPayment = paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
    state,
    player.id,
    cardId,
    dependencies.enqueueTriggeredCardEffects
  );
  if (!costPayment) {
    return game;
  }
  state = costPayment.gameState;
  const movedToWaitingRoomCardIds = costPayment.movedToWaitingRoomCardIds;

  const selectableCardIds = selectWaitingRoomCardIds(
    state,
    player.id,
    and(typeIs(CardType.LIVE), groupIs("μ's"))
  );
  const selectionRequired = selectableCardIds.length > 0;
  state = {
    ...state,
    activeEffect: createWaitingRoomToHandEffectState({
      id: `${PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
      sourceCardId: cardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID),
      stepId: PR_017_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID,
      awaitingPlayerId: player.id,
      selectableCardIds,
      metadata: {
        sourceSlot,
        movedToWaitingRoomCardIds,
      },
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: selectionRequired ? 1 : 0,
        optional: !selectionRequired,
      }),
    }),
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
    sourceCardId: cardId,
    step: 'PAY_COST',
    fromSlot: sourceSlot,
    movedToWaitingRoomCardIds,
    selectableCardIds,
  });
}

function finishPr017NicoRecoverMuseLiveActivateEnergy(
  game: GameState,
  selectedCardId: string | null,
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

  const selectedCardIds = selectedCardId !== null ? [selectedCardId] : [];
  const zoneSelection = getZoneSelectionConfig(effect);
  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    selectedCardIds,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      minCount: zoneSelection.minCount,
      maxCount: zoneSelection.maxCount,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  const successLiveScore = sumSuccessfulLiveScore(recoveryResult.gameState, player.id);
  const conditionMet = successLiveScoreAtLeast(recoveryResult.gameState, player.id, 9);
  const waitingEnergyCount = getEnergyCardIdsByOrientation(
    recoveryResult.gameState,
    player.id,
    OrientationState.WAITING
  ).length;
  const activationCount = Math.min(2, waitingEnergyCount);
  const orientationChange = conditionMet
    ? activateWaitingEnergyCardsForPlayer(recoveryResult.gameState, player.id, activationCount)
    : null;
  const stateAfterEnergy = orientationChange?.gameState ?? recoveryResult.gameState;
  const state = { ...stateAfterEnergy, activeEffect: null };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_IF_SUCCESS_SCORE',
      selectedCardId: selectedCardIds[0] ?? null,
      selectedCardIds,
      publicEffectSummary: {
        effectKind: 'SELF_SACRIFICE_RECOVER_FROM_WAITING_ROOM',
        recoveredCardIds: recoveryResult.movedCardIds,
        noRecoveredCards: recoveryResult.movedCardIds.length === 0,
      },
      successLiveScore,
      conditionMet,
      activatedEnergyCardIds: orientationChange?.activatedEnergyCardIds ?? [],
      previousOrientations: orientationChange?.previousOrientations ?? [],
      nextOrientation: orientationChange?.nextOrientation ?? OrientationState.ACTIVE,
    }),
    effect.metadata?.orderedResolution === true
  );
}
