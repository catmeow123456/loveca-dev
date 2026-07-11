import { createHeartIcon } from '../../../../domain/entities/card.js';
import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, OrientationState } from '../../../../shared/types/enums.js';
import {
  HS_PR_029_LIVE_START_PAY_ENERGY_GAIN_PINK_HEART_ABILITY_ID,
  N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID,
  SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';

const N_SD1_010_LIVE_START_PAY_ENERGY_STEP_ID = 'N_SD1_010_LIVE_START_PAY_ENERGY';
const SP_BP4_012_LIVE_START_PAY_ENERGY_STEP_ID = 'SP_BP4_012_LIVE_START_PAY_ENERGY';
const HS_PR_029_LIVE_START_PAY_ENERGY_STEP_ID = 'HS_PR_029_LIVE_START_PAY_ENERGY';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface PayEnergyGainHeartWorkflowConfig {
  readonly abilityId: string;
  readonly stepId: string;
  readonly energyCostCount: number;
  readonly heartColor: HeartColor;
  readonly heartCount: number;
  readonly heartLabel: string;
}

const PAY_ENERGY_GAIN_HEART_WORKFLOWS: readonly PayEnergyGainHeartWorkflowConfig[] = [
  {
    abilityId: N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID,
    stepId: N_SD1_010_LIVE_START_PAY_ENERGY_STEP_ID,
    energyCostCount: 2,
    heartColor: HeartColor.GREEN,
    heartCount: 1,
    heartLabel: '绿色Heart',
  },
  {
    abilityId: SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID,
    stepId: SP_BP4_012_LIVE_START_PAY_ENERGY_STEP_ID,
    energyCostCount: 1,
    heartColor: HeartColor.RED,
    heartCount: 1,
    heartLabel: '红色Heart',
  },
  {
    abilityId: HS_PR_029_LIVE_START_PAY_ENERGY_GAIN_PINK_HEART_ABILITY_ID,
    stepId: HS_PR_029_LIVE_START_PAY_ENERGY_STEP_ID,
    energyCostCount: 1,
    heartColor: HeartColor.PINK,
    heartCount: 1,
    heartLabel: '[桃ハート]',
  },
];

export function registerPayEnergyGainHeartWorkflowHandlers(): void {
  for (const config of PAY_ENERGY_GAIN_HEART_WORKFLOWS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options) =>
      startPayEnergyGainHeartWorkflow(game, ability, config, options.orderedResolution === true)
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishPayEnergyGainHeartWorkflow(game, config, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
    );
  }
}

function startPayEnergyGainHeartWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  config: PayEnergyGainHeartWorkflowConfig,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  const canPay = activeEnergyCardIds.length >= config.energyCostCount;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: config.stepId,
      stepText: canPay
        ? `可以支付${config.energyCostCount}张活跃能量，获得${config.heartCount}个${config.heartLabel}。`
        : '当前没有足够可支付的活跃能量，可以不发动。',
      awaitingPlayerId: player.id,
      selectableOptions: canPay ? [{ id: 'pay', label: `支付${config.energyCostCount}[E]` }] : [],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        activeEnergyCardIds,
        energyCostCount: config.energyCostCount,
        heartColor: config.heartColor,
        heartCount: config.heartCount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_OPTION',
      activeEnergyCardIds,
      heartColor: config.heartColor,
      heartCount: config.heartCount,
    },
  });
}

function finishPayEnergyGainHeartWorkflow(
  game: GameState,
  config: PayEnergyGainHeartWorkflowConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.stepId) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const energyCostCount =
    typeof effect.metadata?.energyCostCount === 'number'
      ? effect.metadata.energyCostCount
      : config.energyCostCount;
  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: energyCostCount },
  ]);
  if (!costPayment) {
    return game;
  }

  const stateAfterCost = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const modifierResult = addHeartLiveModifierForMember(
    { ...stateAfterCost, activeEffect: null },
    {
      playerId: player.id,
      memberCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: [createHeartIcon(config.heartColor, config.heartCount)],
    }
  );
  if (!modifierResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(modifierResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_ENERGY_GAIN_HEART',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      heartColor: config.heartColor,
      heartCount: config.heartCount,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getActiveEnergyCardIds(player: NonNullable<ReturnType<typeof getPlayerById>>): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}
