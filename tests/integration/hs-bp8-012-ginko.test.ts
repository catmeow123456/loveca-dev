import { describe, expect, it } from 'vitest';
import { HS_BP8_012_ON_ENTER_SHUFFLE_WAITING_MEMBERS_BOTTOM_CERISE_GAIN_HEART_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { updatePlayer } from '../../src/domain/entities/game';
import { emitGameEvent } from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  gameWithCards,
  live,
  member,
  pending,
  P1,
  start,
} from '../helpers/card-effect-zone-fixture';

function setup(ceriseCount: number, sourceInStage = true) {
  const cards = [
    member('ginko', { cardCode: 'PL!HS-bp8-012-N', unitName: 'スリーズブーケ' }),
    ...Array.from({ length: ceriseCount }, (_, i) =>
      member(`cerise-${i}`, { unitName: i % 2 ? 'Cerise Bouquet' : 'スリーズブーケ' })
    ),
    member('other-member', { unitName: 'DOLLCHESTRA' }),
    live('waiting-live'),
    member('old-top'),
    member('old-bottom'),
  ];
  let game = updatePlayer(gameWithCards(cards), P1, (p) => ({
    ...p,
    memberSlots: sourceInStage
      ? placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'ginko', {
          face: FaceState.FACE_UP,
          orientation: OrientationState.ACTIVE,
        })
      : p.memberSlots,
    waitingRoom: {
      ...p.waitingRoom,
      cardIds: [
        ...Array.from({ length: ceriseCount }, (_, i) => `cerise-${i}`),
        'other-member',
        'waiting-live',
        ...(sourceInStage ? [] : ['ginko']),
      ],
    },
    mainDeck: { ...p.mainDeck, cardIds: ['old-top', 'old-bottom'] },
  }));
  return game;
}
describe('PL!HS-bp8-012 费用7「百生吟子」', () => {
  it.each([2, 3, 4])(
    'shuffles all and only waiting members and rewards at three Cerise (%i)',
    (count) => {
      const before = setup(count);
      const done = start(before, ABILITY, 'ginko', TriggerCondition.ON_ENTER_STAGE);
      expect(done.players[0].waitingRoom.cardIds).toEqual(['waiting-live']);
      expect(done.players[0].mainDeck.cardIds.slice(0, 2)).toEqual(['old-top', 'old-bottom']);
      expect(new Set(done.players[0].mainDeck.cardIds.slice(2))).toEqual(
        new Set(before.players[0].waitingRoom.cardIds.filter((id) => id !== 'waiting-live'))
      );
      const reward = done.liveResolution.liveModifiers.filter((m) => m.abilityId === ABILITY);
      expect(reward).toHaveLength(count >= 3 ? 1 : 0);
      if (count >= 3)
        expect(reward[0]).toMatchObject({
          kind: 'HEART',
          target: 'SOURCE_MEMBER',
          hearts: [{ color: HeartColor.GREEN, count: 2 }],
          sourceCardId: 'ginko',
        });
      const events = done.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.event).toMatchObject({
        movedCardIds: done.players[0].mainDeck.cardIds.slice(2),
        destination: { kind: 'SHUFFLED_BOTTOM' },
      });
      expect(done.activeEffect).toBeNull();
    }
  );
  it('keeps non-member waiting cards and emits no zero-card movement event', () => {
    let game = setup(0);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: ['waiting-live'] },
    }));
    const done = start(game, ABILITY, 'ginko', TriggerCondition.ON_ENTER_STAGE);
    expect(done.players[0].mainDeck.cardIds).toEqual(['old-top', 'old-bottom']);
    expect(done.players[0].waitingRoom.cardIds).toEqual(['waiting-live']);
    expect(
      done.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      )
    ).toEqual([]);
    expect(done.pendingAbilities).toEqual([]);
  });
  it('still recycles from a waiting-room delegated source and does not reward an absent stage instance', () => {
    const done = start(setup(3, false), ABILITY, 'ginko', TriggerCondition.ON_ENTER_STAGE);
    expect(done.players[0].mainDeck.cardIds).toContain('ginko');
    expect(done.players[0].waitingRoom.cardIds).toEqual(['waiting-live']);
    expect(done.liveResolution.liveModifiers.filter((m) => m.abilityId === ABILITY)).toEqual([]);
  });
  it('finishes the recycle but does not transfer an old pending reward to a reentered Ginko', () => {
    const first = createEnterStageEvent('ginko', ZoneType.HAND, SlotPosition.CENTER, P1, P1);
    let game = emitGameEvent(setup(3), first);
    const ability = {
      ...pending(ABILITY, 'ginko', TriggerCondition.ON_ENTER_STAGE),
      eventIds: [first.eventId],
    };
    game = emitGameEvent(
      game,
      createEnterStageEvent('ginko', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
    );
    const done = resolvePendingCardEffects({ ...game, pendingAbilities: [ability] }).gameState;
    expect(done.players[0].waitingRoom.cardIds).toEqual(['waiting-live']);
    expect(done.liveResolution.liveModifiers.filter((m) => m.abilityId === ABILITY)).toEqual([]);
  });
});
