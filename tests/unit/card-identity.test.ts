import { describe, expect, it } from 'vitest';
import {
  cardBelongsToGroup,
  getCardGroupIdentityKeys,
  getCardNameCandidates,
  hasAtLeastDifferentNamedCards,
} from '../../src/shared/utils/card-identity';

const llBp1001 = {
  cardCode: 'LL-bp1-001-R＋',
  name: '上原歩夢&澁谷かのん&日野下花帆',
  groupNames: [
    'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
    'ラブライブ！スーパースター!!',
    '蓮ノ空女学院スクールアイドルクラブ',
  ],
};

const THREE_NAME_MEMBER_CASES = [
  {
    cardCode: 'LL-bp1-001-R＋',
    name: '上原歩夢&澁谷かのん&日野下花帆',
    works: [
      'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
      'ラブライブ！スーパースター!!',
      '蓮ノ空女学院スクールアイドルクラブ',
    ],
    expected: {
      '虹ヶ咲': '上原歩夢',
      'Liella!': '澁谷かのん',
      '蓮ノ空': '日野下花帆',
    },
  },
  {
    cardCode: 'LL-bp2-001-R＋',
    name: '渡辺 曜&鬼塚夏美&大沢瑠璃乃',
    works: [
      'ラブライブ！サンシャイン!!',
      'ラブライブ！スーパースター!!',
      '蓮ノ空女学院スクールアイドルクラブ',
    ],
    expected: {
      Aqours: '渡辺 曜',
      'Liella!': '鬼塚夏美',
      '蓮ノ空': '大沢瑠璃乃',
    },
  },
  {
    cardCode: 'LL-bp3-001-R＋',
    name: '園田海未&津島善子&天王寺璃奈',
    works: [
      'ラブライブ！',
      'ラブライブ！サンシャイン!!',
      'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
    ],
    expected: {
      "μ's": '園田海未',
      Aqours: '津島善子',
      '虹ヶ咲': '天王寺璃奈',
    },
  },
  {
    cardCode: 'LL-bp4-001-R＋',
    name: '絢瀬絵里&朝香果林&葉月 恋',
    works: [
      'ラブライブ！',
      'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
      'ラブライブ！スーパースター!!',
    ],
    expected: {
      "μ's": '絢瀬絵里',
      '虹ヶ咲': '朝香果林',
      'Liella!': '葉月 恋',
    },
  },
  {
    cardCode: 'LL-bp6-001-R＋',
    name: '南 ことり&黒澤ダイヤ&徒町小鈴',
    works: ['ラブライブ！', 'ラブライブ！サンシャイン!!', '蓮ノ空女学院スクールアイドルクラブ'],
    expected: {
      "μ's": '南 ことり',
      Aqours: '黒澤ダイヤ',
      '蓮ノ空': '徒町小鈴',
    },
  },
] as const;

describe('card identity helpers', () => {
  it('splits Q62 multi-name cards into separate name candidates', () => {
    expect(getCardNameCandidates(llBp1001)).toEqual(['上原歩夢', '澁谷かのん', '日野下花帆']);
    expect(getCardNameCandidates({ name: '園田海未＆津島善子＆天王寺璃奈' })).toEqual([
      '園田海未',
      '津島善子',
      '天王寺璃奈',
    ]);
  });

  it('normalizes official groupNames and series text to canonical group identities', () => {
    expect(cardBelongsToGroup({ groupNames: ['ラブライブ！'] }, "μ's")).toBe(true);
    expect(cardBelongsToGroup({ groupNames: ['ラブライブ！スーパースター!!'] }, 'Liella!')).toBe(
      true
    );
    expect(
      cardBelongsToGroup(
        { groupNames: ['ラブライブ！虹ヶ咲学園スクールアイドル同好会'] },
        '虹ヶ咲'
      )
    ).toBe(true);
    expect(cardBelongsToGroup({ groupNames: ['ラブライブ！スーパースター!!'] }, "μ's")).toBe(
      false
    );
    expect(getCardGroupIdentityKeys(llBp1001)).toEqual(['hasunosora', 'liella', 'nijigasaki']);
  });

  it.each(THREE_NAME_MEMBER_CASES)(
    'filters $cardCode names by aligned group identity source',
    ({ cardCode, name, works, expected }) => {
      const workNamesOnly = {
        cardCode,
        name,
        workNames: [works.join('\n')],
      };
      const groupNamesAndWorkNames = {
        cardCode,
        name,
        groupNames: works,
        workNames: [works.join('\n')],
      };

      for (const [groupName, expectedName] of Object.entries(expected)) {
        expect(getCardNameCandidates(workNamesOnly, { groupName })).toEqual([expectedName]);
        expect(getCardNameCandidates(groupNamesAndWorkNames, { groupName })).toEqual([
          expectedName,
        ]);
      }
    }
  );

  it('keeps group identity union while name mapping refuses unaligned union sources', () => {
    const mixedSources = {
      cardCode: 'LL-bp1-001-R＋',
      name: '上原歩夢&澁谷かのん&日野下花帆',
      groupNames: ['ラブライブ！虹ヶ咲学園スクールアイドル同好会'],
      workNames: ['ラブライブ！スーパースター!!\n蓮ノ空女学院スクールアイドルクラブ'],
    };

    expect(getCardGroupIdentityKeys(mixedSources)).toEqual(['hasunosora', 'liella', 'nijigasaki']);
    expect(getCardNameCandidates(mixedSources, { groupName: '虹ヶ咲' })).toEqual([
      '上原歩夢',
      '澁谷かのん',
      '日野下花帆',
    ]);
  });

  it('matches different names with one contributed name per member', () => {
    expect(
      hasAtLeastDifferentNamedCards(
        [
          llBp1001,
          { name: '日野下花帆' },
          { name: '村野さやか' },
        ],
        3,
        (card) => card
      )
    ).toBe(true);

    expect(
      hasAtLeastDifferentNamedCards(
        [llBp1001, { name: '日野下花帆' }, { name: '日野 下花帆' }],
        3,
        (card) => card
      )
    ).toBe(false);
  });
});
