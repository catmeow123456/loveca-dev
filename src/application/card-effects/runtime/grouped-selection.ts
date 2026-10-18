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

export interface DistinctCardSelectionGroup {
  readonly candidateCardIds: readonly string[];
  readonly minCount: number;
  readonly maxCount: number;
}

/** A grouped card choice cannot also carry a slot, option, number, or another card form. */
export function readExclusiveCardSelectionInput(input: object): readonly string[] | null {
  const choices = Object.entries(input).filter(
    ([key, value]) =>
      value !== undefined && value !== null && !(key === 'resolveInOrder' && value === false)
  );
  if (choices.length === 0) return [];
  if (choices.length !== 1) return null;
  const [key, value] = choices[0]!;
  if (key === 'selectedCardId') return typeof value === 'string' ? [value] : null;
  return key === 'selectedCardIds' &&
    Array.isArray(value) &&
    value.every((id) => typeof id === 'string')
    ? value
    : null;
}

/** Each physical card fills at most one group, including overlapping group candidates. */
export function hasDistinctGroupedCardAssignment(
  cardIds: readonly string[],
  groups: readonly DistinctCardSelectionGroup[],
  options: { readonly allowUnusedCards?: boolean } = {}
): boolean {
  if (
    new Set(cardIds).size !== cardIds.length ||
    groups.some(
      (group) =>
        !Number.isInteger(group.minCount) ||
        !Number.isInteger(group.maxCount) ||
        group.minCount < 0 ||
        group.maxCount < group.minCount
    )
  )
    return false;
  const minimum = groups.reduce((sum, group) => sum + group.minCount, 0);
  const maximum = groups.reduce((sum, group) => sum + group.maxCount, 0);
  if (cardIds.length < minimum || (!options.allowUnusedCards && cardIds.length > maximum)) {
    return false;
  }
  const candidateSets = groups.map((group) => new Set(group.candidateCardIds));
  const counts = groups.map(() => 0);
  const failedStates = new Set<string>();
  const search = (index: number): boolean => {
    const required = groups.reduce(
      (sum, group, groupIndex) => sum + Math.max(0, group.minCount - counts[groupIndex]!),
      0
    );
    if (options.allowUnusedCards && required === 0) return true;
    if (cardIds.length - index < required) return false;
    if (index === cardIds.length) return required === 0;
    const key = `${index}:${counts.join(',')}`;
    if (failedStates.has(key)) return false;
    const cardId = cardIds[index]!;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      if (
        counts[groupIndex]! >= groups[groupIndex]!.maxCount ||
        !candidateSets[groupIndex]!.has(cardId)
      )
        continue;
      counts[groupIndex] += 1;
      if (search(index + 1)) return true;
      counts[groupIndex] -= 1;
    }
    if (options.allowUnusedCards && search(index + 1)) return true;
    failedStates.add(key);
    return false;
  };
  return search(0);
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
