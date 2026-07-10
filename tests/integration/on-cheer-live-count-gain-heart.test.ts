import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID,
  S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(cardCode: string, groupNames: readonly string[] = ['Aqours']): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 17,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function live(cardCode: string, ownerGroup: readonly string[] = ['Aqours']): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ownerGroup,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function placeSourceOnStage(game: GameState, sourceCardId: string): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, sourceCardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

function pending(
  abilityId: string,
  sourceCardId: string,
  eventId: string
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:${eventId}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_CHEER,
    eventIds: [eventId],
    sourceSlot: SlotPosition.CENTER,
  };
}

function resolveChika(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

describe('PL!S-sd1-001 高海千歌 ON_CHEER red Heart', () => {
  it.each([
    { liveCount: 0, expectedHeartCount: 0 },
    { liveCount: 1, expectedHeartCount: 1 },
    { liveCount: 4, expectedHeartCount: 3 },
  ])('counts this cheer event own LIVE cards with cap 3: $liveCount', ({ liveCount, expectedHeartCount }) => {
    const source = createCardInstance(member('PL!S-sd1-001-SD'), PLAYER1, 'chika-001');
    const revealedLives = Array.from({ length: liveCount }, (_, index) =>
      createCardInstance(live(`PL!S-test-live-${index}`), PLAYER1, `revealed-live-${index}`)
    );
    let game = registerCards(createGameState(`s-sd1-001-${liveCount}`, PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      ...revealedLives,
    ]);
    game = placeSourceOnStage(game, source.instanceId);
    const cheerEvent = createCheerEvent(
      PLAYER1,
      revealedLives.map((card) => card.instanceId),
      liveCount
    );
    game = emitGameEvent(game, cheerEvent);
    game = {
      ...game,
      pendingAbilities: [
        pending(
          S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID,
          source.instanceId,
          cheerEvent.eventId
        ),
      ],
    };

    const resolved = resolveChika(game);

    const modifier = resolved.liveResolution.liveModifiers.find(
      (candidate) =>
        candidate.kind === 'HEART' &&
        candidate.abilityId === S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID
    );
    if (expectedHeartCount === 0) {
      expect(modifier).toBeUndefined();
    } else {
      expect(modifier).toMatchObject({
        kind: 'HEART',
        playerId: PLAYER1,
        sourceCardId: source.instanceId,
        target: 'SOURCE_MEMBER',
        hearts: [{ color: HeartColor.RED, count: expectedHeartCount }],
      });
    }
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);
  });

  it('uses CheerEvent revealedCardIds facts and ignores member cards, opponent cards, and other events', () => {
    const source = createCardInstance(member('PL!S-sd1-001-SD'), PLAYER1, 'chika-facts');
    const currentLive = createCardInstance(live('PL!S-current-live'), PLAYER1, 'current-live');
    const currentMember = createCardInstance(member('PL!S-current-member'), PLAYER1, 'current-member');
    const opponentLive = createCardInstance(live('PL!S-opponent-live'), PLAYER2, 'opponent-live');
    const historicalLive = createCardInstance(live('PL!S-historical-live'), PLAYER1, 'historical-live');
    let game = registerCards(createGameState('s-sd1-001-facts', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      currentLive,
      currentMember,
      opponentLive,
      historicalLive,
    ]);
    game = placeSourceOnStage(game, source.instanceId);
    game = emitGameEvent(game, createCheerEvent(PLAYER1, [historicalLive.instanceId], 1));
    const currentEvent = createCheerEvent(
      PLAYER1,
      [currentLive.instanceId, currentMember.instanceId, opponentLive.instanceId],
      3
    );
    game = emitGameEvent(game, currentEvent);
    game = {
      ...game,
      pendingAbilities: [
        pending(
          S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID,
          source.instanceId,
          currentEvent.eventId
        ),
      ],
    };

    const resolved = resolveChika(game);

    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: source.instanceId,
      abilityId: S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: HeartColor.RED, count: 1 }],
    });
    expect(
      resolved.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID &&
          action.payload.step === 'COUNT_OWN_CHEER_LIVE_CARDS_GAIN_RED_HEART'
      )?.payload.matchingLiveCardIds
    ).toEqual([currentLive.instanceId]);
  });

  it('safely consumes the pending ability when the source member left the stage', () => {
    const source = createCardInstance(member('PL!S-sd1-001-SD'), PLAYER1, 'chika-left');
    const revealedLive = createCardInstance(live('PL!S-revealed-live'), PLAYER1, 'left-live');
    let game = registerCards(createGameState('s-sd1-001-left', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      revealedLive,
    ]);
    const cheerEvent = createCheerEvent(PLAYER1, [revealedLive.instanceId], 1);
    game = emitGameEvent(game, cheerEvent);
    game = {
      ...game,
      pendingAbilities: [
        pending(
          S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID,
          source.instanceId,
          cheerEvent.eventId
        ),
      ],
    };

    const resolved = resolveChika(game);

    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });

  it('records turn1 use so a second own normal cheer does not enqueue again, and additional cheer is ignored', () => {
    const source = createCardInstance(member('PL!S-sd1-001-SD'), PLAYER1, 'chika-turn1');
    const firstLive = createCardInstance(live('PL!S-first-live'), PLAYER1, 'first-live');
    const secondLive = createCardInstance(live('PL!S-second-live'), PLAYER1, 'second-live');
    let game = registerCards(createGameState('s-sd1-001-turn1', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      firstLive,
      secondLive,
    ]);
    game = placeSourceOnStage(game, source.instanceId);

    const firstEvent = createCheerEvent(PLAYER1, [firstLive.instanceId], 1);
    game = emitGameEvent(game, firstEvent);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_CHEER], {
      cheerEvents: [firstEvent],
    });
    expect(game.pendingAbilities).toHaveLength(1);
    game = resolveChika(game);

    const additionalEvent = createCheerEvent(PLAYER1, [secondLive.instanceId], 1, {
      additional: true,
    });
    game = emitGameEvent(game, additionalEvent);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_CHEER], {
      cheerEvents: [additionalEvent],
    });
    expect(game.pendingAbilities).toEqual([]);

    const secondEvent = createCheerEvent(PLAYER1, [secondLive.instanceId], 1);
    game = emitGameEvent(game, secondEvent);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_CHEER], {
      cheerEvents: [secondEvent],
    });

    expect(game.pendingAbilities).toEqual([]);
    expect(
      game.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.abilityId === S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID
      )
    ).toHaveLength(1);
  });
});

