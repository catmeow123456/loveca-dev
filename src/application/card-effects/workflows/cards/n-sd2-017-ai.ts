import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { N_SD2_017_LIVE_START_PAY_ENERGY_ACTIVATE_STAGE_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const PAY_ENERGY_STEP_ID = 'N_SD2_017_LIVE_START_PAY_ENERGY';
const SELECT_MEMBER_STEP_ID = 'N_SD2_017_LIVE_START_SELECT_MEMBER_TO_ACTIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNSd2017AiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(
    N_SD2_017_LIVE_START_PAY_ENERGY_ACTIVATE_STAGE_MEMBER_ABILITY_ID,
    (game, ability, options) =>
      startNSd2017AiWorkflow(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    N_SD2_017_LIVE_START_PAY_ENERGY_ACTIVATE_STAGE_MEMBER_ABILITY_ID,
    PAY_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? payEnergyAndStartMemberSelection(game, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    N_SD2_017_LIVE_START_PAY_ENERGY_ACTIVATE_STAGE_MEMBER_ABILITY_ID,
    SELECT_MEMBER_STEP_ID,
    (game, input, context) =>
      finishMemberSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startNSd2017AiWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const canPay = getEnergySelectionCandidates(game, player.id, 'TAP_ACTIVE_ENERGY').length >= 1;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: PAY_ENERGY_STEP_ID,
      stepText: canPay
        ? '可以支付[E]，之后选择自己舞台上的1名待机状态成员变为活跃状态。'
        : '当前没有可用于支付[E]的活跃能量，可以不发动。',
      awaitingPlayerId: player.id,
      selectableOptions: canPay ? [{ id: 'pay', label: '支付[E]' }] : [],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_OPTION',
      canPay,
    },
  });
}

function payEnergyAndStartMemberSelection(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== N_SD2_017_LIVE_START_PAY_ENERGY_ACTIVATE_STAGE_MEMBER_ABILITY_ID ||
    effect.stepId !== PAY_ENERGY_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return finishSkippedActiveEffect(game, continuePendingCardEffects);
  }

  const payment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!payment) return game;
  const stateAfterCost = recordPayCostAction(payment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: payment.paidEnergyCardIds,
    amount: payment.paidEnergyCardIds.length,
  });
  const ability = toPendingAbility(effect);
  const targetSelection = createStageMemberOrientationTargetSelection(stateAfterCost, {
    ability,
    effectText: effect.effectText,
    stepId: SELECT_MEMBER_STEP_ID,
    stepText: '请选择自己舞台上的1名待机状态成员变为活跃状态。',
    awaitingPlayerId: player.id,
    targetPlayerId: player.id,
    selector: typeIs(CardType.MEMBER),
    targetOrientation: OrientationState.ACTIVE,
    selectionLabel: '选择要变为活跃状态的成员',
    orderedResolution: effect.metadata?.orderedResolution === true,
    metadata: { paidEnergyCardIds: payment.paidEnergyCardIds },
  });

  if (!targetSelection.activeEffect) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'PAY_ENERGY_NO_WAITING_MEMBER_TARGET',
        paidEnergyCardIds: payment.paidEnergyCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const activeEffect: ActiveEffectState = {
    ...targetSelection.activeEffect,
    confirmSelectionLabel: '变为活跃状态',
    canSkipSelection: false,
  };
  return addAction({ ...stateAfterCost, activeEffect }, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'PAY_ENERGY_SELECT_MEMBER',
    paidEnergyCardIds: payment.paidEnergyCardIds,
    selectableCardIds: targetSelection.selectableCardIds,
  });
}

function finishMemberSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== N_SD2_017_LIVE_START_PAY_ENERGY_ACTIVATE_STAGE_MEMBER_ABILITY_ID ||
    effect.stepId !== SELECT_MEMBER_STEP_ID ||
    !player ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const currentTargets = getWaitingOwnStageMemberCardIds(game, player.id);
  if (!currentTargets.includes(selectedCardId)) {
    if (currentTargets.length > 0) {
      return { ...game, activeEffect: { ...effect, selectableCardIds: currentTargets } };
    }
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'PAID_ENERGY_TARGET_NO_LONGER_AVAILABLE',
        paidEnergyCardIds: effect.metadata?.paidEnergyCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const targetMetadata = getStageMemberOrientationTargetMetadata(effect);
  const orientationChange = resolveStageMemberOrientationTargetSelection(
    game,
    effect,
    selectedCardId
  );
  if (!targetMetadata || !orientationChange) return game;
  const withTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, events) =>
        addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'PAY_ENERGY_ACTIVATE_STAGE_MEMBER',
          paidEnergyCardIds: effect.metadata?.paidEnergyCardIds,
          targetPlayerId: targetMetadata.targetPlayerId,
          targetCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: events.map((event) => event.eventId),
        }),
    }
  );
  return continuePendingCardEffects(
    withTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function getWaitingOwnStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER)).filter(
    (cardId) => player?.memberSlots.cardStates.get(cardId)?.orientation === OrientationState.WAITING
  );
}

function toPendingAbility(effect: ActiveEffectState): PendingAbilityState {
  return {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [],
  };
}
