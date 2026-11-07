import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_AD1_003_AUTO_ON_CHEER_ALL_BLADE_HEART_ADDITIONAL_CHEER_ABILITY_ID as AUTO } from '../../src/application/card-effects/ability-ids';
import {
  createCardInstance,
  type BladeHearts,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addMemberBelowMember, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createCheerEvent,
  createEnterLiveZoneEvent,
  createLiveStartEvent,
} from '../../src/domain/events/game-events';
import {
  addLiveModifier,
  getLiveCardRequirementModifiers,
} from '../../src/domain/rules/live-modifiers';
import {
  BladeHeartEffect as B,
  CardType,
  FaceState,
  HeartColor as H,
  OrientationState,
  SlotPosition,
  TriggerCondition as T,
  ZoneType,
} from '../../src/shared/types/enums';
import { createNovember07DraftCard } from '../helpers/november-07-draft-effects';

const P = 'p1';
function member(id: string, hearts: MemberCardData['hearts'] = [], bladeHearts?: BladeHearts) {
  const data: MemberCardData = {
    cardCode: `TEST-${id}`,
    name: id,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts,
    bladeHearts,
  };
  return createCardInstance(data, P, id);
}
function setup(heartCount = 6, copies = 1): GameState {
  const cards = [
    createNovember07DraftCard('PL!SP-ad1-003', P, 'source'),
    createNovember07DraftCard('PL!SP-ad1-003', P, 'source2'),
    member('stage', [{ color: H.YELLOW, count: heartCount }]),
    member('all', [], [{ effect: B.HEART, heartColor: H.RAINBOW }]),
    member('purple', [], [{ effect: B.HEART, heartColor: H.PURPLE }]),
    member('draw', [], [{ effect: B.DRAW }]),
    member('score', [], [{ effect: B.SCORE }]),
    ...Array.from({ length: 4 }, (_, i) =>
      member(`deck-${i}`, [], i === 0 ? [{ effect: B.DRAW }] : undefined)
    ),
  ];
  let game = registerCards(createGameState('killer', P, 'P1', 'p2', 'P2'), cards);
  game = updatePlayer(game, P, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'stage', {
      orientation: OrientationState.WAITING,
      face: FaceState.FACE_UP,
    }),
    liveZone: {
      ...player.liveZone,
      cardIds: copies === 1 ? ['source'] : ['source', 'source2'],
      cardStates: new Map(
        ['source', 'source2'].map((id) => [
          id,
          { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE },
        ])
      ),
    },
    mainDeck: { ...player.mainDeck, cardIds: ['deck-0', 'deck-1', 'deck-2', 'deck-3'] },
  }));
  game = emitGameEvent(
    game,
    createEnterLiveZoneEvent('source', ZoneType.HAND, P, P, FaceState.FACE_UP)
  );
  if (copies === 2)
    game = emitGameEvent(
      game,
      createEnterLiveZoneEvent('source2', ZoneType.HAND, P, P, FaceState.FACE_UP)
    );
  return {
    ...game,
    liveResolution: { ...game.liveResolution, isInLive: true, performingPlayerId: P },
  };
}
function liveStart(game: GameState) {
  const event = createLiveStartEvent(P, game.players[0].liveZone.cardIds);
  return enqueueTriggeredCardEffects(emitGameEvent(game, event), [T.ON_LIVE_START], {
    liveStartEvents: [event],
  });
}
function cheer(game: GameState, ids: readonly string[], additional = false, playerId = P) {
  const event = createCheerEvent(playerId, ids, ids.length, { automated: true, additional });
  const key = playerId === P ? 'firstPlayerCheerCardIds' : 'secondPlayerCheerCardIds';
  const state = {
    ...game,
    liveResolution: { ...game.liveResolution, [key]: [...game.liveResolution[key], ...ids] },
  };
  return enqueueTriggeredCardEffects(emitGameEvent(state, event), [T.ON_CHEER], {
    cheerEvents: [event],
  });
}
function confirm(game: GameState, selected?: string) {
  return confirmActiveEffectStep(game, P, game.activeEffect!.id, selected);
}
function resolve(game: GameState) {
  const open = resolvePendingCardEffects(game).gameState;
  return open.activeEffect ? confirm(open) : open;
}
function uses(game: GameState) {
  return game.actionHistory.filter(
    (a) => a.payload.abilityId === AUTO && a.payload.step === 'ABILITY_USE'
  );
}
function additions(game: GameState) {
  return game.actionHistory.filter((a) => a.type === 'CHEER' && a.payload.additional === true);
}
function reenter(game: GameState) {
  let state = updatePlayer(game, P, (p) => ({
    ...p,
    liveZone: {
      ...p.liveZone,
      cardIds: ['source'],
      cardStates: new Map([
        ['source', { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE }],
      ]),
    },
  }));
  return emitGameEvent(
    state,
    createEnterLiveZoneEvent('source', ZoneType.WAITING_ROOM, P, P, FaceState.FACE_UP)
  );
}

