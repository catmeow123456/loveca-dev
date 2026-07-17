import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import {
  findOwnSuccessOrCurrentLiveCardsWithExactEffectiveRequiredHeartCount,
  hasOwnSuccessOrCurrentLiveCardWithExactEffectiveRequiredHeartCount,
} from '../../src/domain/rules/live-card-effective-requirement';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { CardType, HeartColor } from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';

function live(cardCode: string, pink: number, groupNames = ['虹ヶ咲']): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: pink }),
  };
}

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setup(options: {
  readonly current?: readonly ReturnType<typeof createCardInstance>[];
  readonly success?: readonly ReturnType<typeof createCardInstance>[];
}) {
  const current = options.current ?? [];
  const success = options.success ?? [];
  let game = registerCards(createGameState('effective-requirement-query', P1, 'P1', P2, 'P2'), [
    ...current,
    ...success,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: current.reduce(
      (zone, card) => addCardToStatefulZone(zone, card.instanceId),
      player.liveZone
    ),
    successZone: success.reduce(
      (zone, card) => addCardToStatefulZone(zone, card.instanceId),
      player.successZone
    ),
  }));
  return game;
}

const exactPink = (exactCount: number) => ({
  group: '虹ヶ咲',
  heartColor: HeartColor.PINK,
  exactCount,
});

describe('effective required Heart query across own success/current LIVE zones', () => {
  it.each([3, 4, 5])('uses exact equality at the 4 threshold for printed count %i', (pink) => {
    const card = createCardInstance(live(`PL!N-query-${pink}`, pink), P1, `live-${pink}`);
    expect(
      hasOwnSuccessOrCurrentLiveCardWithExactEffectiveRequiredHeartCount(
        setup({ current: [card] }),
        P1,
        exactPink(4)
      )
    ).toBe(pink === 4);
  });

  it('matches cards found only in success LIVE or only in current LIVE', () => {
    const success = createCardInstance(live('PL!N-success', 4), P1, 'success');
    const current = createCardInstance(live('PL!N-current', 4), P1, 'current');
    expect(
      findOwnSuccessOrCurrentLiveCardsWithExactEffectiveRequiredHeartCount(
        setup({ success: [success] }),
        P1,
        exactPink(4)
      )
    ).toEqual(['success']);
    expect(
      findOwnSuccessOrCurrentLiveCardsWithExactEffectiveRequiredHeartCount(
        setup({ current: [current] }),
        P1,
        exactPink(4)
      )
    ).toEqual(['current']);
  });

  it('rejects non-Nijigasaki LIVE cards and non-LIVE objects', () => {
    const aqours = createCardInstance(live('PL!S-aqours', 4, ['Aqours']), P1, 'aqours');
    const wrongType = createCardInstance(member('PL!N-member'), P1, 'member');
    expect(
      findOwnSuccessOrCurrentLiveCardsWithExactEffectiveRequiredHeartCount(
        setup({ current: [aqours, wrongType] }),
        P1,
        exactPink(4)
      )
    ).toEqual([]);
  });

  it('uses requirement modifiers that move a card into and out of the exact threshold', () => {
    const enters = createCardInstance(live('PL!N-enters', 3), P1, 'enters');
    let entersGame = setup({ current: [enters] });
    entersGame = addLiveModifier(entersGame, {
      kind: 'REQUIREMENT',
      liveCardId: enters.instanceId,
      modifiers: [{ color: HeartColor.PINK, countDelta: 1 }],
      sourceCardId: 'increase-source',
      abilityId: 'increase-pink',
    });
    expect(
      hasOwnSuccessOrCurrentLiveCardWithExactEffectiveRequiredHeartCount(
        entersGame,
        P1,
        exactPink(4)
      )
    ).toBe(true);

    const leaves = createCardInstance(live('PL!N-leaves', 4), P1, 'leaves');
    let leavesGame = setup({ success: [leaves] });
    leavesGame = addLiveModifier(leavesGame, {
      kind: 'REQUIREMENT',
      liveCardId: leaves.instanceId,
      modifiers: [{ color: HeartColor.PINK, countDelta: -1 }],
      sourceCardId: 'reduce-source',
      abilityId: 'reduce-pink',
    });
    expect(
      hasOwnSuccessOrCurrentLiveCardWithExactEffectiveRequiredHeartCount(
        leavesGame,
        P1,
        exactPink(4)
      )
    ).toBe(false);
  });

  it('supports the 038/039 cross conditions without excluding the current source LIVE', () => {
    const phoenix = createCardInstance(live('PL!N-pb1-038-L', 3), P1, 'phoenix');
    const stellar = createCardInstance(live('PL!N-pb1-039-L', 4), P1, 'stellar');
    const game = setup({ current: [phoenix, stellar] });
    expect(
      findOwnSuccessOrCurrentLiveCardsWithExactEffectiveRequiredHeartCount(game, P1, exactPink(3))
    ).toEqual(['phoenix']);
    expect(
      findOwnSuccessOrCurrentLiveCardsWithExactEffectiveRequiredHeartCount(game, P1, exactPink(4))
    ).toEqual(['stellar']);
  });
});
