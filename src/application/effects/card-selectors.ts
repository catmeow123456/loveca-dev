import type { CardInstance } from '../../domain/entities/card.js';
import { isLiveCardData, isMemberCardData } from '../../domain/entities/card.js';
import { BladeHeartEffect, HeartColor, type CardType } from '../../shared/types/enums.js';
import {
  cardBelongsToGroup,
  cardBelongsToUnit,
  cardNameAliasMatches,
  cardNameMatchesAnyAlias,
  normalizeCardName as normalizeSharedCardName,
} from '../../shared/utils/card-identity.js';
import { hasStrictNoAbilityCardText } from '../../shared/utils/card-text.js';

export type CardSelector = (card: CardInstance) => boolean;

const UNIT_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['cerise-bouquet', 'Cerise Bouquet', 'スリーズブーケ'],
  ['dollchestra', 'DOLLCHESTRA'],
  ['mira-cra-park', 'Mira-Cra Park!', 'みらくらぱーく！', 'みらくらぱーく!'],
  ['edelnote', 'EdelNote'],
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
  return groupAliasIs(groupName);
}

export function groupAliasIs(groupName: string): CardSelector {
  return (card) => cardBelongsToGroup(card.data, groupName);
}

export function unitIs(unitName: string): CardSelector {
  const normalizedUnitName = normalizeGroupName(unitName);
  return (card) => normalizeGroupName(card.data.unitName).includes(normalizedUnitName);
}

export function unitAliasIs(unitName: string): CardSelector {
  return (card) => cardBelongsToUnit(card.data, unitName);
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
  return (card) => cardNameAliasMatches(card.data, name);
}

export function cardNameAliasAny(names: readonly string[]): CardSelector {
  return (card) => cardNameMatchesAnyAlias(card.data, names);
}

export function memberHasHeartColor(color: HeartColor): CardSelector {
  return (card) =>
    isMemberCardData(card.data) &&
    card.data.hearts.some((heart) => heart.color === color && heart.count > 0);
}

export function memberHasPrintedHeartColorAtLeast(
  color: HeartColor,
  minCount: number
): CardSelector {
  return (card) =>
    isMemberCardData(card.data) &&
    card.data.hearts
      .filter((heart) => heart.color === color)
      .reduce((sum, heart) => sum + heart.count, 0) >= minCount;
}

export function liveRequiresHeartColor(color: HeartColor): CardSelector {
  return (card) =>
    isLiveCardData(card.data) && (card.data.requirements.colorRequirements.get(color) ?? 0) > 0;
}

export function liveRequiresPrintedHeartColorAtLeast(
  color: HeartColor,
  minCount: number
): CardSelector {
  return (card) =>
    isLiveCardData(card.data) &&
    (card.data.requirements.colorRequirements.get(color) ?? 0) >= minCount;
}

export function liveTotalRequiredHeartGte(minCount: number): CardSelector {
  return (card) => isLiveCardData(card.data) && card.data.requirements.totalRequired >= minCount;
}

export function hasBladeHeart(): CardSelector {
  return (card) =>
    (((card.data as { readonly bladeHearts?: readonly unknown[] }).bladeHearts?.length ?? 0) > 0);
}

export function hasScoreBladeHeart(): CardSelector {
  return (card) =>
    ((card.data as { readonly bladeHearts?: readonly { readonly effect?: unknown }[] }).bladeHearts
      ?.some((bladeHeart) => bladeHeart.effect === 'SCORE') ?? false);
}

export function hasAllBladeHeart(): CardSelector {
  return (card) =>
    ((card.data as {
      readonly bladeHearts?: readonly {
        readonly effect?: unknown;
        readonly heartColor?: unknown;
      }[];
    }).bladeHearts?.some(
      (bladeHeart) =>
        bladeHeart.effect === BladeHeartEffect.HEART &&
        bladeHeart.heartColor === HeartColor.RAINBOW
    ) ?? false);
}

export function hasNoAbilityOrContinuousAbility(): CardSelector {
  return (card) => {
    const cardText = card.data.cardText?.trim() ?? '';
    return cardText.length === 0 || /【常[时時]】/.test(cardText);
  };
}

export function hasStrictNoAbility(): CardSelector {
  return (card) => hasStrictNoAbilityCardText(card.data.cardText);
}

export function memberPrintedBladeLte(maxBlade: number): CardSelector {
  return (card) => isMemberCardData(card.data) && card.data.blade <= maxBlade;
}

export function memberPrintedBladeEquals(bladeCount: number): CardSelector {
  return (card) => isMemberCardData(card.data) && card.data.blade === bladeCount;
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
  return normalizeSharedCardName(value);
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
