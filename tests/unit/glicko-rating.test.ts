import { describe, expect, it } from 'vitest';
import {
  CURRENT_GLICKO1_SHADOW_CONFIG,
  GLICKO1_PER_MATCH_SHADOW_V1,
  GLICKO1_PER_MATCH_SHADOW_V2,
  GLICKO1_PER_MATCH_V2,
  createInitialGlickoRatingState,
  formatGlickoRatingForDisplay,
  increaseGlickoDeviationForInactivity,
  isGlickoPlacementComplete,
  rateGlickoHeadToHead,
  rateGlickoPeriod,
  softResetGlickoRatingState,
  type GlickoRatingState,
} from '../../src/server/rating/glicko';
import { simulateGlickoShadow } from '../../src/server/rating/glicko-shadow';

describe('Glicko-1 rating', () => {
  it('matches the published Glicko-1 example rating period', () => {
    const result = rateGlickoPeriod({ rating: 1500, ratingDeviation: 200 }, [
      { opponent: { rating: 1400, ratingDeviation: 30 }, score: 1 },
      { opponent: { rating: 1550, ratingDeviation: 100 }, score: 0 },
      { opponent: { rating: 1700, ratingDeviation: 300 }, score: 0 },
    ]);

    expect(result.rating).toBeCloseTo(1464.11, 2);
    expect(result.ratingDeviation).toBeCloseTo(151.4, 1);
  });

  it('rates both players from the same pre-match snapshot', () => {
    const initial = createInitialGlickoRatingState();
    const result = rateGlickoHeadToHead(initial, initial, 1, new Date('2026-08-01T12:00:00.000Z'));

    expect(result.first.rating).toBeGreaterThan(1500);
    expect(result.second.rating).toBeLessThan(1500);
    expect(result.first.rating - 1500).toBeCloseTo(1500 - result.second.rating, 10);
    expect(result.first.ratingDeviation).toBeCloseTo(result.second.ratingDeviation, 10);
    expect(result.first.ratedMatchCount).toBe(1);
    expect(result.second.ratedMatchCount).toBe(1);
  });

  it('rewards an upset more than beating an equally rated opponent', () => {
    const winner: GlickoRatingState = {
      rating: 1500,
      ratingDeviation: 100,
      ratedMatchCount: 10,
      lastRatedAt: new Date('2026-08-01T00:00:00.000Z'),
    };
    const equalOpponent = { ...winner };
    const strongerOpponent = { ...winner, rating: 1800 };
    const ratedAt = new Date('2026-08-01T01:00:00.000Z');

    const equalWin = rateGlickoHeadToHead(winner, equalOpponent, 1, ratedAt);
    const upsetWin = rateGlickoHeadToHead(winner, strongerOpponent, 1, ratedAt);

    expect(upsetWin.first.rating - winner.rating).toBeGreaterThan(
      equalWin.first.rating - winner.rating
    );
  });

  it('increases deviation with inactivity and caps it at the configured maximum', () => {
    const state: GlickoRatingState = {
      rating: 1500,
      ratingDeviation: 50,
      ratedMatchCount: 20,
      lastRatedAt: new Date('2025-08-01T00:00:00.000Z'),
    };
    const increased = increaseGlickoDeviationForInactivity(
      state,
      new Date('2026-08-01T00:00:00.000Z')
    );

    expect(increased.ratingDeviation).toBeCloseTo(350, 10);
    expect(
      increaseGlickoDeviationForInactivity(increased, new Date('2030-08-01T00:00:00.000Z'))
        .ratingDeviation
    ).toBe(350);
  });

  it('applies the candidate soft reset and resets placement progress', () => {
    const reset = softResetGlickoRatingState({
      rating: 1900,
      ratingDeviation: 80,
      ratedMatchCount: 30,
      lastRatedAt: new Date('2026-08-01T00:00:00.000Z'),
    });

    expect(reset).toEqual({
      rating: 1700,
      ratingDeviation: 200,
      ratedMatchCount: 0,
      lastRatedAt: null,
    });
    expect(isGlickoPlacementComplete(reset)).toBe(false);
    expect(
      isGlickoPlacementComplete({
        ...reset,
        ratedMatchCount: CURRENT_GLICKO1_SHADOW_CONFIG.placementMatchCount,
      })
    ).toBe(true);
    expect(formatGlickoRatingForDisplay(1699.51)).toBe(1700);
  });

  it('keeps the V1 report reproducible while the current V2 placement gate requires ten matches', () => {
    const state = createInitialGlickoRatingState();

    expect(GLICKO1_PER_MATCH_SHADOW_V1.placementMatchCount).toBe(5);
    expect(GLICKO1_PER_MATCH_SHADOW_V2.placementMatchCount).toBe(10);
    expect(CURRENT_GLICKO1_SHADOW_CONFIG).toBe(GLICKO1_PER_MATCH_SHADOW_V2);
    expect(
      isGlickoPlacementComplete({ ...state, ratedMatchCount: 5 }, GLICKO1_PER_MATCH_SHADOW_V1)
    ).toBe(true);
    expect(isGlickoPlacementComplete({ ...state, ratedMatchCount: 9 })).toBe(false);
    expect(isGlickoPlacementComplete({ ...state, ratedMatchCount: 10 })).toBe(true);
  });

  it('slightly reduces new-player volatility in the second formal version', () => {
    const firstMatch = rateGlickoHeadToHead(
      createInitialGlickoRatingState(GLICKO1_PER_MATCH_V2),
      createInitialGlickoRatingState(GLICKO1_PER_MATCH_V2),
      0,
      new Date('2026-08-01T00:00:00.000Z'),
      GLICKO1_PER_MATCH_V2
    );
    const splitSeries = rateGlickoHeadToHead(
      firstMatch.first,
      firstMatch.second,
      1,
      new Date('2026-08-01T00:10:00.000Z'),
      GLICKO1_PER_MATCH_V2
    );

    expect(GLICKO1_PER_MATCH_V2.initialRatingDeviation).toBe(300);
    expect(Math.round(splitSeries.first.rating)).toBe(1547);
    expect(Math.round(splitSeries.second.rating)).toBe(1453);
  });

  it('rejects invalid time order and invalid scores', () => {
    const state: GlickoRatingState = {
      rating: 1500,
      ratingDeviation: 100,
      ratedMatchCount: 2,
      lastRatedAt: new Date('2026-08-02T00:00:00.000Z'),
    };

    expect(() =>
      increaseGlickoDeviationForInactivity(state, new Date('2026-08-01T00:00:00.000Z'))
    ).toThrow('ratedAt must not be earlier than lastRatedAt');
    expect(() =>
      rateGlickoPeriod(state, [
        {
          opponent: { rating: 1500, ratingDeviation: 100 },
          score: 0.25 as never,
        },
      ])
    ).toThrow('score must be 0, 0.5, or 1');
  });
});

