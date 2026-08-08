import {
  assertValidGlicko1Config,
  GLICKO1_PER_MATCH_V3,
  rateGlickoHeadToHead,
  type Glicko1Config,
  type GlickoHeadToHeadResult,
  type GlickoRatingState,
} from './glicko.js';

export interface RankedGrowthPoolConfig {
  readonly mode: 'POST_PLACEMENT_AVERAGE_CENTERED';
  readonly centerRating: number;
  readonly maximumTotalAdjustment: number;
  readonly transitionWidth: number;
  readonly positiveSplitMode: 'EQUAL';
  readonly negativeWinnerShare: number;
}

/**
 * Old persistent seasons contain a plain Glicko1Config. The growth section is
 * optional so those frozen V1-V3 JSON snapshots remain valid and replayable.
 */
export type RankedRatingConfig = Glicko1Config & {
  readonly growthPool?: RankedGrowthPoolConfig;
};

const V4_ALGORITHM_VERSION = 'GLICKO1_PER_MATCH_V4';
const V4_GROWTH_POOL_CONFIG: RankedGrowthPoolConfig = Object.freeze({
  mode: 'POST_PLACEMENT_AVERAGE_CENTERED',
  centerRating: 1800,
  maximumTotalAdjustment: 16,
  transitionWidth: 250,
  positiveSplitMode: 'EQUAL',
  negativeWinnerShare: 0.75,
});

export const GLICKO1_PER_MATCH_V4: RankedRatingConfig = Object.freeze({
  ...GLICKO1_PER_MATCH_V3,
  algorithmVersion: V4_ALGORITHM_VERSION,
  minimumRatingDeviation: 100,
  placementMatchCount: 5,
  growthPool: V4_GROWTH_POOL_CONFIG,
});

export type RankedDecisiveScore = 0 | 1;

export interface RankedHeadToHeadResult extends GlickoHeadToHeadResult {
  readonly totalGrowthAdjustment: number;
  readonly firstGrowthAdjustment: number;
  readonly secondGrowthAdjustment: number;
}

export function assertValidRankedRatingConfig(config: RankedRatingConfig): void {
  assertValidGlicko1Config(config);
  const growthPool = config.growthPool;
  if (config.algorithmVersion !== V4_ALGORITHM_VERSION && growthPool) {
    throw new Error('growthPool is only supported by GLICKO1_PER_MATCH_V4');
  }
  if (config.algorithmVersion === V4_ALGORITHM_VERSION && !growthPool) {
    throw new Error('GLICKO1_PER_MATCH_V4 requires growthPool');
  }
  if (!growthPool) {
    return;
  }
  const growthPoolKeys = Object.keys(growthPool).sort();
  const publishedGrowthPoolKeys = Object.keys(V4_GROWTH_POOL_CONFIG).sort();
  if (
    growthPoolKeys.length !== publishedGrowthPoolKeys.length ||
    growthPoolKeys.some((key, index) => key !== publishedGrowthPoolKeys[index])
  ) {
    throw new Error('GLICKO1_PER_MATCH_V4 growthPool shape must match the published configuration');
  }
  if (growthPool.mode !== 'POST_PLACEMENT_AVERAGE_CENTERED') {
    throw new Error('growthPool.mode must be POST_PLACEMENT_AVERAGE_CENTERED');
  }
  assertFinite(growthPool.centerRating, 'growthPool.centerRating');
  assertFinite(growthPool.maximumTotalAdjustment, 'growthPool.maximumTotalAdjustment');
  assertFinite(growthPool.transitionWidth, 'growthPool.transitionWidth');
  assertFinite(growthPool.negativeWinnerShare, 'growthPool.negativeWinnerShare');
  if (growthPool.maximumTotalAdjustment <= 0) {
    throw new Error('growthPool.maximumTotalAdjustment must be greater than zero');
  }
  if (growthPool.transitionWidth <= 0) {
    throw new Error('growthPool.transitionWidth must be greater than zero');
  }
  if (growthPool.positiveSplitMode !== 'EQUAL') {
    throw new Error('growthPool.positiveSplitMode must be EQUAL');
  }
  if (growthPool.negativeWinnerShare < 0 || growthPool.negativeWinnerShare > 1) {
    throw new Error('growthPool.negativeWinnerShare must be between zero and one');
  }
  if (
    growthPool.centerRating !== V4_GROWTH_POOL_CONFIG.centerRating ||
    growthPool.maximumTotalAdjustment !== V4_GROWTH_POOL_CONFIG.maximumTotalAdjustment ||
    growthPool.transitionWidth !== V4_GROWTH_POOL_CONFIG.transitionWidth ||
    growthPool.negativeWinnerShare !== V4_GROWTH_POOL_CONFIG.negativeWinnerShare
  ) {
    throw new Error('GLICKO1_PER_MATCH_V4 growthPool must match the published configuration');
  }
  if (
    config.ratingPeriodMode !== GLICKO1_PER_MATCH_V4.ratingPeriodMode ||
    config.ratingScale !== GLICKO1_PER_MATCH_V4.ratingScale ||
    config.initialRating !== GLICKO1_PER_MATCH_V4.initialRating ||
    config.initialRatingDeviation !== GLICKO1_PER_MATCH_V4.initialRatingDeviation ||
    config.minimumRatingDeviation !== GLICKO1_PER_MATCH_V4.minimumRatingDeviation ||
    config.maximumRatingDeviation !== GLICKO1_PER_MATCH_V4.maximumRatingDeviation ||
    config.inactivityTimeUnitMs !== GLICKO1_PER_MATCH_V4.inactivityTimeUnitMs ||
    config.deviationIncreasePerTimeUnit !== GLICKO1_PER_MATCH_V4.deviationIncreasePerTimeUnit ||
    config.placementMatchCount !== GLICKO1_PER_MATCH_V4.placementMatchCount ||
    config.displayDecimalPlaces !== GLICKO1_PER_MATCH_V4.displayDecimalPlaces
  ) {
    throw new Error('GLICKO1_PER_MATCH_V4 must match the published rating parameters');
  }
}

