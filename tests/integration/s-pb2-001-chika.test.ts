import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_BP6_002_AUTO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING_TOP_BOTTOM_ABILITY_ID as RIKO_AUTO,
  S_PB2_001_AUTO_STACK_AQOURS_LIVE_ABILITY_ID as AUTO,
  S_PB2_001_LIVE_START_RETURN_AQOURS_LIVES_ABILITY_ID as LIVE_START,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { returnStageMemberToHandAndEnqueueTriggers } from '../../src/application/card-effects/runtime/return-stage-member-to-hand';
import { moveMemberBetweenSlots } from '../../src/application/effects/member-state';
import { resolveLiveZoneToWaitingRoomTriggers } from '../../src/application/effects/live-zone-waiting-room-triggers';
import {
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
  createSubmitJudgmentCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartRequirement,
  type LiveCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import {
  createEnterStageEvent,
  createEnterWaitingRoomEvent,
  isCardMoveEvent,
  type EnterWaitingRoomEvent,
} from '../../src/domain/events/game-events';
import { addLiveProhibitionUntilLiveEnd } from '../../src/domain/rules/live-prohibitions';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { getNovember20MemberData } from '../helpers/november-20-draft-effects';

const P1 = 'p1';
const P2 = 'p2';
const CHIKA = 'chika';
const CENTER = SlotPosition.CENTER;
const RIGHT = SlotPosition.RIGHT;
const chikaData = getNovember20MemberData('PL!S-pb2-001');
const FACE_UP = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
const FACE_DOWN = { ...FACE_UP, face: FaceState.FACE_DOWN };

function live(cardId: string, ownerId = P1, group = 'Aqours') {
  const data: LiveCardData = {
    cardType: CardType.LIVE,
    cardCode: `PL!S-test-${cardId}`,
    name: cardId,
    groupNames: [group],
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.RED]: 99 }),
  };
  return createCardInstance(data, ownerId, cardId);
}

function setup() {
  const cards = [
    createCardInstance(chikaData, P1, CHIKA),
    createCardInstance({ ...chikaData, cardCode: 'TEST-MEMBER' }, P1, 'member'),
    createCardInstance(getNovember20MemberData('PL!S-bp6-002-P'), P1, 'riko'),
    createCardInstance({ ...chikaData, cardCode: 'TEST-DECK' }, P1, 'deck-1'),
    createCardInstance({ ...chikaData, cardCode: 'TEST-DECK' }, P1, 'deck-2'),
    createCardInstance({ ...chikaData, cardCode: 'TEST-DECK' }, P2, 'deck-3'),
    live('a'),
    live('b'),
    live('other', P1, '虹ヶ咲'),
    live('performance'),
    live('opponent', P2),
  ];
  let game = registerCards(createGameState('chika', P1, 'P1', P2, 'P2'), cards);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, CENTER, CHIKA, FACE_UP),
    mainDeck: { ...player.mainDeck, cardIds: ['deck-1', 'deck-2'] },
  }));
  return updatePlayer(game, P2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: ['deck-3'] },
  }));
}

function withWaiting(game: GameState, ...cardIds: string[]): GameState {
  return updatePlayer(game, P1, (player) => ({
    ...player,
    waitingRoom: { ...player.waitingRoom, cardIds },
  }));
}

function withBelow(game: GameState, ...cardIds: string[]): GameState {
  return updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: cardIds.reduce(
      (slots, id) => addMemberBelowMember(slots, CENTER, id),
      player.memberSlots
    ),
  }));
}

function withLiveSet(game: GameState): GameState {
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, 'performance', FACE_DOWN),
  }));
  return {
    ...game,
    currentPhase: GamePhase.LIVE_SET_PHASE,
    currentSubPhase: SubPhase.LIVE_SET_SECOND_PLAYER,
    activePlayerIndex: 1,
    liveSetCompletedPlayers: [P1],
  };
}

function sessionFrom(game: GameState) {
  const session = createGameSession();
  session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
  return session;
}

