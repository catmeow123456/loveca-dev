import { describe, expect, it } from 'vitest';
import type { CardInstance, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  and,
  cardNameAliasIs,
  cardNameIs,
  costGte,
  costLte,
  groupAliasIs,
  groupIs,
  hasBladeHeart,
  memberHasHeartColor,
  memberPrintedBladeLte,
  not,
  or,
  typeIs,
  unitAliasIs,
  unitAliasOrTextAliasIs,
  unitIs,
} from '../../src/application/effects/card-selectors';
import { BladeHeartEffect, CardType, HeartColor } from '../../src/shared/types/enums';

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
    expect(costGte(5)(highCostMember)).toBe(true);
    expect(costGte(5)(lowCostMember)).toBe(false);
    expect(costGte(5)(live)).toBe(false);
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

  it('matches Muse aliases through groupAliasIs with legacy bare mu support', () => {
    const explicitMuse = memberCard('OTHER-MUSE-GROUP', { groupName: "μ's" });
    const textMuse = memberCard('OTHER-MUSE-TEXT', { cardText: "从『μ's』的成员中选择。" });
    const bareMuGroup = memberCard('OTHER-MUSE-BARE-GROUP', { groupName: 'μ' });
    const bareMuText = memberCard('OTHER-MUSE-BARE-TEXT', { cardText: '选择1名μ成员。' });
    const fallbackMuse = memberCard('PL!-fallback');
    const aqours = memberCard('OTHER-AQOURS', { groupName: 'Aqours' });
    const other = memberCard('OTHER-GROUP', { groupName: '蓮ノ空' });

    const muse = groupAliasIs("μ's");

    expect(muse(explicitMuse)).toBe(true);
    expect(muse(textMuse)).toBe(true);
    expect(muse(bareMuGroup)).toBe(true);
    expect(muse(bareMuText)).toBe(true);
    expect(muse(fallbackMuse)).toBe(true);
    expect(muse(aqours)).toBe(false);
    expect(muse(other)).toBe(false);
  });

  it('matches known group aliases and card-code fallbacks through one generic selector', () => {
    const hasunosoraChinese = memberCard('OTHER-HS-CN', { groupName: '莲之空女学院' });
    const hasunosoraJapanese = memberCard('OTHER-HS-JP', {
      groupName: '蓮ノ空女学院スクールアイドルクラブ',
    });
    const hasunosoraFallback = memberCard('PL!HS-fallback');
    const liellaGroup = memberCard('OTHER-SP-GROUP', { groupName: 'Liella!' });
    const liellaGroupWithoutBang = memberCard('OTHER-SP-GROUP-NO-BANG', { groupName: 'Liella' });
    const liellaTextWithoutBang = memberCard('OTHER-SP-TEXT-NO-BANG', {
      cardText: 'Liella のメンバー。',
    });
    const liellaText = memberCard('OTHER-SP-TEXT', { cardText: '『リエラ』のメンバー。' });
    const liellaFallback = memberCard('PL!SP-fallback');
    const nijigasakiText = memberCard('OTHER-N-TEXT', { cardText: 'Nijigasaki のメンバー。' });
    const nijigasakiFallback = memberCard('PL!N-fallback');
    const aqoursText = memberCard('OTHER-S-TEXT', { groupName: 'Aqours' });
    const aqoursFallback = memberCard('PL!S-fallback');
    const other = memberCard('OTHER-identity', { groupName: "μ's" });

    const hasunosora = groupAliasIs('蓮ノ空');
    const liella = groupAliasIs('Liella!');
    const nijigasaki = groupAliasIs('虹ヶ咲');
    const aqours = groupAliasIs('Aqours');

    expect(groupAliasIs("μ's")(memberCard('PL!-fallback'))).toBe(true);
    expect(hasunosora(hasunosoraChinese)).toBe(true);
    expect(hasunosora(hasunosoraJapanese)).toBe(true);
    expect(hasunosora(hasunosoraFallback)).toBe(true);
    expect(liella(liellaGroup)).toBe(true);
    expect(liella(liellaGroupWithoutBang)).toBe(true);
    expect(liella(liellaTextWithoutBang)).toBe(true);
    expect(liella(liellaText)).toBe(true);
    expect(liella(liellaFallback)).toBe(true);
    expect(nijigasaki(nijigasakiText)).toBe(true);
    expect(nijigasaki(nijigasakiFallback)).toBe(true);
    expect(aqours(aqoursText)).toBe(true);
    expect(aqours(aqoursFallback)).toBe(true);
    expect(hasunosora(other)).toBe(false);
  });

  it('matches card unit independently from series group', () => {
    const ceriseLive = liveCard('PL!HS-bp2-022-L', {
      groupName: '蓮ノ空女学院スクールアイドルクラブ',
      unitName: 'スリーズブーケ',
    });
    const dollchestraLive = liveCard('PL!HS-bp6-027-L', {
      groupName: '蓮ノ空女学院スクールアイドルクラブ',
      unitName: 'DOLLCHESTRA',
    });

    expect(unitIs('スリーズブーケ')(ceriseLive)).toBe(true);
    expect(unitIs('Cerise Bouquet')(ceriseLive)).toBe(false);
    expect(unitIs('スリーズブーケ')(dollchestraLive)).toBe(false);
  });

  it('matches known unit aliases across English and Japanese unit names', () => {
    const ceriseLive = liveCard('PL!HS-bp2-022-L', {
      groupName: '蓮ノ空女学院スクールアイドルクラブ',
      unitName: 'スリーズブーケ',
    });
    const miraCraLive = liveCard('PL!HS-bp6-027-L', {
      groupName: '蓮ノ空女学院スクールアイドルクラブ',
      unitName: 'みらくらぱーく！',
    });

    expect(unitAliasIs('Cerise Bouquet')(ceriseLive)).toBe(true);
    expect(unitAliasIs('スリーズブーケ')(ceriseLive)).toBe(true);
    expect(unitAliasIs('Mira-Cra Park!')(miraCraLive)).toBe(true);
    expect(unitAliasIs('みらくらぱーく!')(miraCraLive)).toBe(true);
    expect(unitAliasIs('スリーズブーケ')(miraCraLive)).toBe(false);
  });

  it('matches known unit aliases in text only when explicitly requested', () => {
    const treatedAsThreeUnits = liveCard('PL!HS-test-L', {
      cardText: 'すべての領域にあるこのカードは『Cerise Bouquet』、『DOLLCHESTRA』、『Mira-Cra Park!』として扱う。',
    });

    expect(unitAliasIs('スリーズブーケ')(treatedAsThreeUnits)).toBe(false);
    expect(unitAliasOrTextAliasIs('スリーズブーケ')(treatedAsThreeUnits)).toBe(true);
    expect(unitAliasOrTextAliasIs('DOLLCHESTRA')(treatedAsThreeUnits)).toBe(true);
    expect(unitAliasOrTextAliasIs('みらくらぱーく！')(treatedAsThreeUnits)).toBe(true);
  });

  it('matches card names after whitespace normalization', () => {
    const spacedName = memberCard('PL!HS-bp6-004-R', { name: '百生 吟子' });
    const compactName = memberCard('PL!HS-pb1-004-R', { name: '百生吟子' });
    const otherName = memberCard('PL!HS-bp6-017-N', { name: '日野下花帆' });

    const ginko = cardNameIs('百生吟子');

    expect(ginko(spacedName)).toBe(true);
    expect(ginko(compactName)).toBe(true);
    expect(ginko(otherName)).toBe(false);
  });

  it('matches member heart color only for positive heart counts on member cards', () => {
    const greenMember = memberCard('green-member', {
      hearts: [createHeartIcon(HeartColor.GREEN, 1)],
    });
    const zeroGreenMember = memberCard('zero-green-member', {
      hearts: [createHeartIcon(HeartColor.GREEN, 0)],
    });
    const greenLive = liveCard('green-live', {
      requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
    });

    const greenHeartMember = memberHasHeartColor(HeartColor.GREEN);

    expect(greenHeartMember(greenMember)).toBe(true);
    expect(greenHeartMember(zeroGreenMember)).toBe(false);
    expect(greenHeartMember(greenLive)).toBe(false);
  });

  it('matches cards that have printed BLADE HEART items and composes with not', () => {
    const bladeHeartMember = memberCard('blade-heart-member', {
      bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
    });
    const noBladeHeartMember = memberCard('no-blade-heart-member', { bladeHearts: [] });

    const hasPrintedBladeHeart = hasBladeHeart();

    expect(hasPrintedBladeHeart(bladeHeartMember)).toBe(true);
    expect(hasPrintedBladeHeart(noBladeHeartMember)).toBe(false);
    expect(not(hasPrintedBladeHeart)(noBladeHeartMember)).toBe(true);
  });

  it('matches member printed BLADE at or below a threshold', () => {
    const lowBladeMember = memberCard('low-blade-member', { blade: 3 });
    const highBladeMember = memberCard('high-blade-member', { blade: 4 });
    const live = liveCard('blade-live');

    const printedBladeLte3 = memberPrintedBladeLte(3);

    expect(printedBladeLte3(lowBladeMember)).toBe(true);
    expect(printedBladeLte3(highBladeMember)).toBe(false);
    expect(printedBladeLte3(live)).toBe(false);
  });

  it('matches current character name aliases across Japanese and Chinese names', () => {
    const aliasCases = [
      ['高坂穂乃果', '高坂穗乃果'],
      ['絢瀬絵里', '绚濑绘里'],
      ['南ことり', '南琴梨'],
      ['矢澤にこ', '矢泽日香'],
      ['桜内梨子', '樱内梨子'],
      ['黒澤ダイヤ', '黑泽黛雅'],
      ['黒澤ルビィ', '黑泽露比'],
      ['上原歩夢', '上原步梦'],
      ['桜坂しずく', '樱坂雫'],
      ['優木せつ菜', '优木雪菜'],
      ['エマ・ヴェルデ', '艾玛·维尔德'],
      ['ミア・テイラー', '米娅·泰勒'],
      ['鐘嵐珠', '钟岚珠'],
      ['澁谷かのん', '涩谷香音'],
      ['渋谷かのん', '涉谷香音'],
      ['平安名すみれ', '平安名 堇'],
      ['桜小路きな子', '樱小路 希奈子'],
      ['米女メイ', '米女芽衣'],
      ['鬼塚夏美', '鬼冢夏美'],
      ['ウィーン・マルガレーテ', '薇恩・玛格丽特'],
      ['日野下花帆', '日野下 花帆'],
      ['村野さやか', '村野沙耶香'],
      ['夕霧綴理', '夕雾缀理'],
      ['大沢瑠璃乃', '大泽瑠璃乃'],
      ['大沢瑠璃乃', '大泽琉璃乃'],
      ['藤島慈', '藤岛 慈'],
      ['徒町小鈴', '徒町 小铃'],
      ['安養寺姫芽', '安养寺姬芽'],
      ['セラス 柳田 リリエンフェルト', '赛拉丝·柳田·利林费尔德'],
      ['セラス柳田リリエンフェルト', '赛拉丝柳田利林费尔德'],
      ['綺羅ツバサ', '绮罗翼'],
      ['優木あんじゅ', '优木杏树'],
      ['鹿角聖良', '鹿角圣良'],
      ['鹿角理亞', '鹿角理亚'],
      ['聖澤悠奈', '圣泽悠奈'],
    ] as const;

    for (const [queryName, cardName] of aliasCases) {
      expect(cardNameAliasIs(queryName)(memberCard(`alias-${queryName}`, { name: cardName }))).toBe(
        true
      );
    }

    expect(
      cardNameAliasIs('大沢瑠璃乃')(
        memberCard('LL-bp2-001-R+', { name: '渡辺 曜&鬼塚夏美&大沢瑠璃乃' })
      )
    ).toBe(true);
    expect(cardNameAliasIs('大沢瑠璃乃')(memberCard('PL!HS-other', { name: '藤島 慈' }))).toBe(
      false
    );
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
