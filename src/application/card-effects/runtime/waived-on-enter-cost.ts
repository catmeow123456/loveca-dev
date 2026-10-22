import type { GameState, PendingAbilityState } from '../../../domain/entities/game.js';
import { getPendingAbilitySourceLifecycleId } from './ability-source-lifecycle.js';
import { startPendingActiveEffect } from './active-effect.js';
import { getAbilityEffectText } from './workflow-helpers.js';

/** Internal bridge directly into the existing post-cost resolver; no cost prompt is exposed. */
export function createWaivedOnEnterCostContinuationState(
  game: GameState,
  ability: PendingAbilityState,
  stepId: string,
  orderedResolution: boolean
): GameState {
  return startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
      onEnterInvocation: ability.onEnterInvocation,
      awaitingPlayerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepText: '结算此登场能力。',
      stepId,
      metadata: {
        ...ability.metadata,
        sourceSlot: ability.sourceSlot,
        eventIds: ability.eventIds,
        orderedResolution,
      },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, step: 'ACTIVATION_COST_WAIVED' },
  });
}
