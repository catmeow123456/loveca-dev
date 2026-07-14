import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { selectDifferentStructuredUnitCardsWithGroup } from '../../../../shared/utils/card-identity.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { HS_BP5_017_LIVE_START_PAY_ENERGY_DIFFERENT_UNITS_THIS_LIVE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { finishSkippedActiveEffect, startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

export const HS_BP5_017_PAY_ENERGY_STEP_ID = 'HS_BP5_017_PAY_ENERGY';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const SCORE_BONUS = 1;

export function registerHsBp5017DreamBelieversWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP5_017_LIVE_START_PAY_ENERGY_DIFFERENT_UNITS_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp5017LiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP5_017_LIVE_START_PAY_ENERGY_DIFFERENT_UNITS_THIS_LIVE_SCORE_ABILITY_ID,
    HS_BP5_017_PAY_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishHsBp5017AfterPayment(game, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startHsBp5017LiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return consumePendingAbility(game, ability);
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(game, player.id);
  if (activeEnergyCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(consumePendingAbility(game, ability), 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_ACTIVE_ENERGY_DECLINE',
        activeEnergyCardIds,
        scoreBonus: 0,
      }),
      orderedResolution
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getHsBp5017DreamBelieversEffectText(game, player.id, ability.sourceCardId),
      stepId: HS_BP5_017_PAY_ENERGY_STEP_ID,
      stepText: '可以支付[E]发动此效果。',
      awaitingPlayerId: player.id,
      selectableOptions: [
        { id: 'pay', label: '支付[E]' },
        { id: 'decline', label: '不发动' },
      ],
      metadata: {
        orderedResolution,
        activeEnergyCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_OPTION',
      activeEnergyCardIds,
    },
  });
}

function finishHsBp5017AfterPayment(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_017_LIVE_START_PAY_ENERGY_DIFFERENT_UNITS_THIS_LIVE_SCORE_ABILITY_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return {
      ...game,
      activeEffect: null,
    };
  }

  const orderedResolution = effect.metadata?.orderedResolution === true;
  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return finishSkippedActiveEffect(game, continuePendingCardEffects);
  }

  const stateAfterCost = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const stateWithoutActiveEffect = {
    ...stateAfterCost,
    activeEffect: null,
  };
  const condition = getHsBp5017DreamBelieversCondition(
    stateWithoutActiveEffect,
    player.id,
    effect.sourceCardId
  );
  const stateAfterScore = condition.conditionMet
    ? addScoreModifierAndRefresh(stateWithoutActiveEffect, {
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        scoreBonus: SCORE_BONUS,
      })
    : stateWithoutActiveEffect;

  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: condition.conditionMet
        ? 'PAY_ENERGY_DIFFERENT_UNITS_THIS_LIVE_SCORE'
        : 'PAY_ENERGY_NO_DIFFERENT_UNITS',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      sourceInLiveZone: condition.sourceInLiveZone,
      matchingStageMemberCardIds: condition.matchingStageMembers.map((member) => member.cardId),
      matchingStageMemberUnitNames: condition.matchingStageMembers.map((member) => member.unitName),
      conditionMet: condition.conditionMet,
      scoreBonus: condition.conditionMet ? SCORE_BONUS : 0,
    }),
    orderedResolution
  );
}

function getHsBp5017DreamBelieversCondition(
  game: GameState,
  playerId: string,
  sourceCardId: string
): {
  readonly sourceInLiveZone: boolean;
  readonly matchingStageMembers: readonly {
    readonly cardId: string;
    readonly unitName: string;
  }[];
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return { sourceInLiveZone: false, matchingStageMembers: [], conditionMet: false };
  }

  const sourceInLiveZone = player.liveZone.cardIds.includes(sourceCardId);
  const matchingStageMembers = sourceInLiveZone
    ? selectDifferentStructuredUnitCardsWithGroup(
        getAllMemberCardIds(player.memberSlots),
        (cardId) => getCardById(game, cardId)?.data,
        { groupName: '蓮ノ空', minCount: 2 }
      ).map((match) => ({ cardId: match.item, unitName: match.unitName }))
    : [];

  return {
    sourceInLiveZone,
    matchingStageMembers,
    conditionMet: sourceInLiveZone && matchingStageMembers.length >= 2,
  };
}

function getHsBp5017DreamBelieversEffectText(
  game: GameState,
  playerId: string,
  sourceCardId: string
): string {
  const condition = getHsBp5017DreamBelieversCondition(game, playerId, sourceCardId);
  const sourceStatus = condition.sourceInLiveZone ? '来源LIVE在LIVE区' : '来源LIVE不在LIVE区';
  const conditionStatus = condition.conditionMet
    ? '满足条件，支付后此LIVE分数+1'
    : '未满足条件，支付后不增加分数';
  return `${getAbilityEffectText(
    HS_BP5_017_LIVE_START_PAY_ENERGY_DIFFERENT_UNITS_THIS_LIVE_SCORE_ABILITY_ID
  )}（${sourceStatus}，当前可匹配小队名各不相同成员 ${condition.matchingStageMembers.length}名，${conditionStatus}）`;
}

function addScoreModifierAndRefresh(
  game: GameState,
  options: {
    readonly playerId: string;
    readonly sourceCardId: string;
    readonly abilityId: string;
    readonly scoreBonus: number;
  }
): GameState {
  const modifier: Extract<LiveModifierState, { readonly kind: 'SCORE' }> = {
    kind: 'SCORE',
    playerId: options.playerId,
    countDelta: options.scoreBonus,
    liveCardId: options.sourceCardId,
    sourceCardId: options.sourceCardId,
    abilityId: options.abilityId,
  };
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(options.playerId, (playerScores.get(options.playerId) ?? 0) + options.scoreBonus);
  const stateWithModifier = addLiveModifier(game, modifier);
  return {
    ...stateWithModifier,
    liveResolution: {
      ...stateWithModifier.liveResolution,
      playerScores,
    },
  };
}

function consumePendingAbility(game: GameState, ability: PendingAbilityState): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
}

function getActiveEnergyCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}