describe('Glicko shadow simulation', () => {
  it('sorts matches by settled time and match ID and emits a rebuildable ledger', () => {
    const simulation = simulateGlickoShadow([
      {
        matchId: 'match-c',
        firstPlayerId: 'alice',
        secondPlayerId: 'bob',
        winnerSeat: 'SECOND',
        settledAt: new Date('2026-08-03T00:00:00.000Z'),
      },
      {
        matchId: 'match-b',
        firstPlayerId: 'alice',
        secondPlayerId: 'carol',
        winnerSeat: 'FIRST',
        settledAt: new Date('2026-08-02T00:00:00.000Z'),
      },
      {
        matchId: 'match-a',
        firstPlayerId: 'alice',
        secondPlayerId: 'bob',
        winnerSeat: 'FIRST',
        settledAt: new Date('2026-08-02T00:00:00.000Z'),
      },
    ]);

    expect(simulation.settlements.map((settlement) => settlement.matchId)).toEqual([
      'match-a',
      'match-b',
      'match-c',
    ]);
    expect(simulation.settlements[0]?.algorithmVersion).toBe('GLICKO1_PER_MATCH_SHADOW_V2');
    expect(simulation.settlements[2]?.firstBefore).toEqual(simulation.settlements[1]?.firstAfter);
    expect(simulation.players.get('alice')?.ratedMatchCount).toBe(3);
    expect(simulation.players.get('bob')?.ratedMatchCount).toBe(2);
    expect(simulation.players.get('carol')?.ratedMatchCount).toBe(1);
  });

  it('rejects duplicate match IDs before producing a second settlement', () => {
    expect(() =>
      simulateGlickoShadow([
        {
          matchId: 'duplicate',
          firstPlayerId: 'alice',
          secondPlayerId: 'bob',
          winnerSeat: 'FIRST',
          settledAt: new Date('2026-08-01T00:00:00.000Z'),
        },
        {
          matchId: 'duplicate',
          firstPlayerId: 'carol',
          secondPlayerId: 'dave',
          winnerSeat: 'SECOND',
          settledAt: new Date('2026-08-02T00:00:00.000Z'),
        },
      ])
    ).toThrow('duplicate shadow matchId: duplicate');
  });
});
