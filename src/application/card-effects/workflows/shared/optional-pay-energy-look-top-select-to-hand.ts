import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState, ZoneType } from '../../../../shared/types/enums.js';
import {
  SP_BP1_012_ON_ENTER_PAY_ENERGY_LOOK_TOP_THREE_SELECT_ONE_ABILITY_ID,
  SP_SD1_009_ON_ENTER_PAY_ONE_ENERGY_NINE_LOOK_TOP_FIVE_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  resolveLookTopSelectToHandSelection,
  startLookTopSelectToHandWorkflow,
  type LookTopSelectToHandWorkflowOptions,
} from './look-top-select-to-hand.js';

const PAY_OPTION_ID = 'pay';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface OptionalPayEnergyLookTopConfig {
  readonly abilityId: string;
  readonly paymentStepId: string;
  readonly selectStepId: string;
  readonly topCount: 3 | 5;
  readonly minEnergyCountAfterPayment?: number;
  readonly paymentStepText: string;
  readonly selectStepText: string;
  readonly startActionStep: string;
  readonly finishActionStep: string;
}

const CONFIGS: readonly OptionalPayEnergyLookTopConfig[] = [
  {
    abilityId: SP_BP1_012_ON_ENTER_PAY_ENERGY_LOOK_TOP_THREE_SELECT_ONE_ABILITY_ID,
    paymentStepId: 'SP_BP1_012_OPTIONAL_PAY_ENERGY',
    selectStepId: 'SP_BP1_012_SELECT_ONE_FROM_TOP_THREE',
    topCount: 3,
    paymentStepText: '可以支付[E]，检视自己卡组顶的3张卡。',
    selectStepText: '请选择1张检视到的卡加入手牌，其余卡片放置入休息室。',
    startActionStep: 'START_OPTIONAL_PAY_ENERGY',
    finishActionStep: 'SELECT_ONE_TO_HAND_REST_TO_WAITING_ROOM',
  },
  {
    abilityId: SP_SD1_009_ON_ENTER_PAY_ONE_ENERGY_NINE_LOOK_TOP_FIVE_ABILITY_ID,
    paymentStepId: 'SP_SD1_009_OPTIONAL_PAY_ENERGY',
    selectStepId: 'SP_SD1_009_SELECT_ONE_FROM_TOP_FIVE',
    topCount: 5,
    minEnergyCountAfterPayment: 9,
    paymentStepText: '可以支付[E]。支付后自己的能量大于等于9张时，检视自己卡组顶的5张卡。',
    selectStepText: '请选择1张检视到的卡加入手牌，其余卡片放置入休息室。',
    startActionStep: 'START_OPTIONAL_PAY_ENERGY_NINE_LOOK_TOP_FIVE',
    finishActionStep: 'SELECT_ONE_TO_HAND_REST_TO_WAITING_ROOM',
  },
];

export function registerOptionalPayEnergyLookTopSelectToHandWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startOptionalPayment(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      config.paymentStepId,
      (game, input, context) =>
        finishOptionalPayment(
          game,
          input.selectedOptionId ?? null,
          config,
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        )
    );
    registerActiveEffectStepHandler(config.abilityId, config.selectStepId, (game, input, context) =>
      resolveLookTopSelectToHandSelection(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        {
          continuePendingCardEffects: context.continuePendingCardEffects,
          enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
        }
      )
    );
  }
}

function startOptionalPayment(
  game: GameState,
  ability: PendingAbilityState,
  config: OptionalPayEnergyLookTopConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return continuePendingCardEffects(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      orderedResolution
    );
  }
  const canPay = countActiveEnergy(game, player.id) >= 1;
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: config.paymentStepId,
      stepText: canPay ? config.paymentStepText : '当前活跃能量不足，无法支付[E]，可以不发动。',
      awaitingPlayerId: player.id,
      selectableOptions: canPay ? [{ id: PAY_OPTION_ID, label: '支付[E]' }] : [],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: config.startActionStep,
    },
  });
}

function finishOptionalPayment(
  game: GameState,
  selectedOptionId: string | null,
  config: OptionalPayEnergyLookTopConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.paymentStepId) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (selectedOptionId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE',
        paidEnergyCardIds: [],
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  if (selectedOptionId !== PAY_OPTION_ID || countActiveEnergy(game, player.id) < 1) {
    return game;
  }

  const payment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!payment) {
    return game;
  }
  const stateAfterPayment = recordPayCostAction(payment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: payment.paidEnergyCardIds,
    amount: payment.paidEnergyCardIds.length,
  });
  const energyCountAfterPayment =
    getPlayerById(stateAfterPayment, player.id)?.energyZone.cardIds.length ?? 0;
  if (
    config.minEnergyCountAfterPayment !== undefined &&
    energyCountAfterPayment < config.minEnergyCountAfterPayment
  ) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterPayment, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'ENERGY_COUNT_CONDITION_NOT_MET',
        energyCount: energyCountAfterPayment,
        requiredEnergyCount: config.minEnergyCountAfterPayment,
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  const options: LookTopSelectToHandWorkflowOptions = {
    orderedResolution: effect.metadata?.orderedResolution === true,
    continuePendingCardEffects,
    enqueueTriggeredCardEffects,
  };
  return startLookTopSelectToHandWorkflow(
    { ...stateAfterPayment, activeEffect: null },
    abilityFromEffect(effect),
    createLookTopConfig(config, getAbilityEffectText(effect.abilityId)),
    options
  );
}

function createLookTopConfig(config: OptionalPayEnergyLookTopConfig, effectText: string) {
  return {
    effectText,
    topCount: config.topCount,
    selector: () => true,
    countRule: { exactCount: 1 } as const,
    revealSelectedBeforeHand: false,
    selectStepId: config.selectStepId,
    selectStepText: config.selectStepText,
    noTargetStepText: '没有检视到卡片，效果安全结束。',
    selectionLabel: '选择要加入手牌的卡',
    confirmSelectionLabel: '加入手牌',
    selectionRequiredWhenHasTargets: true,
    clampExactCountToInspectedCount: true,
    finishActionStep: config.finishActionStep,
    includeInspectedCardIdsInFinishAction: true,
    publicEffectSummaryContext: {
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND' as const,
      sourceActionLabel: '登场' as const,
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: config.topCount,
    },
  };
}

function countActiveEnergy(game: GameState, playerId: string): number {
  const player = getPlayerById(game, playerId);
  return (
    player?.energyZone.cardIds.filter(
      (cardId) => player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.ACTIVE
    ).length ?? 0
  );
}

function abilityFromEffect(effect: ActiveEffectState): PendingAbilityState {
  return {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    timingId: 'ON_ENTER_STAGE',
  } as PendingAbilityState;
}
