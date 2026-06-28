import type { GameAction, GameState } from '../../../domain/entities/game.js';

const ABILITY_USE_STEP = 'ABILITY_USE';
const ACTIVATED_ABILITY_USE_STEP = 'ACTIVATED_ABILITY_USE';

export interface ResolvedAbilityObserverContext {
  readonly resolvedAction: GameAction;
}

export type ResolvedAbilityObserverHandler = (
  game: GameState,
  context: ResolvedAbilityObserverContext
) => GameState;

const resolvedAbilityObserverHandlers: ResolvedAbilityObserverHandler[] = [];

export function registerResolvedAbilityObserver(handler: ResolvedAbilityObserverHandler): void {
  resolvedAbilityObserverHandlers.push(handler);
}

export function enqueueResolvedAbilityObserverCardEffects(game: GameState): GameState {
  const resolvedAction = game.actionHistory.at(-1);
  if (resolvedAction?.type !== 'RESOLVE_ABILITY') {
    return game;
  }
  if (
    resolvedAction.payload.step === ABILITY_USE_STEP ||
    resolvedAction.payload.step === ACTIVATED_ABILITY_USE_STEP
  ) {
    return game;
  }

  let state = game;
  for (const handler of resolvedAbilityObserverHandlers) {
    state = handler(state, { resolvedAction });
  }
  return state;
}
