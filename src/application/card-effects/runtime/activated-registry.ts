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

export function registerActivatedAbilityHandler(
  abilityId: string,
  handler: ActivatedAbilityHandler
): void {
  activatedAbilityHandlers.set(abilityId, handler);
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
