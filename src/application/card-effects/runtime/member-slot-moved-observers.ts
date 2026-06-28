import type { GameState } from '../../../domain/entities/game.js';
import type { MemberSlotMovedEvent } from '../../../domain/events/game-events.js';

export interface MemberSlotMovedObserverContext {
  readonly events: readonly MemberSlotMovedEvent[];
}

export type MemberSlotMovedObserverHandler = (
  game: GameState,
  context: MemberSlotMovedObserverContext
) => GameState;

const memberSlotMovedObserverHandlers: MemberSlotMovedObserverHandler[] = [];

export function registerMemberSlotMovedObserver(handler: MemberSlotMovedObserverHandler): void {
  memberSlotMovedObserverHandlers.push(handler);
}

export function enqueueMemberSlotMovedObserverCardEffects(
  game: GameState,
  events: readonly MemberSlotMovedEvent[]
): GameState {
  let state = game;
  for (const handler of memberSlotMovedObserverHandlers) {
    state = handler(state, { events });
  }
  return state;
}
