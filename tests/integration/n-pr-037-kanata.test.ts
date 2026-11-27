import { describe, expect, it } from 'vitest';
import { HS_PR_043_LIVE_START_BOTTOM_TWO_MEMBERS_HEART_TWELVE_GAIN_BLADE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createHeartIcon } from '../../src/domain/entities/card';
import { emitGameEvent, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  createEnterStageEvent,
  createEnterWaitingRoomEvent,
} from '../../src/domain/events/game-events';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
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
} from '../helpers/card-effect-zone-fixture';
import { getNovember20MemberData } from '../helpers/november-20-draft-effects';

const KANATA = 'kanata';
const IZUMI = 'izumi';
const CENTER = SlotPosition.CENTER;
const RIGHT = SlotPosition.RIGHT;
const FACE_UP = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
const TEXT =
  '【LIVE开始时】可以将存在于休息室的２张成员卡按任意顺序放置于卡组底：因此放置于卡组底的成员卡持有的HEART的总数大于等于１２的场合，LIVE结束时为止，获得[ブレード][ブレード][ブレード]。';

function startLive(total = 12, withIzumi = false) {
  const cards = [
    member(KANATA, getNovember20MemberData('PL!N-PR-037-PR')),
    member(IZUMI, getNovember20MemberData('PL!HS-PR-043-PR')),
    member('a', { hearts: [createHeartIcon(HeartColor.GREEN, 6)] }),
    member('b', { hearts: [createHeartIcon(HeartColor.RAINBOW, total - 6)] }),
    member('c', { hearts: [createHeartIcon(HeartColor.YELLOW, 6)] }),
    member('d', { hearts: [createHeartIcon(HeartColor.PURPLE, 6)] }),
    live('waiting-live'),
    live('current-live'),
    member('old-deck'),
    member('opponent-deck', {}, P2),
  ];
  let game = updatePlayer(gameWithCards(cards), P1, (player) => {
    const slots = placeCardInSlot(player.memberSlots, CENTER, KANATA, FACE_UP);
    return {
      ...player,
      memberSlots: withIzumi ? placeCardInSlot(slots, RIGHT, IZUMI, FACE_UP) : slots,
      liveZone: addCardToStatefulZone(player.liveZone, 'current-live', {
        ...FACE_UP,
        face: FaceState.FACE_DOWN,
      }),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: withIzumi ? ['a', 'b', 'c', 'd', 'waiting-live'] : ['a', 'b', 'waiting-live'],
      },
      mainDeck: { ...player.mainDeck, cardIds: ['old-deck'] },
    };
  });
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: ['opponent-deck'] },
  }));
  const session = createGameSession();
  session.restoreRuntimeState({
    authorityState: {
      ...game,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_SECOND_PLAYER,
      activePlayerIndex: 1,
      liveSetCompletedPlayers: [P1],
    },
    currentPublicSeq: 0,
  });
  const result = session.executeCommand(
    createConfirmStepCommand(P2, SubPhase.LIVE_SET_SECOND_PLAYER)
  );
  expect(result.success, result.error).toBe(true);
  expect(session.state?.currentSubPhase).toBe(SubPhase.PERFORMANCE_LIVE_START_EFFECTS);
  return session.state!;
}

function rewards(game: GameState) {
  return game.liveResolution.liveModifiers.filter((modifier) => modifier.abilityId === ABILITY);
}

