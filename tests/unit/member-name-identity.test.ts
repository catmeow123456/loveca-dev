import { describe, expect, it } from 'vitest';
import {
  cardNameAliasMatches,
  getNormalizedCardNameCandidates,
  hasAtLeastDifferentNamedCards,
  normalizeCardName,
  selectDifferentNamedCards,
} from '../../src/shared/utils/card-identity';
import { cardNameIs } from '../../src/application/effects/card-selectors';
import { createCardInstance } from '../../src/domain/entities/card';
import { CardType } from '../../src/shared/types/enums';

// Explicit identity fixtures: changes to the runtime alias table do not rewrite these expectations.
const MEMBER_ALIASES = [
  ['高坂穂乃果', '高坂穗乃果'],
  ['絢瀬絵里', '绚濑绘里'],
  ['南ことり', '南琴梨', '南琴梨（南小鸟）', '南小鸟'],
  ['園田海未', '园田海未'],
  ['星空凛'],
  ['西木野真姫', '西木野真姬'],
  ['東條希', '东条希'],
  ['小泉花陽', '小泉花阳'],
  ['矢澤にこ', '矢泽日香', '矢泽日香（妮可）', '矢泽日香（矢泽妮可）', '矢泽妮可', '妮可'],
  ['高海千歌'],
  ['桜内梨子', '樱内梨子'],
  ['松浦果南'],
  ['黒澤ダイヤ', '黑泽黛雅'],
  ['渡辺曜', '渡边曜'],
  ['津島善子', '津岛善子'],
  ['国木田花丸'],
  ['小原鞠莉'],
  ['黒澤ルビィ', '黑泽露比'],
  ['上原歩夢', '上原步梦'],
  ['中須かすみ', '中须霞'],
  ['桜坂しずく', '樱坂雫'],
  ['朝香果林'],
  ['宮下愛', '宫下爱'],
  ['近江彼方'],
  ['優木せつ菜', '优木雪菜'],
  ['エマ・ヴェルデ', '艾玛·维尔德'],
  ['天王寺璃奈'],
  ['三船栞子'],
  ['ミア・テイラー', '米娅·泰勒'],
  ['鐘嵐珠', '钟岚珠'],
  ['澁谷かのん', '渋谷かのん', '涩谷香音', '涉谷香音'],
  ['唐可可'],
  ['嵐千砂都', '岚千砂都'],
  ['平安名すみれ', '平安名堇'],
  ['葉月恋', '叶月恋'],
  ['桜小路きな子', '樱小路希奈子'],
  ['米女メイ', '米女芽衣'],
  ['若菜四季'],
  ['鬼塚夏美', '鬼冢夏美'],
  ['ウィーン・マルガレーテ', '薇恩・玛格丽特'],
  ['鬼塚冬毬', '鬼冢冬毬'],
  ['日野下花帆'],
  ['村野さやか', '村野沙耶香'],
  ['乙宗梢'],
  ['夕霧綴理', '夕雾缀理'],
  ['大沢瑠璃乃', '大泽瑠璃乃', '大泽琉璃乃'],
  ['藤島慈', '藤岛慈'],
  ['百生吟子'],
  ['徒町小鈴', '徒町小铃'],
  ['安養寺姫芽', '安养寺姬芽'],
  [
    'セラス柳田リリエンフェルト',
    'セラス 柳田 リリエンフェルト',
    '赛拉丝柳田利林费尔德',
    '赛拉丝·柳田·利林费尔德',
  ],
  ['桂城泉'],
  ['綺羅ツバサ', '绮罗翼'],
  ['優木あんじゅ', '优木杏树'],
  ['統堂英玲奈', '统堂英玲奈'],
  ['鹿角聖良', '鹿角圣良'],
  ['鹿角理亞', '鹿角理亚'],
  ['柊摩央'],
  ['聖澤悠奈', '圣泽悠奈'],
] as const;
const memberOptions = { nameComparison: 'MEMBER_IDENTITY', minCount: 0 } as const;
const count = (names: readonly string[]) =>
  selectDifferentNamedCards(
    names.map((name) => ({ name })),
    (card) => card,
    memberOptions
  ).length;

