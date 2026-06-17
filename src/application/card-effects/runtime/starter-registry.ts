import type {
  GameState,
  PendingAbilityState,
} from '../../../domain/entities/game.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export interface PendingAbilityStarterOptions {
  readonly orderedResolution?: boolean;
  readonly manualConfirmation?: boolean;
  readonly skipManualConfirmation?: boolean;
}

export interface PendingAbilityStarterContext {
  readonly continuePendingCardEffects: ContinuePendingCardEffects;
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

export function resolvePendingAbilityStarterWithRegistry(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  context: PendingAbilityStarterContext
): GameState | null {
  const handler = pendingAbilityStarterHandlers.get(ability.abilityId);
  return handler ? handler(game, ability, options, context) : null;
}
