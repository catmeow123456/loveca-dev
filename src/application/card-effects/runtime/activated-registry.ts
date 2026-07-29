import type { GameState } from '../../../domain/entities/game.js';
import { EnergySelectionRequiredError } from '../../effects/energy-selection.js';
import { createActivatedAbilityEnergySelectionWindow } from './energy-operation-selection.js';
import { getAbilityEffectText } from './workflow-helpers.js';

export type ActivatedAbilityHandler = (
  game: GameState,
  playerId: string,
  cardId: string,
  abilityId: string
) => GameState;

export type ActivatedAbilityPreflight = (
  game: GameState,
  playerId: string,
  cardId: string,
  abilityId: string
) => boolean;

export type ActivatedAbilityPreflightQuery =
  | { readonly status: 'REGISTERED'; readonly available: boolean }
  | { readonly status: 'UNREGISTERED' };

const activatedAbilityHandlers = new Map<string, ActivatedAbilityHandler>();
const activatedAbilityPreflights = new Map<string, ActivatedAbilityPreflight>();

export function registerActivatedAbilityHandler(
  abilityId: string,
  handler: ActivatedAbilityHandler,
  options: {
    readonly preflight?: ActivatedAbilityPreflight;
  } = {}
): void {
  activatedAbilityHandlers.set(abilityId, handler);
  if (options.preflight) {
    activatedAbilityPreflights.set(abilityId, options.preflight);
  } else {
    activatedAbilityPreflights.delete(abilityId);
  }
}

/**
 * Read-only legality query for callers that must enumerate an activated action
 * without speculatively running its resolver.
 */
export function queryActivatedAbilityPreflight(
  game: GameState,
  playerId: string,
  cardId: string,
  abilityId: string
): ActivatedAbilityPreflightQuery {
  const preflight = activatedAbilityPreflights.get(abilityId);
  return preflight
    ? { status: 'REGISTERED', available: preflight(game, playerId, cardId, abilityId) }
    : { status: 'UNREGISTERED' };
}

export function resolveActivatedAbilityWithRegistry(
  game: GameState,
  playerId: string,
  cardId: string,
  abilityId: string
): GameState | null {
  const handler = activatedAbilityHandlers.get(abilityId);
  if (!handler) return null;
  try {
    return handler(game, playerId, cardId, abilityId);
  } catch (error) {
    if (!(error instanceof EnergySelectionRequiredError)) throw error;
    return createActivatedAbilityEnergySelectionWindow(
      game,
      playerId,
      cardId,
      abilityId,
      getAbilityEffectText(abilityId),
      error
    );
  }
}
