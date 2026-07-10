import { createHeartIcon } from '../../../../domain/entities/card.js';
import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, OrientationState } from '../../../../shared/types/enums.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { HS_BP2_009_ON_ENTER_PAY_ENERGY_LOWER_COST_MIRACRA_RELAY_GAIN_TWO_PINK_HEART_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';
import { evaluateRelayEnterLowerCostUnitCondition } from '../shared/relay-enter-lower-cost-unit.js';

const PAY_ENERGY_STEP_ID = 'HS_BP2_009_ON_ENTER_PAY_ENERGY';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp2009HimeWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP2_009_ON_ENTER_PAY_ENERGY_LOWER_COST_MIRACRA_RELAY_GAIN_TWO_PINK_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp2009HimeOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP2_009_ON_ENTER_PAY_ENERGY_LOWER_COST_MIRACRA_RELAY_GAIN_TWO_PINK_HEART_ABILITY_ID,
    PAY_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishHsBp2009PayEnergy(game, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startHsBp2009HimeOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || getSourceMemberSlot(game, ability.controllerId, ability.sourceCardId) === null) {
    return finishPendingNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_LEFT_STAGE'
    );
  }

  const activeEnergyCardIds = player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
  const canPay = activeEnergyCardIds.length >= 1;

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
        ? '可以支付1张活跃能量。支付后检查本次换手条件，满足时获得[桃ハート][桃ハート]。'
        : '当前没有可支付的活跃能量，可以不发动。',
      awaitingPlayerId: player.id,
      selectableOptions: canPay ? [{ id: 'pay', label: '支付1能量' }] : undefined,
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        relayReplacements: ability.metadata?.relayReplacements,
        activeEnergyCardIds,
        energyCostCount: 1,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_LOWER_COST_MIRACRA_RELAY_OPTION',
      activeEnergyCardIds,
    },
  });
}

function finishHsBp2009PayEnergy(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !==
      HS_BP2_009_ON_ENTER_PAY_ENERGY_LOWER_COST_MIRACRA_RELAY_GAIN_TWO_PINK_HEART_ABILITY_ID ||
    effect.stepId !== PAY_ENERGY_STEP_ID
  ) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return finishActiveEffect(game, continuePendingCardEffects, {
      step: 'PAY_ENERGY_UNAVAILABLE_NO_OP',
      paidEnergyCardIds: [],
      conditionMet: false,
      heartCount: 0,
    });
  }

  const stateAfterCost = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const sourceOnStage =
    getSourceMemberSlot(stateAfterCost, player.id, effect.sourceCardId) !== null;
  const condition = evaluateRelayEnterLowerCostUnitCondition(
    stateAfterCost,
    {
      sourceCardId: effect.sourceCardId,
      controllerId: player.id,
      relayReplacements: effect.metadata?.relayReplacements,
    },
    'Mira-Cra Park!'
  );

  let stateAfterModifier = stateAfterCost;
  let heartCount = 0;
  if (sourceOnStage && condition.conditionMet) {
    const modifierResult = addHeartLiveModifierForMember(
      { ...stateAfterCost, activeEffect: null },
      {
        playerId: player.id,
        memberCardId: effect.sourceCardId,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        hearts: [createHeartIcon(HeartColor.PINK, 2)],
      }
    );
    if (modifierResult) {
      stateAfterModifier = modifierResult.gameState;
      heartCount = 2;
    }
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...stateAfterModifier,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'PAY_ENERGY_CHECK_LOWER_COST_MIRACRA_RELAY_GAIN_TWO_PINK_HEART',
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
        sourceOnStage,
        conditionMet: sourceOnStage && condition.conditionMet,
        reason: sourceOnStage ? condition.reason : 'SOURCE_LEFT_STAGE',
        sourceEffectiveCost: condition.sourceEffectiveCost,
        relayReplacementCardIds: condition.relayReplacementCardIds,
        matchingRelayReplacementCardIds: condition.matchingRelayReplacementCardIds,
        capturedReplacementEffectiveCosts: condition.capturedReplacementEffectiveCosts,
        heartColor: HeartColor.PINK,
        heartCount,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  reason: string
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'ON_ENTER_PAY_ENERGY_NO_OP',
      reason,
    }),
    orderedResolution
  );
}

function finishActiveEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
