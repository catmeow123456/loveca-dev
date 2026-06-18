import type { GameState } from '../../../domain/entities/game.js';
import { getCardById } from '../../../domain/entities/game.js';
import type { CardSelector } from '../../effects/card-selectors.js';

export interface GroupedSelectionRule {
  readonly key: string;
  readonly selector: CardSelector;
  readonly minCount: number;
  readonly maxCount: number;
}

export interface GroupedSelectionValidationResult {
  readonly selectedCardIds: readonly string[];
  readonly groupCardIds: Readonly<Record<string, readonly string[]>>;
}

export function validateGroupedCardSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  rules: readonly GroupedSelectionRule[]
): GroupedSelectionValidationResult | null {
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (uniqueSelectedCardIds.length !== selectedCardIds.length) {
    return null;
  }

  const groupCardIds: Record<string, string[]> = Object.fromEntries(
    rules.map((rule) => [rule.key, []])
  );

  for (const cardId of uniqueSelectedCardIds) {
    const card = getCardById(game, cardId);
    if (!card) {
      return null;
    }
    const matchingRules = rules.filter((rule) => rule.selector(card));
    if (matchingRules.length === 0) {
      return null;
    }
    for (const rule of matchingRules) {
      groupCardIds[rule.key]?.push(cardId);
    }
  }

  for (const rule of rules) {
    const count = groupCardIds[rule.key]?.length ?? 0;
    if (count < rule.minCount || count > rule.maxCount) {
      return null;
    }
  }

  return {
    selectedCardIds: uniqueSelectedCardIds,
    groupCardIds,
  };
}
