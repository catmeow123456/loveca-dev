import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { SP_BP7_015_LIVE_START_PAY_ENERGY_THREE_CATCHU_DRAW_ONE_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const PAY_ENERGY_STEP_ID = 'SP_BP7_015_PAY_ENERGY_FOR_THREE_CATCHU_DRAW';
const PAY_OPTION_ID = 'pay';
const catchuMember = and(typeIs(CardType.MEMBER), unitAliasIs('CatChu!'));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp7015SumireWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP7_015_LIVE_START_PAY_ENERGY_THREE_CATCHU_DRAW_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    SP_BP7_015_LIVE_START_PAY_ENERGY_THREE_CATCHU_DRAW_ONE_ABILITY_ID,
    PAY_ENERGY_STEP_ID,
    (game, input, context) =>
      finish(game, input.selectedOptionId ?? null, context.continuePendingCardEffects)
  );
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const activeEnergyCardIds = getActiveEnergyCardIds(game, player.id);
  if (activeEnergyCardIds.length === 0) {
    return consume(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_ACTIVE_ENERGY_FOR_COST',
      paidEnergyCardIds: [],
      catchuMemberCount: getCatchuMemberCount(game, player.id),
      drawnCardIds: [],
    });
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: PAY_ENERGY_STEP_ID,
      stepText: '可以支付[E]；支付后若自己的舞台上存在3名『CatChu!』成员，则抽1张卡。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: PAY_OPTION_ID, label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_OPTIONAL_ENERGY_PAYMENT',
      activeEnergyCardIds,
    },
  });
}

function finish(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_BP7_015_LIVE_START_PAY_ENERGY_THREE_CATCHU_DRAW_ONE_ABILITY_ID ||
    effect.stepId !== PAY_ENERGY_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (selectedOptionId === null) {
    return resolve({ ...game, activeEffect: null }, effect, player.id, continuePendingCardEffects, {
      step: 'DECLINE_PAY_ENERGY',
      paidEnergyCardIds: [],
      catchuMemberCount: getCatchuMemberCount(game, player.id),
      drawnCardIds: [],
    });
  }
  if (
    selectedOptionId !== PAY_OPTION_ID ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }

  const payment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!payment) {
    return resolve({ ...game, activeEffect: null }, effect, player.id, continuePendingCardEffects, {
      step: 'ENERGY_PAYMENT_NO_LONGER_AVAILABLE',
      paidEnergyCardIds: [],
      catchuMemberCount: getCatchuMemberCount(game, player.id),
      drawnCardIds: [],
    });
  }

  const stateAfterCost = recordPayCostAction(payment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: payment.paidEnergyCardIds,
    amount: payment.paidEnergyCardIds.length,
  });
  const catchuMemberCount = getCatchuMemberCount(stateAfterCost, player.id);
  const conditionMet = catchuMemberCount >= 3;
  const drawResult = conditionMet ? drawCardsForPlayer(stateAfterCost, player.id, 1) : null;
  const state = drawResult?.gameState ?? stateAfterCost;
  const drawnCardIds = drawResult?.drawnCardIds ?? [];

  return resolve({ ...state, activeEffect: null }, effect, player.id, continuePendingCardEffects, {
    step: conditionMet ? 'PAY_ENERGY_THREE_CATCHU_DRAW_ONE' : 'PAY_ENERGY_CATCHU_CONDITION_NOT_MET',
    paidEnergyCardIds: payment.paidEnergyCardIds,
    catchuMemberCount,
    conditionMet,
    drawnCardIds,
  });
}

function getActiveEnergyCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return (
    player?.energyZone.cardIds.filter(
      (cardId) => player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.ACTIVE
    ) ?? []
  );
}

function getCatchuMemberCount(game: GameState, playerId: string): number {
  return getStageMemberCardIdsMatching(game, playerId, catchuMember).length;
}

function consume(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
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
      sourceSlot: ability.sourceSlot,
      ...payload,
    }),
    orderedResolution
  );
}

function resolve(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(game, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
