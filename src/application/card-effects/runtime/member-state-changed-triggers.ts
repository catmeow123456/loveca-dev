import type { GameState } from '../../../domain/entities/game.js';
import type { MemberStateChangedEvent } from '../../../domain/events/game-events.js';
import { TriggerCondition } from '../../../shared/types/enums.js';
import { getNewMemberStateChangedEvents } from './events.js';

export type EnqueueTriggeredCardEffectsForMemberStateChanged = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly memberStateChangedEvents?: readonly MemberStateChangedEvent[];
  }
) => GameState;

export interface MemberOrientationChangeResult {
  readonly gameState: GameState;
}

export interface EnqueueMemberStateChangedTriggersOptions<
  TOrientationResult extends MemberOrientationChangeResult,
> {
  readonly prepareGameStateBeforeEnqueue?: (
    game: GameState,
    orientationResult: TOrientationResult,
    memberStateChangedEvents: readonly MemberStateChangedEvent[]
  ) => GameState;
}

export type EnqueueMemberStateChangedTriggersResult<
  TOrientationResult extends MemberOrientationChangeResult,
> = TOrientationResult & {
  readonly memberStateChangedEvents: readonly MemberStateChangedEvent[];
};

export function enqueueMemberStateChangedTriggersFromOrientationResult<
  TOrientationResult extends MemberOrientationChangeResult,
>(
  before: GameState,
  orientationResult: TOrientationResult,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged,
  options: EnqueueMemberStateChangedTriggersOptions<TOrientationResult> = {}
): EnqueueMemberStateChangedTriggersResult<TOrientationResult> {
  const memberStateChangedEvents = getNewMemberStateChangedEvents(
    before,
    orientationResult.gameState
  );
  const gameStateBeforeEnqueue = options.prepareGameStateBeforeEnqueue
    ? options.prepareGameStateBeforeEnqueue(
        orientationResult.gameState,
        orientationResult,
        memberStateChangedEvents
      )
    : orientationResult.gameState;

  if (memberStateChangedEvents.length === 0) {
    return {
      ...orientationResult,
      gameState: gameStateBeforeEnqueue,
      memberStateChangedEvents,
    };
  }

  return {
    ...orientationResult,
    gameState: enqueueTriggeredCardEffects(
      gameStateBeforeEnqueue,
      [TriggerCondition.ON_MEMBER_STATE_CHANGED],
      { memberStateChangedEvents }
    ),
    memberStateChangedEvents,
  };
}