function waitingEvents(game: GameState): EnterWaitingRoomEvent[] {
  return game.eventLog.flatMap(({ event }) =>
    isCardMoveEvent(event) && event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      ? [event as EnterWaitingRoomEvent]
      : []
  );
}

function selectOption(game: GameState, option: string) {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    option
  );
}

function startLiveWithBelow(...cardIds: string[]) {
  const session = sessionFrom(withLiveSet(withBelow(setup(), ...cardIds)));
  const command = session.executeCommand(
    createConfirmStepCommand(P2, SubPhase.LIVE_SET_SECOND_PLAYER)
  );
  expect(command.success, command.error).toBe(true);
  expect(session.state?.activeEffect?.abilityId).toBe(LIVE_START);
  return session;
}

describe('PL!S-pb2-001 费用2「高海千歌」', () => {
  it('registers both whole paragraphs by base number', () => {
    const paragraphs = chikaData.cardTextCn!.split('\n\n');
    for (const rarity of ['PP', 'R', 'P+']) {
      const defs = getCardAbilityDefinitionsForCardCode(`PL!S-pb2-001-${rarity}`);
      expect(defs.map((entry) => entry.abilityId)).toEqual([AUTO, LIVE_START]);
      expect(defs.map((entry) => entry.effectText)).toEqual(paragraphs);
    }
  });

  it('independently queues each qualifying moved LIVE, preserves a grouped event and offers each decision', () => {
    let game = withWaiting(setup(), 'a', 'b', 'member', 'other');
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'riko', FACE_UP),
    }));
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: ['opponent'] },
    }));
    game = resolveLiveZoneToWaitingRoomTriggers(game, [
      'a',
      'b',
      'member',
      'other',
      'opponent',
      'a',
    ]);
    const events = waitingEvents(game);
    expect(events.map((event) => event.cardInstanceIds)).toEqual([
      ['a', 'b', 'member', 'other'],
      ['opponent'],
    ]);
    const copies = game.pendingAbilities.filter((ability) => ability.abilityId === AUTO);
    expect(copies.map((ability) => ability.metadata?.movedCardIds)).toEqual([['a'], ['b']]);
    expect(game.pendingAbilities.filter((ability) => ability.abilityId === RIKO_AUTO)).toHaveLength(
      1
    );
    expect(new Set(copies.map((ability) => ability.id)).size).toBe(2);
    expect(
      enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_WAITING_ROOM], {
        enterWaitingRoomEvents: events,
      }).pendingAbilities
    ).toEqual(game.pendingAbilities);
    expect(game.activeEffect?.selectableOptions?.map((option) => option.label)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('本次放置对象：a'),
        expect.stringContaining('本次放置对象：b'),
      ])
    );

    const declined = selectOption(game, copies[0].id);
    const afterDecline = confirmActiveEffectStep(declined, P1, declined.activeEffect!.id);
    const accepted = selectOption(afterDecline, copies[1].id);
    const afterStack = selectOption(accepted, 'stack');
    expect(afterStack.players[0].memberSlots.memberBelow[CENTER]).toEqual(['b']);
    expect(afterStack.players[0].waitingRoom.cardIds).toEqual(['a', 'member', 'other']);
    expect(afterStack.activeEffect?.selectableCardIds).toEqual(['a']);
  });

  it('uses the true failed-LIVE command path, keeps the stacked card public and follows a slot change', () => {
    let game = updatePlayer(setup(), P1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, 'a', FACE_UP),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      liveResolution: { ...game.liveResolution, isInLive: true, performingPlayerId: P1 },
    };
    const session = sessionFrom(game);
    const failed = session.executeCommand(createSubmitJudgmentCommand(P1, new Map()));
    expect(failed.success, failed.error).toBe(true);
    const effect = session.state!.activeEffect!;
    expect(effect.abilityId).toBe(AUTO);
    const stack = createConfirmEffectStepCommand(
      P1,
      effect.id,
      undefined,
      undefined,
      undefined,
      'stack'
    );
    expect(session.executeCommand(stack).success).toBe(true);
    expect(session.executeCommand(stack).success).toBe(false);
    expect(waitingEvents(session.state!)).toHaveLength(1);
    expect(session.getPublicEventsSince(0)).toContainEqual(
      expect.objectContaining({
        type: 'CardMovedPublic',
        from: expect.objectContaining({ zone: ZoneType.WAITING_ROOM }),
        to: expect.objectContaining({ zone: ZoneType.MEMBER_SLOT, slot: CENTER }),
      })
    );
    const moved = moveMemberBetweenSlots(session.state!, P1, CHIKA, RIGHT)!.gameState;
    for (const playerId of [P1, P2]) {
      const view = projectPlayerViewState(moved, playerId);
      const objectId = createPublicObjectId('a');
      expect(view.table.zones.FIRST_MEMBER_RIGHT.memberBelow?.RIGHT).toEqual([objectId]);
      expect(view.objects[objectId]).toMatchObject({
        surface: 'FRONT',
        frontInfo: expect.objectContaining({ cardCode: 'PL!S-test-a' }),
      });
    }
  });

  it('rejects a pending target or a host that has reentered as a new rules object', () => {
    const base = resolveLiveZoneToWaitingRoomTriggers(withWaiting(setup(), 'a'), ['a']);
    const reentered = emitGameEvent(
      base,
      createEnterWaitingRoomEvent(['a'], ZoneType.LIVE_ZONE, P1, P1)
    );
    const replacedHost = emitGameEvent(
      base,
      createEnterStageEvent(CHIKA, ZoneType.HAND, CENTER, P1, P1)
    );
    for (const stale of [reentered, replacedHost]) {
      const done = selectOption(stale, 'stack');
      expect(done.players[0].waitingRoom.cardIds).toEqual(['a']);
      expect(done.players[0].memberSlots.memberBelow[CENTER]).toEqual([]);
      expect(done.activeEffect).toBeNull();
    }
  });

  it('lets either host take the same LIVE once and sends the stack to waiting when that host returns to hand', () => {
    const otherHost = 'second-chika';
    let game = registerCards(withWaiting(setup(), 'a'), [
      createCardInstance(chikaData, P1, otherHost),
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, RIGHT, otherHost, FACE_UP),
    }));
    const ordered = resolveLiveZoneToWaitingRoomTriggers(game, ['a']);
    expect(ordered.pendingAbilities.filter((ability) => ability.abilityId === AUTO)).toHaveLength(
      2
    );
    const choosing = confirmActiveEffectStep(ordered, P1, ordered.activeEffect!.id, otherHost);
    const stacked = selectOption(choosing, 'stack');
    expect(stacked.activeEffect).toBeNull();
    expect(stacked.pendingAbilities).toEqual([]);
    expect(stacked.players[0].memberSlots.memberBelow[RIGHT]).toEqual(['a']);
    expect(stacked.players[0].memberSlots.memberBelow[CENTER]).toEqual([]);
    const returned = returnStageMemberToHandAndEnqueueTriggers(
      stacked,
      P1,
      otherHost,
      enqueueTriggeredCardEffects
    )!.gameState;
    expect(returned.players[0].hand.cardIds).toContain(otherHost);
    expect(returned.players[0].waitingRoom.cardIds).toEqual(['a']);
    expect(waitingEvents(returned).map((event) => event.fromZone)).toEqual([
      ZoneType.LIVE_ZONE,
      ZoneType.MEMBER_SLOT,
    ]);
    expect(resolvePendingCardEffects(returned).gameState.activeEffect).toBeNull();
  });

  it('emits the prohibited LIVE clear event and resumes the regular phase after the new effect', () => {
    let game = withLiveSet(setup());
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, 'opponent', FACE_DOWN),
    }));
    game = addLiveProhibitionUntilLiveEnd(
      { ...game, currentSubPhase: SubPhase.LIVE_SET_SECOND_PLAYER, liveSetCompletedPlayers: [P1] },
      { playerId: P1, sourceCardId: CHIKA, abilityId: 'prohibition-test' }
    );
    const session = sessionFrom(game);
    expect(
      session.executeCommand(createConfirmStepCommand(P2, SubPhase.LIVE_SET_SECOND_PLAYER)).success
    ).toBe(true);
    expect(session.state?.currentPhase).toBe(GamePhase.LIVE_SET_PHASE);
    expect(session.state?.activeEffect?.abilityId).toBe(AUTO);
    const effectId = session.state!.activeEffect!.id;
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, effectId, undefined, undefined, undefined, 'stack')
      ).success
    ).toBe(true);
    expect(waitingEvents(session.state!).map((event) => event.cardInstanceIds)).toEqual([
      ['performance'],
    ]);
    expect(session.state?.players[0].memberSlots.memberBelow[CENTER]).toEqual(['performance']);
    expect(session.state?.currentPhase).toBe(GamePhase.PERFORMANCE_PHASE);
    expect(session.state?.liveResolution.performingPlayerId).toBe(P2);
  });

  it('forces all eligible stacked cards to be placed and keeps the deck order out of public history', () => {
    const session = startLiveWithBelow('a', 'other', 'b', 'member');
    const opened = session.state!;
    const effect = opened.activeEffect!;
    expect(effect).toMatchObject({
      selectableCardIds: ['a', 'b'],
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 2,
      maxSelectableCards: 2,
    });
    const submit = (targetSession: ReturnType<typeof sessionFrom>, ids: readonly string[]) =>
      targetSession.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          effect.id,
          undefined,
          undefined,
          undefined,
          undefined,
          ids
        )
      );
    expect(submit(session, ['a']).success).toBe(false);
    expect(submit(session, ['a', 'a']).success).toBe(false);
    expect(submit(session, ['a', 'other']).success).toBe(false);
    expect(session.state!.players[0].memberSlots.memberBelow[CENTER]).toEqual([
      'a',
      'other',
      'b',
      'member',
    ]);
    const beforeSeq = session.getPublicEventsSince(0).at(-1)?.seq ?? 0;
    const reversed = sessionFrom(opened);
    expect(submit(session, ['b', 'a']).success).toBe(true);
    expect(submit(reversed, ['a', 'b']).success).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['b', 'a', 'deck-1', 'deck-2']);
    expect(reversed.state!.players[0].mainDeck.cardIds).toEqual(['a', 'b', 'deck-1', 'deck-2']);
    expect(session.state!.players[0].memberSlots.memberBelow[CENTER]).toEqual(['other', 'member']);
    expect(session.state!.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        abilityId: LIVE_START,
        kind: 'BLADE',
        target: 'SOURCE_MEMBER',
        countDelta: 2,
        sourceCardId: CHIKA,
      })
    );
    const publicMoves = (targetSession: ReturnType<typeof sessionFrom>, after = 0) =>
      targetSession
        .getPublicEventsSince(after)
        .flatMap((event) =>
          event.type === 'CardMovedPublic' && event.to?.zone === ZoneType.MAIN_DECK
            ? [{ card: event.card?.publicObjectId, destination: event.to }]
            : []
        );
    expect(publicMoves(session, beforeSeq)).toEqual(publicMoves(reversed));
    expect(publicMoves(session, beforeSeq)).toHaveLength(2);
    for (const move of publicMoves(session, beforeSeq))
      expect(move.destination.index).toBeUndefined();
    const view = projectPlayerViewState(session.state!, P2);
    expect(view.table.zones.FIRST_MAIN_DECK.objectIds).toBeUndefined();
    const cheer = session.executeCommand(
      createConfirmStepCommand(P1, SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );
    expect(cheer.success, cheer.error).toBe(true);
    expect(session.state?.liveResolution.firstPlayerCheerCardIds).toEqual(['b', 'a', 'deck-1']);
  });

  it.each([[], ['a']])('confirms only once when no ordering is needed (%s)', (...cardIds) => {
    const session = startLiveWithBelow(...cardIds);
    expect(session.state?.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id))
        .success
    ).toBe(true);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([...cardIds, 'deck-1', 'deck-2']);
    expect(
      session.state?.liveResolution.liveModifiers.filter((entry) => entry.abilityId === LIVE_START)
    ).toHaveLength(cardIds.length);
  });
});
