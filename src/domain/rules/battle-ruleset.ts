import {
  isLiveCardData,
  type CardInstance,
  type HeartRequirement,
  type LiveCardData,
} from '../entities/card.js';
import { HeartColor } from '../../shared/types/enums.js';

export type BattleRulesetId = 'STANDARD' | 'SEALED_HALF_GRAY_V1';

export function victoryLiveCount(game: { readonly rulesetId: BattleRulesetId }): number {
  return game.rulesetId === 'SEALED_HALF_GRAY_V1' ? 2 : 3;
}

/** Convert printed requirements before applying effects, never the card catalog itself. */
export function baseLiveRequirement(
  game: { readonly rulesetId: BattleRulesetId },
  printed: HeartRequirement
): HeartRequirement {
  return game.rulesetId === 'SEALED_HALF_GRAY_V1'
    ? {
        totalRequired: printed.totalRequired,
        colorRequirements: new Map([[HeartColor.GRAY, printed.totalRequired]]),
      }
    : printed;
}

/** A transient selector input; stored card data and printed art remain unchanged. */
export function rulesetCardForSelection(
  game: { readonly rulesetId: BattleRulesetId },
  card: CardInstance
): CardInstance {
  return game.rulesetId === 'SEALED_HALF_GRAY_V1' && isLiveCardData(card.data)
    ? {
        ...card,
        data: {
          ...card.data,
          requirements: baseLiveRequirement(game, card.data.requirements),
        } as LiveCardData,
      }
    : card;
}
