import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { createHeartIcon } from '../../../../domain/entities/card.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, OrientationState } from '../../../../shared/types/enums.js';
import { N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID } from '../../ability-ids.js';
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
const ENERGY_COST_COUNT = 2;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNSd1010ShiorikoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID,
    (game, ability, options) =>
      startNSd1010ShiorikoLiveStartWorkflow(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID,
    N_SD1_010_LIVE_START_PAY_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishNSd1010ShiorikoPayEnergyWorkflow(game, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startNSd1010ShiorikoLiveStartWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  const canPay = activeEnergyCardIds.length >= ENERGY_COST_COUNT;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(
        N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID
      ),
      stepId: N_SD1_010_LIVE_START_PAY_ENERGY_STEP_ID,
      stepText: canPay
        ? '可以支付2张活跃能量，获得1个绿色Heart。'
        : '当前没有足够可支付的活跃能量，可以不发动。',
      awaitingPlayerId: player.id,
      selectableOptions: canPay
        ? [
            { id: 'pay', label: '支付2能量' },
            { id: 'decline', label: '不发动' },
          ]
        : [{ id: 'decline', label: '不发动' }],
      metadata: {
        orderedResolution,
        activeEnergyCardIds,
        energyCostCount: ENERGY_COST_COUNT,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_OPTION',
      activeEnergyCardIds,
      heartColor: HeartColor.GREEN,
      heartCount: 1,
    },
  });
}

function finishNSd1010ShiorikoPayEnergyWorkflow(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID ||
    effect.stepId !== N_SD1_010_LIVE_START_PAY_ENERGY_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: ENERGY_COST_COUNT },
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
      hearts: [createHeartIcon(HeartColor.GREEN, 1)],
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
      step: 'PAY_ENERGY_GAIN_GREEN_HEART',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      heartColor: HeartColor.GREEN,
      heartCount: 1,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getActiveEnergyCardIds(player: NonNullable<ReturnType<typeof getPlayerById>>): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}
