const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export type GlickoScore = 0 | 0.5 | 1;

export interface GlickoCompetitor {
  readonly rating: number;
  readonly ratingDeviation: number;
}

export interface GlickoRatingState extends GlickoCompetitor {
  readonly ratedMatchCount: number;
  readonly lastRatedAt: Date | null;
}

export type GlickoSoftResetMode = 'RESET_TO_INITIAL' | 'RETAIN_TOWARD_CENTER';

export interface GlickoPeriodResult {
  readonly opponent: GlickoCompetitor;
  readonly score: GlickoScore;
}

export interface Glicko1Config {
  readonly algorithmVersion: string;
  readonly ratingPeriodMode: 'PER_MATCH';
  readonly ratingScale: number;
  readonly initialRating: number;
  readonly initialRatingDeviation: number;
  readonly minimumRatingDeviation: number;
  readonly maximumRatingDeviation: number;
  readonly inactivityTimeUnitMs: number;
  readonly deviationIncreasePerTimeUnit: number;
  readonly placementMatchCount: number;
  readonly displayDecimalPlaces: number;
  readonly softResetMode: GlickoSoftResetMode;
  readonly softResetCenter: number;
  readonly softResetRetention: number;
  readonly softResetMinimumDeviation: number;
}

const SHADOW_V1_MAXIMUM_DEVIATION = 350;
const SHADOW_V1_STABLE_DEVIATION = 50;
const SHADOW_V1_DAYS_TO_MAXIMUM_DEVIATION = 365;

/**
 * Candidate configuration for offline shadow validation only.
 *
 * Any parameter change must use a new algorithmVersion. Player-visible rating
 * ledgers must never refer to a SHADOW configuration version.
 */
export const GLICKO1_PER_MATCH_SHADOW_V1: Glicko1Config = Object.freeze({
  algorithmVersion: 'GLICKO1_PER_MATCH_SHADOW_V1',
  ratingPeriodMode: 'PER_MATCH',
  ratingScale: 400,
  initialRating: 1500,
  initialRatingDeviation: SHADOW_V1_MAXIMUM_DEVIATION,
  minimumRatingDeviation: 30,
  maximumRatingDeviation: SHADOW_V1_MAXIMUM_DEVIATION,
  inactivityTimeUnitMs: MILLISECONDS_PER_DAY,
  deviationIncreasePerTimeUnit: Math.sqrt(
    (SHADOW_V1_MAXIMUM_DEVIATION ** 2 - SHADOW_V1_STABLE_DEVIATION ** 2) /
      SHADOW_V1_DAYS_TO_MAXIMUM_DEVIATION
  ),
  placementMatchCount: 5,
  displayDecimalPlaces: 0,
  softResetMode: 'RESET_TO_INITIAL',
  softResetCenter: 1500,
  softResetRetention: 0.5,
  softResetMinimumDeviation: 200,
});

/**
 * Production shadow report 2026-07-29 showed that five matches still left
 * 6/35 qualified players above RD 150, while every player with at least ten
 * matches was at or below RD 150. Rating math is unchanged from SHADOW_V1;
 * only the player-visible placement gate changes.
 */
export const GLICKO1_PER_MATCH_SHADOW_V2: Glicko1Config = Object.freeze({
  ...GLICKO1_PER_MATCH_SHADOW_V1,
  algorithmVersion: 'GLICKO1_PER_MATCH_SHADOW_V2',
  placementMatchCount: 10,
});

/**
 * First persistent season configuration. It promotes the validated SHADOW_V2
 * parameters without changing their mathematical meaning.
 */
export const GLICKO1_PER_MATCH_V1: Glicko1Config = Object.freeze({
  ...GLICKO1_PER_MATCH_SHADOW_V2,
  algorithmVersion: 'GLICKO1_PER_MATCH_V1',
});

/**
 * Second persistent season configuration. It slightly lowers the uncertainty
 * assigned to a brand-new player so the first few results remain responsive
 * without producing the full RD 350 swing.
 */
export const GLICKO1_PER_MATCH_V2: Glicko1Config = Object.freeze({
  ...GLICKO1_PER_MATCH_V1,
  algorithmVersion: 'GLICKO1_PER_MATCH_V2',
  initialRatingDeviation: 300,
});

