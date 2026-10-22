import { describe, expect, it } from 'vitest';
import { HS_PR_043_LIVE_START_BOTTOM_TWO_MEMBERS_HEART_TWELVE_GAIN_BLADE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createHeartIcon } from '../../src/domain/entities/card';
import { emitGameEvent, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  choose,
  chooseMany,
  gameWithCards,
  live,
  member,
  P1,
  P2,
  start,
} from '../helpers/card-effect-zone-fixture';

function setup(total = 12) {
  const cards = [
    member('izumi', { cardCode: 'PL!HS-PR-043-PR' }),
    member('a', { hearts: [createHeartIcon(HeartColor.GREEN, 6)] }),
    member('b', { hearts: [createHeartIcon(HeartColor.RAINBOW, total - 6)] }),
    live('waiting-live'),
    member('old-deck'),
  ];
  const game = updatePlayer(gameWithCards(cards), P1, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'izumi', {
      face: FaceState.FACE_UP,
      orientation: OrientationState.ACTIVE,
    }),
    waitingRoom: { ...p.waitingRoom, cardIds: ['a', 'b', 'waiting-live'] },
    mainDeck: { ...p.mainDeck, cardIds: ['old-deck'] },
  }));
  return start(game, ABILITY, 'izumi');
}
function reward(game: GameState) {
  return game.liveResolution.liveModifiers.filter((m) => m.abilityId === ABILITY);
}

describe('PL!HS-PR-043 费用7「桂城泉」', () => {
  it.each([11, 12, 13])(
    'pays exactly two in order and checks moved ordinary Heart total %i',
    (total) => {
      const started = setup(total);
      expect(started.activeEffect).toMatchObject({
        minSelectableCards: 2,
        maxSelectableCards: 2,
        selectableCardIds: ['a', 'b'],
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
      });
      const reveal = chooseMany(started, ['b', 'a']);
      expect(reveal.players[0].waitingRoom.cardIds).toEqual(['a', 'b', 'waiting-live']);
      expect(reward(reveal)).toEqual([]);
      expect(
        reveal.actionHistory.filter(
          (action) => action.type === 'PAY_COST' && action.payload.abilityId === ABILITY
        )
      ).toEqual([]);
      const done = choose(reveal);
      expect(done.players[0].mainDeck.cardIds).toEqual(['old-deck', 'b', 'a']);
      expect(done.players[0].waitingRoom.cardIds).toEqual(['waiting-live']);
      expect(reward(done)).toHaveLength(total >= 12 ? 1 : 0);
      if (total >= 12)
        expect(reward(done)[0]).toMatchObject({
          kind: 'BLADE',
          target: 'SOURCE_MEMBER',
          countDelta: 3,
          sourceCardId: 'izumi',
        });
      const events = done.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.event).toMatchObject({
        movedCardIds: ['b', 'a'],
        destination: { kind: 'BOTTOM' },
      });
      expect(
        done.actionHistory.filter(
          (action) => action.type === 'PAY_COST' && action.payload.abilityId === ABILITY
        )
      ).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({
            movedCardIds: ['b', 'a'],
            waitingRoomCardsMovedToMainDeckEventId: events[0]?.event.eventId,
          }),
        }),
      ]);
      expect(done.activeEffect).toBeNull();
    }
  );
  it('declines and rejects wrong count, duplicates and LIVE cards', () => {
    const game = setup();
    for (const ids of [['a'], ['a', 'a'], ['a', 'waiting-live'], ['a', 'b', 'waiting-live']])
      expect(chooseMany(game, ids)).toBe(game);
    const declined = chooseMany(game, []);
    expect(declined.players[0].waitingRoom.cardIds).toEqual(game.players[0].waitingRoom.cardIds);
    expect(declined.activeEffect).toBeNull();
    expect(reward(declined)).toEqual([]);
    expect(declined.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });
  it('does not partially move a stale revealed batch and can finish without a reward after source leaves', () => {
    const revealed = chooseMany(setup(), ['a', 'b']);
    const stale = updatePlayer(revealed, P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: ['b', 'waiting-live'] },
    }));
    const cancelled = choose(stale);
    expect(cancelled.players[0].mainDeck.cardIds).toEqual(['old-deck']);
    expect(reward(cancelled)).toEqual([]);
    expect(cancelled.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    const sourceLeft = updatePlayer(revealed, P1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
    }));
    const paid = choose(sourceLeft);
    expect(paid.players[0].mainDeck.cardIds).toEqual(['old-deck', 'a', 'b']);
    expect(reward(paid)).toEqual([]);
  });
  it('uses authoritative dwell, projects selected cards to both players and advances exactly once', () => {
    let now = 1000;
    const session = createGameSession({ now: () => now });
    session.createGame('izumi-dwell', P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = setup();
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          ['b', 'a']
        )
      ).success
    ).toBe(true);
    const reveal = session.state!.activeEffect!;
    expect(reveal.publicCardSelectionOrdered).toBe(true);
    for (const player of [P1, P2])
      expect(
        projectPlayerViewState(session.state!, player).objects[createPublicObjectId('a')].surface
      ).toBe('FRONT');
    const deadline = reveal.publicCardSelectionAutoAdvanceAt!;
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, deadline))
        .success
    ).toBe(false);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['old-deck']);
    now = deadline;
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, deadline))
        .success
    ).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['old-deck', 'b', 'a']);
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P1, reveal.id, deadline))
        .success
    ).toBe(false);
  });
  it('keeps the complete payment but cannot reward a reentered source instance', () => {
    const revealed = chooseMany(setup(), ['a', 'b']);
    const reentered = emitGameEvent(
      revealed,
      createEnterStageEvent('izumi', ZoneType.HAND, SlotPosition.CENTER, P1, P1)
    );
    const done = choose(reentered);
    expect(done.players[0].mainDeck.cardIds).toEqual(['old-deck', 'a', 'b']);
    expect(reward(done)).toEqual([]);
  });
});
