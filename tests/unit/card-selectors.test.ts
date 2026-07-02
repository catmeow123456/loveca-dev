import { describe, expect, it } from 'vitest';
import type { CardInstance, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  and,
  cardNameAliasAny,
  cardNameAliasIs,
  cardNameContains,
  cardNameIs,
  costGte,
  costLte,
  groupAliasIs,
  groupIs,
  hasAllBladeHeart,
  hasBladeHeart,
  hasNoAbilityOrContinuousAbility,
  hasScoreBladeHeart,
  liveRequiresHeartColor,
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

  it('matches Muse cards by structured groupNames only', () => {
    const explicitMuse = memberCard('OTHER-1', { groupNames: ["μ's"] });
    const textMuse = memberCard('OTHER-2', { cardText: "从『μ's』的成员中选择。" });
    const fallbackMuse = memberCard('PL!-fallback');
    const other = memberCard('OTHER-3', { groupNames: ['Aqours'] });

    const muse = groupIs("μ's");

    expect(muse(explicitMuse)).toBe(true);
    expect(muse(textMuse)).toBe(false);
    expect(muse(fallbackMuse)).toBe(false);
    expect(muse(other)).toBe(false);
  });

  it('matches Muse aliases through groupAliasIs with structured bare mu support', () => {
    const explicitMuse = memberCard('OTHER-MUSE-GROUP', { groupNames: ["μ's"] });
    const textMuse = memberCard('OTHER-MUSE-TEXT', { cardText: "从『μ's』的成员中选择。" });
    const bareMuGroup = memberCard('OTHER-MUSE-BARE-GROUP', { groupNames: ['μ'] });
    const bareMuText = memberCard('OTHER-MUSE-BARE-TEXT', { cardText: '选择1名μ成员。' });
    const fallbackMuse = memberCard('PL!-fallback');
    const aqours = memberCard('OTHER-AQOURS', { groupNames: ['Aqours'] });
    const other = memberCard('OTHER-GROUP', { groupNames: ['蓮ノ空'] });

    const muse = groupAliasIs("μ's");

    expect(muse(explicitMuse)).toBe(true);
    expect(muse(textMuse)).toBe(false);
    expect(muse(bareMuGroup)).toBe(true);
    expect(muse(bareMuText)).toBe(false);
    expect(muse(fallbackMuse)).toBe(false);
    expect(muse(aqours)).toBe(false);
    expect(muse(other)).toBe(false);
  });

  it('matches known group aliases through structured groupNames', () => {
    const hasunosoraChinese = memberCard('OTHER-HS-CN', { groupNames: ['莲之空女学院'] });
    const hasunosoraJapanese = memberCard('OTHER-HS-JP', {
      groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    });
    const hasunosoraText = memberCard('OTHER-HS-TEXT', { cardText: 'Hasunosora のメンバー。' });
    const hasunosoraPrefixOnly = memberCard('PL!HS-prefix-only');
    const liellaGroup = memberCard('OTHER-SP-GROUP', { groupNames: ['Liella!'] });
    const liellaGroupWithoutBang = memberCard('OTHER-SP-GROUP-NO-BANG', { groupNames: ['Liella'] });
    const liellaTextWithoutBang = memberCard('OTHER-SP-TEXT-NO-BANG', {
      cardText: 'Liella のメンバー。',
    });
    const liellaText = memberCard('OTHER-SP-TEXT', { cardText: '『リエラ』のメンバー。' });
    const liellaSuperstar = memberCard('OTHER-SP-SUPERSTAR', { cardText: 'スーパースター楽曲。' });
    const liellaSuperstarEnglish = memberCard('OTHER-SP-SUPERSTAR-EN', {
      cardText: 'SUPERSTAR member.',
    });
    const liellaPrefixOnly = memberCard('PL!SP-prefix-only');
    const nijigasakiGroup = memberCard('OTHER-N-GROUP', { groupNames: ['虹ヶ咲学園'] });
    const nijigasakiShort = memberCard('OTHER-N-SHORT', { cardText: '虹咲のメンバー。' });
    const nijigasakiText = memberCard('OTHER-N-TEXT', { cardText: 'Nijigasaki のメンバー。' });
    const nijigasakiPrefixOnly = memberCard('PL!N-prefix-only');
    const aqoursText = memberCard('OTHER-S-TEXT', { groupNames: ['Aqours'] });
    const aqoursPrefixOnly = memberCard('PL!S-prefix-only');
    const aqoursMixedSeries = memberCard('LL-bp2-001-R+', {
      name: '渡辺 曜&鬼塚夏美&大沢瑠璃乃',
      groupNames: [
        'ラブライブ！サンシャイン!!',
        'ラブライブ！スーパースター!!',
        '蓮ノ空女学院スクールアイドルクラブ',
      ],
    });
    const other = memberCard('OTHER-identity', { groupNames: ["μ's"] });

    const hasunosora = groupAliasIs('蓮ノ空');
    const liella = groupAliasIs('Liella!');
    const nijigasaki = groupAliasIs('虹ヶ咲');
    const aqours = groupAliasIs('Aqours');

    expect(groupAliasIs("μ's")(memberCard('PL!-prefix-only'))).toBe(false);
    expect(hasunosora(hasunosoraChinese)).toBe(true);
    expect(hasunosora(hasunosoraJapanese)).toBe(true);
    expect(groupAliasIs('Hasunosora')(hasunosoraText)).toBe(false);
    expect(groupAliasIs('Hasunosora')(hasunosoraPrefixOnly)).toBe(false);
    expect(hasunosora(hasunosoraPrefixOnly)).toBe(false);
    expect(liella(liellaGroup)).toBe(true);
    expect(liella(liellaGroupWithoutBang)).toBe(true);
    expect(liella(liellaTextWithoutBang)).toBe(false);
    expect(liella(liellaText)).toBe(false);
    expect(liella(liellaSuperstar)).toBe(false);
    expect(liella(liellaSuperstarEnglish)).toBe(false);
    expect(liella(liellaPrefixOnly)).toBe(false);
    expect(nijigasaki(nijigasakiGroup)).toBe(true);
    expect(nijigasaki(nijigasakiShort)).toBe(false);
    expect(nijigasaki(nijigasakiText)).toBe(false);
    expect(nijigasaki(nijigasakiPrefixOnly)).toBe(false);
    expect(aqours(aqoursText)).toBe(true);
    expect(aqours(aqoursPrefixOnly)).toBe(false);
    expect(aqours(aqoursMixedSeries)).toBe(true);
    expect(hasunosora(other)).toBe(false);
  });

  it('does not treat PL!SP card-code prefix as Liella! when true groupNames differ', () => {
    const vienneSolo = memberCard('PL!SP-pb1-021-N', {
      name: 'ウィーン・マルガレーテ',
      groupNames: ['ウィーン・マルガレーテ'],
    });

    expect(groupAliasIs('Liella!')(vienneSolo)).toBe(false);
    expect(groupIs('Liella!')(vienneSolo)).toBe(false);
  });

  it('matches SaintSnow aliases through structured groupNames only', () => {
    const unitName = memberCard('OTHER-SAINTSNOW-UNIT', { unitName: 'SaintSnow' });
    const unitNameRaw = memberCard('OTHER-SAINTSNOW-UNIT-RAW', { unitNameRaw: 'Saint Snow' });
    const groupName = memberCard('OTHER-SAINTSNOW-GROUP', { groupNames: ['SaintSnow'] });
    const groupNames = memberCard('OTHER-SAINTSNOW-GROUPS', { groupNames: ['Saint Snow'] });
    const cardText = memberCard('OTHER-SAINTSNOW-TEXT', {
      cardText: 'このカードは『SaintSnow』のメンバーとして扱う。',
    });
    const cardTextJp = memberCard('OTHER-SAINTSNOW-TEXT-JP', {
      cardTextJp: 'このカードは『Saint Snow』のメンバーとして扱う。',
    });
    const cardTextCn = memberCard('OTHER-SAINTSNOW-TEXT-CN', {
      cardTextCn: '这张卡视为 SaintSnow 成员。',
    });
    const other = memberCard('OTHER-NOT-SAINTSNOW', { unitName: 'Aqours' });

    const saintSnow = groupAliasIs('SaintSnow');

    expect(saintSnow(unitName)).toBe(false);
    expect(saintSnow(unitNameRaw)).toBe(false);
    expect(saintSnow(groupName)).toBe(true);
    expect(saintSnow(groupNames)).toBe(true);
    expect(groupAliasIs('Saint Snow')(cardText)).toBe(false);
    expect(saintSnow(cardTextJp)).toBe(false);
    expect(saintSnow(cardTextCn)).toBe(false);
    expect(saintSnow(other)).toBe(false);
  });

  it('keeps structured rival-group identity boundaries without series prefix fallbacks', () => {
    const pureSunnyPassion = memberCard('PL!SP-test-sunny-passion', {
      groupNames: ['SunnyPassion'],
    });
    const pureArise = memberCard('PL!-test-a-rise', {
      groupNames: ['A-RISE'],
    });
    const pureSaintSnow = memberCard('PL!S-bp5-111-R', {
      groupNames: ['SaintSnow'],
    });
    const aqoursAndSaintSnow = memberCard('PL!S-test-aqours-saintsnow', {
      groupNames: ['Aqours/SaintSnow'],
    });
    const pureAqours = memberCard('PL!S-test-aqours', {
      groupNames: ['Aqours'],
    });

    expect(groupAliasIs('Sunny Passion')(pureSunnyPassion)).toBe(true);
    expect(groupAliasIs('Liella!')(pureSunnyPassion)).toBe(false);
    expect(groupAliasIs('A-RISE')(pureArise)).toBe(true);
    expect(groupAliasIs("μ's")(pureArise)).toBe(false);
    expect(groupAliasIs('SaintSnow')(pureSaintSnow)).toBe(true);
    expect(groupAliasIs('Aqours')(pureSaintSnow)).toBe(false);
    expect(groupAliasIs('SaintSnow')(aqoursAndSaintSnow)).toBe(true);
    expect(groupAliasIs('Aqours')(aqoursAndSaintSnow)).toBe(true);
    expect(groupAliasIs('Aqours')(pureAqours)).toBe(true);
    expect(groupAliasIs('SaintSnow')(pureAqours)).toBe(false);
  });

  it('does not match unknown group aliases through groupAliasIs', () => {
    const customGroup = memberCard('OTHER-CUSTOM-GROUP', {
      groupNames: ['Custom School Idol Club'],
      cardText: 'Custom School Idol Club member.',
    });
    const customFallback = memberCard('PL!CUSTOM-fallback');

    const unknownGroup = groupAliasIs('Custom School Idol Club');

    expect(unknownGroup(customGroup)).toBe(false);
    expect(unknownGroup(customFallback)).toBe(false);
  });

  it('uses the same known identity matching for groupIs', () => {
    const customGroup = memberCard('OTHER-CUSTOM-GROUP', {
      groupNames: ['Custom School Idol Club'],
    });
    const customText = memberCard('OTHER-CUSTOM-TEXT', {
      cardText: 'Choose a Custom School Idol Club member.',
    });
    const other = memberCard('OTHER-CUSTOM-MISS', { groupNames: ['Other Group'] });

    const custom = groupIs('Custom School Idol Club');

    expect(custom(customGroup)).toBe(false);
    expect(custom(customText)).toBe(false);
    expect(custom(other)).toBe(false);
  });

  it('matches card unit independently from series group', () => {
    const ceriseLive = liveCard('PL!HS-bp2-022-L', {
      groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
      unitName: 'スリーズブーケ',
    });
    const dollchestraLive = liveCard('PL!HS-bp6-027-L', {
      groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
      unitName: 'DOLLCHESTRA',
    });

    expect(unitIs('スリーズブーケ')(ceriseLive)).toBe(true);
    expect(unitIs('Cerise Bouquet')(ceriseLive)).toBe(false);
    expect(unitIs('スリーズブーケ')(dollchestraLive)).toBe(false);
  });

  it('matches known unit aliases across English and Japanese unit names', () => {
    const ceriseLive = liveCard('PL!HS-bp2-022-L', {
      groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
      unitName: 'スリーズブーケ',
    });
    const miraCraLive = liveCard('PL!HS-bp6-027-L', {
      groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
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
      cardText:
        'すべての領域にあるこのカードは『Cerise Bouquet』、『DOLLCHESTRA』、『Mira-Cra Park!』として扱う。',
    });

    expect(unitAliasIs('スリーズブーケ')(treatedAsThreeUnits)).toBe(false);
    expect(unitAliasOrTextAliasIs('スリーズブーケ')(treatedAsThreeUnits)).toBe(true);
    expect(unitAliasOrTextAliasIs('DOLLCHESTRA')(treatedAsThreeUnits)).toBe(true);
    expect(unitAliasOrTextAliasIs('みらくらぱーく！')(treatedAsThreeUnits)).toBe(true);
  });

  it('matches exact Hasunosora triple-unit identity cards through unitAliasIs without scanning text broadly', () => {
    const tripleUnitCardCodes = [
      'PL!HS-bp2-020-L',
      'PL!HS-bp5-018-L',
      'PL!HS-sd1-020-SD',
    ];

    for (const cardCode of tripleUnitCardCodes) {
      const card = liveCard(cardCode, {
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
        cardText:
          'すべての領域にあるこのカードは『スリーズブーケ』、『DOLLCHESTRA』、『みらくらぱーく！』として扱う。',
      });

      expect(unitAliasIs('スリーズブーケ')(card)).toBe(true);
      expect(unitAliasIs('DOLLCHESTRA')(card)).toBe(true);
      expect(unitAliasIs('みらくらぱーく！')(card)).toBe(true);
    }

    const nonExactTextOnly = liveCard('PL!HS-non-exact-triple-unit-L', {
      groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
      cardText:
        'すべての領域にあるこのカードは『スリーズブーケ』、『DOLLCHESTRA』、『みらくらぱーく！』として扱う。',
    });

    expect(unitAliasIs('スリーズブーケ')(nonExactTextOnly)).toBe(false);
    expect(unitAliasIs('DOLLCHESTRA')(nonExactTextOnly)).toBe(false);
    expect(unitAliasIs('みらくらぱーく！')(nonExactTextOnly)).toBe(false);
    expect(unitAliasOrTextAliasIs('スリーズブーケ')(nonExactTextOnly)).toBe(true);
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

  it('matches normalized card names by containment without alias expansion', () => {
    const exactName = liveCard('contains-exact', { name: 'Dream Believers' });
    const spacedName = liveCard('contains-spaced', { name: 'Dream・Believers Special' });
    const otherName = liveCard('contains-other', { name: '夏めきペイン' });
    const chineseAlias = memberCard('contains-alias', { name: '大泽瑠璃乃' });

    expect(cardNameContains('Dream Believers')(exactName)).toBe(true);
    expect(cardNameContains('Dream Believers')(spacedName)).toBe(true);
    expect(cardNameContains('Dream Believers')(otherName)).toBe(false);
    expect(cardNameContains('')(exactName)).toBe(false);
    expect(cardNameContains('大沢瑠璃乃')(chineseAlias)).toBe(false);
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

  it('matches LIVE required Heart color only when that color has a positive requirement', () => {
    const yellowLive = liveCard('yellow-live', {
      requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
    });
    const pinkLive = liveCard('pink-live', {
      requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
    });
    const zeroYellowLive = liveCard('zero-yellow-live', {
      requirements: createHeartRequirement({ [HeartColor.YELLOW]: 0 }),
    });
    const yellowMember = memberCard('yellow-member', {
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    });

    const yellowRequirementLive = liveRequiresHeartColor(HeartColor.YELLOW);

    expect(yellowRequirementLive(yellowLive)).toBe(true);
    expect(yellowRequirementLive(pinkLive)).toBe(false);
    expect(yellowRequirementLive(zeroYellowLive)).toBe(false);
    expect(yellowRequirementLive(yellowMember)).toBe(false);
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

  it('matches cards that have printed SCORE BLADE HEART items', () => {
    const scoreLive = liveCard('score-live', {
      bladeHearts: [{ effect: BladeHeartEffect.SCORE }],
    });
    const drawLive = liveCard('draw-live', {
      bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
    });
    const scoreMember = memberCard('score-member', {
      bladeHearts: [{ effect: BladeHeartEffect.SCORE }],
    });
    const noBladeHeartLive = liveCard('no-blade-heart-live', { bladeHearts: [] });

    const hasScore = hasScoreBladeHeart();

    expect(hasScore(scoreLive)).toBe(true);
    expect(hasScore(scoreMember)).toBe(true);
    expect(hasScore(drawLive)).toBe(false);
    expect(hasScore(noBladeHeartLive)).toBe(false);
  });

  it('matches cards that have printed ALL BLADE HEART items', () => {
    const allHeartLive = liveCard('all-heart-live', {
      bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }],
    });
    const normalHeartLive = liveCard('normal-heart-live', {
      bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.PINK }],
    });
    const drawLive = liveCard('draw-live', {
      bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
    });
    const scoreMember = memberCard('score-member', {
      bladeHearts: [{ effect: BladeHeartEffect.SCORE }],
    });
    const noBladeHeartLive = liveCard('no-blade-heart-live', { bladeHearts: [] });

    const hasAll = hasAllBladeHeart();

    expect(hasAll(allHeartLive)).toBe(true);
    expect(hasAll(normalHeartLive)).toBe(false);
    expect(hasAll(drawLive)).toBe(false);
    expect(hasAll(scoreMember)).toBe(false);
    expect(hasAll(noBladeHeartLive)).toBe(false);
  });

  it('matches cards with no ability text or a continuous ability', () => {
    const noTextMember = memberCard('no-text-member');
    const blankTextLive = liveCard('blank-text-live', { cardText: '  ' });
    const continuousMember = memberCard('continuous-member', {
      cardText: '【常时】LIVE结束时为止，获得[紫ハート]。',
    });
    const jpContinuousMember = memberCard('jp-continuous-member', {
      cardText: '【常時】LIVE終了時まで、[紫ハート]を得る。',
    });
    const onEnterMember = memberCard('on-enter-member', {
      cardText: '【登场】抽1张卡。',
    });
    const activatedMember = memberCard('activated-member', {
      cardText: '【起动】将1张手牌放置入休息室。',
    });

    const noAbilityOrContinuous = hasNoAbilityOrContinuousAbility();

    expect(noAbilityOrContinuous(noTextMember)).toBe(true);
    expect(noAbilityOrContinuous(blankTextLive)).toBe(true);
    expect(noAbilityOrContinuous(continuousMember)).toBe(true);
    expect(noAbilityOrContinuous(jpContinuousMember)).toBe(true);
    expect(noAbilityOrContinuous(onEnterMember)).toBe(false);
    expect(noAbilityOrContinuous(activatedMember)).toBe(false);
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

  it('matches any current character name alias from a list', () => {
    const namedDiscardSelector = cardNameAliasAny(['上原歩夢', '澁谷かのん', '日野下花帆']);

    expect(namedDiscardSelector(memberCard('alias-any-ayumu', { name: '上原步梦' }))).toBe(true);
    expect(namedDiscardSelector(memberCard('alias-any-kanon', { name: '涩谷香音' }))).toBe(true);
    expect(
      namedDiscardSelector(memberCard('alias-any-combo', { name: '渡辺 曜&鬼塚夏美&大沢瑠璃乃' }))
    ).toBe(false);
    expect(
      cardNameAliasAny(['渡辺曜', '大沢瑠璃乃'])(
        memberCard('alias-any-combo-hit', { name: '渡辺 曜&鬼塚夏美&大沢瑠璃乃' })
      )
    ).toBe(true);
    expect(namedDiscardSelector(memberCard('alias-any-other', { name: '藤島 慈' }))).toBe(false);
  });

  it('composes selectors with and, or, and not', () => {
    const lowCostMuse = memberCard('PL!-sd1-low', { cost: 4, groupNames: ["μ's"] });
    const highCostMuse = memberCard('PL!-sd1-high', { cost: 5, groupNames: ["μ's"] });
    const live = liveCard('PL!-sd1-live');

    const lowCostMuseMember = and(typeIs(CardType.MEMBER), groupIs("μ's"), costLte(4));
    const lowCostOrLive = or(lowCostMuseMember, typeIs(CardType.LIVE));

    expect(lowCostMuseMember(lowCostMuse)).toBe(true);
    expect(lowCostMuseMember(highCostMuse)).toBe(false);
    expect(lowCostOrLive(live)).toBe(true);
    expect(not(typeIs(CardType.LIVE))(lowCostMuse)).toBe(true);
  });
});
