import { addAction, getPlayerById, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_PB1_003_ON_ENTER_WAIT_SELF_ACTIVATE_PRINTEMPS_COUNT_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { enqueueMemberStateChangedTriggersFromOrientationResult, type EnqueueTriggeredCardEffectsForMemberStateChanged } from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const WAIT_SELF_COST_STEP_ID = 'PL_PB1_003_WAIT_SELF_COST';
const WAIT_SELF_OPTION_ID = 'WAIT_SOURCE';
const printempsMember = and(typeIs(CardType.MEMBER), unitAliasIs('Printemps'));
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlPb1003KotoriWorkflowHandlers(deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged }): void {
  registerPendingAbilityStarterHandler(PL_PB1_003_ON_ENTER_WAIT_SELF_ACTIVATE_PRINTEMPS_COUNT_ENERGY_ABILITY_ID, (game, ability, options, context) => start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects));
  registerActiveEffectStepHandler(PL_PB1_003_ON_ENTER_WAIT_SELF_ACTIVATE_PRINTEMPS_COUNT_ENERGY_ABILITY_ID, WAIT_SELF_COST_STEP_ID, (game, input, context) => finish(game, input.selectedOptionId ?? null, context.continuePendingCardEffects, deps.enqueueTriggeredCardEffects));
}

function start(game: GameState, ability: PendingAbilityState, orderedResolution: boolean, continuePendingCardEffects: ContinuePendingCardEffects): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  const sourceOrientation = player?.memberSlots.cardStates.get(ability.sourceCardId)?.orientation;
  if (!player || sourceSlot === null || sourceOrientation !== OrientationState.ACTIVE) {
    return consume(game, ability, ability.controllerId, orderedResolution, continuePendingCardEffects, { step: 'SOURCE_NOT_ACTIVE_OWN_STAGE_MEMBER', sourceSlot, sourceOrientation: sourceOrientation ?? null });
  }
  return startPendingActiveEffect(game, { ability, playerId: player.id, activeEffect: { id: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, controllerId: player.id, effectText: getAbilityEffectText(ability.abilityId), stepId: WAIT_SELF_COST_STEP_ID, stepText: '可以将此成员变为待机状态。', awaitingPlayerId: player.id, selectableOptions: [{ id: WAIT_SELF_OPTION_ID, label: '发动' }], canSkipSelection: true, skipSelectionLabel: '不发动', metadata: { orderedResolution, sourceSlot } }, actionPayload: { sourceCardId: ability.sourceCardId, sourceSlot, step: 'START_OPTIONAL_WAIT_SELF_COST' } });
}

function finish(game: GameState, selectedOptionId: string | null, continuePendingCardEffects: ContinuePendingCardEffects, enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== PL_PB1_003_ON_ENTER_WAIT_SELF_ACTIVATE_PRINTEMPS_COUNT_ENERGY_ABILITY_ID || effect.stepId !== WAIT_SELF_COST_STEP_ID) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (selectedOptionId === null) return continuePendingCardEffects(addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'DECLINE_WAIT_SELF_COST' }), orderedResolution);
  if (selectedOptionId !== WAIT_SELF_OPTION_ID || effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true) return game;
  const sourceSlot = getSourceMemberSlot(game, player.id, effect.sourceCardId);
  const sourceOrientation = player.memberSlots.cardStates.get(effect.sourceCardId)?.orientation;
  if (sourceSlot === null || sourceOrientation !== OrientationState.ACTIVE) return continuePendingCardEffects(addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, sourceSlot, step: 'SOURCE_NOT_ACTIVE_OWN_STAGE_MEMBER_AFTER_SELECTION', sourceOrientation: sourceOrientation ?? null }), orderedResolution);
  const waitResult = setMemberOrientation(game, player.id, effect.sourceCardId, OrientationState.WAITING, { kind: 'CARD_EFFECT', playerId: player.id, sourceCardId: effect.sourceCardId, abilityId: effect.abilityId, pendingAbilityId: effect.id });
  if (!waitResult || waitResult.previousOrientation !== OrientationState.ACTIVE) return game;
  const afterCost = enqueueMemberStateChangedTriggersFromOrientationResult(game, waitResult, enqueueTriggeredCardEffects, { prepareGameStateBeforeEnqueue: (state, result, events) => addAction(state, 'PAY_COST', player.id, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, sourceSlot, waitedMemberCardId: effect.sourceCardId, previousOrientation: result.previousOrientation, nextOrientation: result.nextOrientation, memberStateChangedEventIds: events.map((event) => event.eventId) }) });
  const printempsMemberCardIds = getStageMemberCardIdsMatching(afterCost.gameState, player.id, printempsMember);
  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(afterCost.gameState, player.id, OrientationState.WAITING);
  const requestedActivationCount = printempsMemberCardIds.length;
  const activation = activateWaitingEnergyCardsForPlayer(afterCost.gameState, player.id, Math.min(requestedActivationCount, waitingEnergyCardIds.length));
  if (!activation) return game;
  return continuePendingCardEffects(addAction({ ...activation.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'WAIT_SELF_ACTIVATE_PRINTEMPS_COUNT_ENERGY', waitedMemberCardId: effect.sourceCardId, printempsMemberCardIds, printempsMemberCount: printempsMemberCardIds.length, requestedActivationCount, activatedEnergyCardIds: activation.activatedEnergyCardIds, memberStateChangedEventIds: afterCost.memberStateChangedEvents.map((event) => event.eventId) }), orderedResolution);
}

function consume(game: GameState, ability: PendingAbilityState, playerId: string, orderedResolution: boolean, continuePendingCardEffects: ContinuePendingCardEffects, payload: Readonly<Record<string, unknown>>): GameState {
  return continuePendingCardEffects(addAction({ ...game, pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id) }, 'RESOLVE_ABILITY', playerId, { pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, ...payload }), orderedResolution);
}
