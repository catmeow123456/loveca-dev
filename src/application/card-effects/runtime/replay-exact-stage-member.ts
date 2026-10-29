import { isMemberCardData } from '../../../domain/entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../../../domain/entities/game.js';
import type { EnterStageEvent } from '../../../domain/events/game-events.js';
import {
  OrientationState,
  TriggerCondition,
  type SlotPosition,
} from '../../../shared/types/enums.js';
import {
  clearPreviousStageMemberInstanceState,
  playMembersFromWaitingRoomToEmptySlots,
} from '../../effects/member-state.js';
import { getNewEnterStageEvents } from './events.js';

export type EnqueueReplayedMemberTriggers = (
  game: GameState,
  triggers: readonly TriggerCondition[],
  options?: { readonly enterStageEvents?: readonly EnterStageEvent[] }
) => GameState;

/** Fixed target only: no waiting-room search, alternate slot, cost, or pending continuation. */
export function replayExactWaitingRoomMemberToOriginalSlotAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  targetCardId: string,
  originalSlot: SlotPosition,
  enqueue: EnqueueReplayedMemberTriggers
): GameState | null {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, targetCardId);
  if (
    !player?.waitingRoom.cardIds.includes(targetCardId) ||
    player.memberSlots.slots[originalSlot] !== null ||
    !card ||
    card.ownerId !== playerId ||
    !isMemberCardData(card.data)
  )
    return null;
  const clean = clearPreviousStageMemberInstanceState(game, playerId, targetCardId);
  const played = playMembersFromWaitingRoomToEmptySlots(
    clean,
    playerId,
    [{ cardId: targetCardId, toSlot: originalSlot }],
    OrientationState.ACTIVE
  );
  if (!played) return null;
  return enqueue(played.gameState, [TriggerCondition.ON_ENTER_STAGE], {
    enterStageEvents: getNewEnterStageEvents(game, played.gameState),
  });
}
