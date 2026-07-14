import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import {
  hasLiveWithoutLiveStartOrSuccessAbility,
  liveHasLiveStartOrSuccessAbility,
} from '../../src/domain/rules/live-zone-ability';
import { addCardToZone } from '../../src/domain/entities/zone';
import { CardType, HeartColor } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function live(cardCode: string, cardText?: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    cardText,
  };
}

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function gameWithOwnLiveZone(cards: readonly ReturnType<typeof createCardInstance>[]) {
  let game = registerCards(createGameState('live-zone-ability', PLAYER1, 'P1', PLAYER2, 'P2'), cards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: cards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.liveZone
    ),
  }));
  return game;
}

describe('live-zone printed ability queries', () => {
  it.each([
    [undefined, true],
    ['', true],
    ['【常时】此卡分数+1。', true],
    ['【ライブ開始時】何かをする。', false],
    ['【LIVE开始时】执行效果。', false],
    ['【ライブ成功時】何かをする。', false],
    ['【LIVE成功时】执行效果。', false],
    ['{{live_start.png|ライブ開始時}}何かをする。', false],
    ['{{live_success.png|ライブ成功時}}何かをする。', false],
    ['【ライブ開始時】A。\n【ライブ成功時】B。', false],
  ] as const)('classifies printed text %j without consulting implemented definitions', (cardText, expected) => {
    expect(liveHasLiveStartOrSuccessAbility(cardText)).toBe(!expected);
    const card = createCardInstance(live('PL!-test-live', cardText), PLAYER1, 'live');
    expect(hasLiveWithoutLiveStartOrSuccessAbility(gameWithOwnLiveZone([card]), PLAYER1)).toBe(
      expected
    );
  });

  it('treats an unimplemented printed LIVE_START ability as disqualifying', () => {
    const card = createCardInstance(
      live('PL!-unimplemented-live', '【ライブ開始時】この能力は definition 未登録。'),
      PLAYER1,
      'unimplemented-live'
    );
    expect(hasLiveWithoutLiveStartOrSuccessAbility(gameWithOwnLiveZone([card]), PLAYER1)).toBe(false);
  });

  it('ignores non-LIVE cards, wrong-owner instances, and cards outside the requested player LIVE zone', () => {
    const nonLive = createCardInstance(member('PL!-not-live'), PLAYER1, 'not-live');
    const wrongOwner = createCardInstance(live('PL!-wrong-owner'), PLAYER2, 'wrong-owner');
    const outsideZone = createCardInstance(live('PL!-outside-zone'), PLAYER1, 'outside-zone');
    let game = registerCards(
      createGameState('live-zone-filter', PLAYER1, 'P1', PLAYER2, 'P2'),
      [nonLive, wrongOwner, outsideZone]
    );
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: addCardToZone(addCardToZone(player.liveZone, nonLive.instanceId), wrongOwner.instanceId),
    }));

    expect(hasLiveWithoutLiveStartOrSuccessAbility(game, PLAYER1)).toBe(false);
    expect(hasLiveWithoutLiveStartOrSuccessAbility(game, 'missing-player')).toBe(false);
  });
});
