import { addAction, type GameState } from '../../../domain/entities/game.js';
import type { TriggerCondition } from '../../../shared/types/enums.js';

export function getDispatchedTriggerEventIds(
  game: GameState,
  triggerCondition: TriggerCondition
): Set<string> {
  return new Set(
    game.actionHistory
      .filter(
        (action) =>
          action.type === 'DISPATCH_TRIGGER_EVENT' &&
          action.payload.triggerCondition === triggerCondition
      )
      .map((action) => action.payload.eventId)
      .filter((eventId): eventId is string => typeof eventId === 'string')
  );
}

export function markTriggerEventDispatched(
  game: GameState,
  options: {
    readonly eventId: string;
    readonly triggerCondition: TriggerCondition;
    readonly playerId: string;
  }
): GameState {
  if (getDispatchedTriggerEventIds(game, options.triggerCondition).has(options.eventId)) {
    return game;
  }
  return addAction(game, 'DISPATCH_TRIGGER_EVENT', options.playerId, {
    eventId: options.eventId,
    triggerCondition: options.triggerCondition,
  });
}
