import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_AD2_001_AUTO_ON_CHEER_TWO_NO_BLADE_HEART_ADDITIONAL_CHEER_ABILITY_ID as AUTO,
  HS_AD2_001_LIVE_SUCCESS_MORE_REVEALED_CHEER_DRAW_ONE_ABILITY_ID as DRAW,
} from '../../src/application/card-effects/ability-ids';
import { getAbilitySourceLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
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
import {
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  createCheerEvent,
  createEnterStageEvent,
  createLiveSuccessEvent,
} from '../../src/domain/events/game-events';
import {
  collectLiveModifiers,
  getMemberEffectiveBladeCount,
} from '../../src/domain/rules/live-modifiers';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  createNovember07DraftCard,
  getNovember07MemberData,
} from '../helpers/november-07-draft-effects';

const P1 = 'p1';
const P2 = 'p2';
const BASE = 'PL!HS-ad2-001';
const AUTO_TEXT =
  '【自动】【１回合１次】自己进行声援时，因声援被公开的自己的卡片中存在大于等于２张不持有BLADE HEART的卡片的场合，追加进行１张卡片的声援。';
const DRAW_TEXT =
  '【LIVE成功时】因声援被公开的自己的卡片的张数，比因声援被公开的对方的卡片的张数多的场合，抽１张卡。';

function member(id: string, bladeHearts?: BladeHearts, owner = P1, name = id) {
  const data: MemberCardData = {
    cardCode: `TEST-${id}`,
    name,
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [],
    groupNames: ['Aqours'],
    bladeHearts,
  };
  return createCardInstance(data, owner, id);
}

function setup(sourceCount = 1): GameState {
  const sources = Array.from({ length: sourceCount }, (_, index) =>
    createNovember07DraftCard(BASE, P1, index === 0 ? 'source' : 'source2')
  );
  const liveData: LiveCardData = {
    cardCode: 'TEST-LIVE',
    name: '合成LIVE',
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
  };
  const cards = [
    ...sources,
    member('none'),
    member('empty', []),
    member('draw', [{ effect: BladeHeartEffect.DRAW }]),
    member('score', [{ effect: BladeHeartEffect.SCORE }]),
    member('all', [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }]),
    member('invalid', null as unknown as BladeHearts),
    member('opponent', undefined, P2),
    ...Array.from({ length: 5 }, (_, i) => member(`deck-${i}`)),
    createCardInstance(liveData, P1, 'live'),
  ];
  let game = registerCards(createGameState('hs-ad2-001', P1, 'P1', P2, 'P2'), cards);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: sources.reduce(
      (slots, source, index) =>
        placeCardInSlot(
          slots,
          index === 0 ? SlotPosition.CENTER : SlotPosition.LEFT,
          source.instanceId,
          {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }
        ),
      player.memberSlots
    ),
    mainDeck: { ...player.mainDeck, cardIds: Array.from({ length: 5 }, (_, i) => `deck-${i}`) },
    liveZone: { ...player.liveZone, cardIds: ['live'] },
  }));
  for (const source of sources) {
    game = emitGameEvent(
      game,
      createEnterStageEvent(source.instanceId, ZoneType.HAND, SlotPosition.CENTER, P1, P1)
    );
  }
  return {
    ...game,
    liveResolution: { ...game.liveResolution, isInLive: true, performingPlayerId: P1 },
  };
}

function cheer(
  game: GameState,
  ids: readonly string[],
  { playerId = P1, additional = false, enqueue = true, moved = false } = {}
): GameState {
  const event = createCheerEvent(playerId, ids, ids.length, { automated: true, additional });
  const key = playerId === P1 ? 'firstPlayerCheerCardIds' : 'secondPlayerCheerCardIds';
  let state: GameState = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      [key]: [...game.liveResolution[key], ...ids],
    },
    resolutionZone: moved
      ? game.resolutionZone
      : {
          ...game.resolutionZone,
          cardIds: [...game.resolutionZone.cardIds, ...ids],
          revealedCardIds: [...game.resolutionZone.revealedCardIds, ...ids],
        },
  };
  if (moved) {
    state = updatePlayer(state, playerId, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [...player.hand.cardIds, ...ids] },
    }));
  }
  state = emitGameEvent(state, event);
  return enqueue
    ? enqueueTriggeredCardEffects(state, [TriggerCondition.ON_CHEER], { cheerEvents: [event] })
    : state;
}

function confirm(game: GameState): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id);
}

