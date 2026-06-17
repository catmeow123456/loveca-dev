import { describe, expect, it } from 'vitest';
import {
  cardBelongsToGroup,
  type CardIdentityLike,
  type GroupIdentityName,
} from '../../src/shared/utils/card-identity';

describe('card identity helpers', () => {
  it('matches group aliases through groupName and cardText with normalized punctuation', () => {
    const cases: readonly {
      readonly groupName: GroupIdentityName;
      readonly card: CardIdentityLike;
    }[] = [
      { groupName: "μ's", card: { groupName: '『μ』' } },
      { groupName: '蓮ノ空', card: { groupName: '莲之空女学院スクールアイドルクラブ' } },
      { groupName: '蓮ノ空', card: { cardText: 'Hasunosora のメンバー' } },
      { groupName: 'Liella!', card: { groupName: 'Liella！' } },
      { groupName: 'Liella!', card: { cardText: 'SUPERSTAR 楽曲' } },
      { groupName: '虹ヶ咲', card: { cardText: '「Nijigasaki」スクールアイドル' } },
      { groupName: 'Aqours', card: { groupName: 'Aqours' } },
    ];

    for (const { groupName, card } of cases) {
      expect(cardBelongsToGroup(card, groupName)).toBe(true);
    }
  });

  it('matches group identity from card-code fallbacks', () => {
    expect(cardBelongsToGroup({ cardCode: 'PL!-sd1-001' }, "μ's")).toBe(true);
    expect(cardBelongsToGroup({ cardCode: 'PL!HS-bp1-001' }, '蓮ノ空')).toBe(true);
    expect(cardBelongsToGroup({ cardCode: 'PL!SP-bp1-001' }, 'Liella!')).toBe(true);
    expect(cardBelongsToGroup({ cardCode: 'PL!N-pb1-001' }, '虹ヶ咲')).toBe(true);
    expect(cardBelongsToGroup({ cardCode: 'PL!S-bp1-001' }, 'Aqours')).toBe(true);
  });

  it('does not match unrelated groups or unknown identities', () => {
    expect(cardBelongsToGroup({ groupName: 'Aqours' }, "μ's")).toBe(false);
    expect(cardBelongsToGroup({ cardText: 'Cerise Bouquet' }, '蓮ノ空')).toBe(false);
    expect(cardBelongsToGroup({ cardCode: 'PL!SP-bp1-001' }, '虹ヶ咲')).toBe(false);
    expect(cardBelongsToGroup({ groupName: 'Liella' }, 'Unknown')).toBe(false);
  });

  it('does not match when identity fields are absent', () => {
    expect(cardBelongsToGroup({}, "μ's")).toBe(false);
    expect(cardBelongsToGroup({}, '蓮ノ空')).toBe(false);
    expect(cardBelongsToGroup({}, 'Liella!')).toBe(false);
    expect(cardBelongsToGroup({}, '虹ヶ咲')).toBe(false);
    expect(cardBelongsToGroup({}, 'Aqours')).toBe(false);
  });
});
