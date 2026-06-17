import type { CardInstance } from '../../domain/entities/card.js';
import { isLiveCardData, isMemberCardData } from '../../domain/entities/card.js';
import type { CardType, HeartColor } from '../../shared/types/enums.js';
import { cardBelongsToGroup } from '../../shared/utils/card-identity.js';

export type CardSelector = (card: CardInstance) => boolean;

const UNIT_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['cerise-bouquet', 'Cerise Bouquet', 'スリーズブーケ'],
  ['dollchestra', 'DOLLCHESTRA'],
  ['mira-cra-park', 'Mira-Cra Park!', 'みらくらぱーく！', 'みらくらぱーく!'],
  ['edelnote', 'EdelNote'],
];

const CARD_NAME_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['高坂穂乃果', '高坂穗乃果'],
  ['絢瀬絵里', '绚濑绘里'],
  ['南ことり', '南琴梨'],
  ['園田海未', '园田海未'],
  ['星空凛'],
  ['西木野真姫', '西木野真姬'],
  ['東條希', '东条希'],
  ['小泉花陽', '小泉花阳'],
  ['矢澤にこ', '矢泽日香'],
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
];

export function typeIs(cardType: CardType): CardSelector {
  return (card) => card.data.cardType === cardType;
}

export function costLte(maxCost: number): CardSelector {
  return (card) => isMemberCardData(card.data) && card.data.cost <= maxCost;
}

export function costGte(minCost: number): CardSelector {
  return (card) => isMemberCardData(card.data) && card.data.cost >= minCost;
}

export function groupIs(groupName: string): CardSelector {
  const normalizedGroupName = normalizeGroupName(groupName);
  return (card) => {
    const cardGroupName = normalizeGroupName(card.data.groupName);
    const cardText = normalizeGroupName(card.data.cardText);
    if (cardGroupName.includes(normalizedGroupName) || cardText.includes(normalizedGroupName)) {
      return true;
    }

    return cardBelongsToGroup(card.data, groupName);
  };
}

export function groupAliasIs(groupName: string): CardSelector {
  return (card) => cardBelongsToGroup(card.data, groupName);
}

export function unitIs(unitName: string): CardSelector {
  const normalizedUnitName = normalizeGroupName(unitName);
  return (card) => normalizeGroupName(card.data.unitName).includes(normalizedUnitName);
}

export function unitAliasIs(unitName: string): CardSelector {
  const normalizedAliases = getNormalizedUnitAliases(unitName);
  return (card) => matchesAnyNormalizedAlias(card.data.unitName, normalizedAliases);
}

export function unitAliasOrTextAliasIs(unitName: string): CardSelector {
  const normalizedAliases = getNormalizedUnitAliases(unitName);
  return (card) =>
    matchesAnyNormalizedAlias(card.data.unitName, normalizedAliases) ||
    matchesAnyNormalizedAlias(card.data.cardText, normalizedAliases);
}

export function cardNameIs(name: string): CardSelector {
  const normalizedName = normalizeCardName(name);
  return (card) => normalizeCardName(card.data.name) === normalizedName;
}

export function cardNameContains(name: string): CardSelector {
  const normalizedName = normalizeCardName(name);
  return (card) =>
    normalizedName.length > 0 && normalizeCardName(card.data.name).includes(normalizedName);
}

export function cardNameAliasIs(name: string): CardSelector {
  const normalizedAliases = getNormalizedCardNameAliases(name);
  return (card) =>
    getNormalizedCardNameCandidates(card.data.name).some((candidate) =>
      normalizedAliases.includes(candidate)
    );
}

export function cardNameAliasAny(names: readonly string[]): CardSelector {
  const selectors = names.map((name) => cardNameAliasIs(name));
  return (card) => selectors.some((selector) => selector(card));
}

export function memberHasHeartColor(color: HeartColor): CardSelector {
  return (card) =>
    isMemberCardData(card.data) &&
    card.data.hearts.some((heart) => heart.color === color && heart.count > 0);
}

export function liveRequiresHeartColor(color: HeartColor): CardSelector {
  return (card) =>
    isLiveCardData(card.data) && (card.data.requirements.colorRequirements.get(color) ?? 0) > 0;
}

export function hasBladeHeart(): CardSelector {
  return (card) =>
    (((card.data as { readonly bladeHearts?: readonly unknown[] }).bladeHearts?.length ?? 0) > 0);
}

export function hasNoAbilityOrContinuousAbility(): CardSelector {
  return (card) => {
    const cardText = card.data.cardText?.trim() ?? '';
    return cardText.length === 0 || /【常[时時]】/.test(cardText);
  };
}

export function memberPrintedBladeLte(maxBlade: number): CardSelector {
  return (card) => isMemberCardData(card.data) && card.data.blade <= maxBlade;
}

export function and(...selectors: readonly CardSelector[]): CardSelector {
  return (card) => selectors.every((selector) => selector(card));
}

export function or(...selectors: readonly CardSelector[]): CardSelector {
  return (card) => selectors.some((selector) => selector(card));
}

export function not(selector: CardSelector): CardSelector {
  return (card) => !selector(card);
}

function normalizeGroupName(value: string | undefined): string {
  return value?.replace(/[『』「」'’]/g, '').replace(/！/g, '!').toLowerCase() ?? '';
}

export function normalizeCardName(value: string | undefined): string {
  return value?.replace(/[\s・·]/g, '') ?? '';
}

function getNormalizedUnitAliases(unitName: string): readonly string[] {
  const normalizedUnitName = normalizeGroupName(unitName);
  const aliasGroup = UNIT_ALIAS_GROUPS.find((aliases) =>
    aliases.some((alias) => normalizeGroupName(alias) === normalizedUnitName)
  );
  return (aliasGroup ?? [unitName]).map((alias) => normalizeGroupName(alias));
}

function matchesAnyNormalizedAlias(
  value: string | undefined,
  normalizedAliases: readonly string[]
): boolean {
  const normalizedValue = normalizeGroupName(value);
  return normalizedAliases.some((alias) => normalizedValue.includes(alias));
}

function getNormalizedCardNameAliases(name: string): readonly string[] {
  const normalizedName = normalizeCardName(name);
  const aliasGroup = CARD_NAME_ALIAS_GROUPS.find((aliases) =>
    aliases.some((alias) => normalizeCardName(alias) === normalizedName)
  );
  return (aliasGroup ?? [name]).map((alias) => normalizeCardName(alias));
}

function getNormalizedCardNameCandidates(value: string | undefined): readonly string[] {
  if (!value) {
    return [];
  }

  const names = [value, ...value.split(/[&＆]/g)];
  return [...new Set(names.map((name) => normalizeCardName(name)).filter(Boolean))];
}
