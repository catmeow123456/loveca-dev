import { addAction, getPlayerById, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { createStageMemberOrientationTargetSelection, resolveStageMemberOrientationTargetSelection } from '../../../effects/stage-member-target-selection.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_PB1_012_ON_ENTER_ACTIVATE_PRINTEMPS_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { enqueueMemberStateChangedTriggersFromOrientationResult, type EnqueueTriggeredCardEffectsForMemberStateChanged } from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_TARGET_STEP_ID = 'PL_PB1_012_SELECT_WAITING_PRINTEMPS_MEMBER';
const printempsMember = and(typeIs(CardType.MEMBER), unitAliasIs('Printemps'));
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlPb1012KotoriWorkflowHandlers(deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged }): void {
  registerPendingAbilityStarterHandler(PL_PB1_012_ON_ENTER_ACTIVATE_PRINTEMPS_MEMBER_ABILITY_ID, (game, ability, options, context) => start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects));
  registerActiveEffectStepHandler(PL_PB1_012_ON_ENTER_ACTIVATE_PRINTEMPS_MEMBER_ABILITY_ID, SELECT_TARGET_STEP_ID, (game, input, context) => finish(game, input.selectedCardId ?? null, context.continuePendingCardEffects, deps.enqueueTriggeredCardEffects));
}

function start(game: GameState, ability: PendingAbilityState, orderedResolution: boolean, continuePendingCardEffects: ContinuePendingCardEffects): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const selection = createStageMemberOrientationTargetSelection(game, { ability, effectText: getAbilityEffectText(ability.abilityId), stepId: SELECT_TARGET_STEP_ID, stepText: '可以选择自己舞台至多1名待机状态的『Printemps』成员变为活跃状态。', awaitingPlayerId: player.id, targetPlayerId: player.id, selector: printempsMember, targetOrientation: OrientationState.ACTIVE, selectionLabel: '选择变为活跃的成员', orderedResolution });
  if (!selection.activeEffect) return consume(game, ability, player.id, orderedResolution, continuePendingCardEffects, { step: 'NO_WAITING_PRINTEMPS_MEMBER_TARGET', selectableCardIds: selection.selectableCardIds });
  return startPendingActiveEffect(game, { ability, playerId: player.id, activeEffect: { ...selection.activeEffect, selectableCardVisibility: 'PUBLIC', selectableCardMode: 'SINGLE', canSkipSelection: true, skipSelectionLabel: '不变为活跃状态' }, actionPayload: { sourceCardId: ability.sourceCardId, step: 'START_SELECT_WAITING_PRINTEMPS_MEMBER', selectableCardIds: selection.selectableCardIds } });
}

function finish(game: GameState, selectedCardId: string | null, continuePendingCardEffects: ContinuePendingCardEffects, enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== PL_PB1_012_ON_ENTER_ACTIVATE_PRINTEMPS_MEMBER_ABILITY_ID || effect.stepId !== SELECT_TARGET_STEP_ID) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (selectedCardId === null) return continuePendingCardEffects(addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'SKIP_ACTIVATE_PRINTEMPS_MEMBER' }), orderedResolution);
  const stillEligible = getStageMemberCardIdsMatching(game, player.id, printempsMember).includes(selectedCardId) && player.memberSlots.cardStates.get(selectedCardId)?.orientation === OrientationState.WAITING;
  if (!stillEligible || effect.selectableCardIds?.includes(selectedCardId) !== true) return continuePendingCardEffects(addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'INVALID_OR_STALE_PRINTEMPS_TARGET', selectedCardId }), orderedResolution);
  const change = resolveStageMemberOrientationTargetSelection(game, effect, selectedCardId);
  if (!change || change.previousOrientation !== OrientationState.WAITING) return game;
  const result = enqueueMemberStateChangedTriggersFromOrientationResult(game, change, enqueueTriggeredCardEffects, { prepareGameStateBeforeEnqueue: (state, orientationResult, events) => addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'ACTIVATE_PRINTEMPS_MEMBER', targetCardId: selectedCardId, previousOrientation: orientationResult.previousOrientation, nextOrientation: orientationResult.nextOrientation, memberStateChangedEventIds: events.map((event) => event.eventId) }) });
  return continuePendingCardEffects(result.gameState, orderedResolution);
}

function consume(game: GameState, ability: PendingAbilityState, playerId: string, orderedResolution: boolean, continuePendingCardEffects: ContinuePendingCardEffects, payload: Readonly<Record<string, unknown>>): GameState {
  return continuePendingCardEffects(addAction({ ...game, pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id) }, 'RESOLVE_ABILITY', playerId, { pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, ...payload }), orderedResolution);
}
