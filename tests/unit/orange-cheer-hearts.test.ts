import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartRequirement,
  getHeartCountByColor,
  type BladeHearts,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import {
  addLiveModifier,
  getCheerCardEffectiveBladeHearts,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import { LiveResolver } from '../../src/domain/rules/live-resolver';
import { calculateHeartDeficit, HeartPool } from '../../src/domain/value-objects/heart';
import { BladeHeartEffect, CardType, HeartColor, SlotPosition } from '../../src/shared/types/enums';
import { placeCardInSlot } from '../../src/domain/entities/zone';

const orange = [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.ORANGE }] as const;

function member(id: string, cost: number, bladeHearts?: BladeHearts) {
  const data: MemberCardData = {
    cardType: CardType.MEMBER,
    cardCode: id,
    name: id,
    cost,
    blade: 0,
    hearts: [{ color: HeartColor.ORANGE, count: 1 }],
    bladeHearts,
  };
  return createCardInstance(data, 'p1', id);
}

// Comprehensive Rules 1.09 (2026-11-11), 2.1.1.3 and 2.1.3:
// ALL substitutes only the six ordinary colors; blade HEARTs retain their Heart identity.
describe('official orange Heart and cheer rules', () => {
  it('keeps ORANGE markers and Hearts for orange or generic requirements, preserving ordinary member ORANGE', () => {
    const resolver = new LiveResolver();
    const result = resolver.processCheer([{ cardId: 'orange', bladeHearts: orange }]);
    expect(result.bladeHearts).toEqual(orange);
    expect(result.bonusHearts.getColorCount(HeartColor.GRAY)).toBe(0);
    expect(result.bonusHearts.getColorCount(HeartColor.ORANGE)).toBe(1);
    expect(result.bonusHearts.getRainbowCount()).toBe(0);
    const requirement = (color: HeartColor) => ({
      cardId: color,
      data: {
        cardType: CardType.LIVE as const,
        cardCode: color,
        name: color,
        score: 1,
        requirements: createHeartRequirement({ [color]: 1 }),
      },
    });
    for (const color of [
      HeartColor.PINK,
      HeartColor.RED,
      HeartColor.YELLOW,
      HeartColor.GREEN,
      HeartColor.BLUE,
      HeartColor.PURPLE,
    ]) {
      const performance = resolver.performLive(
        'p1',
        [],
        [requirement(color)],
        [{ cardId: 'orange', bladeHearts: orange }]
      );
      expect(performance.liveJudgments[0].isSuccess).toBe(false);
    }
    for (const color of [HeartColor.ORANGE, HeartColor.RAINBOW, HeartColor.GRAY]) {
      const performance = resolver.performLive(
        'p1',
        [],
        [requirement(color)],
        [{ cardId: 'orange', bladeHearts: orange }]
      );
      expect(performance.liveJudgments[0].isSuccess).toBe(true);
      expect(performance.liveJudgmentHearts).toEqual([{ color: HeartColor.ORANGE, count: 1 }]);
      expect(performance.remainingHearts).toEqual([]);
    }
    const ordinary = member('ordinary', 1);
    const game = updatePlayer(
      registerCards(createGameState('normal-orange', 'p1', 'P1', 'p2', 'P2'), [ordinary]),
      'p1',
      (player) => ({
        ...player,
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ordinary.instanceId),
      })
    );
    expect(getMemberEffectiveHeartIcons(game, 'p1', ordinary.instanceId)).toEqual([
      { color: HeartColor.ORANGE, count: 1 },
    ]);
    expect(
      resolver.performLive(
        'p1',
        [ordinary.data as MemberCardData],
        [requirement(HeartColor.ORANGE)],
        []
      ).liveJudgments[0].isSuccess
    ).toBe(true);
  });

  it('never substitutes ALL for ORANGE, including deficits and member color queries', () => {
    const allPool = HeartPool.fromHeartIcons([{ color: HeartColor.RAINBOW, count: 8 }]);
    const orangeRequirement = createHeartRequirement({ [HeartColor.ORANGE]: 1 });
    expect(allPool.canSatisfy(orangeRequirement)).toBe(false);
    expect(allPool.allocateForRequirement(orangeRequirement)).toBeNull();
    expect(allPool.consume(orangeRequirement)).toBeNull();
    expect(calculateHeartDeficit(allPool, orangeRequirement)).toEqual(
      new Map([[HeartColor.ORANGE, 1]])
    );
    for (const color of [
      HeartColor.PINK,
      HeartColor.RED,
      HeartColor.YELLOW,
      HeartColor.GREEN,
      HeartColor.BLUE,
      HeartColor.PURPLE,
    ]) {
      expect(allPool.canSatisfy(createHeartRequirement({ [color]: 1 }))).toBe(true);
    }
    const orangeAndAll: MemberCardData = {
      cardType: CardType.MEMBER,
      cardCode: 'orange-all',
      name: 'orange-all',
      cost: 1,
      blade: 0,
      hearts: [
        { color: HeartColor.ORANGE, count: 1 },
        { color: HeartColor.RAINBOW, count: 2 },
      ],
    };
    expect(getHeartCountByColor(orangeAndAll, HeartColor.ORANGE)).toBe(1);
    expect(getHeartCountByColor(orangeAndAll, HeartColor.RED)).toBe(2);
    const resolver = new LiveResolver();
    const result = resolver.performLive(
      'p1',
      [],
      [
        {
          cardId: 'orange-live',
          data: {
            cardType: CardType.LIVE,
            cardCode: 'orange-live',
            name: 'orange-live',
            score: 1,
            requirements: orangeRequirement,
          },
        },
      ],
      [
        {
          cardId: 'all',
          bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }],
        },
      ]
    );
    expect(result.liveJudgments[0].isSuccess).toBe(false);
    expect(result.totalScore).toBe(0);
  });

  it('allocates ALL to ordinary colors or generic demand and preserves exact orange leftovers only when legal', () => {
    const pool = HeartPool.fromHeartIcons([
      { color: HeartColor.ORANGE, count: 1 },
      { color: HeartColor.RAINBOW, count: 2 },
    ]);
    const preferences = { remainingHeartPreferences: [{ color: HeartColor.ORANGE, minCount: 1 }] };
    const generic = createHeartRequirement({ [HeartColor.GRAY]: 1 });
    expect(pool.consume(generic, preferences)?.toArray()).toEqual([
      { color: HeartColor.ORANGE, count: 1 },
      { color: HeartColor.RAINBOW, count: 1 },
    ]);
    const orangeAndRed = createHeartRequirement({ [HeartColor.ORANGE]: 1, [HeartColor.RED]: 1 });
    expect(pool.allocateForRequirement(orangeAndRed, preferences)).toEqual(
      new Map([
        [HeartColor.RED, { normal: 0, rainbow: 1 }],
        [HeartColor.ORANGE, { normal: 1, rainbow: 0 }],
      ])
    );
    expect(pool.consume(orangeAndRed, preferences)?.toArray()).toEqual([
      { color: HeartColor.RAINBOW, count: 1 },
    ]);
    const missingOrange = createHeartRequirement({
      [HeartColor.ORANGE]: 2,
      [HeartColor.RED]: 1,
      [HeartColor.GRAY]: 1,
    });
    expect(pool.consume(missingOrange, preferences)).toBeNull();
    expect(calculateHeartDeficit(pool, missingOrange)).toEqual(new Map([[HeartColor.ORANGE, 1]]));
  });

  it('grants exactly one effective marker to absent/empty low-cost member lists, preserving other markers and owners', () => {
    const markerlessLiveData = {
      cardType: CardType.LIVE,
      cardCode: 'live',
      name: 'live',
      score: 1,
      requirements: createHeartRequirement({}),
    } satisfies LiveCardData;
    const cards = [
      member('absent', 4),
      member('empty', 0, []),
      member('expensive', 5),
      member('draw', 1, [{ effect: BladeHeartEffect.DRAW }]),
      member('score', 1, [{ effect: BladeHeartEffect.SCORE }]),
      member('gray', 1, [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY }]),
      member('all', 1, [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }]),
      member('malformed', 1, null as unknown as BladeHearts),
      createCardInstance(markerlessLiveData, 'p1', 'live'),
      { ...member('opponent', 1), ownerId: 'p2' },
    ];
    let game = registerCards(createGameState('grant', 'p1', 'P1', 'p2', 'P2'), cards);
    for (const source of ['snow-a', 'snow-b'])
      game = addLiveModifier(game, {
        kind: 'CHEER_CARD_BLADE_HEART_GRANT',
        playerId: 'p1',
        maxMemberCost: 4,
        heartColor: HeartColor.ORANGE,
        sourceCardId: source,
      });
    for (const id of ['absent', 'empty'])
      expect(getCheerCardEffectiveBladeHearts(game, 'p1', id)).toEqual(orange);
    for (const id of ['expensive', 'malformed', 'live', 'opponent'])
      expect(getCheerCardEffectiveBladeHearts(game, 'p1', id)).toEqual([]);
    for (const id of ['draw', 'score', 'gray', 'all'])
      expect(getCheerCardEffectiveBladeHearts(game, 'p1', id)).toEqual(
        (cards.find((card) => card.instanceId === id)!.data as MemberCardData).bladeHearts
      );
  });

  it('uses effective member cost and applies the latest color replacement to granted and printed markers in either registration order', () => {
    const card = member('cost', 4);
    for (const grantFirst of [true, false]) {
      let game = registerCards(createGameState(`order-${grantFirst}`, 'p1', 'P1', 'p2', 'P2'), [
        card,
      ]);
      const grant = {
        kind: 'CHEER_CARD_BLADE_HEART_GRANT',
        playerId: 'p1',
        maxMemberCost: 4,
        heartColor: HeartColor.ORANGE,
      } as const;
      const replacement = {
        kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
        playerId: 'p1',
        fromColors: [HeartColor.ORANGE],
        toColor: HeartColor.BLUE,
      } as const;
      for (const modifier of grantFirst ? [grant, replacement] : [replacement, grant])
        game = addLiveModifier(game, modifier);
      expect(getCheerCardEffectiveBladeHearts(game, 'p1', card.instanceId)).toEqual([
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.BLUE },
      ]);
      game = addLiveModifier(game, { ...replacement, toColor: HeartColor.PURPLE });
      expect(getCheerCardEffectiveBladeHearts(game, 'p1', card.instanceId)).toEqual([
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PURPLE },
      ]);
      game = addLiveModifier(game, {
        kind: 'MEMBER_COST',
        playerId: 'p1',
        memberCardId: card.instanceId,
        countDelta: 1,
      });
      expect(getCheerCardEffectiveBladeHearts(game, 'p1', card.instanceId)).toEqual([]);
    }
  });

  it('keeps stage-only cost increases out of the cost-four Hanayo revealed for cheer', () => {
    const hanayo = member('PL!-bp4-008-P', 4);
    const successfulLiveData = {
      cardType: CardType.LIVE,
      cardCode: 'SUCCESS',
      name: 'success',
      score: 6,
      requirements: createHeartRequirement({}),
    } satisfies LiveCardData;
    const successfulLive = createCardInstance(successfulLiveData, 'p1', 'success');
    let game = registerCards(createGameState('cheer-stage-cost', 'p1', 'P1', 'p2', 'P2'), [
      hanayo,
      successfulLive,
    ]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [successfulLive.instanceId] },
    }));
    game = addLiveModifier(game, {
      kind: 'CHEER_CARD_BLADE_HEART_GRANT',
      playerId: 'p1',
      maxMemberCost: 4,
      heartColor: HeartColor.ORANGE,
    });
    expect(getCheerCardEffectiveBladeHearts(game, 'p1', hanayo.instanceId)).toEqual(orange);
    const onStage = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, hanayo.instanceId),
    }));
    expect(getCheerCardEffectiveBladeHearts(onStage, 'p1', hanayo.instanceId)).toEqual([]);
  });
});