function movements(game: GameState) {
  return game.eventLog
    .map(({ event }) => event)
    .filter(
      (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
    );
}

describe('PL!N-PR-037 费用7「近江彼方」', () => {
  it('registers the existing equivalent ability and exact card text for all rarities', () => {
    for (const code of ['PL!N-PR-037-PR', 'PL!N-PR-037-P+', 'PL!HS-PR-043-PR']) {
      expect(getCardAbilityDefinitionsForCardCode(code)).toMatchObject([
        { abilityId: ABILITY, effectText: TEXT, triggerCondition: TriggerCondition.ON_LIVE_START },
      ]);
    }
  });

  it.each([11, 12])(
    'pays exactly two in order from a real Live Start and checks %i Heart',
    (total) => {
      const started = startLive(total);
      expect(started.activeEffect).toMatchObject({
        sourceCardId: KANATA,
        abilityId: ABILITY,
        stepId: 'HS_PR_043_SELECT_TWO_MEMBERS_TO_DECK_BOTTOM',
        effectText: TEXT,
        selectableCardIds: ['a', 'b'],
        minSelectableCards: 2,
        maxSelectableCards: 2,
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
      });
      const reveal = chooseMany(started, ['b', 'a']);
      expect(new Set(reveal.activeEffect?.revealedCardIds)).toEqual(new Set(['a', 'b']));
      expect(reveal.players[0].mainDeck.cardIds).toEqual(['old-deck']);
      expect(movements(reveal)).toEqual([]);
      const done = choose(reveal);
      expect(done.players[0].mainDeck.cardIds).toEqual(['old-deck', 'b', 'a']);
      expect(done.players[0].waitingRoom.cardIds).toEqual(['waiting-live']);
      expect(movements(done)).toMatchObject([
        {
          movedCardIds: ['b', 'a'],
          destination: { kind: 'BOTTOM' },
          cause: { abilityId: ABILITY, sourceCardId: KANATA },
        },
      ]);
      expect(done.actionHistory.filter((action) => action.type === 'PAY_COST')).toMatchObject([
        {
          payload: {
            movedCardIds: ['b', 'a'],
            waitingRoomCardsMovedToMainDeckEventId: movements(done)[0].eventId,
          },
        },
      ]);
      expect(rewards(done)).toMatchObject(
        total === 12
          ? [{ kind: 'BLADE', target: 'SOURCE_MEMBER', sourceCardId: KANATA, countDelta: 3 }]
          : []
      );
      expect(done.activeEffect).toBeNull();
    }
  );

  it('allows skipping without payment and rejects malformed or reentered selections atomically', () => {
    const started = startLive();
    for (const invalid of [['a'], ['a', 'a'], ['b', 'waiting-live']]) {
      expect(chooseMany(started, invalid)).toBe(started);
    }
    const skipped = chooseMany(started, []);
    const reveal = chooseMany(started, ['a', 'b']);
    const reentered = emitGameEvent(
      reveal,
      createEnterWaitingRoomEvent(['a'], ZoneType.MAIN_DECK, P1, P1)
    );
    for (const finished of [skipped, choose(reentered)]) {
      expect(finished.players[0].mainDeck.cardIds).toEqual(['old-deck']);
      expect(finished.players[0].waitingRoom.cardIds).toEqual(['a', 'b', 'waiting-live']);
      expect(finished.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
      expect(movements(finished)).toEqual([]);
      expect(rewards(finished)).toEqual([]);
      expect(finished.activeEffect).toBeNull();
    }
  });

  it('retains legal payment after the original source leaves and grants nothing to a reentered source', () => {
    const reveal = chooseMany(startLive(), ['a', 'b']);
    const left = updatePlayer(reveal, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, CENTER),
    }));
    const reentered = emitGameEvent(
      reveal,
      createEnterStageEvent(KANATA, ZoneType.HAND, CENTER, P1, P1)
    );
    for (const game of [left, reentered]) {
      const done = choose(game);
      expect(done.players[0].mainDeck.cardIds).toEqual(['old-deck', 'a', 'b']);
      expect(movements(done)).toHaveLength(1);
      expect(rewards(done)).toEqual([]);
    }
  });

  it('queues the same ability separately for Izumi and Kanata and applies each reward to its source', () => {
    const started = startLive(12, true);
    expect(started.pendingAbilities).toMatchObject([
      { abilityId: ABILITY, sourceCardId: KANATA },
      { abilityId: ABILITY, sourceCardId: IZUMI },
    ]);
    expect(new Set(started.pendingAbilities.map((pending) => pending.id)).size).toBe(2);
    const first = choose(chooseMany(choose(started, IZUMI), ['d', 'c']));
    expect(first.activeEffect).toMatchObject({ abilityId: ABILITY, sourceCardId: KANATA });
    expect(first.activeEffect?.selectableCardIds).toEqual(['a', 'b']);
    const done = choose(chooseMany(first, ['b', 'a']));
    expect(done.players[0].mainDeck.cardIds).toEqual(['old-deck', 'd', 'c', 'b', 'a']);
    expect(rewards(done)).toMatchObject([
      { sourceCardId: IZUMI, countDelta: 3 },
      { sourceCardId: KANATA, countDelta: 3 },
    ]);
    expect(movements(done)).toMatchObject([
      { movedCardIds: ['d', 'c'], cause: { sourceCardId: IZUMI } },
      { movedCardIds: ['b', 'a'], cause: { sourceCardId: KANATA } },
    ]);
    expect(done.activeEffect).toBeNull();
  });

  it.each([true, false])(
    'shows the same public information for either order (deck already contains cards: %s)',
    (deckHasCards) => {
      const started = startLive();
      const opened = deckHasCards
        ? started
        : updatePlayer(started, P1, (player) => ({
            ...player,
            mainDeck: { ...player.mainDeck, cardIds: [] },
            hand: { ...player.hand, cardIds: ['old-deck'] },
          }));
      const run = (ids: readonly string[]) => {
        let now = 1000;
        const session = createGameSession({ now: () => now });
        session.restoreRuntimeState({ authorityState: opened, currentPublicSeq: 0 });
        const submit = session.executeCommand(
          createConfirmEffectStepCommand(
            P1,
            opened.activeEffect!.id,
            undefined,
            undefined,
            undefined,
            undefined,
            ids
          )
        );
        expect(submit.success, submit.error).toBe(true);
        const reveal = session.state!.activeEffect!;
        const projected = [P1, P2].map((playerId) =>
          projectPlayerViewState(session.state!, playerId, { now })
        );
        for (const view of projected) {
          expect(view.activeEffect).toMatchObject({
            revealedObjectIds: [createPublicObjectId('a'), createPublicObjectId('b')],
            publicCardSelectionOrdered: false,
          });
          for (const id of ['a', 'b']) {
            expect(view.objects[createPublicObjectId(id)]?.surface).toBe('FRONT');
          }
        }
        const deadline = reveal.publicCardSelectionAutoAdvanceAt!;
        now = deadline;
        const settle = session.executeCommand(
          createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, deadline)
        );
        expect(settle.success, settle.error).toBe(true);
        const state = session.state!;
        expect(state.players[0].mainDeck.cardIds).toEqual([
          ...(deckHasCards ? ['old-deck'] : []),
          ...ids,
        ]);
        expect(
          projectPlayerViewState(state, P2).table.zones.FIRST_MAIN_DECK.objectIds
        ).toBeUndefined();
        const events = session
          .getPublicEventsSince(0)
          .map(({ eventId, seq, timestamp, ...publicEvent }) => publicEvent);
        const moves = events.filter(
          (event) => event.type === 'CardMovedPublic' && event.to?.zone === ZoneType.MAIN_DECK
        );
        expect(moves).toHaveLength(2);
        for (const move of moves) {
          expect(move).toMatchObject({ to: { zone: ZoneType.MAIN_DECK } });
          expect(move).not.toHaveProperty('to.index');
        }
        return { reveal: projected[1].activeEffect, events };
      };
      expect(run(['b', 'a'])).toEqual(run(['a', 'b']));
    }
  );
});
