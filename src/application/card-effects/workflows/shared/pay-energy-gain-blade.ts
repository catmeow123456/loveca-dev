import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import {
  BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
  HS_SD1_006_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  S_PR_013_LIVE_START_PAY_TWO_ENERGY_GAIN_TWO_BLADE_ABILITY_ID,
  SP_PB2_040_LIVE_START_PAY_ENERGY_GAIN_TWO_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';

const DECLINE_OPTION_LABEL = '不发动';
const HS_SD1_006_LIVE_START_PAY_ENERGY_STEP_ID = 'HS_SD1_006_LIVE_START_PAY_ENERGY';
const BP4_010_LIVE_START_PAY_ENERGY_STEP_ID = 'BP4_010_LIVE_START_PAY_ENERGY';
const HS_PR_001_LIVE_START_PAY_ENERGY_STEP_ID = 'HS_PR_001_LIVE_START_PAY_ENERGY';
const S_PR_013_LIVE_START_PAY_ENERGY_STEP_ID = 'S_PR_013_LIVE_START_PAY_ENERGY';
const HS_BP1_004_LIVE_START_PAY_ENERGY_STEP_ID = 'HS_BP1_004_LIVE_START_PAY_ENERGY';
const SP_PB2_040_LIVE_START_PAY_ENERGY_STEP_ID = 'SP_PB2_040_LIVE_START_PAY_ENERGY';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface PayEnergyGainBladeWorkflowConfig {
  readonly abilityId: string;
  readonly stepId: string;
  readonly energyCostCount: number;
  readonly bladeBonusSource:
    | { readonly kind: 'FIXED'; readonly amount: number }
    | { readonly kind: 'LIVE_ZONE_CARD_COUNT' };
}

const PAY_ENERGY_GAIN_BLADE_WORKFLOWS: readonly PayEnergyGainBladeWorkflowConfig[] = [
  {
    abilityId: HS_SD1_006_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
    stepId: HS_SD1_006_LIVE_START_PAY_ENERGY_STEP_ID,
    energyCostCount: 1,
    bladeBonusSource: { kind: 'FIXED', amount: 2 },
  },
  {
    abilityId: BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
    stepId: BP4_010_LIVE_START_PAY_ENERGY_STEP_ID,
    energyCostCount: 1,
    bladeBonusSource: { kind: 'FIXED', amount: 2 },
  },
  {
    abilityId: HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
    stepId: HS_PR_001_LIVE_START_PAY_ENERGY_STEP_ID,
    energyCostCount: 2,
    bladeBonusSource: { kind: 'FIXED', amount: 1 },
  },
  {
    abilityId: S_PR_013_LIVE_START_PAY_TWO_ENERGY_GAIN_TWO_BLADE_ABILITY_ID,
    stepId: S_PR_013_LIVE_START_PAY_ENERGY_STEP_ID,
    energyCostCount: 2,
    bladeBonusSource: { kind: 'FIXED', amount: 2 },
  },
  {
    abilityId: HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
    stepId: HS_BP1_004_LIVE_START_PAY_ENERGY_STEP_ID,
    energyCostCount: 1,
    bladeBonusSource: { kind: 'LIVE_ZONE_CARD_COUNT' },
  },
  {
    abilityId: SP_PB2_040_LIVE_START_PAY_ENERGY_GAIN_TWO_BLADE_ABILITY_ID,
    stepId: SP_PB2_040_LIVE_START_PAY_ENERGY_STEP_ID,
    energyCostCount: 1,
    bladeBonusSource: { kind: 'FIXED', amount: 2 },
  },
];

export function registerPayEnergyGainBladeWorkflowHandlers(): void {
  for (const config of PAY_ENERGY_GAIN_BLADE_WORKFLOWS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options) =>
      startPayEnergyGainBladeWorkflow(game, ability, config, options.orderedResolution === true)
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishPayEnergyGainBladeWorkflow(game, config, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
    );
  }
}

function startPayEnergyGainBladeWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  config: PayEnergyGainBladeWorkflowConfig,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  const canPay = activeEnergyCardIds.length >= config.energyCostCount;
  const liveZoneCardCount = player.liveZone.cardIds.length;
  const startBladeBonus = getStartBladeBonus(config, player);

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
        ? `可以支付${config.energyCostCount}张活跃能量，获得${startBladeBonus}个BLADE。`
        : '当前没有可支付的活跃能量，可以不发动。',
      awaitingPlayerId: player.id,
      selectableOptions: canPay
        ? [
            { id: 'pay', label: `支付${config.energyCostCount}能量` },
            { id: 'decline', label: DECLINE_OPTION_LABEL },
          ]
        : [{ id: 'decline', label: DECLINE_OPTION_LABEL }],
      metadata: {
        orderedResolution,
        activeEnergyCardIds,
        energyCostCount: config.energyCostCount,
        ...getBladeBonusMetadata(config, startBladeBonus, liveZoneCardCount),
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_OPTION',
      activeEnergyCardIds,
      ...getStartActionPayload(config, startBladeBonus, liveZoneCardCount),
    },
  });
}

function finishPayEnergyGainBladeWorkflow(
  game: GameState,
  config: PayEnergyGainBladeWorkflowConfig,
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

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    {
      kind: 'TAP_ACTIVE_ENERGY',
      count:
        typeof effect.metadata?.energyCostCount === 'number' ? effect.metadata.energyCostCount : 1,
    },
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
  const bladeBonus = getResolvedBladeBonus(costPayment.gameState, player.id, effect, config);
  let stateAfterModifier = stateAfterCost;
  if (bladeBonus > 0) {
    const bladeResult = addBladeLiveModifierForSourceMember(stateAfterCost, {
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      amount: bladeBonus,
    });
    if (!bladeResult) {
      return game;
    }
    stateAfterModifier = bladeResult.gameState;
  }

  const state = { ...stateAfterModifier, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_ENERGY_GAIN_BLADE',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      bladeBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getActiveEnergyCardIds(player: NonNullable<ReturnType<typeof getPlayerById>>): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function getStartBladeBonus(
  config: PayEnergyGainBladeWorkflowConfig,
  player: NonNullable<ReturnType<typeof getPlayerById>>
): number {
  return config.bladeBonusSource.kind === 'FIXED'
    ? config.bladeBonusSource.amount
    : player.liveZone.cardIds.length;
}

function getResolvedBladeBonus(
  game: GameState,
  playerId: string,
  effect: NonNullable<GameState['activeEffect']>,
  config: PayEnergyGainBladeWorkflowConfig
): number {
  if (config.bladeBonusSource.kind === 'FIXED') {
    return typeof effect.metadata?.bladeBonus === 'number'
      ? effect.metadata.bladeBonus
      : config.bladeBonusSource.amount;
  }

  return getPlayerById(game, playerId)?.liveZone.cardIds.length ?? 0;
}

function getBladeBonusMetadata(
  config: PayEnergyGainBladeWorkflowConfig,
  startBladeBonus: number,
  liveZoneCardCount: number
): Readonly<Record<string, number>> {
  return config.bladeBonusSource.kind === 'FIXED'
    ? { bladeBonus: startBladeBonus }
    : { liveZoneCardCount };
}

function getStartActionPayload(
  config: PayEnergyGainBladeWorkflowConfig,
  startBladeBonus: number,
  liveZoneCardCount: number
): Readonly<Record<string, number>> {
  return config.bladeBonusSource.kind === 'FIXED'
    ? { bladeBonus: startBladeBonus }
    : { liveZoneCardCount };
}
