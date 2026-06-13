import type { CardInstance } from '../../domain/entities/card.js';
import { isMemberCardData } from '../../domain/entities/card.js';
import type { CardType } from '../../shared/types/enums.js';

export type CardSelector = (card: CardInstance) => boolean;

export function typeIs(cardType: CardType): CardSelector {
  return (card) => card.data.cardType === cardType;
}

export function costLte(maxCost: number): CardSelector {
  return (card) => isMemberCardData(card.data) && card.data.cost <= maxCost;
}

export function groupIs(groupName: string): CardSelector {
  const normalizedGroupName = normalizeGroupName(groupName);
  return (card) => {
    const cardGroupName = normalizeGroupName(card.data.groupName);
    const cardText = normalizeGroupName(card.data.cardText);
    if (cardGroupName.includes(normalizedGroupName) || cardText.includes(normalizedGroupName)) {
      return true;
    }

    return normalizedGroupName.includes('μ') && card.data.cardCode.startsWith('PL!-');
  };
}

export function cardNameIs(name: string): CardSelector {
  const normalizedName = normalizeCardName(name);
  return (card) => normalizeCardName(card.data.name) === normalizedName;
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
  return value?.replace(/['’]/g, '').toLowerCase() ?? '';
}

export function normalizeCardName(value: string | undefined): string {
  return value?.replace(/\s/g, '') ?? '';
}
