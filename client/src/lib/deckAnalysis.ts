import type { BladeHearts } from '@game/domain/entities/card';
import { BladeHeartEffect, CardType, HeartColor } from '@game/shared/types/enums';

/** A weighted card snapshot: account decks and frozen sealed pools use the same math. */
export interface AnalysisCard {
  cardType: CardType;
  count: number;
  cost?: number | null;
  score?: number | null;
  bladeHearts?: BladeHearts;
  baseRequiredHearts?: number | null;
}
export interface DistributionBucket {
  value: number;
  count: number;
}
export interface JudgmentBucket {
  kind: 'draw' | 'score' | 'none' | HeartColor;
  cards: number;
  effects: number;
}

export function calculateDeckAnalysis(cards: readonly AnalysisCard[]) {
  const costs = new Map<number, number>();
  const scores = new Map<number, number>();
  const requirements = new Map<number, number>();
  const judgments = new Map<JudgmentBucket['kind'], JudgmentBucket>();
  let memberCount = 0;
  let liveCount = 0;
  let knownCostCount = 0;
  let costSum = 0;
  for (const card of cards) {
    if (card.cardType !== CardType.MEMBER && card.cardType !== CardType.LIVE) continue;
    if (card.cardType === CardType.MEMBER) {
      memberCount += card.count;
      if (card.cost != null) {
        costs.set(card.cost, (costs.get(card.cost) ?? 0) + card.count);
        costSum += card.cost * card.count;
        knownCostCount += card.count;
      }
    } else {
      liveCount += card.count;
      if (card.score != null) scores.set(card.score, (scores.get(card.score) ?? 0) + card.count);
      if (card.baseRequiredHearts != null)
        requirements.set(
          card.baseRequiredHearts,
          (requirements.get(card.baseRequiredHearts) ?? 0) + card.count
        );
    }
    const perCard = new Map<JudgmentBucket['kind'], number>();
    for (const item of card.bladeHearts ?? []) {
      const kind =
        item.effect === BladeHeartEffect.DRAW
          ? 'draw'
          : item.effect === BladeHeartEffect.SCORE
            ? 'score'
            : item.heartColor;
      if (kind) perCard.set(kind, (perCard.get(kind) ?? 0) + 1);
    }
    if (!card.bladeHearts?.length) perCard.set('none', 0);
    for (const [kind, effects] of perCard) {
      const bucket = judgments.get(kind) ?? { kind, cards: 0, effects: 0 };
      bucket.cards += card.count;
      bucket.effects += effects * card.count;
      judgments.set(kind, bucket);
    }
  }
  const distribution = (map: Map<number, number>): DistributionBucket[] =>
    [...map].sort(([a], [b]) => a - b).map(([value, count]) => ({ value, count }));
  const order: JudgmentBucket['kind'][] = [
    'draw',
    'score',
    'none',
    HeartColor.PINK,
    HeartColor.RED,
    HeartColor.YELLOW,
    HeartColor.GREEN,
    HeartColor.BLUE,
    HeartColor.PURPLE,
    HeartColor.ORANGE,
    HeartColor.GRAY,
    HeartColor.RAINBOW,
  ];
  return {
    memberCount,
    liveCount,
    unknownCostCount: memberCount - knownCostCount,
    averageCost: knownCostCount ? costSum / knownCostCount : null,
    costs: distribution(costs),
    scores: distribution(scores),
    requirements: distribution(requirements),
    judgments: order.flatMap((kind) => (judgments.has(kind) ? [judgments.get(kind)!] : [])),
  };
}
export type DeckAnalysis = ReturnType<typeof calculateDeckAnalysis>;
