import type { GameState } from '../../../domain/entities/game.js';
import type { MemberStateChangeCause } from '../../../domain/events/game-events.js';
import { OrientationState } from '../../../shared/types/enums.js';
import { setMemberOrientation } from '../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../effects/stage-targets.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from './member-state-changed-triggers.js';

export interface WaitStageMembersResult {
  readonly gameState: GameState;
  readonly actuallyWaitedMemberCardIds: readonly string[];
  readonly memberStateChangedEventIds: readonly string[];
}

export function waitStageMembersAndEnqueueTriggers(
  game: GameState,
  options: {
    readonly playerId: string;
    readonly memberCardIds: readonly string[];
    readonly cause: MemberStateChangeCause;
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
  }
): WaitStageMembersResult {
  let state = game;
  const actuallyWaitedMemberCardIds: string[] = [];
  const memberStateChangedEventIds: string[] = [];

  for (const memberCardId of options.memberCardIds) {
    if (
      !getStageMemberCardIdsMatching(state, options.playerId, () => true).includes(memberCardId)
    ) {
      continue;
    }
    const orientationResult = setMemberOrientation(
      state,
      options.playerId,
      memberCardId,
      OrientationState.WAITING,
      options.cause
    );
    if (!orientationResult?.changed) {
      continue;
    }
    state = orientationResult.gameState;
    actuallyWaitedMemberCardIds.push(memberCardId);
  }

  const triggerResult = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    { gameState: state },
    options.enqueueTriggeredCardEffects
  );
  memberStateChangedEventIds.push(
    ...triggerResult.memberStateChangedEvents.map((event) => event.eventId)
  );

  return {
    gameState: triggerResult.gameState,
    actuallyWaitedMemberCardIds,
    memberStateChangedEventIds,
  };
}