describe('PL!S-bp2-003 松浦果南 ON_CHEER green Heart', () => {
  function setupBp2003(cardCode: 'PL!S-bp2-003-P' | 'PL!S-bp2-003-R', cardId = 'kanan-003') {
    const source = createCardInstance(member(cardCode), PLAYER1, cardId);
    let game = registerCards(createGameState(`s-bp2-003-${cardCode}`, PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
    ]);
    game = placeSourceOnStage(game, source.instanceId);
    return { game, source };
  }

  function resolveBp2003Event(
    game: GameState,
    sourceCardId: string,
    revealedCardIds: readonly string[],
    options: { readonly additional?: boolean; readonly pendingEventId?: string } = {}
  ): GameState {
    const event = createCheerEvent(PLAYER1, [...revealedCardIds], revealedCardIds.length, {
      additional: options.additional,
    });
    const state = emitGameEvent(game, event);
    return resolveChika({
      ...state,
      pendingAbilities: [
        pending(
          S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID,
          sourceCardId,
          options.pendingEventId ?? event.eventId
        ),
      ],
    });
  }

  it.each(['PL!S-bp2-003-P', 'PL!S-bp2-003-R'] as const)(
    'resolves %s through the shared base definition and gains exactly one green Heart',
    (cardCode) => {
      const { game, source } = setupBp2003(cardCode);
      const revealedLives = [
        createCardInstance(live('PL!S-bp2-003-live-a'), PLAYER1, 'green-live-a'),
        createCardInstance(live('PL!S-bp2-003-live-b'), PLAYER1, 'green-live-b'),
      ];
      const state = registerCards(game, revealedLives);

      const resolved = resolveBp2003Event(
        state,
        source.instanceId,
        revealedLives.map((card) => card.instanceId)
      );

      expect(resolved.liveResolution.liveModifiers).toContainEqual({
        kind: 'HEART',
        playerId: PLAYER1,
        sourceCardId: source.instanceId,
        abilityId: S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID,
        target: 'SOURCE_MEMBER',
        hearts: [{ color: HeartColor.GREEN, count: 1 }],
      });
      expect(resolved.activeEffect).toBeNull();
      expect(resolved.pendingAbilities).toEqual([]);
    }
  );

  it('does not consume turn1 for zero matching LIVE cards, then activates on a later normal cheer', () => {
    const { game, source } = setupBp2003('PL!S-bp2-003-P');
    const memberCard = createCardInstance(member('PL!S-bp2-003-member'), PLAYER1, 'not-live');
    const revealedLive = createCardInstance(live('PL!S-bp2-003-live'), PLAYER1, 'later-live');
    let state = registerCards(game, [memberCard, revealedLive]);

    state = resolveBp2003Event(state, source.instanceId, [memberCard.instanceId]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
    expect(state.activeEffect).toBeNull();

    state = resolveBp2003Event(state, source.instanceId, [revealedLive.instanceId]);
    expect(
      state.liveResolution.liveModifiers.filter(
        (modifier) => modifier.abilityId === S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID
      )
    ).toHaveLength(1);
  });

  it('uses matching pending event facts even after the revealed LIVE left the resolution zone', () => {
    const { game, source } = setupBp2003('PL!S-bp2-003-R');
    const revealedLive = createCardInstance(live('PL!S-bp2-003-moved-live'), PLAYER1, 'moved-live');
    let state = registerCards(game, [revealedLive]);
    const event = createCheerEvent(PLAYER1, [revealedLive.instanceId], 1);
    state = emitGameEvent(state, event);
    state = {
      ...state,
      resolutionZone: { ...state.resolutionZone, cardIds: [], revealedCardIds: [] },
      pendingAbilities: [
        pending(S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID, source.instanceId, event.eventId),
      ],
    };

    const resolved = resolveChika(state);
    expect(resolved.liveResolution.liveModifiers).toHaveLength(1);
  });

  it('ignores member, opponent, old-event, and non-pending-event cards', () => {
    const { game, source } = setupBp2003('PL!S-bp2-003-P');
    const ownMember = createCardInstance(member('PL!S-bp2-003-member'), PLAYER1, 'own-member');
    const opponentLive = createCardInstance(live('PL!S-bp2-003-opponent-live'), PLAYER2, 'opponent-live');
    const oldLive = createCardInstance(live('PL!S-bp2-003-old-live'), PLAYER1, 'old-live');
    let state = registerCards(game, [ownMember, opponentLive, oldLive]);
    state = emitGameEvent(state, createCheerEvent(PLAYER1, [oldLive.instanceId], 1));
    const current = createCheerEvent(PLAYER1, [ownMember.instanceId, opponentLive.instanceId], 2);
    state = emitGameEvent(state, current);
    state = {
      ...state,
      pendingAbilities: [
        pending(S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID, source.instanceId, current.eventId),
      ],
    };

    const resolved = resolveChika(state);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('does not enqueue for additional cheer, and after the first success ignores later normal cheers', () => {
    const { game, source } = setupBp2003('PL!S-bp2-003-P');
    const firstLive = createCardInstance(live('PL!S-bp2-003-first'), PLAYER1, 'first-live');
    const secondLive = createCardInstance(live('PL!S-bp2-003-second'), PLAYER1, 'second-live');
    let state = registerCards(game, [firstLive, secondLive]);

    const additional = createCheerEvent(PLAYER1, [firstLive.instanceId], 1, { additional: true });
    state = emitGameEvent(state, additional);
    state = enqueueTriggeredCardEffects(state, [TriggerCondition.ON_CHEER], { cheerEvents: [additional] });
    expect(state.pendingAbilities).toEqual([]);

    const first = createCheerEvent(PLAYER1, [firstLive.instanceId], 1);
    state = emitGameEvent(state, first);
    state = enqueueTriggeredCardEffects(state, [TriggerCondition.ON_CHEER], { cheerEvents: [first] });
    expect(state.pendingAbilities).toHaveLength(1);
    state = resolveChika(state);

    const second = createCheerEvent(PLAYER1, [secondLive.instanceId], 1);
    state = emitGameEvent(state, second);
    state = enqueueTriggeredCardEffects(state, [TriggerCondition.ON_CHEER], { cheerEvents: [second] });
    expect(state.pendingAbilities).toEqual([]);
  });

  it('consumes the pending continuation without writing a Heart after the source left the stage', () => {
    const source = createCardInstance(member('PL!S-bp2-003-P'), PLAYER1, 'left-kanan');
    const revealedLive = createCardInstance(live('PL!S-bp2-003-live'), PLAYER1, 'left-live');
    let state = registerCards(createGameState('s-bp2-003-left', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      revealedLive,
    ]);
    const event = createCheerEvent(PLAYER1, [revealedLive.instanceId], 1);
    state = emitGameEvent(state, event);
    state = {
      ...state,
      pendingAbilities: [
        pending(S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID, source.instanceId, event.eventId),
      ],
    };

    const resolved = resolveChika(state);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });

  it('continues to the next queued ability after resolving this no-input pending', () => {
    const { game, source } = setupBp2003('PL!S-bp2-003-P');
    const chika = createCardInstance(member('PL!S-sd1-001-SD'), PLAYER1, 'continuation-chika');
    const kananLive = createCardInstance(live('PL!S-bp2-003-live'), PLAYER1, 'continuation-kanan-live');
    const chikaLive = createCardInstance(live('PL!S-sd1-001-live'), PLAYER1, 'continuation-chika-live');
    let state = registerCards(game, [chika, kananLive, chikaLive]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, chika.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    const kananEvent = createCheerEvent(PLAYER1, [kananLive.instanceId], 1);
    const chikaEvent = createCheerEvent(PLAYER1, [chikaLive.instanceId], 1);
    state = emitGameEvent(emitGameEvent(state, kananEvent), chikaEvent);
    state = {
      ...state,
      pendingAbilities: [
        pending(S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID, source.instanceId, kananEvent.eventId),
        pending(
          S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID,
          chika.instanceId,
          chikaEvent.eventId
        ),
      ],
    };

    let resolved = resolveChika(state);
    expect(resolved.activeEffect).not.toBeNull();
    resolved = confirmActiveEffectStep(
      resolved,
      PLAYER1,
      resolved.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.liveResolution.liveModifiers.map((modifier) => modifier.abilityId)
    ).toEqual([
      S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID,
      S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID,
    ]);
  });
});