/**
 * Third persistent season configuration. It keeps the V2 initial state and
 * placement policy, but uses a wider rating scale so large rating gaps do not
 * imply implausibly extreme expected scores or one-match corrections.
 */
export const GLICKO1_PER_MATCH_V3: Glicko1Config = Object.freeze({
  ...GLICKO1_PER_MATCH_V2,
  algorithmVersion: 'GLICKO1_PER_MATCH_V3',
  ratingScale: 800,
});

export const CURRENT_GLICKO1_SHADOW_CONFIG = GLICKO1_PER_MATCH_SHADOW_V2;

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function assertValidConfig(config: Glicko1Config): void {
  if (config.algorithmVersion.trim().length === 0) {
    throw new Error('algorithmVersion must not be empty');
  }
  assertFiniteNumber(config.ratingScale, 'ratingScale');
  assertFiniteNumber(config.initialRating, 'initialRating');
  assertFiniteNumber(config.initialRatingDeviation, 'initialRatingDeviation');
  assertFiniteNumber(config.minimumRatingDeviation, 'minimumRatingDeviation');
  assertFiniteNumber(config.maximumRatingDeviation, 'maximumRatingDeviation');
  assertFiniteNumber(config.inactivityTimeUnitMs, 'inactivityTimeUnitMs');
  assertFiniteNumber(config.deviationIncreasePerTimeUnit, 'deviationIncreasePerTimeUnit');
  assertFiniteNumber(config.softResetCenter, 'softResetCenter');
  assertFiniteNumber(config.softResetRetention, 'softResetRetention');
  assertFiniteNumber(config.softResetMinimumDeviation, 'softResetMinimumDeviation');

  if (
    config.softResetMode !== 'RESET_TO_INITIAL' &&
    config.softResetMode !== 'RETAIN_TOWARD_CENTER'
  ) {
    throw new Error('softResetMode must be RESET_TO_INITIAL or RETAIN_TOWARD_CENTER');
  }
  if (config.ratingScale <= 0) {
    throw new Error('ratingScale must be greater than zero');
  }
  if (config.minimumRatingDeviation <= 0) {
    throw new Error('minimumRatingDeviation must be greater than zero');
  }
  if (config.maximumRatingDeviation < config.minimumRatingDeviation) {
    throw new Error('maximumRatingDeviation must not be lower than minimumRatingDeviation');
  }
  if (
    config.initialRatingDeviation < config.minimumRatingDeviation ||
    config.initialRatingDeviation > config.maximumRatingDeviation
  ) {
    throw new Error('initialRatingDeviation must be within the configured deviation range');
  }
  if (config.inactivityTimeUnitMs <= 0) {
    throw new Error('inactivityTimeUnitMs must be greater than zero');
  }
  if (config.deviationIncreasePerTimeUnit < 0) {
    throw new Error('deviationIncreasePerTimeUnit must not be negative');
  }
  if (!Number.isInteger(config.placementMatchCount) || config.placementMatchCount < 0) {
    throw new Error('placementMatchCount must be a non-negative integer');
  }
  if (
    !Number.isInteger(config.displayDecimalPlaces) ||
    config.displayDecimalPlaces < 0 ||
    config.displayDecimalPlaces > 10
  ) {
    throw new Error('displayDecimalPlaces must be an integer from zero to ten');
  }
  if (config.softResetRetention < 0 || config.softResetRetention > 1) {
    throw new Error('softResetRetention must be between zero and one');
  }
  if (
    config.softResetMinimumDeviation < config.minimumRatingDeviation ||
    config.softResetMinimumDeviation > config.maximumRatingDeviation
  ) {
    throw new Error('softResetMinimumDeviation must be within the configured deviation range');
  }
}

export function assertValidGlicko1Config(config: Glicko1Config): void {
  assertValidConfig(config);
}

function assertValidCompetitor(competitor: GlickoCompetitor, config: Glicko1Config): void {
  assertFiniteNumber(competitor.rating, 'rating');
  assertFiniteNumber(competitor.ratingDeviation, 'ratingDeviation');
  if (
    competitor.ratingDeviation < config.minimumRatingDeviation ||
    competitor.ratingDeviation > config.maximumRatingDeviation
  ) {
    throw new Error('ratingDeviation must be within the configured deviation range');
  }
}

