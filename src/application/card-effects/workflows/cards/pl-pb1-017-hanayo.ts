import { isMemberCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, getPlayerById, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { PL_PB1_017_ON_ENTER_WAIT_SELF_DRAW_DISCARD_UNLESS_PRINTEMPS_RELAY_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { type EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { enqueueMemberStateChangedTriggersFromOrientationResult, type EnqueueTriggeredCardEffectsForMemberStateChanged } from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { finishDrawThenDiscardCardsWorkflow, startDrawThenDiscardCardsWorkflow } from '../shared/draw-then-discard.js';

const WAIT_SELF_STEP_ID = 'PL_PB1_017_WAIT_SELF_COST';
const WAIT_SELF_OPTION_ID = 'WAIT_SOURCE';
const SELECT_DISCARD_STEP_ID = 'PL_PB1_017_SELECT_DISCARD_AFTER_DRAW';
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged & EnqueueTriggeredCardEffectsForEnterWaitingRoom;

export function registerPlPb1017HanayoWorkflowHandlers(deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects }): void {
  registerPendingAbilityStarterHandler(PL_PB1_017_ON_ENTER_WAIT_SELF_DRAW_DISCARD_UNLESS_PRINTEMPS_RELAY_ABILITY_ID, (game, ability, options, context) =>
    start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(PL_PB1_017_ON_ENTER_WAIT_SELF_DRAW_DISCARD_UNLESS_PRINTEMPS_RELAY_ABILITY_ID, WAIT_SELF_STEP_ID, (game, input, context) =>
    finishWaitSelf(game, input.selectedOptionId ?? null, context.continuePendingCardEffects, deps.enqueueTriggeredCardEffects)
  );
  registerActiveEffectStepHandler(PL_PB1_017_ON_ENTER_WAIT_SELF_DRAW_DISCARD_UNLESS_PRINTEMPS_RELAY_ABILITY_ID, SELECT_DISCARD_STEP_ID, (game, input, context) =>
    finishDiscard(game, input.selectedCardId ?? null, input.selectedCardIds, context.continuePendingCardEffects, deps.enqueueTriggeredCardEffects)
  );
}

function start(game: GameState, ability: PendingAbilityState, orderedResolution: boolean, continuePendingCardEffects: ContinuePendingCardEffects): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  const sourceOrientation = player?.memberSlots.cardStates.get(ability.sourceCardId)?.orientation;
  if (!player || sourceSlot === null || sourceOrientation !== OrientationState.ACTIVE) {
    return consume(game, ability, orderedResolution, continuePendingCardEffects, { step: 'SOURCE_NOT_ACTIVE_OWN_STAGE_MEMBER', sourceSlot, sourceOrientation: sourceOrientation ?? null });
  }
  return startPendingActiveEffect(game, {
    ability, playerId: player.id,
    activeEffect: {
      id: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId), stepId: WAIT_SELF_STEP_ID,
      stepText: '可以将此成员变为待机状态。', awaitingPlayerId: player.id,
      selectableOptions: [{ id: WAIT_SELF_OPTION_ID, label: '发动' }], canSkipSelection: true, skipSelectionLabel: '不发动',
      metadata: { orderedResolution, sourceSlot, relayReplacements: ability.metadata?.relayReplacements },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, sourceSlot, step: 'START_OPTIONAL_WAIT_SELF_COST' },
  });
}

function finishWaitSelf(game: GameState, selectedOptionId: string | null, continuePendingCardEffects: ContinuePendingCardEffects, enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== PL_PB1_017_ON_ENTER_WAIT_SELF_DRAW_DISCARD_UNLESS_PRINTEMPS_RELAY_ABILITY_ID || effect.stepId !== WAIT_SELF_STEP_ID) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (selectedOptionId === null) return continuePendingCardEffects(addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'DECLINE_WAIT_SELF_COST' }), orderedResolution);
  if (selectedOptionId !== WAIT_SELF_OPTION_ID || effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true) return game;
  const sourceSlot = getSourceMemberSlot(game, player.id, effect.sourceCardId);
  const sourceOrientation = player.memberSlots.cardStates.get(effect.sourceCardId)?.orientation;
  if (sourceSlot === null || sourceOrientation !== OrientationState.ACTIVE) return continuePendingCardEffects(addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'SOURCE_NOT_ACTIVE_OWN_STAGE_MEMBER_AFTER_SELECTION', sourceSlot, sourceOrientation: sourceOrientation ?? null }), orderedResolution);
  const orientationResult = setMemberOrientation(game, player.id, effect.sourceCardId, OrientationState.WAITING, { kind: 'CARD_EFFECT', playerId: player.id, sourceCardId: effect.sourceCardId, abilityId: effect.abilityId, pendingAbilityId: effect.id });
  if (!orientationResult || orientationResult.previousOrientation !== OrientationState.ACTIVE) return game;
  const afterCost = enqueueMemberStateChangedTriggersFromOrientationResult(game, orientationResult, enqueueTriggeredCardEffects, {
    prepareGameStateBeforeEnqueue: (state, result, events) => addAction(state, 'PAY_COST', player.id, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, sourceSlot, waitedMemberCardId: effect.sourceCardId, previousOrientation: result.previousOrientation, nextOrientation: result.nextOrientation, memberStateChangedEventIds: events.map((event) => event.eventId) }),
  });
  const memberStateChangedEventIds = afterCost.memberStateChangedEvents.map((event) => event.eventId);
  const relayReplacementCardIds = getRelayReplacementCardIds(effect.metadata?.relayReplacements);
  const relayedFromPrintemps = relayReplacementCardIds.some((cardId) => {
    const card = getCardById(afterCost.gameState, cardId);
    return card !== null && isMemberCardData(card.data) && unitAliasIs('Printemps')(card);
  });
  if (relayedFromPrintemps) {
    const drawResult = drawCardsForPlayer(afterCost.gameState, player.id, 1);
    const finalState = drawResult?.gameState ?? afterCost.gameState;
    return continuePendingCardEffects(addAction({ ...finalState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, sourceSlot, step: 'WAIT_SELF_DRAW_PRINTEMPS_RELAY', waitedMemberCardId: effect.sourceCardId, memberStateChangedEventIds, relayReplacementCardIds, relayedFromPrintemps: true, drawnCardIds: drawResult?.drawnCardIds ?? [], discardedCardIds: [] }), orderedResolution);
  }
  const started = startDrawThenDiscardCardsWorkflow(afterCost.gameState, {
    ability: { id: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, controllerId: player.id, sourceSlot, metadata: { relayReplacements: effect.metadata?.relayReplacements } },
    effectText: effect.effectText, drawCount: 1, discardCount: 1, stepId: SELECT_DISCARD_STEP_ID, orderedResolution,
    continuePendingCardEffects,
  });
  if (started.activeEffect?.id === effect.id && (started.activeEffect.selectableCardIds?.length ?? 0) === 0) {
    return continuePendingCardEffects(addAction({ ...started, activeEffect: null }, 'RESOLVE_ABILITY', player.id, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, sourceSlot, step: 'DRAWN_NO_HAND_TO_DISCARD', waitedMemberCardId: effect.sourceCardId, memberStateChangedEventIds, relayReplacementCardIds, relayedFromPrintemps: false, drawnCardIds: started.activeEffect.metadata?.drawnCardIds ?? [], discardedCardIds: [] }), orderedResolution);
  }
  return started.activeEffect ? { ...started, activeEffect: { ...started.activeEffect, metadata: { ...started.activeEffect.metadata, memberStateChangedEventIds, relayReplacementCardIds, relayedFromPrintemps: false } } } : started;
}

