import { isMemberCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, getOpponent, getPlayerById, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { OrientationState, ZoneType } from '../../../../shared/types/enums.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsByOrientation } from '../../../effects/stage-targets.js';
import { PL_PR_001_002_ON_LEAVE_STAGE_ACTIVATE_MEMBER_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { enqueueMemberStateChangedTriggersFromOrientationResult, type EnqueueTriggeredCardEffectsForMemberStateChanged } from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const STEP_ID = 'PL_PR_001_002_SELECT_STAGE_MEMBER_TO_ACTIVE';
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerOnLeaveActivateStageMemberWorkflowHandlers(deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged }): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) => start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects));
  registerActiveEffectStepHandler(ABILITY_ID, STEP_ID, (game, input, context) => finish(game, input.selectedCardId, deps.enqueueTriggeredCardEffects, context.continuePendingCardEffects));
}

function targets(game: GameState, playerId: string): string[] {
  const opponent = getOpponent(game, playerId);
  return [...getStageMemberCardIdsByOrientation(game, playerId, OrientationState.WAITING), ...(opponent ? getStageMemberCardIdsByOrientation(game, opponent.id, OrientationState.WAITING) : [])];
}

function consume(game: GameState, ability: PendingAbilityState, ordered: boolean, step: string, next: Continue): GameState {
  return next(addAction({ ...game, pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id) }, 'RESOLVE_ABILITY', ability.controllerId, { pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, step }), ordered);
}

function start(game: GameState, ability: PendingAbilityState, ordered: boolean, next: Continue): GameState {
  if (ability.metadata?.toZone !== ZoneType.WAITING_ROOM) return consume(game, ability, ordered, 'LEAVE_STAGE_NOT_TO_WAITING_ROOM', next);
  const selectableCardIds = targets(game, ability.controllerId);
  if (selectableCardIds.length === 0) return consume(game, ability, ordered, 'NO_WAITING_STAGE_MEMBER_TARGET', next);
  return startPendingActiveEffect(game, {
    ability, playerId: ability.controllerId,
    activeEffect: { id: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, controllerId: ability.controllerId, effectText: getAbilityEffectText(ability.abilityId), stepId: STEP_ID, stepText: '可以选择舞台上1名待机状态的成员变为活跃状态。', awaitingPlayerId: ability.controllerId, selectableCardIds, selectableCardVisibility: 'PUBLIC', selectableCardMode: 'SINGLE', selectionLabel: '选择要变为活跃状态的成员', confirmSelectionLabel: '变为活跃状态', canSkipSelection: true, skipSelectionLabel: '不发动', metadata: { orderedResolution: ordered } },
    actionPayload: { step: 'START_SELECT_STAGE_MEMBER_TO_ACTIVE', sourceCardId: ability.sourceCardId, selectableCardIds },
  });
}

function finish(game: GameState, selectedCardId: string | null | undefined, enqueue: EnqueueTriggeredCardEffectsForMemberStateChanged, next: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== STEP_ID) return game;
  const ordered = effect.metadata?.orderedResolution === true;
  if (selectedCardId === null) return next(addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'SKIP' }), ordered);
  if (selectedCardId === undefined) return game;
  if (effect.selectableCardIds?.includes(selectedCardId) !== true) return game;
  const card = getCardById(game, selectedCardId);
  const currentTargets = targets(game, effect.controllerId);
  if (!card || !isMemberCardData(card.data) || !currentTargets.includes(selectedCardId)) return next(addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'STALE_TARGET', targetCardId: selectedCardId }), ordered);
  const player = getPlayerById(game, effect.controllerId);
  const opponent = getOpponent(game, effect.controllerId);
  const targetPlayerId = player?.memberSlots.cardStates.has(selectedCardId) ? effect.controllerId : opponent?.id;
  if (!targetPlayerId) return game;
  const result = setMemberOrientation(game, targetPlayerId, selectedCardId, OrientationState.ACTIVE, { kind: 'CARD_EFFECT', playerId: effect.controllerId, sourceCardId: effect.sourceCardId, abilityId: effect.abilityId, pendingAbilityId: effect.id });
  if (!result || !result.changed) return next(addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'STALE_TARGET', targetCardId: selectedCardId }), ordered);
  const resolved = enqueueMemberStateChangedTriggersFromOrientationResult(game, result, enqueue, { prepareGameStateBeforeEnqueue: (state, change, events) => addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'ACTIVATE_STAGE_MEMBER', targetPlayerId, targetCardId: selectedCardId, previousOrientation: change.previousOrientation, nextOrientation: change.nextOrientation, memberStateChangedEventIds: events.map((event) => event.eventId) }) });
  return next(resolved.gameState, ordered);
}