describe('PL!SP-ad1-003 分数2「Killer Kyun☆」', () => {
  it.each([5, 6])(
    'counts WAITING stage specified Hearts at %i and reduces only the source colorless requirement',
    (count) => {
      const open = resolvePendingCardEffects(liveStart(setup(count, 2))).gameState;
      const chosen = confirm(open, 'source');
      expect(chosen.activeEffect?.effectText).toContain(`合计${count}个`);
      expect(chosen.activeEffect?.selectableCardIds).toBeUndefined();
      expect(chosen.activeEffect?.selectableOptions).toBeUndefined();
      expect(getLiveCardRequirementModifiers(chosen.liveResolution, 'source')).toEqual([]);
      const done = confirm(chosen);
      expect(getLiveCardRequirementModifiers(done.liveResolution, 'source')).toEqual(
        count >= 6 ? [{ color: H.RAINBOW, countDelta: -1 }] : []
      );
      expect(getLiveCardRequirementModifiers(done.liveResolution, 'source2')).toEqual([]);
    }
  );
  it('sums yellow plus purple effective member Hearts and excludes ALL, player Hearts and members below', () => {
    let game = registerCards(setup(3), [
      member('second', [
        { color: H.PURPLE, count: 2 },
        { color: H.RAINBOW, count: 20 },
      ]),
      member('below', [{ color: H.PURPLE, count: 20 }]),
    ]);
    game = updatePlayer(game, P, (p) => ({
      ...p,
      memberSlots: addMemberBelowMember(
        placeCardInSlot(p.memberSlots, SlotPosition.LEFT, 'second'),
        SlotPosition.CENTER,
        'below'
      ),
    }));
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'PLAYER',
      playerId: P,
      hearts: [{ color: H.PURPLE, count: 20 }],
    });
    expect(
      getLiveCardRequirementModifiers(resolve(liveStart(game)).liveResolution, 'source')
    ).toEqual([]);
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: P,
      sourceCardId: 'source',
      targetMemberCardId: 'stage',
      hearts: [{ color: H.PURPLE, count: 1 }],
    });
    expect(
      getLiveCardRequirementModifiers(resolve(liveStart(game)).liveResolution, 'source')
    ).toEqual([{ color: H.RAINBOW, countDelta: -1 }]);
  });
  it.each([false, true])(
    'does not reward a new source rules object when it re-enters before %s confirmation',
    (beforeConfirmation) => {
      let game = liveStart(setup());
      if (beforeConfirmation) game = resolvePendingCardEffects(game).gameState;
      game = reenter(game);
      expect(getLiveCardRequirementModifiers(resolve(game).liveResolution, 'source')).toEqual([]);
    }
  );
  it('uses historical ALL facts, performs DRAW immediately and never recursively queues additional cheer', () => {
    const open = resolvePendingCardEffects(cheer(setup(), ['all'])).gameState;
    expect(open.activeEffect?.effectText).toContain('持有[ALLブレード]的卡片有1张');
    const done = confirm(open);
    expect(additions(done)).toHaveLength(1);
    expect(done.players[0].hand.cardIds).toEqual(['deck-1']);
    expect(done.pendingAbilities).toEqual([]);
    expect(done.resolutionZone.cardIds).toContain('deck-0');
    expect(uses(done)).toHaveLength(1);
    expect(cheer(done, ['all']).pendingAbilities).toEqual([]);
  });
  it.each(['purple', 'draw', 'score'])('consumes turn1 when %s is not effective ALL', (id) => {
    const done = resolve(cheer(setup(), [id]));
    expect(uses(done)).toHaveLength(1);
    expect(additions(done)).toEqual([]);
  });
  it('applies effective replacement in both directions and includes prior additional facts', () => {
    let game = addLiveModifier(setup(), {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: P,
      fromColors: [H.RAINBOW],
      toColor: H.PURPLE,
    });
    expect(additions(resolve(cheer(game, ['all'])))).toEqual([]);
    game = addLiveModifier(setup(), {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: P,
      fromColors: [H.PURPLE],
      toColor: H.RAINBOW,
    });
    expect(additions(resolve(cheer(cheer(game, ['purple'], true), ['score'])))).toHaveLength(1);
  });
  it('keeps already-triggered additional cheer independent after its LIVE leaves and preserves its old lifecycle', () => {
    const queued = cheer(setup(), ['all']);
    const old = queued.pendingAbilities[0]!.sourceLifecycleId;
    let left = updatePlayer(queued, P, (p) => ({
      ...p,
      liveZone: { ...p.liveZone, cardIds: [] },
      waitingRoom: { ...p.waitingRoom, cardIds: ['source'] },
    }));
    left = resolve(left);
    expect(additions(left)).toHaveLength(1);
    expect(uses(left)[0]?.payload.sourceLifecycleId).toBe(old);
    expect(cheer(reenter(left), ['all']).pendingAbilities.some((p) => p.abilityId === AUTO)).toBe(
      true
    );
  });
  it('ignores opponent/additional events and supports ordered resolution of two independent copies', () => {
    expect(cheer(setup(), ['all'], true).pendingAbilities).toEqual([]);
    expect(cheer(setup(), ['all'], false, 'p2').pendingAbilities).toEqual([]);
    const open = resolvePendingCardEffects(cheer(setup(6, 2), ['all'])).gameState;
    const done = confirmActiveEffectStep(open, P, open.activeEffect!.id, null, undefined, true);
    expect(additions(done)).toHaveLength(2);
    expect(uses(done)).toHaveLength(2);
    expect(done.activeEffect).toBeNull();
  });
});
