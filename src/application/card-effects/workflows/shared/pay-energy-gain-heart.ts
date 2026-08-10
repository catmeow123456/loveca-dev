import { createHeartIcon } from '../../../../domain/entities/card.js';
import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForSourceMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  HS_PR_029_LIVE_START_PAY_ENERGY_GAIN_PINK_HEART_ABILITY_ID,
  N_BP7_016_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
  N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID,
  PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
  SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const N_SD1_010_LIVE_START_PAY_ENERGY_STEP_ID = 'N_SD1_010_LIVE_START_PAY_ENERGY';
const SP_BP4_012_LIVE_START_PAY_ENERGY_STEP_ID = 'SP_BP4_012_LIVE_START_PAY_ENERGY';
const HS_PR_029_LIVE_START_PAY_ENERGY_STEP_ID = 'HS_PR_029_LIVE_START_PAY_ENERGY';
const N_BP1_003_PAY_ONE_ENERGY_STEP_ID = 'N_BP1_003_PAY_ONE_ENERGY';
const N_BP1_003_CHOOSE_HEART_STEP_ID = 'N_BP1_003_CHOOSE_HEART';
const N_BP7_016_PAY_ONE_ENERGY_STEP_ID = 'N_BP7_016_PAY_ONE_ENERGY';
const N_BP7_016_CHOOSE_HEART_STEP_ID = 'N_BP7_016_CHOOSE_HEART';

const ORDINARY_HEART_COLORS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
] as const;

const HEART_OPTION_LABELS: Readonly<Record<(typeof ORDINARY_HEART_COLORS)[number], string>> = {
  [HeartColor.PINK]: '此成员获得[桃ハート]。',
  [HeartColor.RED]: '此成员获得[赤ハート]。',
  [HeartColor.YELLOW]: '此成员获得[黄ハート]。',
  [HeartColor.GREEN]: '此成员获得[緑ハート]。',
  [HeartColor.BLUE]: '此成员获得[青ハート]。',
  [HeartColor.PURPLE]: '此成员获得[紫ハート]。',
};

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface PayEnergyGainHeartWorkflowBaseConfig {
  readonly abilityId: string;
  readonly payStepId: string;
  readonly energyCostCount: number;
  readonly heartCount: number;
}

interface FixedHeartWorkflowConfig extends PayEnergyGainHeartWorkflowBaseConfig {
  readonly reward: {
    readonly kind: 'FIXED';
    readonly heartColor: HeartColor;
    readonly heartLabel: string;
  };
}

interface ChooseHeartWorkflowConfig extends PayEnergyGainHeartWorkflowBaseConfig {
  readonly reward: {
    readonly kind: 'CHOOSE_ORDINARY_COLOR';
    readonly chooseHeartStepId: string;
  };
}

type PayEnergyGainHeartWorkflowConfig = FixedHeartWorkflowConfig | ChooseHeartWorkflowConfig;

const PAY_ENERGY_GAIN_HEART_WORKFLOWS: readonly PayEnergyGainHeartWorkflowConfig[] = [
  {
    abilityId: N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID,
    payStepId: N_SD1_010_LIVE_START_PAY_ENERGY_STEP_ID,
    energyCostCount: 2,
    heartCount: 1,
    reward: { kind: 'FIXED', heartColor: HeartColor.GREEN, heartLabel: '绿色Heart' },
  },
  {
    abilityId: SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID,
    payStepId: SP_BP4_012_LIVE_START_PAY_ENERGY_STEP_ID,
    energyCostCount: 1,
    heartCount: 1,
    reward: { kind: 'FIXED', heartColor: HeartColor.RED, heartLabel: '红色Heart' },
  },
  {
    abilityId: HS_PR_029_LIVE_START_PAY_ENERGY_GAIN_PINK_HEART_ABILITY_ID,
    payStepId: HS_PR_029_LIVE_START_PAY_ENERGY_STEP_ID,
    energyCostCount: 1,
    heartCount: 1,
    reward: { kind: 'FIXED', heartColor: HeartColor.PINK, heartLabel: '[桃ハート]' },
  },
  {
    abilityId: PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
    payStepId: N_BP1_003_PAY_ONE_ENERGY_STEP_ID,
    energyCostCount: 1,
    heartCount: 1,
    reward: { kind: 'CHOOSE_ORDINARY_COLOR', chooseHeartStepId: N_BP1_003_CHOOSE_HEART_STEP_ID },
  },
  {
    abilityId: N_BP7_016_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
    payStepId: N_BP7_016_PAY_ONE_ENERGY_STEP_ID,
    energyCostCount: 1,
    heartCount: 1,
    reward: { kind: 'CHOOSE_ORDINARY_COLOR', chooseHeartStepId: N_BP7_016_CHOOSE_HEART_STEP_ID },
  },
];

