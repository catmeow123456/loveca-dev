import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_PR_023_AUTO_ON_CHEER_SAME_GROUP_MEMBER_THREE_GAIN_PINK_GREEN_HEART_ABILITY_ID,
  S_PR_040_AUTO_ON_CHEER_SAME_GROUP_MEMBER_THREE_GAIN_PINK_GREEN_HEART_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { revealCheerCardsFromMainDeck } from '../../src/application/effects/cheer';
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

const CONFIGS = [
  {
    cardCode: 'PL!N-PR-023-PR',
    abilityId: N_PR_023_AUTO_ON_CHEER_SAME_GROUP_MEMBER_THREE_GAIN_PINK_GREEN_HEART_ABILITY_ID,
  },
  {
    cardCode: 'PL!S-PR-040-PR',
    abilityId: S_PR_040_AUTO_ON_CHEER_SAME_GROUP_MEMBER_THREE_GAIN_PINK_GREEN_HEART_ABILITY_ID,
  },
] as const;

function member(
  cardCode: string,
  groupNames: readonly string[],
  unitName?: string
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function live(cardCode: string, groupNames: readonly string[]): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function setup(
  config: (typeof CONFIGS)[number],
  revealedCards: readonly ReturnType<typeof createCardInstance>[],
  orientation: OrientationState = OrientationState.ACTIVE
): { game: GameState; sourceId: string } {
  const source = createCardInstance(
    member(config.cardCode, ['虹ヶ咲']),
    PLAYER1,
    `${config.cardCode}:source`
  );
  let game = registerCards(
    createGameState(`same-group:${config.cardCode}`, PLAYER1, 'P1', PLAYER2, 'P2'),
    [source, ...revealedCards]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
  return { game, sourceId: source.instanceId };
}

function enqueueNormalCheer(game: GameState, cardIds: readonly string[]): GameState {
  const event = createCheerEvent(PLAYER1, cardIds, cardIds.length);
  return enqueueTriggeredCardEffects(emitGameEvent(game, event), [TriggerCondition.ON_CHEER], {
    cheerEvents: [event],
  });
}

function createPending(
  abilityId: string,
  sourceCardId: string,
  eventId: string,
  controllerId = PLAYER1
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:${eventId}`,
    abilityId,
    sourceCardId,
    controllerId,
    mandatory: true,
    timingId: TriggerCondition.ON_CHEER,
    eventIds: [eventId],
    sourceSlot: SlotPosition.CENTER,
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function abilityUseCount(game: GameState, abilityId: string, sourceCardId?: string): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.step === 'ABILITY_USE' &&
      action.payload.abilityId === abilityId &&
      (sourceCardId === undefined || action.payload.sourceCardId === sourceCardId)
  ).length;
}

function latestResolvePayload(
  game: GameState,
  abilityId: string
): Readonly<Record<string, unknown>> {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === abilityId &&
        action.payload.step !== 'ABILITY_USE'
    )!.payload;
}

function ownMembers(
  prefix: string,
  groups: readonly (readonly string[])[]
): readonly ReturnType<typeof createCardInstance>[] {
  return groups.map((groupNames, index) =>
    createCardInstance(member(`${prefix}-${index}`, groupNames), PLAYER1, `${prefix}-${index}`)
  );
}

function expectPinkGreenSourceModifier(
  game: GameState,
  config: (typeof CONFIGS)[number],
  sourceId: string
): void {
  expect(game.liveResolution.liveModifiers).toContainEqual({
    kind: 'HEART',
    playerId: PLAYER1,
    sourceCardId: sourceId,
    abilityId: config.abilityId,
    target: 'SOURCE_MEMBER',
    hearts: [
      { color: HeartColor.PINK, count: 1 },
      { color: HeartColor.GREEN, count: 1 },
    ],
  });
}

describe('shared ON_CHEER same-group member triple gains pink and green Hearts', () => {
  it.each(CONFIGS)(
    '$cardCode uses the real reveal and definition lookup path while WAITING',
    (config) => {
      const cards = ownMembers(`${config.cardCode}:real`, [['虹ヶ咲'], ['虹ヶ咲'], ['虹ヶ咲']]);
      let { game, sourceId } = setup(config, cards, OrientationState.WAITING);
      game = updatePlayer(game, PLAYER1, (player) => ({
        ...player,
        mainDeck: { ...player.mainDeck, cardIds: cards.map((card) => card.instanceId) },
      }));

      const cheerResult = revealCheerCardsFromMainDeck(game, PLAYER1, 3);
      const queued = enqueueTriggeredCardEffects(
        cheerResult.gameState,
        [TriggerCondition.ON_CHEER],
        { cheerEvents: [cheerResult.cheerEvent] }
      );
      expect(queued.pendingAbilities).toHaveLength(1);
      expect(queued.pendingAbilities[0]).toMatchObject({
        abilityId: config.abilityId,
        sourceCardId: sourceId,
        eventIds: [cheerResult.cheerEvent.eventId],
      });

      const resolved = resolve(queued);
      expectPinkGreenSourceModifier(resolved, config, sourceId);
      expect(resolved.activeEffect).toBeNull();
      expect(resolved.pendingAbilities).toEqual([]);
      expect(latestResolvePayload(resolved, config.abilityId)).toMatchObject({
        cheerEventId: cheerResult.cheerEvent.eventId,
        revealedCardIds: cards.map((card) => card.instanceId),
        matchingMemberCardIds: cards.map((card) => card.instanceId),
        groupCounts: { nijigasaki: 3 },
        qualifyingGroupKeys: ['nijigasaki'],
        conditionMet: true,
        gainedHearts: [
          { color: HeartColor.PINK, count: 1 },
          { color: HeartColor.GREEN, count: 1 },
        ],
      });
    }
  );

  it.each(CONFIGS)(
    '$cardCode fails with only two same-group members but consumes turn1',
    (config) => {
      const cards = ownMembers(`${config.cardCode}:two`, [['Aqours'], ['Aqours']]);
      const { game, sourceId } = setup(config, cards);
      const resolved = resolve(
        enqueueNormalCheer(
          game,
          cards.map((card) => card.instanceId)
        )
      );
      expect(resolved.liveResolution.liveModifiers).toEqual([]);
      expect(abilityUseCount(resolved, config.abilityId, sourceId)).toBe(1);
      expect(latestResolvePayload(resolved, config.abilityId)).toMatchObject({
        groupCounts: { aqours: 2 },
        qualifyingGroupKeys: [],
        conditionMet: false,
        gainedHearts: [],
      });
    }
  );

  it.each(CONFIGS)(
    '$cardCode does not group three different groups or a shared unitName',
    (config) => {
      const cards = [
        createCardInstance(member('different-a', ['Aqours'], 'AZALEA'), PLAYER1, 'different-a'),
        createCardInstance(member('different-b', ['虹ヶ咲'], 'AZALEA'), PLAYER1, 'different-b'),
        createCardInstance(member('different-c', ['Liella!'], 'AZALEA'), PLAYER1, 'different-c'),
      ];
      const { game } = setup(config, cards);
      const resolved = resolve(
        enqueueNormalCheer(
          game,
          cards.map((card) => card.instanceId)
        )
      );
      expect(resolved.liveResolution.liveModifiers).toEqual([]);
      expect(latestResolvePayload(resolved, config.abilityId)).toMatchObject({
        groupCounts: { aqours: 1, liella: 1, nijigasaki: 1 },
        qualifyingGroupKeys: [],
        conditionMet: false,
      });
    }
  );

  it.each(CONFIGS)('$cardCode ignores unrecognized free-form group text', (config) => {
    const cards = ownMembers(`${config.cardCode}:unknown`, [
      ['unknown-group'],
      ['unknown-group'],
      ['unknown-group'],
    ]);
    const { game } = setup(config, cards);
    const resolved = resolve(
      enqueueNormalCheer(
        game,
        cards.map((card) => card.instanceId)
      )
    );
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(latestResolvePayload(resolved, config.abilityId)).toMatchObject({
      groupCounts: {},
      qualifyingGroupKeys: [],
      conditionMet: false,
    });
  });

  it.each(CONFIGS)('$cardCode rejects A/B, B/C, C/A without one common triple group', (config) => {
    const cards = ownMembers(`${config.cardCode}:triangle`, [
      ['Aqours', '虹ヶ咲'],
      ['虹ヶ咲', 'Liella!'],
      ['Liella!', 'Aqours'],
    ]);
    const { game } = setup(config, cards);
    const resolved = resolve(
      enqueueNormalCheer(
        game,
        cards.map((card) => card.instanceId)
      )
    );
    expect(latestResolvePayload(resolved, config.abilityId)).toMatchObject({
      groupCounts: { aqours: 2, liella: 2, nijigasaki: 2 },
      qualifyingGroupKeys: [],
      conditionMet: false,
    });
  });

  it.each(CONFIGS)(
    '$cardCode lets multi-group members contribute to each canonical bucket',
    (config) => {
      const cards = ownMembers(`${config.cardCode}:multi`, [
        ['Aqours', '虹ヶ咲'],
        ['虹ヶ咲'],
        ['虹ヶ咲', 'Liella!'],
      ]);
      const { game, sourceId } = setup(config, cards);
      const resolved = resolve(
        enqueueNormalCheer(
          game,
          cards.map((card) => card.instanceId)
        )
      );
      expectPinkGreenSourceModifier(resolved, config, sourceId);
      expect(latestResolvePayload(resolved, config.abilityId)).toMatchObject({
        groupCounts: { aqours: 1, liella: 1, nijigasaki: 3 },
        qualifyingGroupKeys: ['nijigasaki'],
        conditionMet: true,
      });
    }
  );

  it.each(CONFIGS)(
    '$cardCode de-duplicates repeated group text and repeated card ids',
    (config) => {
      const cards = ownMembers(`${config.cardCode}:dedupe`, [['Aqours', 'Aqours'], ['Aqours']]);
      const { game } = setup(config, cards);
      const ids = [cards[0]!.instanceId, cards[0]!.instanceId, cards[1]!.instanceId];
      const resolved = resolve(enqueueNormalCheer(game, ids));
      expect(resolved.liveResolution.liveModifiers).toEqual([]);
      expect(latestResolvePayload(resolved, config.abilityId)).toMatchObject({
        revealedCardIds: ids,
        groupCounts: { aqours: 2 },
        qualifyingGroupKeys: [],
        conditionMet: false,
      });
    }
  );

  it.each(CONFIGS)('$cardCode ignores LIVE, energy, and opponent-owned member cards', (config) => {
    const own = ownMembers(`${config.cardCode}:filtered`, [['Aqours'], ['Aqours'], ['Aqours']]);
    const otherCards = [
      createCardInstance(live('filtered-live', ['Aqours']), PLAYER1, 'filtered-live'),
      createCardInstance(energy('filtered-energy'), PLAYER1, 'filtered-energy'),
      createCardInstance(member('filtered-opponent', ['Aqours']), PLAYER2, 'filtered-opponent'),
    ];
    const { game } = setup(config, [...own, ...otherCards]);
    const resolved = resolve(
      enqueueNormalCheer(
        game,
        [...own, ...otherCards].map((card) => card.instanceId)
      )
    );
    expect(latestResolvePayload(resolved, config.abilityId)).toMatchObject({
      matchingMemberCardIds: own.map((card) => card.instanceId),
      groupCounts: { aqours: 3 },
      qualifyingGroupKeys: ['aqours'],
      conditionMet: true,
    });
  });

  it.each(CONFIGS)(
    '$cardCode reads only the pending-linked event and keeps moved-away facts',
    (config) => {
      const oldCards = ownMembers(`${config.cardCode}:old`, [['Aqours'], ['Aqours'], ['Aqours']]);
      const currentCards = ownMembers(`${config.cardCode}:current`, [
        ['虹ヶ咲'],
        ['虹ヶ咲'],
        ['虹ヶ咲'],
      ]);
      let { game, sourceId } = setup(config, [...oldCards, ...currentCards]);
      game = emitGameEvent(
        game,
        createCheerEvent(
          PLAYER1,
          oldCards.map((card) => card.instanceId),
          3
        )
      );
      const currentEvent = createCheerEvent(
        PLAYER1,
        currentCards.map((card) => card.instanceId),
        3
      );
      game = {
        ...game,
        resolutionZone: {
          ...game.resolutionZone,
          cardIds: currentCards.map((card) => card.instanceId),
          revealedCardIds: currentCards.map((card) => card.instanceId),
        },
      };
      game = enqueueTriggeredCardEffects(
        emitGameEvent(game, currentEvent),
        [TriggerCondition.ON_CHEER],
        { cheerEvents: [currentEvent] }
      );
      expect(game.pendingAbilities).toHaveLength(1);
      game = {
        ...game,
        resolutionZone: { ...game.resolutionZone, cardIds: [], revealedCardIds: [] },
      };
      const resolved = resolve(game);
      expectPinkGreenSourceModifier(resolved, config, sourceId);
      expect(latestResolvePayload(resolved, config.abilityId)).toMatchObject({
        cheerEventId: currentEvent.eventId,
        revealedCardIds: currentCards.map((card) => card.instanceId),
        groupCounts: { nijigasaki: 3 },
      });
    }
  );

  it.each(CONFIGS)(
    '$cardCode condition failure blocks later normal cheer in the same turn',
    (config) => {
      const cards = ownMembers(`${config.cardCode}:turn1`, [['Aqours'], ['Aqours'], ['Aqours']]);
      const { game, sourceId } = setup(config, cards);
      let state = resolve(
        enqueueNormalCheer(
          game,
          cards.slice(0, 2).map((card) => card.instanceId)
        )
      );
      expect(abilityUseCount(state, config.abilityId, sourceId)).toBe(1);
      state = enqueueNormalCheer(
        state,
        cards.map((card) => card.instanceId)
      );
      expect(state.pendingAbilities).toEqual([]);
      expect(state.liveResolution.liveModifiers).toEqual([]);
    }
  );

  it.each(CONFIGS)(
    '$cardCode pending itself occupies the turn1 limit before resolution',
    (config) => {
      const cards = ownMembers(`${config.cardCode}:occupied`, [['Aqours'], ['Aqours'], ['Aqours']]);
      const { game } = setup(config, cards);
      const first = enqueueNormalCheer(
        game,
        cards.map((card) => card.instanceId)
      );
      expect(first.pendingAbilities).toHaveLength(1);
      const second = enqueueNormalCheer(
        first,
        cards.map((card) => card.instanceId)
      );
      expect(second.pendingAbilities).toHaveLength(1);
      expect(second.pendingAbilities[0]?.abilityId).toBe(config.abilityId);
    }
  );

  it.each(CONFIGS)('$cardCode does not queue for additional or opponent cheer', (config) => {
    const cards = ownMembers(`${config.cardCode}:event-filter`, [
      ['Aqours'],
      ['Aqours'],
      ['Aqours'],
    ]);
    const { game } = setup(config, cards);
    const additional = createCheerEvent(
      PLAYER1,
      cards.map((card) => card.instanceId),
      3,
      {
        additional: true,
      }
    );
    const afterAdditional = enqueueTriggeredCardEffects(
      emitGameEvent(game, additional),
      [TriggerCondition.ON_CHEER],
      { cheerEvents: [additional] }
    );
    expect(afterAdditional.pendingAbilities).toEqual([]);

    const opponent = createCheerEvent(
      PLAYER2,
      cards.map((card) => card.instanceId),
      3
    );
    const afterOpponent = enqueueTriggeredCardEffects(
      emitGameEvent(game, opponent),
      [TriggerCondition.ON_CHEER],
      { cheerEvents: [opponent] }
    );
    expect(afterOpponent.pendingAbilities).toEqual([]);
  });

  it.each(CONFIGS)(
    '$cardCode safely consumes stale source off-stage or as memberBelow',
    (config) => {
      for (const staleKind of ['OFF_STAGE', 'MEMBER_BELOW'] as const) {
        const cards = ownMembers(`${config.cardCode}:${staleKind}`, [
          ['Aqours'],
          ['Aqours'],
          ['Aqours'],
        ]);
        const host = createCardInstance(
          member(`host:${staleKind}`, ['Aqours']),
          PLAYER1,
          `host:${staleKind}`
        );
        let { game, sourceId } = setup(config, [...cards, host]);
        const event = createCheerEvent(
          PLAYER1,
          cards.map((card) => card.instanceId),
          3
        );
        game = emitGameEvent(game, event);
        game = updatePlayer(game, PLAYER1, (player) => {
          let memberSlots = removeCardFromSlot(player.memberSlots, SlotPosition.CENTER);
          if (staleKind === 'MEMBER_BELOW') {
            memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, host.instanceId);
            memberSlots = {
              ...memberSlots,
              memberBelow: { ...memberSlots.memberBelow, [SlotPosition.CENTER]: [sourceId] },
            };
          }
          return { ...player, memberSlots };
        });
        game = {
          ...game,
          pendingAbilities: [createPending(config.abilityId, sourceId, event.eventId)],
        };
        const resolved = resolve(game);
        expect(resolved.pendingAbilities).toEqual([]);
        expect(resolved.liveResolution.liveModifiers).toEqual([]);
        expect(abilityUseCount(resolved, config.abilityId, sourceId)).toBe(0);
        expect(resolved.activeEffect).toBeNull();
      }
    }
  );

  it.each(CONFIGS)(
    '$cardCode keeps pending consumed when the member modifier helper rejects the source',
    (config) => {
      const cards = ownMembers(`${config.cardCode}:invalid-source`, [
        ['Aqours'],
        ['Aqours'],
        ['Aqours'],
      ]);
      const invalidSource = createCardInstance(
        live(config.cardCode, ['Aqours']),
        PLAYER1,
        `${config.cardCode}:invalid-source`
      );
      let game = registerCards(
        createGameState(`invalid-source:${config.cardCode}`, PLAYER1, 'P1', PLAYER2, 'P2'),
        [invalidSource, ...cards]
      );
      game = updatePlayer(game, PLAYER1, (player) => ({
        ...player,
        memberSlots: placeCardInSlot(
          player.memberSlots,
          SlotPosition.CENTER,
          invalidSource.instanceId
        ),
      }));
      const resolved = resolve(
        enqueueNormalCheer(
          game,
          cards.map((card) => card.instanceId)
        )
      );
      expect(resolved.pendingAbilities).toEqual([]);
      expect(resolved.activeEffect).toBeNull();
      expect(resolved.liveResolution.liveModifiers).toEqual([]);
      expect(abilityUseCount(resolved, config.abilityId, invalidSource.instanceId)).toBe(1);
      expect(latestResolvePayload(resolved, config.abilityId)).toMatchObject({
        conditionMet: true,
        gainedHearts: [],
      });
    }
  );

  it.each(CONFIGS)(
    '$cardCode resolves two instances of the same ability independently',
    (config) => {
      const cards = ownMembers(`${config.cardCode}:same-identity`, [
        ['Aqours'],
        ['Aqours'],
        ['Aqours'],
      ]);
      const left = createCardInstance(
        member(config.cardCode, ['Aqours']),
        PLAYER1,
        `${config.cardCode}:left`
      );
      const right = createCardInstance(
        member(config.cardCode, ['Aqours']),
        PLAYER1,
        `${config.cardCode}:right`
      );
      let game = registerCards(
        createGameState(`same-identity:${config.cardCode}`, PLAYER1, 'P1', PLAYER2, 'P2'),
        [left, right, ...cards]
      );
      game = updatePlayer(game, PLAYER1, (player) => ({
        ...player,
        memberSlots: placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, left.instanceId),
          SlotPosition.RIGHT,
          right.instanceId
        ),
      }));
      const orderWindow = resolve(
        enqueueNormalCheer(
          game,
          cards.map((card) => card.instanceId)
        )
      );
      const resolved = confirmActiveEffectStep(
        orderWindow,
        PLAYER1,
        orderWindow.activeEffect!.id,
        undefined,
        undefined,
        true
      );
      expect(resolved.pendingAbilities).toEqual([]);
      expect(resolved.activeEffect).toBeNull();
      expectPinkGreenSourceModifier(resolved, config, left.instanceId);
      expectPinkGreenSourceModifier(resolved, config, right.instanceId);
      expect(abilityUseCount(resolved, config.abilityId, left.instanceId)).toBe(1);
      expect(abilityUseCount(resolved, config.abilityId, right.instanceId)).toBe(1);
    }
  );

  it('keeps two source instances and the two ability identities independent through continuation', () => {
    const cards = ownMembers('dual:revealed', [['Aqours'], ['Aqours'], ['Aqours']]);
    const nSource = createCardInstance(member(CONFIGS[0].cardCode, ['虹ヶ咲']), PLAYER1, 'dual:n');
    const sSource = createCardInstance(member(CONFIGS[1].cardCode, ['Aqours']), PLAYER1, 'dual:s');
    let game = registerCards(createGameState('dual', PLAYER1, 'P1', PLAYER2, 'P2'), [
      nSource,
      sSource,
      ...cards,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, nSource.instanceId),
        SlotPosition.RIGHT,
        sSource.instanceId,
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }
      ),
    }));
    game = enqueueNormalCheer(
      game,
      cards.map((card) => card.instanceId)
    );
    expect(game.pendingAbilities.map((pending) => pending.abilityId).sort()).toEqual(
      CONFIGS.map((config) => config.abilityId).sort()
    );

    const orderWindow = resolve(game);
    expect(orderWindow.activeEffect).not.toBeNull();
    const resolved = confirmActiveEffectStep(
      orderWindow,
      PLAYER1,
      orderWindow.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expectPinkGreenSourceModifier(resolved, CONFIGS[0], nSource.instanceId);
    expectPinkGreenSourceModifier(resolved, CONFIGS[1], sSource.instanceId);
    expect(abilityUseCount(resolved, CONFIGS[0].abilityId, nSource.instanceId)).toBe(1);
    expect(abilityUseCount(resolved, CONFIGS[1].abilityId, sSource.instanceId)).toBe(1);
    expect(
      resolved.liveResolution.liveModifiers.find(
        (modifier) => modifier.sourceCardId === nSource.instanceId
      )?.abilityId
    ).toBe(CONFIGS[0].abilityId);
    expect(
      resolved.liveResolution.liveModifiers.find(
        (modifier) => modifier.sourceCardId === sSource.instanceId
      )?.abilityId
    ).toBe(CONFIGS[1].abilityId);
  });
});
