import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_AD1_001_AUTO_ON_CHEER_ORANGE_ADDITIONAL_CHEER_ABILITY_ID as AUTO,
  SP_AD1_001_LIVE_START_DISCARD_RECOVER_LIVE_OR_DRAW_AND_SEVENTH_ABILITY_ID as START,
} from '../../src/application/card-effects/ability-ids';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { revealCheerCardsFromMainDeck } from '../../src/application/effects/cheer';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartRequirement,
  type BladeHearts,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  createCheerEvent,
  createEnterStageEvent,
  createEnterWaitingRoomEvent,
  createLiveStartEvent,
} from '../../src/domain/events/game-events';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import {
  BladeHeartEffect as B,
  CardType,
  FaceState,
  GamePhase,
  HeartColor as H,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition as T,
  ZoneType,
} from '../../src/shared/types/enums';
import { createNovember10OrangeCard } from '../helpers/november-10-orange-effects';

const P = 'p1';
function member(id: string, bladeHearts?: BladeHearts) {
  const data: MemberCardData = {
    cardCode: `TEST-${id}`,
    name: id,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [],
    bladeHearts,
  };
  return createCardInstance(data, P, id);
}
function live(id: string) {
  const data: LiveCardData = {
    cardCode: `TEST-${id}`,
    name: id,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [H.RED]: 1 }),
  };
  return createCardInstance(data, P, id);
}
function setup(hand: string[] = ['discard-member'], deckCount = 10): GameState {
  const cards = [
    createNovember10OrangeCard('PL!SP-ad1-001', P, 'source'),
    member('discard-member'),
    live('discard-live'),
    live('recover-live'),
    ...[H.ORANGE, H.GRAY, H.RAINBOW, H.RED].map((color) =>
      member(color, [{ effect: B.HEART, heartColor: color }])
    ),
    member('draw', [{ effect: B.DRAW }]),
    ...Array.from({ length: 12 }, (_, i) =>
      member(`deck-${i}`, i === 0 ? [{ effect: B.DRAW }] : undefined)
    ),
  ];
  let game = registerCards(createGameState('kanon', P, 'P1', 'p2', 'P2'), cards);
  game = updatePlayer(game, P, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'source'),
    hand: { ...p.hand, cardIds: hand },
    waitingRoom: { ...p.waitingRoom, cardIds: ['recover-live'] },
    mainDeck: { ...p.mainDeck, cardIds: Array.from({ length: deckCount }, (_, i) => `deck-${i}`) },
  }));
  game = emitGameEvent(
    game,
    createEnterStageEvent('source', ZoneType.HAND, SlotPosition.CENTER, P, P)
  );
  return {
    ...game,
    liveResolution: { ...game.liveResolution, isInLive: true, performingPlayerId: P },
  };
}
function liveStart(game: GameState) {
  const e = createLiveStartEvent(P, []);
  return enqueueTriggeredCardEffects(emitGameEvent(game, e), [T.ON_LIVE_START], {
    liveStartEvents: [e],
  });
}
function open(game: GameState) {
  return resolvePendingCardEffects(game).gameState;
}
function select(game: GameState, id?: string | null) {
  return confirmActiveEffectStep(game, P, game.activeEffect!.id, id);
}
function cheers(game: GameState, ids: string[], additional = false, playerId = P) {
  const e = createCheerEvent(playerId, ids, ids.length, { automated: true, additional });
  const key = playerId === P ? 'firstPlayerCheerCardIds' : 'secondPlayerCheerCardIds';
  return enqueueTriggeredCardEffects(
    emitGameEvent(
      {
        ...game,
        liveResolution: { ...game.liveResolution, [key]: [...game.liveResolution[key], ...ids] },
      },
      e
    ),
    [T.ON_CHEER],
    { cheerEvents: [e] }
  );
}
function resolveCheer(game: GameState) {
  const state = open(game);
  return state.activeEffect ? select(state) : state;
}
function additions(game: GameState) {
  return game.actionHistory.filter((a) => a.type === 'CHEER' && a.payload.additional === true);
}
function uses(game: GameState) {
  return game.actionHistory.filter(
    (a) => a.payload.abilityId === AUTO && a.payload.step === 'ABILITY_USE'
  );
}

