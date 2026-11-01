import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { GamePhase, ZoneType } from '../../../../shared/types/enums.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  EnergySelectionRequiredError,
  getEnergySelectionCandidates,
} from '../../../effects/energy-selection.js';
import { PL_BP8_009_ACTIVATED_PAY_TWO_ENERGY_STACK_HAND_MEMBER_BELOW_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { getAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { stackMemberCardBelowStageMember } from '../../runtime/actions.js';
import { createActiveEffectEnergySelectionWindow } from '../../runtime/energy-operation-selection.js';
import { isDirectOrGrantedActivatedAbilitySource } from '../../runtime/granted-member-below-abilities.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import {
  getSourceMemberSlot,
  isCurrentStageMemberAbilitySource,
} from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const PAY_STEP = 'PL_BP8_009_PAY_TWO_ENERGY';
const SELECT_STEP = 'PL_BP8_009_SELECT_HAND_MEMBER_BELOW';
type Continue = (game: GameState, ordered: boolean) => GameState;

export function registerPlBp8009NicoWorkflowHandlers(): void {
  registerActivatedAbilityHandler(ABILITY_ID, start, canStart);
  registerActiveEffectStepHandler(ABILITY_ID, PAY_STEP, (game, _input, runtime) => {
    const result = payAndSelect(game);
    return result.activeEffect ? result : runtime.continuePendingCardEffects(result, false);
  });
  registerActiveEffectStepHandler(
    ABILITY_ID,
    SELECT_STEP,
    (game, input, runtime) =>
      finishSelection(game, input.selectedCardId ?? null, runtime.continuePendingCardEffects),
    queryCardSelection
  );
}

function canStart(game: GameState, playerId: string, sourceCardId: string): boolean {
  const source = getCardById(game, sourceCardId);
  return (
    !game.activeEffect &&
    game.currentPhase === GamePhase.MAIN_PHASE &&
    game.players[game.activePlayerIndex]?.id === playerId &&
    source?.ownerId === playerId &&
    isMemberCardData(source.data) &&
    getSourceMemberSlot(game, playerId, sourceCardId) !== null &&
    isDirectOrGrantedActivatedAbilitySource(game, playerId, sourceCardId, ABILITY_ID, [
      'PL!-bp8-009',
    ]) &&
    getEnergySelectionCandidates(game, playerId, 'TAP_ACTIVE_ENERGY').length >= 2
  );
}

function start(game: GameState, playerId: string, sourceCardId: string): GameState {
  if (!canStart(game, playerId, sourceCardId)) return game;
  const invocation: ActiveEffectState = {
    id: `${ABILITY_ID}:${sourceCardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
    abilityId: ABILITY_ID,
    sourceCardId,
    sourceLifecycleId: getAbilitySourceLifecycleId(game, ABILITY_ID, sourceCardId),
    controllerId: playerId,
    awaitingPlayerId: playerId,
    effectText: getAbilityEffectText(ABILITY_ID),
    stepId: PAY_STEP,
    stepText: '支付[E][E]。',
  };
  const started = { ...game, activeEffect: invocation };
  try {
    return payAndSelect(started);
  } catch (error) {
    if (!(error instanceof EnergySelectionRequiredError)) throw error;
    // Resume this captured invocation, without re-running current-source start gates.
    return createActiveEffectEnergySelectionWindow(started, invocation, {}, error);
  }
}

function payAndSelect(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== PAY_STEP) return game;
  const payment = payImmediateEffectCosts(game, effect.controllerId, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!payment) return game;
  let state = recordPayCostAction(payment.gameState, effect.controllerId, {
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
    energyCardIds: payment.paidEnergyCardIds,
    amount: 2,
  });
  state = recordAbilityUseForContext(state, effect.controllerId, {
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
    sourceLifecycleId: effect.sourceLifecycleId,
    abilityInstanceId: effect.abilityInstanceId,
  });
  const ids = getHandMembers(state, effect.controllerId);
  if (!isCurrentStageMemberAbilitySource(state, effect) || ids.length === 0) {
    return finish(state, effect, 'NO_MEMBER_STACKED');
  }
  return {
    ...state,
    activeEffect: {
      ...effect,
      stepId: SELECT_STEP,
      stepText: '可以从自己的手牌将1张成员卡放置于此成员下方。',
      selectableCardIds: ids,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 0,
      maxSelectableCards: 1,
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      selectionLabel: '选择要放置于此成员下方的成员卡',
      confirmSelectionLabel: '放置于此成员下方',
    },
  };
}

function finishSelection(game: GameState, cardId: string | null, next: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_STEP) return game;
  if (cardId === null || !isCurrentStageMemberAbilitySource(game, effect)) {
    return next(finish(game, effect, 'NO_MEMBER_STACKED'), false);
  }
  const ids = getHandMembers(game, effect.controllerId);
  if (!ids.includes(cardId) || !effect.selectableCardIds?.includes(cardId)) return game;
  const result = stackMemberCardBelowStageMember(game, {
    playerId: effect.controllerId,
    sourceZone: ZoneType.HAND,
    movedCardId: cardId,
    hostCardId: effect.sourceCardId,
    targetSlot: getSourceMemberSlot(game, effect.controllerId, effect.sourceCardId)!,
  });
  return result
    ? next(finish(result.gameState, effect, 'STACK_HAND_MEMBER_BELOW', cardId), false)
    : game;
}

function getHandMembers(game: GameState, playerId: string): string[] {
  return (getPlayerById(game, playerId)?.hand.cardIds ?? []).filter((id) => {
    const card = getCardById(game, id);
    return card?.ownerId === playerId && isMemberCardData(card.data);
  });
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  step: string,
  stackedCardId?: string
): GameState {
  return addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
    step,
    stackedCardIds: stackedCardId ? [stackedCardId] : [],
  });
}
