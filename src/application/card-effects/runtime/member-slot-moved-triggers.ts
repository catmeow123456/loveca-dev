import type { GameState } from '../../../domain/entities/game.js';
import type { MemberSlotMovedEvent } from '../../../domain/events/game-events.js';
import { SlotPosition, TriggerCondition } from '../../../shared/types/enums.js';
import {
  moveMemberBetweenSlots,
  type MoveMemberBetweenSlotsResult,
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
  readonly prepareGameStateBeforeEnqueue?: (
    game: GameState,
    moveResult: MoveMemberBetweenSlotsResult
  ) => GameState;
}

export interface MoveMemberBetweenSlotsAndEnqueueTriggersResult
  extends MoveMemberBetweenSlotsResult {
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
  const moveResult = moveMemberBetweenSlots(game, playerId, cardId, toSlot);
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