function assertValidRatingState(state: GlickoRatingState, config: Glicko1Config): void {
  assertValidCompetitor(state, config);
  assertValidRatingStateMetadata(state);
}

function assertValidRatingStateMetadata(state: GlickoRatingState): void {
  if (!Number.isInteger(state.ratedMatchCount) || state.ratedMatchCount < 0) {
    throw new Error('ratedMatchCount must be a non-negative integer');
  }
  if (state.lastRatedAt !== null && !Number.isFinite(state.lastRatedAt.getTime())) {
    throw new Error('lastRatedAt must be a valid Date or null');
  }
}

function assertValidScore(score: number): asserts score is GlickoScore {
  if (score !== 0 && score !== 0.5 && score !== 1) {
    throw new Error('score must be 0, 0.5, or 1');
  }
}

function clampRatingDeviation(value: number, config: Glicko1Config): number {
  return Math.min(config.maximumRatingDeviation, Math.max(config.minimumRatingDeviation, value));
}

function getGlickoQ(config: Glicko1Config): number {
  return Math.log(10) / config.ratingScale;
}

function glickoOpponentImpact(opponentDeviation: number, config: Glicko1Config): number {
  const q = getGlickoQ(config);
  return 1 / Math.sqrt(1 + (3 * q ** 2 * opponentDeviation ** 2) / Math.PI ** 2);
}

export function calculateGlickoExpectedScore(
  player: GlickoCompetitor,
  opponent: GlickoCompetitor,
  config: Glicko1Config = CURRENT_GLICKO1_SHADOW_CONFIG
): number {
  assertValidConfig(config);
  assertValidCompetitor(player, config);
  assertValidCompetitor(opponent, config);

  const impact = glickoOpponentImpact(opponent.ratingDeviation, config);
  return 1 / (1 + 10 ** ((-impact * (player.rating - opponent.rating)) / config.ratingScale));
}

export function createInitialGlickoRatingState(
  config: Glicko1Config = CURRENT_GLICKO1_SHADOW_CONFIG
): GlickoRatingState {
  assertValidConfig(config);
  return {
    rating: config.initialRating,
    ratingDeviation: config.initialRatingDeviation,
    ratedMatchCount: 0,
    lastRatedAt: null,
  };
}

export function increaseGlickoDeviationForInactivity(
  state: GlickoRatingState,
  ratedAt: Date,
  config: Glicko1Config = CURRENT_GLICKO1_SHADOW_CONFIG
): GlickoRatingState {
  assertValidConfig(config);
  assertValidRatingState(state, config);
  const ratedAtMs = ratedAt.getTime();
  if (!Number.isFinite(ratedAtMs)) {
    throw new Error('ratedAt must be a valid Date');
  }
  if (state.lastRatedAt === null) {
    return state;
  }

  const elapsedMs = ratedAtMs - state.lastRatedAt.getTime();
  if (elapsedMs < 0) {
    throw new Error('ratedAt must not be earlier than lastRatedAt');
  }
  if (elapsedMs === 0 || state.ratingDeviation === config.maximumRatingDeviation) {
    return state;
  }

  const elapsedUnits = elapsedMs / config.inactivityTimeUnitMs;
  const increasedDeviation = Math.sqrt(
    state.ratingDeviation ** 2 + config.deviationIncreasePerTimeUnit ** 2 * elapsedUnits
  );
  return {
    ...state,
    ratingDeviation: clampRatingDeviation(increasedDeviation, config),
  };
}

/**
 * Applies one Glicko-1 rating period. Every result is evaluated against the
 * player's same pre-period rating and RD.
 */