function finishDiscard(game: GameState, selectedCardId: string | null, selectedCardIds: readonly string[] | undefined, continuePendingCardEffects: ContinuePendingCardEffects, enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== PL_PB1_017_ON_ENTER_WAIT_SELF_DRAW_DISCARD_UNLESS_PRINTEMPS_RELAY_ABILITY_ID || effect.stepId !== SELECT_DISCARD_STEP_ID) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const selected = selectedCardIds && selectedCardIds.length > 0 ? selectedCardIds : selectedCardId ? [selectedCardId] : [];
  if (selected.length === 1 && effect.selectableCardIds?.includes(selected[0]) === true && !player.hand.cardIds.includes(selected[0])) {
    return continuePendingCardEffects(addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, sourceSlot: effect.metadata?.sourceSlot, step: 'STALE_TARGET', selectedDiscardCardId: selected[0], drawnCardIds: effect.metadata?.drawnCardIds ?? [], memberStateChangedEventIds: effect.metadata?.memberStateChangedEventIds ?? [], discardedCardIds: [] }), effect.metadata?.orderedResolution === true);
  }
  return finishDrawThenDiscardCardsWorkflow(game, selectedCardId, selectedCardIds, continuePendingCardEffects, enqueueTriggeredCardEffects);
}

function getRelayReplacementCardIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): string[] => entry && typeof entry === 'object' && typeof (entry as { cardId?: unknown }).cardId === 'string' ? [(entry as { cardId: string }).cardId] : []);
}

function consume(game: GameState, ability: PendingAbilityState, orderedResolution: boolean, continuePendingCardEffects: ContinuePendingCardEffects, payload: Readonly<Record<string, unknown>>): GameState {
  return continuePendingCardEffects(addAction({ ...game, pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id) }, 'RESOLVE_ABILITY', ability.controllerId, { pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, ...payload }), orderedResolution);
}
