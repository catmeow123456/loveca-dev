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

const activatedAbilityHandlers = new Map<string, ActivatedAbilityHandler>();
type ActivatedAbilityAvailabilityQuery = (
  game: GameState,
  playerId: string,
  cardId: string
) => boolean;
const availabilityQueries = new Map<string, ActivatedAbilityAvailabilityQuery>();

export function registerActivatedAbilityHandler(
  abilityId: string,
  handler: ActivatedAbilityHandler,
  canStart?: ActivatedAbilityAvailabilityQuery
): void {
  activatedAbilityHandlers.set(abilityId, handler);
  if (canStart) availabilityQueries.set(abilityId, canStart);
  else availabilityQueries.delete(abilityId);
}

/** Undefined means this workflow has not supplied a read-only start query. Never trial-resolve it. */
export function queryActivatedAbilityStart(
  game: GameState,
  playerId: string,
  cardId: string,
  abilityId: string
): boolean | undefined {
  return availabilityQueries.get(abilityId)?.(game, playerId, cardId);
}

export function resolveActivatedAbilityWithRegistry(
  game: GameState,
  playerId: string,
  cardId: string,
  abilityId: string
): GameState | null {
  const handler = activatedAbilityHandlers.get(abilityId);
  if (!handler) return null;
  if (queryActivatedAbilityStart(game, playerId, cardId, abilityId) === false) return game;
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
