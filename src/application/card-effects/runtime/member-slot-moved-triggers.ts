import type { GameState } from '../../../domain/entities/game.js';
import type {
  MemberSlotMovedEvent,
  MemberStateChangeCause,
} from '../../../domain/events/game-events.js';
import { SlotPosition, TriggerCondition } from '../../../shared/types/enums.js';
import {
  moveMemberBetweenSlots,
  type MoveMemberBetweenSlotsResult,
  rearrangeStageMembers,
  rearrangeStageMembersByMoveHistory,
  type RearrangeStageMembersResult,
  type RearrangeStageMembersByMoveHistoryResult,
  type RearrangeStageMemberPlacement,
  type StageFormationMoveHistoryEntry,
} from '../../effects/member-state.js';
import { getNewMemberSlotMovedEvents } from './events.js';

export type EnqueueTriggeredCardEffectsForMemberSlotMoved = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly memberSlotMovedEvents?: readonly MemberSlotMovedEvent[];
  }
) => GameState;

export interface MoveMemberBetweenSlotsAndEnqueueTriggersOptions {
  readonly cause?: MemberStateChangeCause;
  readonly prepareGameStateBeforeEnqueue?: (
    game: GameState,
    moveResult: MoveMemberBetweenSlotsResult
  ) => GameState;
}

export interface MoveMemberBetweenSlotsAndEnqueueTriggersResult
  extends MoveMemberBetweenSlotsResult {
  readonly memberSlotMovedEvents: readonly MemberSlotMovedEvent[];
}

export interface RearrangeStageMembersAndEnqueueTriggersOptions {
  readonly cause?: MemberStateChangeCause;
  readonly prepareGameStateBeforeEnqueue?: (
    game: GameState,
    rearrangeResult: RearrangeStageMembersResult
  ) => GameState;
}

export interface RearrangeStageMembersAndEnqueueTriggersResult
  extends RearrangeStageMembersResult {
  readonly memberSlotMovedEvents: readonly MemberSlotMovedEvent[];
}

export interface RearrangeStageMembersByMoveHistoryAndEnqueueTriggersOptions {
  readonly cause?: MemberStateChangeCause;
  readonly expectedPlacements?: readonly RearrangeStageMemberPlacement[];
  readonly prepareGameStateBeforeEnqueue?: (
    game: GameState,
    rearrangeResult: RearrangeStageMembersByMoveHistoryResult
  ) => GameState;
}

export interface RearrangeStageMembersByMoveHistoryAndEnqueueTriggersResult
  extends RearrangeStageMembersByMoveHistoryResult {
  readonly memberSlotMovedEvents: readonly MemberSlotMovedEvent[];
}

export function moveMemberBetweenSlotsAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  cardId: string,
  toSlot: SlotPosition,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved,
  options: MoveMemberBetweenSlotsAndEnqueueTriggersOptions = {}
): MoveMemberBetweenSlotsAndEnqueueTriggersResult | null {
  const moveResult = moveMemberBetweenSlots(game, playerId, cardId, toSlot, {
    cause: options.cause,
  });
  if (!moveResult) {
    return null;
  }

  const memberSlotMovedEvents = getNewMemberSlotMovedEvents(game, moveResult.gameState);
  const gameStateBeforeEnqueue = options.prepareGameStateBeforeEnqueue
    ? options.prepareGameStateBeforeEnqueue(moveResult.gameState, moveResult)
    : moveResult.gameState;

  return {
    ...moveResult,
    gameState: enqueueTriggeredCardEffects(
      gameStateBeforeEnqueue,
      [TriggerCondition.ON_MEMBER_SLOT_MOVED],
      { memberSlotMovedEvents }
    ),
    memberSlotMovedEvents,
  };
}

export function rearrangeStageMembersAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  placements: readonly RearrangeStageMemberPlacement[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved,
  options: RearrangeStageMembersAndEnqueueTriggersOptions = {}
): RearrangeStageMembersAndEnqueueTriggersResult | null {
  const rearrangeResult = rearrangeStageMembers(game, playerId, placements, {
    cause: options.cause,
  });
  if (!rearrangeResult) {
    return null;
  }

  const memberSlotMovedEvents = getNewMemberSlotMovedEvents(game, rearrangeResult.gameState);
  const gameStateBeforeEnqueue = options.prepareGameStateBeforeEnqueue
    ? options.prepareGameStateBeforeEnqueue(rearrangeResult.gameState, rearrangeResult)
    : rearrangeResult.gameState;

  return {
    ...rearrangeResult,
    gameState: enqueueTriggeredCardEffects(
      gameStateBeforeEnqueue,
      [TriggerCondition.ON_MEMBER_SLOT_MOVED],
      { memberSlotMovedEvents }
    ),
    memberSlotMovedEvents,
  };
}

export function rearrangeStageMembersByMoveHistoryAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  moveHistory: readonly StageFormationMoveHistoryEntry[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved,
  options: RearrangeStageMembersByMoveHistoryAndEnqueueTriggersOptions = {}
): RearrangeStageMembersByMoveHistoryAndEnqueueTriggersResult | null {
  const rearrangeResult = rearrangeStageMembersByMoveHistory(game, playerId, moveHistory, {
    cause: options.cause,
    expectedPlacements: options.expectedPlacements,
  });
  if (!rearrangeResult) {
    return null;
  }

  const memberSlotMovedEvents = getNewMemberSlotMovedEvents(game, rearrangeResult.gameState);
  const gameStateBeforeEnqueue = options.prepareGameStateBeforeEnqueue
    ? options.prepareGameStateBeforeEnqueue(rearrangeResult.gameState, rearrangeResult)
    : rearrangeResult.gameState;

  return {
    ...rearrangeResult,
    gameState: enqueueTriggeredCardEffects(
      gameStateBeforeEnqueue,
      [TriggerCondition.ON_MEMBER_SLOT_MOVED],
      { memberSlotMovedEvents }
    ),
    memberSlotMovedEvents,
  };
}
