import { addAction, getPlayerById, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { placeEnergyFromEnergyDeckBelowStageMember } from '../../../effects/energy-below.js';
import { N_BP7_007_LIVE_SUCCESS_PLACE_ENERGY_DECK_BELOW_SELF_ABILITY_ID } from '../../ability-ids.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import type { PendingAbilityStarterOptions } from '../../runtime/starter-registry.js';
import { registerManualConfirmablePendingAbilityStarterHandler } from '../../runtime/workflow-helpers.js';

type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp7007SetsunaWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    N_BP7_007_LIVE_SUCCESS_PLACE_ENERGY_DECK_BELOW_SELF_ABILITY_ID,
    (game, ability, options, context) => resolve(game, ability, options, context.continuePendingCardEffects),
    () => ({ stepText: '确认后结算此效果。' })
  );
}

function resolve(game: GameState, ability: PendingAbilityState, options: PendingAbilityStarterOptions, next: Continue): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  const placement = player && sourceSlot !== null
    ? placeEnergyFromEnergyDeckBelowStageMember(game, player.id, ability.sourceCardId, 1)
    : null;
  const resolvedState = placement?.gameState ?? game;
  const state = {
    ...resolvedState,
    activeEffect: null,
    pendingAbilities: resolvedState.pendingAbilities.filter((item) => item.id !== ability.id),
  };
  return next(addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
    pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId,
    step: placement ? 'PLACE_ENERGY_DECK_BELOW_SELF' : 'SOURCE_NOT_TOP_LEVEL_STAGE_MEMBER',
    targetSlot: placement?.targetSlot ?? null,
    placedEnergyCardIds: placement?.placedEnergyCardIds ?? [],
  }), options.orderedResolution === true);
}
