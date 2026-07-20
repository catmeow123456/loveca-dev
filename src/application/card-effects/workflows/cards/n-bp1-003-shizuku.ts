import { createHeartIcon } from '../../../../domain/entities/card.js';
import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

export const N_BP1_003_PAY_ONE_ENERGY_STEP_ID = 'N_BP1_003_PAY_ONE_ENERGY';
export const N_BP1_003_CHOOSE_HEART_STEP_ID = 'N_BP1_003_CHOOSE_HEART';

const ENERGY_COST = 1;
const HEART_COLOR_OPTIONS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
] as const;

const HEART_OPTION_LABELS: Readonly<Record<(typeof HEART_COLOR_OPTIONS)[number], string>> = {
  [HeartColor.PINK]: '此成员获得[桃ハート]。',
  [HeartColor.RED]: '此成员获得[赤ハート]。',
  [HeartColor.YELLOW]: '此成员获得[黄ハート]。',
  [HeartColor.GREEN]: '此成员获得[緑ハート]。',
  [HeartColor.BLUE]: '此成员获得[青ハート]。',
  [HeartColor.PURPLE]: '此成员获得[紫ハート]。',
};

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp1003ShizukuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startShizukuLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
    N_BP1_003_PAY_ONE_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? payEnergyAndStartHeartSelection(game, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
    N_BP1_003_CHOOSE_HEART_STEP_ID,
    (game, input, context) =>
      finishHeartSelection(game, input.selectedOptionId ?? null, context.continuePendingCardEffects)
  );
}

function startShizukuLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  if (getSourceMemberSlot(game, player.id, ability.sourceCardId) === null) {
    return consumePendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_NOT_ON_STAGE_BEFORE_PAYMENT'
    );
  }

  const activeEnergyCardIds = getEnergySelectionCandidates(game, player.id, 'TAP_ACTIVE_ENERGY');
  const canPay = activeEnergyCardIds.length >= ENERGY_COST;
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: N_BP1_003_PAY_ONE_ENERGY_STEP_ID,
      stepText: canPay
        ? '可以支付[E]，然后选择获得的Heart颜色。'
        : '当前活跃能量不足，无法支付[E]，可以不发动。',
      awaitingPlayerId: player.id,
      selectableOptions: canPay ? [{ id: 'pay', label: '支付[E]' }] : [],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ONE_ENERGY_OPTION',
      activeEnergyCardIds,
      canPay,
    },
  });
}

function payEnergyAndStartHeartSelection(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID ||
    effect.stepId !== N_BP1_003_PAY_ONE_ENERGY_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  if (getSourceMemberSlot(game, player.id, effect.sourceCardId) === null) {
    return finishActiveNoOp(
      game,
      player.id,
      continuePendingCardEffects,
      'SOURCE_NOT_ON_STAGE_BEFORE_PAYMENT'
    );
  }

  const payment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: ENERGY_COST },
  ]);
  if (!payment) return game;
  const stateAfterPayment = recordPayCostAction(payment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: payment.paidEnergyCardIds,
    amount: payment.paidEnergyCardIds.length,
  });

  return addAction(
    {
      ...stateAfterPayment,
      activeEffect: {
        ...effect,
        stepId: N_BP1_003_CHOOSE_HEART_STEP_ID,
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
          options: HEART_COLOR_OPTIONS.map((color) => ({
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
          paidEnergyCardIds: payment.paidEnergyCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_ONE_ENERGY_CHOOSE_HEART',
      paidEnergyCardIds: payment.paidEnergyCardIds,
    }
  );
}

function finishHeartSelection(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID ||
    effect.stepId !== N_BP1_003_CHOOSE_HEART_STEP_ID ||
    !isNormalHeartColor(selectedOptionId)
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;

  const heartResult =
    getSourceMemberSlot(game, player.id, effect.sourceCardId) === null
      ? null
      : addHeartLiveModifierForMember(
          { ...game, activeEffect: null },
          {
            playerId: player.id,
            memberCardId: effect.sourceCardId,
            sourceCardId: effect.sourceCardId,
            abilityId: effect.abilityId,
            hearts: [createHeartIcon(selectedOptionId, 1)],
          }
        );
  const state = heartResult?.gameState ?? { ...game, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: heartResult ? 'GAIN_CHOSEN_HEART' : 'SOURCE_NOT_ON_STAGE_AFTER_PAYMENT',
      paidEnergyCardIds: effect.metadata?.paidEnergyCardIds,
      heartColor: heartResult ? selectedOptionId : null,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function isNormalHeartColor(value: string | null): value is (typeof HEART_COLOR_OPTIONS)[number] {
  return HEART_COLOR_OPTIONS.some((color) => color === value);
}

function finishActiveNoOp(
  game: GameState,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  reason: string
): GameState {
  const effect = game.activeEffect;
  if (!effect) return game;
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'NO_OP',
      reason,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  reason: string
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_OP',
        reason,
      }
    ),
    orderedResolution
  );
}
