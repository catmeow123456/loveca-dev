import { describe, expect, it } from 'vitest';
import {
  createInitialGlickoRatingState,
  GLICKO1_PER_MATCH_V3,
  rateGlickoHeadToHead,
  type GlickoRatingState,
} from '../../src/server/rating/glicko';
import {
  assertValidRankedRatingConfig,
  GLICKO1_PER_MATCH_V4,
  rateRankedHeadToHead,
} from '../../src/server/rating/ranked-rating';

const RATED_AT = new Date('2026-09-01T00:00:00.000Z');

function stableState(
  rating: number,
  ratedMatchCount = GLICKO1_PER_MATCH_V4.placementMatchCount
): GlickoRatingState {
  return {
    rating,
    ratingDeviation: 100,
    ratedMatchCount,
    lastRatedAt: new Date('2026-08-31T00:00:00.000Z'),
  };
}

describe('ranked V4 growth rating', () => {
  it('publishes the new-season V4 parameters without changing V3', () => {
    expect(GLICKO1_PER_MATCH_V4).toMatchObject({
      algorithmVersion: 'GLICKO1_PER_MATCH_V4',
      initialRating: 1500,
      initialRatingDeviation: 300,
      ratingScale: 800,
      minimumRatingDeviation: 100,
      placementMatchCount: 5,
      growthPool: {
        enabled: true,
        centerRating: 1800,
        maximumTotalAdjustment: 16,
        transitionWidth: 250,
        positiveSplitMode: 'EQUAL',
        negativeWinnerShare: 0.75,
      },
    });
    expect(GLICKO1_PER_MATCH_V3).toMatchObject({
      ratingScale: 800,
      minimumRatingDeviation: 30,
      placementMatchCount: 10,
    });
    expect(GLICKO1_PER_MATCH_V3).not.toHaveProperty('growthPool');
  });

  it('does not apply growth while either player is still in placement', () => {
    const first = stableState(1600, 5);
    const second = stableState(1600, 4);
    const ranked = rateRankedHeadToHead(first, second, 1, RATED_AT, GLICKO1_PER_MATCH_V4);
    const pureGlicko = rateGlickoHeadToHead(first, second, 1, RATED_AT, GLICKO1_PER_MATCH_V4);

    expect(ranked.totalGrowthAdjustment).toBe(0);
    expect(ranked.first).toEqual(pureGlicko.first);
    expect(ranked.second).toEqual(pureGlicko.second);
  });

  it('keeps the configured growth values but applies pure Glicko while growth is disabled', () => {
    const revisionId = 'a'.repeat(32);
    const disabledConfig = {
      ...GLICKO1_PER_MATCH_V4,
      algorithmVersion: `GLICKO1_PER_MATCH_V4_REV_${revisionId}`,
      growthPool: { ...GLICKO1_PER_MATCH_V4.growthPool!, enabled: false },
      parameterRevision: {
        mode: 'ADMIN_SEASON_RECALCULATION' as const,
        revisionId,
        baseAlgorithmVersion: 'GLICKO1_PER_MATCH_V4' as const,
        sourceSoftResetMode: GLICKO1_PER_MATCH_V4.softResetMode,
        sourceSoftResetCenter: GLICKO1_PER_MATCH_V4.softResetCenter,
        sourceSoftResetRetention: GLICKO1_PER_MATCH_V4.softResetRetention,
        sourceSoftResetMinimumDeviation: GLICKO1_PER_MATCH_V4.softResetMinimumDeviation,
      },
    };
    const first = stableState(1600);
    const second = stableState(1600);
    const ranked = rateRankedHeadToHead(first, second, 1, RATED_AT, disabledConfig);
    const pureGlicko = rateGlickoHeadToHead(first, second, 1, RATED_AT, disabledConfig);

    expect(() => assertValidRankedRatingConfig(disabledConfig)).not.toThrow();
    expect(ranked.totalGrowthAdjustment).toBe(0);
    expect(ranked.first).toEqual(pureGlicko.first);
    expect(ranked.second).toEqual(pureGlicko.second);
    expect(disabledConfig.growthPool).toMatchObject({
      enabled: false,
      centerRating: 1800,
      maximumTotalAdjustment: 16,
      transitionWidth: 250,
      negativeWinnerShare: 0.75,
    });
  });

  it('keeps a five-win placement run near 1800 without growth', () => {
    let player = createInitialGlickoRatingState(GLICKO1_PER_MATCH_V4);
    for (let index = 0; index < 5; index += 1) {
      const result = rateRankedHeadToHead(
        player,
        createInitialGlickoRatingState(GLICKO1_PER_MATCH_V4),
        1,
        new Date(`2026-09-0${index + 1}T00:00:00.000Z`),
        GLICKO1_PER_MATCH_V4
      );
      expect(result.totalGrowthAdjustment).toBe(0);
      player = result.first;
    }

    expect(player.ratedMatchCount).toBe(5);
    expect(player.rating).toBeCloseTo(1838.6250891703205, 10);
  });

  it('splits a positive pool equally below 1800 after placement', () => {
    const first = stableState(1600);
    const second = stableState(1600);
    const ranked = rateRankedHeadToHead(first, second, 1, RATED_AT, GLICKO1_PER_MATCH_V4);
    const pureGlicko = rateGlickoHeadToHead(first, second, 1, RATED_AT, GLICKO1_PER_MATCH_V4);
    const expectedPool = 16 * Math.tanh((1800 - 1600) / 250);

    expect(ranked.totalGrowthAdjustment).toBeCloseTo(expectedPool, 12);
    expect(ranked.firstGrowthAdjustment).toBeCloseTo(expectedPool / 2, 12);
    expect(ranked.secondGrowthAdjustment).toBeCloseTo(expectedPool / 2, 12);
    expect(ranked.first.rating - pureGlicko.first.rating).toBeCloseTo(expectedPool / 2, 12);
    expect(ranked.second.rating - pureGlicko.second.rating).toBeCloseTo(expectedPool / 2, 12);
    expect(ranked.first.ratingDeviation).toBe(pureGlicko.first.ratingDeviation);
    expect(ranked.second.ratingDeviation).toBe(pureGlicko.second.ratingDeviation);
  });

  it('charges 75% of a negative pool to the winner above 1800', () => {
    const first = stableState(1900);
    const second = stableState(1900);
    const ranked = rateRankedHeadToHead(first, second, 0, RATED_AT, GLICKO1_PER_MATCH_V4);
    const expectedPool = 16 * Math.tanh((1800 - 1900) / 250);

    expect(ranked.totalGrowthAdjustment).toBeCloseTo(expectedPool, 12);
    expect(ranked.firstGrowthAdjustment).toBeCloseTo(expectedPool * 0.25, 12);
    expect(ranked.secondGrowthAdjustment).toBeCloseTo(expectedPool * 0.75, 12);
    expect(ranked.firstGrowthAdjustment + ranked.secondGrowthAdjustment).toBeCloseTo(
      expectedPool,
      12
    );
  });

  it('is neutral at an average rating of 1800', () => {
    const ranked = rateRankedHeadToHead(
      stableState(1700),
      stableState(1900),
      1,
      RATED_AT,
      GLICKO1_PER_MATCH_V4
    );

    expect(ranked.totalGrowthAdjustment).toBe(0);
    expect(ranked.firstGrowthAdjustment).toBe(0);
    expect(ranked.secondGrowthAdjustment).toBe(0);
  });

  it('rejects growth on frozen old versions and unpublished V4 parameters', () => {
    expect(() =>
      assertValidRankedRatingConfig({
        ...GLICKO1_PER_MATCH_V3,
        growthPool: GLICKO1_PER_MATCH_V4.growthPool,
      })
    ).toThrow('growthPool is only supported by GLICKO1_PER_MATCH_V4');
    expect(() =>
      assertValidRankedRatingConfig({
        ...GLICKO1_PER_MATCH_V4,
        growthPool: {
          ...GLICKO1_PER_MATCH_V4.growthPool!,
          maximumTotalAdjustment: 20,
        },
      })
    ).toThrow('growthPool must match the published configuration');
    expect(() =>
      assertValidRankedRatingConfig({
        ...GLICKO1_PER_MATCH_V4,
        minimumRatingDeviation: 90,
      })
    ).toThrow('must match the published rating parameters');
  });
});