describe('PL!SP-ad1-001 费用13「涩谷香音」', () => {
  it('forces a single hand discard as an effect, then publicly recovers any LIVE without a second public window', () => {
    const start = open(liveStart(setup()));
    expect(start.activeEffect?.abilityId).toBe(START);
    expect(start.activeEffect?.canSkipSelection).toBe(false);
    expect(start.activeEffect?.autoSubmitSingleSelection).toBe(true);
    expect(start.activeEffect?.metadata?.effectCosts).toBeUndefined();
    expect(select(start, null)).toBe(start);
    expect(select(start, 'recover-live')).toBe(start);
    expect(
      confirmActiveEffectStep(
        start,
        P,
        start.activeEffect!.id,
        'discard-member',
        undefined,
        undefined,
        undefined,
        ['discard-member']
      )
    ).toBe(start);
    expect(
      confirmActiveEffectStep(
        start,
        P,
        start.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        ['discard-member']
      )
    ).toBe(start);
    const recovered = select(start, 'discard-member');
    expect(recovered.players[0].waitingRoom.cardIds).toContain('discard-member');
    expect(recovered.activeEffect?.canSkipSelection).toBe(false);
    expect(recovered.activeEffect?.autoSubmitSingleSelection).toBe(true);
    expect(
      confirmActiveEffectStep(
        recovered,
        P,
        recovered.activeEffect!.id,
        'recover-live',
        undefined,
        undefined,
        undefined,
        ['recover-live']
      )
    ).toBe(recovered);
    expect(recovered.actionHistory.filter((a) => a.type === 'PAY_COST')).toEqual([]);
    expect(
      recovered.eventLog.filter(({ event }) => event.eventType === T.ON_ENTER_WAITING_ROOM)
    ).toHaveLength(1);
    const reveal = select(recovered, 'recover-live');
    expect(reveal.activeEffect?.stepId).toBe('COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION');
    expect(reveal.activeEffect?.revealedCardIds).toEqual(['recover-live']);
    expect(reveal.players[0].hand.cardIds).toEqual([]);
    const done = select(reveal);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].hand.cardIds).toEqual(['recover-live']);
    expect(done.pendingAbilities).toEqual([]);
    expect(confirmActiveEffectStep(done, P, reveal.activeEffect!.id)).toBe(done);
  });
  it('rejects stale discard/recovery input and leaves a mandatory selection available', () => {
    let game = open(liveStart(setup()));
    const stale = updatePlayer(game, P, (p) => ({ ...p, hand: { ...p.hand, cardIds: [] } }));
    expect(select(stale, 'discard-member')).toBe(stale);
    game = select(game, 'discard-member');
    const withoutLive = updatePlayer(game, P, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: ['discard-member'] },
    }));
    expect(select(withoutLive, 'recover-live').activeEffect).toBeNull();
  });
  it('does not recover the same physical card after it leaves and reenters during its public window', () => {
    let game = select(select(open(liveStart(setup())), 'discard-member'), 'recover-live');
    game = emitGameEvent(game, createEnterWaitingRoomEvent(['recover-live'], ZoneType.HAND, P, P));
    const done = select(game);
    expect(done.players[0].hand.cardIds).toEqual([]);
    expect(done.players[0].waitingRoom.cardIds).toContain('recover-live');
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
  });
  it.each([12, 13])(
    'uses the RULES play command and pays all thirteen energy with %i available',
    (count) => {
      const session = createGameSession();
      session.createGame('kanon-play', P, 'P1', 'p2', 'P2');
      const energies = Array.from({ length: count }, (_, i) =>
        createCardInstance(
          { cardCode: `ENERGY-${i}`, name: `energy ${i}`, cardType: CardType.ENERGY },
          P,
          `energy-${i}`
        )
      );
      let game = registerCards(setup(['source', 'discard-member']), energies);
      game = {
        ...game,
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.NONE,
        liveResolution: { ...game.liveResolution, isInLive: false, performingPlayerId: null },
      };
      game = updatePlayer(game, P, (p) => ({
        ...p,
        memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
        energyZone: {
          ...p.energyZone,
          cardIds: energies.map((e) => e.instanceId),
          cardStates: new Map(
            energies.map((e) => [
              e.instanceId,
              { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
            ])
          ),
        },
      }));
      (session as unknown as { authorityState: GameState }).authorityState = game;
      const result = session.executeCommand(
        createPlayMemberToSlotCommand(P, 'source', SlotPosition.CENTER)
      );
      expect(result.success).toBe(count === 13);
      if (count === 12) {
        expect(session.state?.players[0].hand.cardIds).toContain('source');
        expect(session.state?.players[0].memberSlots.slots.CENTER).toBeNull();
      } else {
        const state = session.state!;
        expect(state.players[0].memberSlots.slots.CENTER).toBe('source');
        expect(
          [...state.players[0].energyZone.cardStates.values()].filter(
            (s) => s.orientation === OrientationState.WAITING
          )
        ).toHaveLength(13);
        expect(
          state.actionHistory.some((a) => a.type === 'PAY_COST' && a.payload.amount === 13)
        ).toBe(true);
        expect(open(liveStart(state)).activeEffect?.abilityId).toBe(START);
      }
    }
  );
  it('still discards with no subsequent LIVE target and finishes normally with no hand', () => {
    const noTarget = updatePlayer(setup(), P, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: [] },
    }));
    const done = select(open(liveStart(noTarget)), 'discard-member');
    expect(done.players[0].hand.cardIds).toEqual([]);
    expect(done.players[0].waitingRoom.cardIds).toEqual(['discard-member']);
    expect(done.activeEffect).toBeNull();
    const empty = open(liveStart(setup([])));
    const emptyDone = empty.activeEffect ? select(empty) : empty;
    expect(emptyDone.activeEffect).toBeNull();
    expect(emptyDone.pendingAbilities).toEqual([]);
  });
  it.each([3, 10])(
    'draws after discarding a LIVE and puts exactly that card seventh or at the bottom of a short %i-card deck',
    (count) => {
      const done = select(open(liveStart(setup(['discard-live'], count))), 'discard-live');
      expect(done.players[0].hand.cardIds).toEqual(['deck-0']);
      expect(done.players[0].mainDeck.cardIds.indexOf('discard-live')).toBe(Math.min(6, count - 1));
      expect(done.players[0].waitingRoom.cardIds).toEqual(['recover-live']);
      expect(done.activeEffect).toBeNull();
      const event = done.eventLog.find(
        ({ event }) => event.eventType === T.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      )?.event;
      expect(event).toMatchObject({
        movedCardIds: ['discard-live'],
        destination: { kind: 'POSITION', positionFromTop: 7 },
      });
    }
  );
  it.each([0, 1])(
    'does not move a refreshed original discard back to seventh when drawing from a %i-card deck',
    (count) => {
      const game = updatePlayer(setup(['discard-live'], count), P, (p) => ({
        ...p,
        waitingRoom: { ...p.waitingRoom, cardIds: [] },
      }));
      const done = select(open(liveStart(game)), 'discard-live');
      const moves = done.eventLog
        .filter(({ event }) => event.eventType === T.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK)
        .map(({ event }) => event);
      expect(
        moves.some(
          (e) =>
            e.eventType === T.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK &&
            'destination' in e &&
            typeof e.destination === 'object' &&
            e.destination.kind === 'POSITION'
        )
      ).toBe(false);
      expect(
        done.actionHistory.find((a) => a.payload.step === 'DRAW_AND_PLACE_ORIGINAL_DISCARD_SEVENTH')
          ?.payload.discardedCardLeftWaitingRoom
      ).toBe(true);
    }
  );
  it('resolves both independent branches after its source has left the stage', () => {
    for (const hand of ['discard-live', 'discard-member']) {
      let game = liveStart(setup([hand]));
      game = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
        game,
        P,
        'source',
        enqueueTriggeredCardEffects
      )!.gameState;
      game = select(open(game), hand);
      if (game.activeEffect) game = select(select(game, 'recover-live'));
      expect(game.activeEffect).toBeNull();
      expect(game.players[0].hand.cardIds).toEqual([
        hand === 'discard-live' ? 'deck-0' : 'recover-live',
      ]);
    }
  });
  it('uses historical effective ORANGE, immediately resolves additional DRAW and does not recurse', () => {
    const done = resolveCheer(cheers(setup([]), ['ORANGE']));
    expect(additions(done)).toHaveLength(1);
    expect(additions(done)[0]?.payload.cheerCardIds).toHaveLength(2);
    expect(done.players[0].hand.cardIds).toEqual(['deck-2']);
    expect(done.resolutionZone.cardIds).toEqual(['deck-0', 'deck-1']);
    expect(done.pendingAbilities).toEqual([]);
    expect(uses(done)).toHaveLength(1);
    expect(cheers(done, ['ORANGE']).pendingAbilities).toEqual([]);
  });
  it('queues from the real normal-cheer reveal helper after its batch finishes', () => {
    const game = updatePlayer(setup([]), P, (p) => ({
      ...p,
      mainDeck: { ...p.mainDeck, cardIds: ['ORANGE', ...p.mainDeck.cardIds] },
    }));
    const normal = revealCheerCardsFromMainDeck(game, P, 1, { automated: true });
    const queued = enqueueTriggeredCardEffects(normal.gameState, [T.ON_CHEER], {
      cheerEvents: [normal.cheerEvent!],
    });
    expect(queued.pendingAbilities.map((p) => p.abilityId)).toEqual([AUTO]);
    const done = resolveCheer(queued);
    expect(additions(done)).toHaveLength(1);
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].hand.cardIds).toEqual(['deck-2']);
  });
  it.each(['GRAY', 'RAINBOW', 'RED', 'draw'])(
    'does not count %s as ORANGE and still consumes turn1',
    (id) => {
      const done = resolveCheer(cheers(setup([]), [id]));
      expect(additions(done)).toEqual([]);
      expect(uses(done)).toHaveLength(1);
    }
  );
  it('uses replacements in both directions at resolution and includes previous additional history', () => {
    let game = addLiveModifier(setup([]), {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: P,
      fromColors: [H.ORANGE],
      toColor: H.RED,
    });
    expect(additions(resolveCheer(cheers(game, ['ORANGE'])))).toEqual([]);
    game = addLiveModifier(setup([]), {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: P,
      fromColors: [H.RED],
      toColor: H.ORANGE,
    });
    expect(additions(resolveCheer(cheers(cheers(game, ['RED'], true), ['draw'])))).toHaveLength(1);
    game = open(cheers(setup([]), ['ORANGE']));
    game = addLiveModifier(game, {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: P,
      fromColors: [H.ORANGE],
      toColor: H.RED,
    });
    expect(additions(select(game))).toEqual([]);
  });
  it('ignores additional and opponent triggers, keeps old lifecycle after source leaves, and permits reentry', () => {
    expect(cheers(setup([]), ['ORANGE'], true).pendingAbilities).toEqual([]);
    expect(cheers(setup([]), ['ORANGE'], false, 'p2').pendingAbilities).toEqual([]);
    let game = cheers(setup([]), ['ORANGE']);
    const oldLifecycle = game.pendingAbilities[0]!.sourceLifecycleId;
    game = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      game,
      P,
      'source',
      enqueueTriggeredCardEffects
    )!.gameState;
    game = resolveCheer(game);
    expect(additions(game)).toHaveLength(1);
    expect(uses(game)[0]?.payload.sourceLifecycleId).toBe(oldLifecycle);
    game = updatePlayer(game, P, (p) => ({
      ...p,
      waitingRoom: {
        ...p.waitingRoom,
        cardIds: p.waitingRoom.cardIds.filter((id) => id !== 'source'),
      },
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'source'),
    }));
    game = emitGameEvent(
      game,
      createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P, P)
    );
    expect(cheers(game, ['ORANGE']).pendingAbilities.some((p) => p.abilityId === AUTO)).toBe(true);
  });
});
