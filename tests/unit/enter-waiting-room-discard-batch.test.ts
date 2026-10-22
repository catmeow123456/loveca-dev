import { describe, expect, it, vi } from 'vitest';
import {
  discardHandsToWaitingRoomAsBatchAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../src/application/card-effects/runtime/enter-waiting-room-triggers';
import { TriggerCondition } from '../../src/shared/types/enums';
import { P1, P2, member, gameWith, hand } from '../helpers/modifier-workflow-fixtures';

describe('simultaneous multi-player hand discard trigger boundary', () => {
  it('collects both events only after both players have moved their privately chosen cards', () => {
    const cards = [member('SYNTHETIC-A', 'a'), member('SYNTHETIC-B', 'b', P2)];
    const game = hand(hand(gameWith(cards), [cards[0]!]), [cards[1]!], P2);
    const enqueue = vi.fn<EnqueueTriggeredCardEffectsForEnterWaitingRoom>(
      (state, conditions, options) => {
        expect(state.players.map((p) => p.hand.cardIds)).toEqual([[], []]);
        expect(state.players.map((p) => p.waitingRoom.cardIds)).toEqual([['a'], ['b']]);
        expect(conditions).toEqual([TriggerCondition.ON_ENTER_WAITING_ROOM]);
        expect(options?.enterWaitingRoomEvents).toHaveLength(2);
        return state;
      }
    );
    expect(
      discardHandsToWaitingRoomAsBatchAndEnqueueTriggers(
        game,
        [
          { playerId: P1, selectedCardIds: ['a'] },
          { playerId: P2, selectedCardIds: ['b'] },
        ],
        enqueue
      )?.enterWaitingRoomEvents
    ).toHaveLength(2);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it('does not enqueue or return partial movement when a later selection is stale', () => {
    const card = member('SYNTHETIC-A', 'a');
    const game = hand(gameWith([card]), [card]);
    const enqueue = vi.fn<EnqueueTriggeredCardEffectsForEnterWaitingRoom>((state) => state);
    expect(
      discardHandsToWaitingRoomAsBatchAndEnqueueTriggers(
        game,
        [
          { playerId: P1, selectedCardIds: ['a'] },
          { playerId: P2, selectedCardIds: ['stale'] },
        ],
        enqueue
      )
    ).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
    expect(game.players[0].hand.cardIds).toEqual(['a']);
  });
});