describe('member-name identity for distinct-card assignment', () => {
  it.each(
    MEMBER_ALIASES.filter((names) => new Set(names.map(normalizeCardName)).size > 1).map(
      (names) => ({
        name: names[0],
        names,
      })
    )
  )('counts all spellings of $name as one member', ({ names }) => {
    expect(count(names)).toBe(1);
    expect(
      hasAtLeastDifferentNamedCards(
        names.map((name) => ({ name })),
        2,
        (card) => card,
        { nameComparison: 'MEMBER_IDENTITY' }
      )
    ).toBe(false);
  });

  it.each([
    [['星空凛&小泉花阳'], 1],
    [['星空凛&小泉花阳', '星空凛'], 2],
    [['星空凛&小泉花阳', '小泉花陽'], 2],
    [['星空凛&小泉花阳', '星空凛', '小泉花陽'], 2],
    [['星空凛&小泉花阳', '星空凛＆小泉花陽'], 2],
    [['高坂穗乃果', '高坂穂乃果'], 1],
    [['上原歩夢&澁谷かのん&日野下花帆', '上原步梦', '涩谷香音'], 3],
    [['未知成员甲', '未知成员乙', '未知 成员甲'], 2],
  ] as const)('assigns every card at most one distinct member: %j', (names, expected) => {
    for (const ordered of [names, [...names].reverse()]) {
      expect(count(ordered)).toBe(expected);
      expect(count(ordered.map((name) => name.split(/[&＆]/).reverse().join('&')))).toBe(expected);
    }
  });

  it('keeps every canonical member distinct and never counts Muse aliases or DUO as a tenth member', () => {
    expect(count(MEMBER_ALIASES.map((names) => names[0]))).toBe(MEMBER_ALIASES.length);
    expect(
      count([
        '高坂穂乃果',
        '绚濑绘里',
        '南琴梨（南小鸟）',
        '园田海未',
        '星空凛',
        '西木野真姬',
        '东条希',
        '小泉花阳',
        '矢泽日香（矢泽妮可）',
        '高坂穗乃果',
        '星空凛&小泉花陽',
      ])
    ).toBe(9);
  });

  it.each([
    ['米女メイ', '米女芽衣'],
    ['米女芽衣', '米女メイ'],
    ['澁谷かのん&米女メイ', '涩谷香音&米女芽衣'],
  ])(
    'canonicalizes excluded names from %s as well as candidate identities',
    (source, candidate) => {
      const selected = selectDifferentNamedCards(
        [{ name: candidate }, { name: '平安名堇' }],
        (card) => card,
        {
          ...memberOptions,
          excludedNormalizedNames: getNormalizedCardNameCandidates({ name: source }),
        }
      );
      expect(selected.map((match) => match.name)).toEqual(['平安名堇']);
    }
  );

  it('preserves group-name mapping and simultaneous different-cost constraints', () => {
    const cards = [
      {
        name: '上原歩夢&澁谷かのん&日野下花帆',
        groupNames: ['虹ヶ咲', 'Liella!', '蓮ノ空'],
        cost: 2,
      },
      { name: '涩谷香音', groupNames: ['Liella!'], cost: 3 },
      { name: '唐可可', groupNames: ['Liella!'], cost: 3 },
    ];
    const selected = selectDifferentNamedCards(cards, (card) => card, {
      ...memberOptions,
      groupName: 'Liella!',
      getSecondaryKey: (card) => card.cost,
    });
    expect(selected.map((match) => match.name)).toEqual(['澁谷かのん', '唐可可']);
  });

  it('leaves strict card-name comparison and displayed names unchanged', () => {
    const cards = [{ name: '高坂穗乃果' }, { name: '高坂穂乃果' }];
    expect(selectDifferentNamedCards(cards, (card) => card, { minCount: 0 })).toHaveLength(2);
    const selected = selectDifferentNamedCards(cards, (card) => card, memberOptions);
    expect(selected[0]?.name).toBe('高坂穗乃果');
    expect(selected[0]?.normalizedName).toBe('高坂穂乃果');
    expect(cardNameAliasMatches(cards[0], cards[1].name)).toBe(true);
    const member = createCardInstance(
      {
        name: '高坂穗乃果',
        cardCode: 'STRICT-NAME',
        cardType: CardType.MEMBER,
      },
      'p1',
      'strict'
    );
    expect(cardNameIs('高坂穂乃果')(member)).toBe(false);
    expect(normalizeCardName('高坂穗乃果')).toBe('高坂穗乃果');
  });
});