export function rateGlickoPeriod(
  player: GlickoCompetitor,
  results: readonly GlickoPeriodResult[],
  config: Glicko1Config = CURRENT_GLICKO1_SHADOW_CONFIG
): GlickoCompetitor {
  assertValidConfig(config);
  assertValidCompetitor(player, config);
  if (results.length === 0) {
    throw new Error('a Glicko rating period must include at least one result');
  }

  let inverseVarianceSum = 0;
  let ratingDeltaSum = 0;
  const q = getGlickoQ(config);
  for (const result of results) {
    assertValidCompetitor(result.opponent, config);
    assertValidScore(result.score);

    const impact = glickoOpponentImpact(result.opponent.ratingDeviation, config);
    const expectedScore =
      1 / (1 + 10 ** ((-impact * (player.rating - result.opponent.rating)) / config.ratingScale));
    inverseVarianceSum += impact ** 2 * expectedScore * (1 - expectedScore);
    ratingDeltaSum += impact * (result.score - expectedScore);
  }

  const estimatedVariance = 1 / (q ** 2 * inverseVarianceSum);
  const precision = 1 / player.ratingDeviation ** 2 + 1 / estimatedVariance;
  const ratingDeviation = clampRatingDeviation(Math.sqrt(1 / precision), config);
  const rating = player.rating + (q / precision) * ratingDeltaSum;

  return { rating, ratingDeviation };
}

export interface GlickoHeadToHeadResult {
  readonly first: GlickoRatingState;
  readonly second: GlickoRatingState;
}

/**
 * Rates both players from the same pre-match snapshot. This is the settlement
 * primitive used by the per-match shadow configuration.
 */
export function rateGlickoHeadToHead(
  first: GlickoRatingState,
  second: GlickoRatingState,
  firstScore: GlickoScore,
  ratedAt: Date,
  config: Glicko1Config = CURRENT_GLICKO1_SHADOW_CONFIG
): GlickoHeadToHeadResult {
  assertValidConfig(config);
  assertValidRatingState(first, config);
  assertValidRatingState(second, config);
  assertValidScore(firstScore);
  if (!Number.isFinite(ratedAt.getTime())) {
    throw new Error('ratedAt must be a valid Date');
  }

  const preparedFirst = increaseGlickoDeviationForInactivity(first, ratedAt, config);
  const preparedSecond = increaseGlickoDeviationForInactivity(second, ratedAt, config);
  const ratedFirst = rateGlickoPeriod(
    preparedFirst,
    [{ opponent: preparedSecond, score: firstScore }],
    config
  );
  const ratedSecond = rateGlickoPeriod(
    preparedSecond,
    [{ opponent: preparedFirst, score: (1 - firstScore) as GlickoScore }],
    config
  );

  return {
    first: {
      ...ratedFirst,
      ratedMatchCount: first.ratedMatchCount + 1,
      lastRatedAt: new Date(ratedAt.getTime()),
    },
    second: {
      ...ratedSecond,
      ratedMatchCount: second.ratedMatchCount + 1,
      lastRatedAt: new Date(ratedAt.getTime()),
    },
  };
}

export function softResetGlickoRatingState(
  state: GlickoRatingState,
  config: Glicko1Config = CURRENT_GLICKO1_SHADOW_CONFIG
): GlickoRatingState {
  assertValidConfig(config);
  assertFiniteNumber(state.rating, 'rating');
  assertFiniteNumber(state.ratingDeviation, 'ratingDeviation');
  if (state.ratingDeviation <= 0) {
    throw new Error('ratingDeviation must be greater than zero');
  }
  assertValidRatingStateMetadata(state);

  if (config.softResetMode === 'RESET_TO_INITIAL') {
    return createInitialGlickoRatingState(config);
  }
  return {
    rating:
      config.softResetCenter + config.softResetRetention * (state.rating - config.softResetCenter),
    ratingDeviation: clampRatingDeviation(
      Math.max(state.ratingDeviation, config.softResetMinimumDeviation),
      config
    ),
    ratedMatchCount: 0,
    lastRatedAt: null,
  };
}

export function isGlickoPlacementComplete(
  state: GlickoRatingState,
  config: Glicko1Config = CURRENT_GLICKO1_SHADOW_CONFIG
): boolean {
  assertValidConfig(config);
  assertValidRatingState(state, config);
  return state.ratedMatchCount >= config.placementMatchCount;
}

export function formatGlickoRatingForDisplay(
  rating: number,
  config: Glicko1Config = CURRENT_GLICKO1_SHADOW_CONFIG
): number {
  assertValidConfig(config);
  assertFiniteNumber(rating, 'rating');
  const factor = 10 ** config.displayDecimalPlaces;
  return Math.round(rating * factor) / factor;
}
