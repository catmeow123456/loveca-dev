import { isMemberCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, getOpponent, getPlayerById, type GameState } from '../../../../domain/entities/game.js';
import { collectLiveModifiers, getMemberOriginalBladeCount } from '../../../../domain/rules/live-modifiers.js';
import { CardType, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { stackEnergyFromEnergyZoneBelowMember } from '../../../effects/energy-below.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { N_BP7_004_ACTIVATED_STACK_ENERGY_BELOW_WAIT_ORIGINAL_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { enqueueMemberStateChangedTriggersFromOrientationResult, type EnqueueTriggeredCardEffectsForMemberStateChanged } from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordAbilityUseForContext, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const SELECT_TARGET_STEP_ID = 'N_BP7_004_SELECT_WAIT_TARGET';

export function registerNBp7004KarinWorkflowHandlers(deps: {
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerActivatedAbilityHandler(
    N_BP7_004_ACTIVATED_STACK_ENERGY_BELOW_WAIT_ORIGINAL_BLADE_ABILITY_ID,
    (game, playerId, cardId) => start(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(
    N_BP7_004_ACTIVATED_STACK_ENERGY_BELOW_WAIT_ORIGINAL_BLADE_ABILITY_ID,
    SELECT_TARGET_STEP_ID,
    (game, input) => finish(game, input.selectedCardId ?? null, deps.enqueueTriggeredCardEffects)
  );
}

function start(game: GameState, playerId: string, sourceCardId: string): GameState {
  const player = getPlayerById(game, playerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const source = getCardById(game, sourceCardId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, sourceCardId) : null;
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  if (
    game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE || activePlayerId !== playerId ||
    !player || !opponent || !source || source.ownerId !== playerId ||
    !isMemberCardData(source.data) || source.data.cardCode !== 'PL!N-bp7-004-P' ||
    sourceSlot === null || player.energyZone.cardIds.length === 0
  ) return game;

  const predictedThreshold = (player.memberSlots.energyBelow[sourceSlot] ?? []).length + 2;
  if (getTargets(game, opponent.id, predictedThreshold).length === 0) return game;

  const stacked = stackEnergyFromEnergyZoneBelowMember(game, player.id, sourceSlot, 1);
  if (!stacked || stacked.stackedEnergyCardIds.length !== 1) return game;
  let state = recordPayCostAction(stacked.gameState, player.id, {
    abilityId: N_BP7_004_ACTIVATED_STACK_ENERGY_BELOW_WAIT_ORIGINAL_BLADE_ABILITY_ID,
    sourceCardId, sourceSlot, costType: 'STACK_ENERGY_BELOW',
    stackedEnergyCardIds: stacked.stackedEnergyCardIds,
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: N_BP7_004_ACTIVATED_STACK_ENERGY_BELOW_WAIT_ORIGINAL_BLADE_ABILITY_ID,
    sourceCardId,
  });
  const threshold = (getPlayerById(state, player.id)?.memberSlots.energyBelow[sourceSlot] ?? []).length + 1;
  const targets = getTargets(state, opponent.id, threshold);
  if (targets.length === 0) return addResolve(state, player.id, sourceCardId, sourceSlot, threshold, stacked.stackedEnergyCardIds, null, []);
  return {
    ...state,
    activeEffect: {
      id: `${N_BP7_004_ACTIVATED_STACK_ENERGY_BELOW_WAIT_ORIGINAL_BLADE_ABILITY_ID}:${sourceCardId}:target:${state.actionHistory.length}`,
      abilityId: N_BP7_004_ACTIVATED_STACK_ENERGY_BELOW_WAIT_ORIGINAL_BLADE_ABILITY_ID,
      sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(N_BP7_004_ACTIVATED_STACK_ENERGY_BELOW_WAIT_ORIGINAL_BLADE_ABILITY_ID),
      stepId: SELECT_TARGET_STEP_ID,
      stepText: '请选择对方舞台上符合条件的成员变为待机状态。',
      awaitingPlayerId: player.id,
      selectableCardIds: targets,
      selectionLabel: '选择要变为待机状态的成员',
      confirmSelectionLabel: '变为待机状态',
      canSkipSelection: false,
      metadata: { sourceSlot, threshold, stackedEnergyCardIds: stacked.stackedEnergyCardIds },
    },
  };
}

function finish(game: GameState, targetCardId: string | null, enqueue: EnqueueTriggeredCardEffectsForMemberStateChanged): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== SELECT_TARGET_STEP_ID || !targetCardId || effect.selectableCardIds?.includes(targetCardId) !== true) return game;
  const opponent = getOpponent(game, effect.controllerId);
  const threshold = typeof effect.metadata?.threshold === 'number' ? effect.metadata.threshold : -1;
  if (!opponent || !getTargets(game, opponent.id, threshold).includes(targetCardId)) {
    return addResolve({ ...game, activeEffect: null }, effect.controllerId, effect.sourceCardId,
      effect.metadata?.sourceSlot ?? null, threshold, stringArray(effect.metadata?.stackedEnergyCardIds), null, []);
  }
  const orientation = setMemberOrientation(game, opponent.id, targetCardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT', playerId: effect.controllerId, sourceCardId: effect.sourceCardId, abilityId: effect.abilityId,
  });
  if (!orientation) {
    return addResolve({ ...game, activeEffect: null }, effect.controllerId, effect.sourceCardId,
      effect.metadata?.sourceSlot ?? null, threshold, stringArray(effect.metadata?.stackedEnergyCardIds), null, []);
  }
  const wrapped = enqueueMemberStateChangedTriggersFromOrientationResult(game, orientation, enqueue);
  return addResolve({ ...wrapped.gameState, activeEffect: null }, effect.controllerId, effect.sourceCardId,
    effect.metadata?.sourceSlot ?? null, threshold, stringArray(effect.metadata?.stackedEnergyCardIds), targetCardId, wrapped.memberStateChangedEvents.map((event) => event.eventId));
}

function getTargets(game: GameState, opponentId: string, threshold: number): readonly string[] {
  const opponent = getPlayerById(game, opponentId);
  const modifiers = collectLiveModifiers(game);
  return getStageMemberCardIdsMatching(game, opponentId, typeIs(CardType.MEMBER)).filter((cardId) =>
    opponent?.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.WAITING &&
    getMemberOriginalBladeCount(game, opponentId, cardId, modifiers) <= threshold
  );
}

function addResolve(game: GameState, playerId: string, sourceCardId: string, sourceSlot: unknown, threshold: number,
  stackedEnergyCardIds: readonly string[], targetMemberCardId: string | null, memberStateChangedEventIds: readonly string[]): GameState {
  return addAction(game, 'RESOLVE_ABILITY', playerId, {
    abilityId: N_BP7_004_ACTIVATED_STACK_ENERGY_BELOW_WAIT_ORIGINAL_BLADE_ABILITY_ID,
    sourceCardId, sourceSlot, step: targetMemberCardId ? 'WAIT_ORIGINAL_BLADE_TARGET' : 'NO_VALID_TARGET_AFTER_COST',
    threshold, stackedEnergyCardIds, targetMemberCardId, memberStateChangedEventIds,
  });
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
