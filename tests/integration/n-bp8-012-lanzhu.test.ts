import { describe, expect, it } from 'vitest';
import { N_BP8_012_LIVE_SUCCESS_DRAW_ONE_ABILITY_ID as LANZHU } from '../../src/application/card-effects/ability-ids';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { createCardInstance } from '../../src/domain/entities/card';
import { registerCards, updatePlayer } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { FaceState, OrientationState, SlotPosition } from '../../src/shared/types/enums';
import { getOctober26CardData } from '../helpers/october-26-card-effects';
import { P1, setup, live, choose, latest } from '../helpers/october-26-member-workflow';

describe('PL!N-bp8-012 费用4「钟岚珠」unconditional LIVE draw', () => {
  it('uses real success enqueue and plain confirmation; draws only after confirmation', () => {
    const game = live(setup('PL!N-bp8-012-R', 0), true);
    expect(game.activeEffect?.effectText).toBe('【LIVE成功时】抽１张卡。');
    expect(game.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(game.players[0].hand.cardIds).toEqual([]);
    const done = choose(game);
    expect(done.players[0].hand.cardIds).toEqual(['deck-0']);
    expect(latest(done, LANZHU)).toMatchObject({ step: 'DRAW_ONE', drawnCardIds: ['deck-0'] });
    expect(done.activeEffect).toBeNull();
  });
  it('still draws when the source leaves after triggering', () => {
    const queued = live(setup('PL!N-bp8-012-R', 0), true, false);
    const moved = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      queued,
      P1,
      'source',
      enqueueTriggeredCardEffects
    )!;
    const done = choose(resolvePendingCardEffects(moved.gameState).gameState);
    expect(done.players[0].hand.cardIds).toEqual(['deck-0']);
    expect(done.players[0].waitingRoom.cardIds).toContain('source');
  });
  it('handles an empty drawable deck and consumes pending', () => {
    const initial = updatePlayer(setup('PL!N-bp8-012-R', 0), P1, (p) => ({
      ...p,
      mainDeck: { ...p.mainDeck, cardIds: [] },
    }));
    const done = choose(live(initial, true));
    expect(latest(done, LANZHU)).toMatchObject({ drawnCardIds: [] });
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
  });
  it.each([false, true])(
    'two sources support manual point selection and ordered batch (%s)',
    (ordered) => {
      const second = createCardInstance(getOctober26CardData('PL!N-bp8-012-R'), P1, 'second');
      let game = registerCards(setup('PL!N-bp8-012-R', 0), [second]);
      game = updatePlayer(game, P1, (p) => ({
        ...p,
        memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.LEFT, second.instanceId, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      }));
      game = live(game, true);
      const firstPending = game.pendingAbilities.find((a) => a.sourceCardId === 'second')!;
      game = confirmActiveEffectStep(
        game,
        P1,
        game.activeEffect!.id,
        undefined,
        undefined,
        ordered,
        ordered ? undefined : firstPending.id
      );
      if (!ordered) {
        expect(game.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
        game = choose(game);
      }
      if (game.activeEffect) game = choose(game);
      expect(game.players[0].hand.cardIds).toEqual(['deck-0', 'deck-1']);
      expect(game.pendingAbilities).toEqual([]);
      expect(game.activeEffect).toBeNull();
    }
  );
});