/**
 * Unified persistent ranked settlement boundary. Pure Glicko remains in
 * glicko.ts; version-specific season incentives are applied only here so live
 * settlement and deterministic ledger replay cannot drift apart.
 */
export function rateRankedHeadToHead(
  first: GlickoRatingState,
  second: GlickoRatingState,
  firstScore: RankedDecisiveScore,
  ratedAt: Date,
  config: RankedRatingConfig
): RankedHeadToHeadResult {
  assertValidRankedRatingConfig(config);
  const glicko = rateGlickoHeadToHead(first, second, firstScore, ratedAt, config);
  const growthPool = config.growthPool;
  if (
    !growthPool ||
    first.ratedMatchCount < config.placementMatchCount ||
    second.ratedMatchCount < config.placementMatchCount
  ) {
    return {
      ...glicko,
      totalGrowthAdjustment: 0,
      firstGrowthAdjustment: 0,
      secondGrowthAdjustment: 0,
    };
  }

  const averageRating = (first.rating + second.rating) / 2;
  const totalGrowthAdjustment =
    growthPool.maximumTotalAdjustment *
    Math.tanh((growthPool.centerRating - averageRating) / growthPool.transitionWidth);
  const [firstGrowthAdjustment, secondGrowthAdjustment] = splitGrowthAdjustment(
    totalGrowthAdjustment,
    firstScore,
    growthPool
  );

  return {
    first: {
      ...glicko.first,
      rating: glicko.first.rating + firstGrowthAdjustment,
    },
    second: {
      ...glicko.second,
      rating: glicko.second.rating + secondGrowthAdjustment,
    },
    totalGrowthAdjustment,
    firstGrowthAdjustment,
    secondGrowthAdjustment,
  };
}

function splitGrowthAdjustment(
  total: number,
  firstScore: RankedDecisiveScore,
  config: RankedGrowthPoolConfig
): readonly [number, number] {
  if (total >= 0) {
    return [total / 2, total / 2];
  }
  const winnerAdjustment = total * config.negativeWinnerShare;
  const loserAdjustment = total - winnerAdjustment;
  return firstScore === 1
    ? [winnerAdjustment, loserAdjustment]
    : [loserAdjustment, winnerAdjustment];
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}
