import type { GameAction, GameState } from '../../../domain/entities/game.js';
import { capturePendingAbilitySourceLifecycles } from './ability-source-lifecycle.js';

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
  const resolvedAction = getLatestActionBeforeTriggerDispatchAudit(game);
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
  return capturePendingAbilitySourceLifecycles(state);
}

function getLatestActionBeforeTriggerDispatchAudit(game: GameState): GameAction | undefined {
  for (let index = game.actionHistory.length - 1; index >= 0; index -= 1) {
    const action = game.actionHistory[index];
    if (action?.type === 'DISPATCH_TRIGGER_EVENT') {
      continue;
    }
    return action;
  }
  return undefined;
}
