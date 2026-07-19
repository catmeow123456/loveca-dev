import type {
  GameState,
  PendingAbilityState,
} from '../../../domain/entities/game.js';
import { EnergySelectionRequiredError } from '../../effects/energy-selection.js';
import { createPendingAbilityEnergySelectionWindow } from './energy-operation-selection.js';
import { getAbilityEffectText } from './workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export type DelegatePendingAbility = (
  game: GameState,
  ability: PendingAbilityState,
  options?: PendingAbilityStarterOptions
) => GameState;

export interface PendingAbilityStarterOptions {
  readonly orderedResolution?: boolean;
  readonly manualConfirmation?: boolean;
  readonly confirmBeforeResolution?: boolean;
  readonly skipManualConfirmation?: boolean;
}

export interface PendingAbilityStarterContext {
  readonly continuePendingCardEffects: ContinuePendingCardEffects;
  readonly delegatePendingAbility: DelegatePendingAbility;
}

export type PendingAbilityStarterHandler = (
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  context: PendingAbilityStarterContext
) => GameState;

const pendingAbilityStarterHandlers = new Map<string, PendingAbilityStarterHandler>();

export function registerPendingAbilityStarterHandler(
  abilityId: string,
  handler: PendingAbilityStarterHandler
): void {
  pendingAbilityStarterHandlers.set(abilityId, handler);
}

export function hasPendingAbilityStarterHandler(abilityId: string): boolean {
  return pendingAbilityStarterHandlers.has(abilityId);
}

export function resolvePendingAbilityStarterWithRegistry(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  context: PendingAbilityStarterContext
): GameState | null {
  const handler = pendingAbilityStarterHandlers.get(ability.abilityId);
  if (!handler) return null;
  try {
    return handler(game, ability, options, context);
  } catch (error) {
    if (!(error instanceof EnergySelectionRequiredError)) throw error;
    return createPendingAbilityEnergySelectionWindow(
      game,
      ability,
      options,
      getAbilityEffectText(ability.abilityId),
      error
    );
  }
}
