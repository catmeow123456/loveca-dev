import type { GameState } from '../../../domain/entities/game.js';
import type { MemberStateChangedEvent } from '../../../domain/events/game-events.js';
import { capturePendingAbilitySourceLifecycles } from './ability-source-lifecycle.js';

export interface MemberStateChangedObserverContext {
  readonly events: readonly MemberStateChangedEvent[];
}

export type MemberStateChangedObserverHandler = (
  game: GameState,
  context: MemberStateChangedObserverContext
) => GameState;

const memberStateChangedObserverHandlers: MemberStateChangedObserverHandler[] = [];

export function registerMemberStateChangedObserver(
  handler: MemberStateChangedObserverHandler
): void {
  memberStateChangedObserverHandlers.push(handler);
}

export function enqueueMemberStateChangedObserverCardEffects(
  game: GameState,
  events: readonly MemberStateChangedEvent[]
): GameState {
  let state = game;
  for (const handler of memberStateChangedObserverHandlers) {
    state = handler(state, { events });
  }
  return capturePendingAbilitySourceLifecycles(state);
}
