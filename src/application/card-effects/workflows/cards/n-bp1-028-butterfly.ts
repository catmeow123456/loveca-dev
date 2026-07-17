import {
  addAction,
  getCardById,
  getPlayerById,
  updateLiveResolution,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { isLiveCardData } from '../../../../domain/entities/card.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_N_BP1_028_LIVE_START_PAY_TWO_ENERGY_NIJIGASAKI_STAGE_THIS_LIVE_SCORE_ABILITY_ID } from '../../ability-ids.js';
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

export const N_BP1_028_PAY_TWO_ENERGY_STEP_ID = 'N_BP1_028_PAY_TWO_ENERGY';
const ENERGY_COST = 2;
const SCORE_BONUS = 1;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp1028ButterflyWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP1_028_LIVE_START_PAY_TWO_ENERGY_NIJIGASAKI_STAGE_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      startButterflyLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP1_028_LIVE_START_PAY_TWO_ENERGY_NIJIGASAKI_STAGE_THIS_LIVE_SCORE_ABILITY_ID,
    N_BP1_028_PAY_TWO_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishButterflyPayment(game, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startButterflyLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  if (!isOwnLiveCardInLiveZone(game, player.id, ability.sourceCardId)) {
    return consumePendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_NOT_IN_LIVE_ZONE_BEFORE_PAYMENT'
    );
  }

  const activeEnergyCardIds = getEnergySelectionCandidates(
    game,
    player.id,
    'TAP_ACTIVE_ENERGY'
  );
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
      stepId: N_BP1_028_PAY_TWO_ENERGY_STEP_ID,
      stepText: canPay
        ? '可以支付[E][E]；支付后检查自己的舞台上是否存在『虹咲』成员。'
        : '当前活跃能量不足，无法支付[E][E]，可以不发动。',
      awaitingPlayerId: player.id,
      selectableOptions: canPay ? [{ id: 'pay', label: '支付[E][E]' }] : [],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_TWO_ENERGY_OPTION',
      activeEnergyCardIds,
      canPay,
    },
  });
}

function finishButterflyPayment(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP1_028_LIVE_START_PAY_TWO_ENERGY_NIJIGASAKI_STAGE_THIS_LIVE_SCORE_ABILITY_ID ||
    effect.stepId !== N_BP1_028_PAY_TWO_ENERGY_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  if (!isOwnLiveCardInLiveZone(game, player.id, effect.sourceCardId)) {
    return finishActiveNoOp(
      game,
      player.id,
      continuePendingCardEffects,
      'SOURCE_NOT_IN_LIVE_ZONE_BEFORE_PAYMENT'
    );
  }

  const payment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: ENERGY_COST },
  ]);
  if (!payment) return game;
  let state = recordPayCostAction(payment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: payment.paidEnergyCardIds,
    amount: payment.paidEnergyCardIds.length,
  });

  const conditionMet =
    getStageMemberCardIdsMatching(
      state,
      player.id,
      and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'))
    ).length > 0;
  let scoreDelta = 0;
  if (conditionMet && isOwnLiveCardInLiveZone(state, player.id, effect.sourceCardId)) {
    const matchingModifiers = state.liveResolution.liveModifiers.filter(
      (modifier) =>
        modifier.kind === 'SCORE' &&
        modifier.playerId === player.id &&
        modifier.liveCardId === effect.sourceCardId &&
        modifier.sourceCardId === effect.sourceCardId &&
        modifier.abilityId === effect.abilityId
    );
    const existingBonus = matchingModifiers.reduce(
      (sum, modifier) => sum + (modifier.kind === 'SCORE' ? modifier.countDelta : 0),
      0
    );
    const replacement: Extract<LiveModifierState, { readonly kind: 'SCORE' }> = {
      kind: 'SCORE',
      playerId: player.id,
      countDelta: SCORE_BONUS,
      liveCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    };
    state = replaceLiveModifier(
      state,
      {
        kind: 'SCORE',
        playerId: player.id,
        liveCardId: effect.sourceCardId,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
      },
      replacement
    );
    scoreDelta = SCORE_BONUS - existingBonus;
    if (scoreDelta !== 0) {
      state = updateLiveResolution(state, (liveResolution) => {
        const playerScores = new Map(liveResolution.playerScores);
        playerScores.set(player.id, (playerScores.get(player.id) ?? 0) + scoreDelta);
        return { ...liveResolution, playerScores };
      });
    }
  }

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: conditionMet ? 'PAY_TWO_ENERGY_GAIN_THIS_LIVE_SCORE' : 'PAY_TWO_ENERGY_CONDITION_NOT_MET',
      paidEnergyCardIds: payment.paidEnergyCardIds,
      conditionMet,
      scoreBonus: scoreDelta,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function isOwnLiveCardInLiveZone(game: GameState, playerId: string, cardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  return (
    player?.liveZone.cardIds.includes(cardId) === true &&
    card?.ownerId === playerId &&
    isLiveCardData(card.data)
  );
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
