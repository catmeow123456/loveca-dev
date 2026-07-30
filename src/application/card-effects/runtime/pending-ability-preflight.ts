import {
  addAction,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';
import { getPendingAbilitySourceLifecycleId } from './ability-source-lifecycle.js';

export interface PendingAbilityPreflightResolution {
  readonly step: string;
  readonly actionPayload?: Readonly<Record<string, unknown>>;
}

export type PendingAbilityPreflightHandler = (
  game: GameState,
  ability: PendingAbilityState
) => PendingAbilityPreflightResolution | null;

export interface PendingAbilityPreflightResult {
  readonly gameState: GameState;
  readonly resolvedAbilityId: string | null;
}

const pendingAbilityPreflightHandlers = new Map<string, PendingAbilityPreflightHandler>();

export function registerPendingAbilityPreflightHandler(
  abilityId: string,
  handler: PendingAbilityPreflightHandler
): void {
  pendingAbilityPreflightHandlers.set(abilityId, handler);
}

/**
 * Resolves at most one registered pending ability that can no longer perform
 * any rule action. The runner must re-enter the scheduler after a resolution
 * so resolved-ability observers and check-timing priority see every no-op
 * resolution independently.
 */
export function resolveFirstNonActionablePendingAbilityWithRegistry(
  game: GameState,
  candidates: readonly PendingAbilityState[]
): PendingAbilityPreflightResult {
  for (const candidate of candidates) {
    const ability = game.pendingAbilities.find((pending) => pending.id === candidate.id);
    const handler = ability ? pendingAbilityPreflightHandlers.get(ability.abilityId) : undefined;
    if (!ability || !handler) {
      continue;
    }

    const resolution = handler(game, ability);
    if (!resolution) {
      continue;
    }

    return {
      gameState: addAction(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter((pending) => pending.id !== ability.id),
        },
        'RESOLVE_ABILITY',
        ability.controllerId,
        {
          ...resolution.actionPayload,
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
          sourceSlot: ability.sourceSlot,
          step: resolution.step,
          pendingPreflight: true,
        }
      ),
      resolvedAbilityId: ability.id,
    };
  }

  return { gameState: game, resolvedAbilityId: null };
}
