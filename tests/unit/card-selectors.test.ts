import { describe, expect, it } from 'vitest';
import type { CardInstance, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { and, costLte, groupIs, not, or, typeIs } from '../../src/application/effects/card-selectors';
import { CardType, HeartColor } from '../../src/shared/types/enums';

function memberCard(cardCode: string, overrides: Partial<MemberCardData> = {}): CardInstance {
  return {
    instanceId: `${cardCode}-instance`,
    ownerId: 'player1',
    data: {
      cardCode,
      name: cardCode,
      cardType: CardType.MEMBER,
      cost: 1,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
      ...overrides,
    },
  };
}

function liveCard(cardCode: string, overrides: Partial<LiveCardData> = {}): CardInstance {
  return {
    instanceId: `${cardCode}-instance`,
    ownerId: 'player1',
    data: {
      cardCode,
      name: cardCode,
      cardType: CardType.LIVE,
      score: 3,
      requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      ...overrides,
    },
  };
}

describe('card selectors', () => {
  it('matches card type and numeric member cost', () => {
    const lowCostMember = memberCard('PL!-sd1-low', { cost: 4 });
    const highCostMember = memberCard('PL!-sd1-high', { cost: 5 });
    const live = liveCard('PL!-sd1-live');

    expect(typeIs(CardType.MEMBER)(lowCostMember)).toBe(true);
    expect(typeIs(CardType.MEMBER)(live)).toBe(false);
    expect(costLte(4)(lowCostMember)).toBe(true);
    expect(costLte(4)(highCostMember)).toBe(false);
    expect(costLte(4)(live)).toBe(false);
  });

  it('matches Muse cards by explicit group, text, and PL card-code fallback', () => {
    const explicitMuse = memberCard('OTHER-1', { groupName: "μ's" });
    const textMuse = memberCard('OTHER-2', { cardText: "从『μ's』的成员中选择。" });
    const fallbackMuse = memberCard('PL!-fallback');
    const other = memberCard('OTHER-3', { groupName: 'Aqours' });

    const muse = groupIs("μ's");

    expect(muse(explicitMuse)).toBe(true);
    expect(muse(textMuse)).toBe(true);
    expect(muse(fallbackMuse)).toBe(true);
    expect(muse(other)).toBe(false);
  });

  it('composes selectors with and, or, and not', () => {
    const lowCostMuse = memberCard('PL!-sd1-low', { cost: 4 });
    const highCostMuse = memberCard('PL!-sd1-high', { cost: 5 });
    const live = liveCard('PL!-sd1-live');

    const lowCostMuseMember = and(typeIs(CardType.MEMBER), groupIs("μ's"), costLte(4));
    const lowCostOrLive = or(lowCostMuseMember, typeIs(CardType.LIVE));

    expect(lowCostMuseMember(lowCostMuse)).toBe(true);
    expect(lowCostMuseMember(highCostMuse)).toBe(false);
    expect(lowCostOrLive(live)).toBe(true);
    expect(not(typeIs(CardType.LIVE))(lowCostMuse)).toBe(true);
  });
});
