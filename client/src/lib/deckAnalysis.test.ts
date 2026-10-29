import { describe, expect, it } from 'vitest';
import { BladeHeartEffect, CardType, HeartColor } from '@game/shared/types/enums';
import { calculateDeckAnalysis } from './deckAnalysis';

describe('deck statistics from weighted frozen cards', () => {
  it('counts duplicate copies, double hearts and mixed effects without counting energies', () => {
    const analysis = calculateDeckAnalysis([
      {
        cardType: CardType.MEMBER,
        count: 3,
        cost: 4,
        bladeHearts: [
          { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY },
          { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY },
          { effect: BladeHeartEffect.DRAW },
        ],
      },
      { cardType: CardType.MEMBER, count: 1, cost: 0, bladeHearts: [] },
      {
        cardType: CardType.LIVE,
        count: 6,
        score: 3,
        baseRequiredHearts: 5,
        bladeHearts: [
          { effect: BladeHeartEffect.SCORE },
          { effect: BladeHeartEffect.SCORE },
          { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PINK },
        ],
      },
      { cardType: CardType.ENERGY, count: 12 },
    ]);
    expect(analysis.memberCount).toBe(4);
    expect(analysis.liveCount).toBe(6);
    expect(analysis.averageCost).toBe(3);
    expect(analysis.costs).toEqual([
      { value: 0, count: 1 },
      { value: 4, count: 3 },
    ]);
    expect(analysis.scores).toEqual([{ value: 3, count: 6 }]);
    expect(analysis.requirements).toEqual([{ value: 5, count: 6 }]);
    expect(analysis.judgments).toEqual([
      { kind: 'draw', cards: 3, effects: 3 },
      { kind: 'score', cards: 6, effects: 12 },
      { kind: 'none', cards: 1, effects: 0 },
      { kind: HeartColor.PINK, cards: 6, effects: 6 },
      { kind: HeartColor.GRAY, cards: 3, effects: 6 },
    ]);
  });
  it('keeps missing cost distinct from zero and handles an incomplete selection', () => {
    const analysis = calculateDeckAnalysis([
      { cardType: CardType.MEMBER, count: 2, cost: null },
      { cardType: CardType.MEMBER, count: 1, cost: 0 },
      { cardType: CardType.LIVE, count: 6, score: 0, baseRequiredHearts: 0 },
    ]);
    expect(analysis.unknownCostCount).toBe(2);
    expect(analysis.averageCost).toBe(0);
    expect(analysis.costs).toEqual([{ value: 0, count: 1 }]);
    expect(analysis.judgments).toEqual([{ kind: 'none', cards: 9, effects: 0 }]);
    expect(calculateDeckAnalysis([]).averageCost).toBeNull();
  });
});