function uses(game: GameState) {
  return game.actionHistory.filter(
    (action) => action.payload.abilityId === AUTO && action.payload.step === 'ABILITY_USE'
  );
}

function additions(game: GameState) {
  return game.actionHistory.filter(
    (action) => action.type === 'CHEER' && action.payload.additional === true
  );
}

function lastPayload(game: GameState, abilityId: string) {
  return game.actionHistory.filter((action) => action.payload.abilityId === abilityId).at(-1)
    ?.payload;
}

function success(game: GameState, resolve = true): GameState {
  const event = createLiveSuccessEvent(P1, ['live'], 1);
  const queued = enqueueTriggeredCardEffects(
    emitGameEvent(game, event),
    [TriggerCondition.ON_LIVE_SUCCESS],
    {
      liveSuccessEvents: [event],
    }
  );
  return resolve ? resolvePendingCardEffects(queued).gameState : queued;
}

describe('PL!HS-ad2-001 费用11「乙宗梢」', () => {
  it('collects source BLADE +2 for three different member identities without a group restriction', () => {
    const first = member('first', undefined, P1, '涩谷香音');
    const second = member('second', undefined, P1, '高坂穗乃果');
    let game = registerCards(setup(), [first, second]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
        SlotPosition.RIGHT,
        second.instanceId
      ),
    }));
    expect(getMemberEffectiveBladeCount(game, P1, 'source')).toBe(3);
    expect(collectLiveModifiers(game)).toContainEqual(
      expect.objectContaining({
        kind: 'BLADE',
        target: 'SOURCE_MEMBER',
        sourceCardId: 'source',
        countDelta: 2,
      })
    );
    game = registerCards(game, [member('second', undefined, P1, '渋谷かのん')]);
    expect(getMemberEffectiveBladeCount(game, P1, 'source')).toBe(1);
    game = registerCards(game, [second]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.RIGHT),
    }));
    expect(getMemberEffectiveBladeCount(game, P1, 'source')).toBe(1);
  });

  it('covers another printing and stops collecting once the source leaves the main stage', () => {
    const source = createCardInstance(
      { ...getNovember07MemberData(BASE), cardCode: `${BASE}-P` },
      P1,
      'source'
    );
    let game = registerCards(setup(), [source, member('first'), member('second')]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'first'),
        SlotPosition.RIGHT,
        'second'
      ),
    }));
    expect(getMemberEffectiveBladeCount(game, P1, 'source')).toBe(3);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    expect(
      collectLiveModifiers(game).some((modifier) => modifier.sourceCardId === 'source')
    ).toBe(false);
  });

  it.each([
    ['WAITING_MEMBERS', 3],
    ['ONE_COMBINED_MEMBER', 1],
    ['MEMBER_BELOW', 1],
  ] as const)(
    'counts one name per top-level member, including WAITING members (%s)',
    (scenario, expectedBlade) => {
      const first = member(
        'first',
        undefined,
        P1,
        scenario === 'ONE_COMBINED_MEMBER' ? '涩谷香音&平安名堇' : '涩谷香音'
      );
      const second = member('second', undefined, P1, '高坂穗乃果');
      let game = registerCards(setup(), [first, second]);
      game = updatePlayer(game, P1, (player) => {
        let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'first', {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        });
        if (scenario === 'WAITING_MEMBERS') {
          memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, 'second', {
            orientation: OrientationState.WAITING,
            face: FaceState.FACE_UP,
          });
        } else if (scenario === 'MEMBER_BELOW') {
          memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, 'second');
        }
        return { ...player, memberSlots };
      });
      expect(getMemberEffectiveBladeCount(game, P1, 'source')).toBe(expectedBlade);
    }
  );

  it('confirms once, counts earlier additional and moved historical cards, then adds exactly one cheer', () => {
    let queued = cheer(setup(), ['none'], { moved: true });
    queued = cheer(queued, ['empty'], { additional: true, enqueue: false, moved: true });
    const open = resolvePendingCardEffects(queued).gameState;
    expect(open.activeEffect?.effectText).toBe(
      `${AUTO_TEXT}（当前自己声援公开的不持有BLADE HEART的卡片有2张，满足条件，实际追加进行1张卡片的声援。）`
    );
    expect(uses(open)).toHaveLength(0);
    expect(additions(open)).toHaveLength(0);
    const done = confirm(open);
    expect(lastPayload(done, AUTO)).toMatchObject({
      matchingCardIds: ['none', 'empty'],
      conditionMet: true,
    });
    expect(additions(done)).toHaveLength(1);
    expect(additions(done)[0]?.payload.cheerCardIds).toEqual(['deck-0']);
    expect(uses(done)).toHaveLength(1);
    expect(done.pendingAbilities).toEqual([]);
    expect(done.activeEffect).toBeNull();
  });

  it('does not count DRAW, SCORE, ALL or invalid null as cards without Blade Hearts and consumes the use on failure', () => {
    const open = resolvePendingCardEffects(
      cheer(setup(), ['none', 'draw', 'score', 'all', 'invalid'])
    ).gameState;
    expect(open.activeEffect?.effectText).toContain('有1张，未满足条件');
    const done = confirm(open);
    expect(lastPayload(done, AUTO)).toMatchObject({
      matchingCardIds: ['none'],
      conditionMet: false,
    });
    expect(uses(done)).toHaveLength(1);
    expect(additions(done)).toHaveLength(0);
    expect(cheer(done, ['empty']).pendingAbilities).toEqual([]);
  });

  it('ignores opponent/additional trigger events and continues to resolve after the source leaves', () => {
    expect(cheer(setup(), ['opponent'], { playerId: P2 }).pendingAbilities).toEqual([]);
    expect(cheer(setup(), ['none', 'empty'], { additional: true }).pendingAbilities).toEqual([]);
    const queued = cheer(setup(), ['none', 'empty']);
    const moved = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      queued,
      P1,
      'source',
      enqueueTriggeredCardEffects
    )!;
    const done = confirm(resolvePendingCardEffects(moved.gameState).gameState);
    expect(done.players[0].waitingRoom.cardIds).toContain('source');
    expect(additions(done)).toHaveLength(1);
    expect(uses(done)).toHaveLength(1);
  });

  it('keeps the captured old lifecycle after re-entry and leaves the new source its own once-per-turn use', () => {
    const queued = cheer(setup(), ['none', 'empty']);
    const oldLifecycle = queued.pendingAbilities.find(
      (entry) => entry.abilityId === AUTO
    )!.sourceLifecycleId;
    const moved = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      queued,
      P1,
      'source',
      enqueueTriggeredCardEffects
    )!;
    let reentered = updatePlayer(moved.gameState, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => id !== 'source'),
      },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'source'),
    }));
    reentered = emitGameEvent(
      reentered,
      createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
    );
    const currentLifecycle = getAbilitySourceLifecycleId(reentered, AUTO, 'source');
    expect(currentLifecycle).not.toBe(oldLifecycle);
    let done = confirm(resolvePendingCardEffects(reentered).gameState);
    expect(uses(done)[0]?.payload.sourceLifecycleId).toBe(oldLifecycle);
    done = confirm(resolvePendingCardEffects(cheer(done, ['none', 'empty'])).gameState);
    expect(uses(done).map((action) => action.payload.sourceLifecycleId)).toEqual([
      oldLifecycle,
      currentLifecycle,
    ]);
    expect(additions(done)).toHaveLength(2);
  });

  it.each([false, true])(
    'supports manual selection and ordered batches without recursive ON_CHEER (%s)',
    (ordered) => {
      let state = resolvePendingCardEffects(cheer(setup(2), ['none', 'empty'])).gameState;
      expect(state.activeEffect?.canResolveInOrder).toBe(true);
      state = confirmActiveEffectStep(
        state,
        P1,
        state.activeEffect!.id,
        ordered ? null : 'source',
        undefined,
        ordered
      );
      if (!ordered) {
        expect(uses(state)).toHaveLength(0);
        expect(state.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
        state = confirm(state);
        expect(uses(state)).toHaveLength(1);
        state = confirm(state);
      }
      expect(uses(state)).toHaveLength(2);
      expect(additions(state)).toHaveLength(2);
      expect(state.pendingAbilities).toEqual([]);
      expect(state.activeEffect).toBeNull();
    }
  );

  it('resolves the additional DRAW Blade Heart immediately before the next pending confirmation', () => {
    const game = registerCards(setup(2), [member('deck-0', [{ effect: BladeHeartEffect.DRAW }])]);
    let state = resolvePendingCardEffects(cheer(game, ['none', 'empty'])).gameState;
    state = confirmActiveEffectStep(state, P1, state.activeEffect!.id, 'source');
    state = confirm(state);
    expect(state.players[0].hand.cardIds).toEqual(['deck-1']);
    expect(additions(state)[0]?.payload).toMatchObject({
      bladeHeartDrawCount: 1,
      bladeHeartDrawnCardIds: ['deck-1'],
    });
    expect(state.activeEffect?.sourceCardId).toBe('source2');
    const done = confirm(state);
    expect(done.players[0].hand.cardIds).toEqual(['deck-1']);
    expect(additions(done)).toHaveLength(2);
  });

  it('uses the existing immediate refresh path for an empty additional-cheer deck', () => {
    const game = updatePlayer(setup(), P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: ['deck-0'] },
    }));
    const done = confirm(resolvePendingCardEffects(cheer(game, ['none', 'empty'])).gameState);
    expect(additions(done)[0]?.payload.cheerCardIds).toEqual(['deck-0']);
    expect(
      done.actionHistory.some(
        (action) => action.type === 'RULE_ACTION' && action.payload.type === 'REFRESH'
      )
    ).toBe(true);
  });

  it('reports zero actual additional cards when neither the main deck nor waiting room can supply one', () => {
    const game = updatePlayer(setup(), P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [] },
    }));
    const open = resolvePendingCardEffects(cheer(game, ['none', 'empty'])).gameState;
    expect(open.activeEffect?.effectText).toContain('满足条件，实际追加进行0张');
    const done = confirm(open);
    expect(lastPayload(done, AUTO)).toMatchObject({
      conditionMet: true,
      requestedAdditionalCheerCount: 1,
      actualAdditionalCheerCount: 0,
    });
    expect(done.pendingAbilities).toEqual([]);
    expect(uses(done)).toHaveLength(1);
  });

  it.each([
    [2, 1, true],
    [1, 0, true],
    [1, 1, false],
    [1, 2, false],
  ])(
    'draws only when own revealed cheer count is strictly higher (%i:%i)',
    (own, opponent, expected) => {
      let game = cheer(setup(), ['none', 'empty'].slice(0, own), { enqueue: false, moved: true });
      const opponentCards = Array.from({ length: opponent }, (_, i) =>
        member(`opponent-${i}`, undefined, P2)
      );
      game = registerCards(game, opponentCards);
      game = cheer(
        game,
        opponentCards.map((card) => card.instanceId),
        { playerId: P2, enqueue: false }
      );
      const open = success(game);
      expect(open.activeEffect?.effectText).toContain(DRAW_TEXT);
      const before = open.players[0].hand.cardIds.length;
      const done = confirm(open);
      expect(done.players[0].hand.cardIds.length).toBe(before + Number(expected));
      expect(lastPayload(done, DRAW)).toMatchObject({
        ownRevealedCheerCount: own,
        opponentRevealedCheerCount: opponent,
        conditionMet: expected,
      });
    }
  );

  it('rechecks revealed facts when confirmation changes a 1:0 lead into a tie', () => {
    const game = cheer(setup(), ['none'], { enqueue: false, moved: true });
    const open = success(game);
    expect(open.activeEffect?.effectText).toContain('自己因声援公开1张，对方0张，满足条件');
    const tied = cheer(open, ['opponent'], { playerId: P2, enqueue: false });
    const done = confirm(tied);
    expect(done.players[0].hand.cardIds).toEqual(['none']);
    expect(done.players[0].mainDeck.cardIds[0]).toBe('deck-0');
    expect(lastPayload(done, DRAW)).toMatchObject({
      ownRevealedCheerCount: 1,
      opponentRevealedCheerCount: 1,
      conditionMet: false,
      drawnCardIds: [],
    });
    expect(done.pendingAbilities).toEqual([]);
    expect(done.activeEffect).toBeNull();
  });

  it('counts additional/moved cheer for LIVE success and draws after its already-triggered source leaves', () => {
    let game = cheer(setup(), ['none'], { enqueue: false, moved: true });
    game = cheer(game, ['empty'], { enqueue: false, additional: true, moved: true });
    game = cheer(game, ['opponent'], { playerId: P2, enqueue: false });
    const queued = success(game, false);
    const moved = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      queued,
      P1,
      'source',
      enqueueTriggeredCardEffects
    )!;
    const open = resolvePendingCardEffects(moved.gameState).gameState;
    expect(open.activeEffect?.effectText).toContain('实际抽1张卡');
    const done = confirm(open);
    expect(done.players[0].hand.cardIds).toEqual(['none', 'empty', 'deck-0']);
    expect(done.pendingAbilities).toEqual([]);
  });
});