export function registerPayEnergyGainHeartWorkflowHandlers(): void {
  for (const config of PAY_ENERGY_GAIN_HEART_WORKFLOWS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options) =>
      startPayEnergyGainHeartWorkflow(game, ability, config, options.orderedResolution === true)
    );
    registerActiveEffectStepHandler(config.abilityId, config.payStepId, (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? payEnergyForHeartWorkflow(game, config, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
    );
    if (isChooseHeartWorkflowConfig(config)) {
      const chooseHeartConfig = config;
      registerActiveEffectStepHandler(
        chooseHeartConfig.abilityId,
        chooseHeartConfig.reward.chooseHeartStepId,
        (game, input, context) =>
          finishChosenHeartWorkflow(
            game,
            chooseHeartConfig,
            input.selectedOptionId ?? null,
            context.continuePendingCardEffects
          )
      );
    }
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

  const activeEnergyCardIds = getEnergySelectionCandidates(game, player.id, 'TAP_ACTIVE_ENERGY');
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
      stepId: config.payStepId,
      stepText: canPay
        ? getPayStepText(config)
        : `当前活跃能量不足，无法支付${'[E]'.repeat(config.energyCostCount)}，可以不发动。`,
      awaitingPlayerId: player.id,
      selectableOptions: canPay
        ? [{ id: 'pay', label: `支付${'[E]'.repeat(config.energyCostCount)}` }]
        : [],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        activeEnergyCardIds,
        energyCostCount: config.energyCostCount,
        heartCount: config.heartCount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_OPTION',
      activeEnergyCardIds,
      heartCount: config.heartCount,
      rewardKind: config.reward.kind,
    },
  });
}

function payEnergyForHeartWorkflow(
  game: GameState,
  config: PayEnergyGainHeartWorkflowConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.payStepId) {
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
  if (config.reward.kind === 'CHOOSE_ORDINARY_COLOR') {
    return {
      ...stateAfterCost,
      activeEffect: {
        ...effect,
        stepId: config.reward.chooseHeartStepId,
        stepText: '请选择本次LIVE结束前获得的Heart颜色。',
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectableCardMode: undefined,
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectionLabel: '选择要获得的Heart颜色',
        confirmSelectionLabel: undefined,
        selectableOptions: undefined,
        effectChoice: {
          mode: 'SINGLE',
          options: ORDINARY_HEART_COLORS.map((color) => ({
            id: color,
            text: HEART_OPTION_LABELS[color],
          })),
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true,
        },
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          orderedResolution: effect.metadata?.orderedResolution === true,
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
          heartCount: config.heartCount,
        },
      },
    };
  }

  const modifierResult =
    getSourceMemberSlot(stateAfterCost, player.id, effect.sourceCardId) === null
      ? null
      : addHeartLiveModifierForSourceMember(
          { ...stateAfterCost, activeEffect: null },
          {
            playerId: player.id,
            sourceCardId: effect.sourceCardId,
            abilityId: effect.abilityId,
            hearts: [createHeartIcon(config.reward.heartColor, config.heartCount)],
          }
        );
  if (!modifierResult) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SOURCE_NOT_ON_STAGE_AFTER_PAYMENT',
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
        heartColor: null,
        heartCount: config.heartCount,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return continuePendingCardEffects(
    addAction(modifierResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_ENERGY_GAIN_HEART',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      heartColor: config.reward.heartColor,
      heartCount: config.heartCount,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishChosenHeartWorkflow(
  game: GameState,
  config: ChooseHeartWorkflowConfig,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== config.reward.chooseHeartStepId ||
    !isOrdinaryHeartColor(selectedOptionId)
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const modifierResult =
    getSourceMemberSlot(game, player.id, effect.sourceCardId) === null
      ? null
      : addHeartLiveModifierForSourceMember(
          { ...game, activeEffect: null },
          {
            playerId: player.id,
            sourceCardId: effect.sourceCardId,
            abilityId: effect.abilityId,
            hearts: [createHeartIcon(selectedOptionId, config.heartCount)],
          }
        );
  const state = modifierResult?.gameState ?? { ...game, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: modifierResult ? 'GAIN_CHOSEN_HEART' : 'SOURCE_NOT_ON_STAGE_AFTER_PAYMENT',
      paidEnergyCardIds: effect.metadata?.paidEnergyCardIds,
      heartColor: modifierResult ? selectedOptionId : null,
      heartCount: config.heartCount,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getPayStepText(config: PayEnergyGainHeartWorkflowConfig): string {
  const paymentText = `支付${'[E]'.repeat(config.energyCostCount)}`;
  if (config.reward.kind === 'CHOOSE_ORDINARY_COLOR') {
    return `可以${paymentText}，然后选择获得的Heart颜色。`;
  }
  return `可以${paymentText}，获得${config.heartCount}个${config.reward.heartLabel}。`;
}

function isOrdinaryHeartColor(
  value: string | null
): value is (typeof ORDINARY_HEART_COLORS)[number] {
  return ORDINARY_HEART_COLORS.some((color) => color === value);
}

function isChooseHeartWorkflowConfig(
  config: PayEnergyGainHeartWorkflowConfig
): config is ChooseHeartWorkflowConfig {
  return config.reward.kind === 'CHOOSE_ORDINARY_COLOR';
}
