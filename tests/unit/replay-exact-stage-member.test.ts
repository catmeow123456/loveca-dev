import { describe, expect, it, vi } from 'vitest';
import { createCardInstance } from '../../src/domain/entities/card';
import { updatePlayer } from '../../src/domain/entities/game';
import {
  CardType,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { replayExactWaitingRoomMemberToOriginalSlotAndEnqueueTriggers as replay, type EnqueueReplayedMemberTriggers } from '../../src/application/card-effects/runtime/replay-exact-stage-member';
import { P1, P2, gameWith, syntheticMember, stage } from '../helpers/edelnote-effect-fixture';

function setup() {
  return updatePlayer(
    gameWith([
      syntheticMember('target', { name: 'same' }),
      syntheticMember('twin', { name: 'same' }),
    ]),
    P1,
    (player) => ({ ...player, waitingRoom: { ...player.waitingRoom, cardIds: ['target', 'twin'] } })
  );
}

describe('fixed waiting-room member replay action', () => {
  it('replays only the captured entity into its captured empty slot and enqueues exactly its new entry', () => {
    const enqueue = vi.fn<EnqueueReplayedMemberTriggers>((state) => state);
    const result = replay(setup(), P1, 'target', SlotPosition.LEFT, enqueue)!;
    expect(result.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe('target');
    expect(result.players[0].memberSlots.cardStates.get('target')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(result.players[0].waitingRoom.cardIds).toEqual(['twin']);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0][1]).toEqual([TriggerCondition.ON_ENTER_STAGE]);
    expect(enqueue.mock.calls[0][2]?.enterStageEvents).toHaveLength(1);
    expect(enqueue.mock.calls[0][2]?.enterStageEvents?.[0]).toMatchObject({
      cardInstanceId: 'target',
      toSlot: SlotPosition.LEFT,
    });
  });
  it('rejects a missing fixed card rather than selecting another same-name waiting-room member', () => {
    const game = updatePlayer(setup(), P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: ['twin'] },
    }));
    const enqueue = vi.fn<EnqueueReplayedMemberTriggers>((state) => state);
    expect(replay(game, P1, 'target', SlotPosition.LEFT, enqueue)).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('rejects an occupied captured slot rather than falling back to another empty slot', () => {
    const game = stage(setup(), 'twin', SlotPosition.LEFT);
    const enqueue = vi.fn<EnqueueReplayedMemberTriggers>((state) => state);
    expect(replay(game, P1, 'target', SlotPosition.LEFT, enqueue)).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it.each(['wrong-owner', 'non-member'])(
    'rejects %s without emitting or enqueueing entry events',
    (kind) => {
      const invalid =
        kind === 'wrong-owner'
          ? syntheticMember('target', {}, P2)
          : createCardInstance(
              { cardCode: 'SYNTHETIC-energy', name: 'energy', cardType: CardType.ENERGY },
              P1,
              'target'
            );
      const game = updatePlayer(gameWith([invalid]), P1, (p) => ({
        ...p,
        waitingRoom: { ...p.waitingRoom, cardIds: ['target'] },
      }));
    const enqueue = vi.fn<EnqueueReplayedMemberTriggers>((state) => state);
      expect(replay(game, P1, 'target', SlotPosition.LEFT, enqueue)).toBeNull();
      expect(game.eventLog).toEqual([]);
      expect(enqueue).not.toHaveBeenCalled();
    }
  );
});
