import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartRequirement,
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

describe('orange cheer marker identity and colorless contribution', () => {
  it('preserves ORANGE markers but contributes only GRAY, separately from ALL and ordinary member ORANGE', () => {
    const resolver = new LiveResolver();
    const result = resolver.processCheer([{ cardId: 'orange', bladeHearts: orange }]);
    expect(result.bladeHearts).toEqual(orange);
    expect(result.bonusHearts.getColorCount(HeartColor.GRAY)).toBe(1);
    expect(result.bonusHearts.getColorCount(HeartColor.ORANGE)).toBe(0);
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
    for (const color of [HeartColor.PINK, HeartColor.ORANGE]) {
      const performance = resolver.performLive(
        'p1',
        [],
        [requirement(color)],
        [{ cardId: 'orange', bladeHearts: orange }]
      );
      expect(performance.liveJudgments[0].isSuccess).toBe(false);
    }
    expect(
      resolver.performLive(
        'p1',
        [],
        [requirement(HeartColor.RAINBOW)],
        [{ cardId: 'orange', bladeHearts: orange }]
      ).liveJudgments[0].isSuccess
    ).toBe(true);
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
