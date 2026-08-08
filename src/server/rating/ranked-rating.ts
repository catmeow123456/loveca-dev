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
  readonly enabled: boolean;
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
  readonly parameterRevision?: RankedRatingParameterRevision;
};

export interface RankedRatingParameterRevision {
  readonly mode: 'ADMIN_SEASON_RECALCULATION';
  readonly revisionId: string;
  readonly baseAlgorithmVersion: typeof V3_ALGORITHM_VERSION | typeof V4_ALGORITHM_VERSION;
  readonly sourceSoftResetMode: Glicko1Config['softResetMode'];
  readonly sourceSoftResetCenter: number;
  readonly sourceSoftResetRetention: number;
  readonly sourceSoftResetMinimumDeviation: number;
}

const V3_ALGORITHM_VERSION = 'GLICKO1_PER_MATCH_V3';
const V4_ALGORITHM_VERSION = 'GLICKO1_PER_MATCH_V4';
export const RANKED_RATING_REVISION_ALGORITHM_MARKER = '_REV_';
const V4_GROWTH_POOL_CONFIG: RankedGrowthPoolConfig = Object.freeze({
  mode: 'POST_PLACEMENT_AVERAGE_CENTERED',
  enabled: true,
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
  const isRevision = isRankedRatingParameterRevisionConfig(config);
  if (config.algorithmVersion.includes(RANKED_RATING_REVISION_ALGORITHM_MARKER) && !isRevision) {
    throw new Error('revision algorithmVersion requires a matching parameterRevision identity');
  }
  const supportsGrowth =
    config.algorithmVersion === V4_ALGORITHM_VERSION ||
    (isRevision && config.parameterRevision.baseAlgorithmVersion === V4_ALGORITHM_VERSION);
  if (!supportsGrowth && growthPool) {
    throw new Error('growthPool is only supported by GLICKO1_PER_MATCH_V4');
  }
  if (supportsGrowth && !growthPool) {
    throw new Error('GLICKO1_PER_MATCH_V4 requires growthPool');
  }
  if (config.parameterRevision && !isRevision) {
    throw new Error('parameterRevision identity is invalid');
  }
  if (!growthPool) {
    if (isRevision) {
      assertValidRevisionParameters(config);
    }
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
  if (typeof growthPool.enabled !== 'boolean') {
    throw new Error('growthPool.enabled must be a boolean');
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
  if (isRevision) {
    assertValidRevisionParameters(config, growthPool);
    return;
  }
  if (
    growthPool.enabled !== V4_GROWTH_POOL_CONFIG.enabled ||
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

export function isRankedRatingParameterRevisionConfig(
  config: RankedRatingConfig
): config is RankedRatingConfig & { readonly parameterRevision: RankedRatingParameterRevision } {
  const revision = config.parameterRevision;
  return Boolean(
    revision &&
    revision.mode === 'ADMIN_SEASON_RECALCULATION' &&
    (revision.baseAlgorithmVersion === V3_ALGORITHM_VERSION ||
      revision.baseAlgorithmVersion === V4_ALGORITHM_VERSION) &&
    /^[0-9a-f]{32}$/.test(revision.revisionId) &&
    config.algorithmVersion ===
      `${revision.baseAlgorithmVersion}${RANKED_RATING_REVISION_ALGORITHM_MARKER}${revision.revisionId}` &&
    (revision.sourceSoftResetMode === 'RESET_TO_INITIAL' ||
      revision.sourceSoftResetMode === 'RETAIN_TOWARD_CENTER') &&
    Number.isFinite(revision.sourceSoftResetCenter) &&
    Number.isFinite(revision.sourceSoftResetRetention) &&
    Number.isFinite(revision.sourceSoftResetMinimumDeviation)
  );
}

function assertValidRevisionParameters(
  config: RankedRatingConfig,
  growthPool?: RankedGrowthPoolConfig
): void {
  if (config.ratingPeriodMode !== 'PER_MATCH') {
    throw new Error('revised ratingPeriodMode must remain PER_MATCH');
  }
  assertRange(config.ratingScale, 200, 2_000, 'ratingScale');
  assertRange(config.minimumRatingDeviation, 30, 200, 'minimumRatingDeviation');
  if (!Number.isInteger(config.placementMatchCount)) {
    throw new Error('placementMatchCount must be an integer');
  }
  assertRange(config.placementMatchCount, 1, 30, 'placementMatchCount');
  if (growthPool) {
    assertRange(growthPool.centerRating, 1_400, 2_400, 'growthPool.centerRating');
    assertRange(growthPool.maximumTotalAdjustment, 1, 50, 'growthPool.maximumTotalAdjustment');
    assertRange(growthPool.transitionWidth, 50, 1_000, 'growthPool.transitionWidth');
    assertRange(growthPool.negativeWinnerShare, 0.5, 1, 'growthPool.negativeWinnerShare');
  }
  const base =
    config.parameterRevision?.baseAlgorithmVersion === V3_ALGORITHM_VERSION
      ? GLICKO1_PER_MATCH_V3
      : GLICKO1_PER_MATCH_V4;
  const immutableKeys: readonly (keyof Glicko1Config)[] = [
    'initialRating',
    'initialRatingDeviation',
    'maximumRatingDeviation',
    'inactivityTimeUnitMs',
    'deviationIncreasePerTimeUnit',
    'displayDecimalPlaces',
  ];
  for (const key of immutableKeys) {
    if (config[key] !== base[key]) {
      throw new Error(`revised ${key} must remain equal to the published base value`);
    }
  }
  const revision = config.parameterRevision!;
  if (
    config.softResetMode !== revision.sourceSoftResetMode ||
    config.softResetCenter !== revision.sourceSoftResetCenter ||
    config.softResetRetention !== revision.sourceSoftResetRetention ||
    config.softResetMinimumDeviation !==
      Math.max(revision.sourceSoftResetMinimumDeviation, config.minimumRatingDeviation)
  ) {
    throw new Error('revised soft-reset parameters must remain bound to the source configuration');
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
    !growthPool.enabled ||
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

function assertRange(value: number, minimum: number, maximum: number, label: string): void {
  assertFinite(value, label);
  if (value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
}
