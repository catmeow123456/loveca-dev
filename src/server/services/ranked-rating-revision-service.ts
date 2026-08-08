import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { config as serverConfig } from '../config.js';
import { pool } from '../db/pool.js';
import type { GlickoRatingState } from '../rating/glicko.js';
import {
  buildRankedCompetitiveEnvironmentIdentity,
  type RankedCardCatalogIdentity,
} from '../rating/ranked-environment.js';
import {
  materializeRankedRatingLedger,
  type RankedRatingEvent,
  type RankedRatingMaterialization,
  type RankedRatingMaterializationStep,
} from '../rating/ranked-ledger.js';
import {
  assertValidRankedRatingConfig,
  isRankedRatingParameterRevisionConfig,
  RANKED_RATING_REVISION_ALGORITHM_MARKER,
  type RankedGrowthPoolConfig,
  type RankedRatingConfig,
} from '../rating/ranked-rating.js';
import { stableJsonStringify } from './replay-payload-serialization.js';

const PREVIEW_LIFETIME_MS = 15 * 60 * 1000;
const SUPPORTED_BASE_ALGORITHMS = new Set(['GLICKO1_PER_MATCH_V3', 'GLICKO1_PER_MATCH_V4']);

export interface RankedRatingRevisionParameters {
  readonly ratingScale: number;
  readonly minimumRatingDeviation: number;
  readonly placementMatchCount: number;
  readonly growthPool?: {
    readonly enabled: boolean;
    readonly centerRating: number;
    readonly maximumTotalAdjustment: number;
    readonly transitionWidth: number;
    readonly negativeWinnerShare: number;
  };
}

export interface RankedRatingRevisionPreviewInput {
  readonly seasonId: string;
  readonly parameters: RankedRatingRevisionParameters;
  readonly reason: string;
  readonly adminUserId: string;
}

export interface RankedRatingRevisionApplyInput {
  readonly seasonId: string;
  readonly previewToken: string;
  readonly adminUserId: string;
}

export interface RankedRatingRevisionBlockers {
  readonly pendingMatches: number;
  readonly runningMatches: number;
  readonly activeTickets: number;
  readonly activeReservations: number;
  readonly activeParticipations: number;
  readonly matchEnvironmentMismatches: number;
  readonly matchRecordRulesMismatches: number;
}

export interface RankedRatingRevisionPlayerChange {
  readonly userId: string;
  readonly playerName: string;
  readonly before: GlickoRatingState | null;
  readonly after: GlickoRatingState | null;
  readonly ratingDelta: number;
  readonly ratingDeviationDelta: number;
  readonly ratedMatchCountDelta: number;
  readonly rankBefore: number | null;
  readonly rankAfter: number | null;
  readonly rankDelta: number | null;
}

export interface RankedRatingRevisionPreview {
  readonly schemaVersion: 'loveca-ranked-rating-revision-preview-v1';
  readonly seasonId: string;
  readonly sourceAlgorithmVersion: string;
  readonly targetAlgorithmVersion: string;
  readonly sourceConfig: RankedRatingConfig;
  readonly targetConfig: RankedRatingConfig;
  readonly sourceLedgerRevision: number;
  readonly projectedLedgerRevision: number;
  readonly previewExpiresAt: Date;
  readonly previewToken: string;
  readonly blockers: RankedRatingRevisionBlockers;
  readonly canApply: boolean;
  readonly materializedMatchCount: number;
  readonly affectedMatchCount: number;
  readonly affectedPlayerCount: number;
  readonly leaderboardEnteredCount: number;
  readonly leaderboardLeftCount: number;
  readonly seedDeviationClampCount: number;
  readonly maximumAbsoluteRatingChange: number;
  readonly maximumAbsoluteRankChange: number;
  readonly maximumAbsolutePerMatchDeltaChange: number;
  readonly playerChanges: readonly RankedRatingRevisionPlayerChange[];
}

export interface RankedRatingRevisionHistoryItem {
  readonly id: string;
  readonly revisionNumber: number;
  readonly sourceAlgorithmVersion: string;
  readonly targetAlgorithmVersion: string;
  readonly sourceConfig: RankedRatingConfig;
  readonly targetConfig: RankedRatingConfig;
  readonly sourceLedgerRevision: number;
  readonly targetLedgerRevision: number;
  readonly reason: string;
  readonly previewSummary: Readonly<Record<string, unknown>>;
  readonly appliedBy: string | null;
  readonly appliedAt: Date;
  readonly current: boolean;
}

interface RankedRatingRevisionSeasonSnapshot {
  readonly id: string;
  readonly lifecycle: 'DRAFT' | 'ACTIVE' | 'FINALIZING' | 'CLOSED';
  readonly queueAdmission: 'OPEN' | 'PAUSED';
  readonly competitiveEnvironmentId: string;
  readonly rulesVersion: string;
  readonly cardCatalogVersion: string;
  readonly cardCatalogHash: string;
  readonly deckPolicyVersion: string;
  readonly ratingAlgorithmVersion: string;
  readonly ratingConfig: RankedRatingConfig;
  readonly leaderboardMinimumMatchCount: number;
  readonly ledgerRevision: number;
  readonly activeRatingRevisionId: string | null;
}

export interface RankedRatingRevisionSnapshot {
  readonly season: RankedRatingRevisionSeasonSnapshot;
  readonly blockers: RankedRatingRevisionBlockers;
  readonly events: readonly RankedRatingEvent[];
  readonly seeds: ReadonlyMap<string, GlickoRatingState>;
  readonly currentRatings: ReadonlyMap<string, GlickoRatingState>;
  readonly playerNames: ReadonlyMap<string, string>;
  readonly nextRevisionNumber: number;
}

interface RankedRatingRevisionPlan {
  readonly snapshot: RankedRatingRevisionSnapshot;
  readonly revisionId: string;
  readonly targetConfig: RankedRatingConfig;
  readonly targetCompetitiveEnvironmentId: string;
  readonly directives: readonly RankedRatingEvent[];
  readonly materialization: RankedRatingMaterialization;
  readonly preview: Omit<RankedRatingRevisionPreview, 'previewToken'>;
  readonly reason: string;
}

interface PreviewTokenPayload {
  readonly schemaVersion: 'loveca-ranked-rating-revision-token-v1';
  readonly seasonId: string;
  readonly revisionId: string;
  readonly sourceAlgorithmVersion: string;
  readonly sourceConfigHash: string;
  readonly sourceLedgerRevision: number;
  readonly sourceCompetitiveEnvironmentId: string;
  readonly sourceRulesVersion: string;
  readonly sourceCardCatalogVersion: string;
  readonly sourceCardCatalogHash: string;
  readonly sourceDeckPolicyVersion: string;
  readonly targetConfigHash: string;
  readonly parameters: RankedRatingRevisionParameters;
  readonly reason: string;
  readonly previewAdminUserId: string;
  readonly expiresAt: string;
}

export interface RankedRatingRevisionRepository {
  loadSnapshot(seasonId: string, lock: boolean): Promise<RankedRatingRevisionSnapshot>;
  applyPlan(plan: RankedRatingRevisionPlan, adminUserId: string): Promise<void>;
  listHistory(seasonId: string): Promise<readonly RankedRatingRevisionHistoryItem[]>;
}

interface RankedRatingRevisionServiceDeps {
  readonly transaction?: <T>(
    callback: (repository: RankedRatingRevisionRepository) => Promise<T>
  ) => Promise<T>;
  readonly createId?: () => string;
  readonly now?: () => Date;
  readonly previewSecret?: string;
  readonly audit?: (event: RankedRatingRevisionAuditEvent) => void;
}

interface RankedRatingRevisionAuditEvent {
  readonly event: string;
  readonly adminUserId: string;
  readonly seasonId: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export class RankedRatingRevisionServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'RankedRatingRevisionServiceError';
  }
}

export class RankedRatingRevisionService {
  private readonly transaction: <T>(
    callback: (repository: RankedRatingRevisionRepository) => Promise<T>
  ) => Promise<T>;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly previewSecret: string;
  private readonly audit: (event: RankedRatingRevisionAuditEvent) => void;

  constructor(deps: RankedRatingRevisionServiceDeps = {}) {
    this.transaction = deps.transaction ?? withSerializableRevisionTransaction;
    this.createId = deps.createId ?? (() => randomUUID().replaceAll('-', ''));
    this.now = deps.now ?? (() => new Date());
    this.previewSecret = deps.previewSecret ?? serverConfig.jwtSecret;
    this.audit = deps.audit ?? writeRevisionAudit;
  }

  async preview(input: RankedRatingRevisionPreviewInput): Promise<RankedRatingRevisionPreview> {
    validatePreviewInput(input);
    const revisionId = normalizeRevisionId(this.createId());
    const expiresAt = new Date(this.now().getTime() + PREVIEW_LIFETIME_MS);
    return this.transaction(async (repository) => {
      const snapshot = await repository.loadSnapshot(input.seasonId, false);
      const plan = buildPlan(snapshot, input.parameters, input.reason, revisionId, expiresAt);
      const payload = createTokenPayload(plan, input.parameters, expiresAt, input.adminUserId);
      const preview = {
        ...plan.preview,
        previewToken: signPreviewToken(payload, this.previewSecret),
      };
      this.audit({
        event: 'RANKED_RATING_REVISION_PREVIEWED',
        adminUserId: input.adminUserId,
        seasonId: input.seasonId,
        detail: previewSummary(preview),
      });
      return preview;
    });
  }

  async apply(input: RankedRatingRevisionApplyInput): Promise<RankedRatingRevisionPreview> {
    if (!input.adminUserId.trim()) {
      throw revisionError('RANKED_RATING_REVISION_ADMIN_REQUIRED', '缺少管理员身份');
    }
    const payload = verifyAndReadPreviewToken(input.previewToken, this.previewSecret, this.now());
    if (payload.seasonId !== input.seasonId) {
      throw revisionError('RANKED_RATING_REVISION_SEASON_MISMATCH', '预览令牌不属于当前赛季', 409);
    }
    if (payload.previewAdminUserId !== input.adminUserId) {
      throw revisionError(
        'RANKED_RATING_REVISION_PREVIEW_ADMIN_MISMATCH',
        '预览令牌只能由生成预览的管理员应用',
        403
      );
    }
    const result = await this.transaction(async (repository) => {
      const snapshot = await repository.loadSnapshot(payload.seasonId, true);
      const expiresAt = new Date(payload.expiresAt);
      const plan = buildPlan(
        snapshot,
        payload.parameters,
        payload.reason,
        payload.revisionId,
        expiresAt
      );
      assertTokenMatchesPlan(payload, plan);
      assertApplySafety(plan.snapshot);
      await repository.applyPlan(plan, input.adminUserId);
      return { ...plan.preview, previewToken: input.previewToken };
    });
    this.audit({
      event: 'RANKED_RATING_REVISION_APPLIED',
      adminUserId: input.adminUserId,
      seasonId: payload.seasonId,
      detail: previewSummary(result),
    });
    return result;
  }

  async listHistory(seasonId: string): Promise<readonly RankedRatingRevisionHistoryItem[]> {
    if (!seasonId.trim()) {
      throw revisionError('RANKED_RATING_REVISION_SEASON_REQUIRED', '缺少赛季 ID');
    }
    return this.transaction((repository) => repository.listHistory(seasonId));
  }
}

function buildPlan(
  snapshot: RankedRatingRevisionSnapshot,
  parameters: RankedRatingRevisionParameters,
  reason: string,
  revisionId: string,
  expiresAt: Date
): RankedRatingRevisionPlan {
  const { season } = snapshot;
  if (season.lifecycle !== 'ACTIVE') {
    throw revisionError(
      'RANKED_RATING_REVISION_LIFECYCLE_INVALID',
      '只能对进行中的赛季预览或应用评分参数修订',
      409
    );
  }
  const sourceConfig = readStoredConfig(season.ratingAlgorithmVersion, season.ratingConfig);
  const cardCatalog: RankedCardCatalogIdentity = {
    cardCatalogVersion: season.cardCatalogVersion,
    cardCatalogHash: season.cardCatalogHash,
    // Published count is deliberately not part of the competitive-environment hash.
    // Recalculation must preserve the season's frozen catalog instead of depending on
    // whichever catalog happens to be published when an administrator runs the tool.
    publishedCardCount: 0,
  };
  const sourceEnvironment = buildRankedCompetitiveEnvironmentIdentity(cardCatalog, sourceConfig, {
    rulesVersion: season.rulesVersion,
    deckPolicyVersion: season.deckPolicyVersion,
  });
  if (sourceEnvironment.competitiveEnvironmentId !== season.competitiveEnvironmentId) {
    throw revisionError(
      'RANKED_RATING_REVISION_SOURCE_ENVIRONMENT_MISMATCH',
      '赛季冻结竞技环境与当前源配置无法互相验证，已拒绝回算',
      409
    );
  }
  const baseAlgorithmVersion = getBaseAlgorithmVersion(sourceConfig);
  if (editableParametersEqual(sourceConfig, parameters)) {
    throw revisionError(
      'RANKED_RATING_REVISION_NO_CHANGES',
      '调整参数与当前赛季配置完全相同，无需创建修订',
      409
    );
  }
  const targetConfig = buildTargetConfig(
    sourceConfig,
    baseAlgorithmVersion,
    parameters,
    revisionId
  );
  assertLedgerRevision(snapshot.events, season.ledgerRevision);
  const sourceMaterialization = materializeRankedRatingLedger(
    snapshot.events,
    sourceConfig,
    snapshot.seeds
  );
  assertProjectionMatches(snapshot.currentRatings, sourceMaterialization.players);
  const targetSeedNormalization = normalizeSeeds(snapshot.seeds, targetConfig);
  const latestDirectives = collectLatestDirectives(snapshot.events);
  const directives = latestDirectives.map((latest, index): RankedRatingEvent => ({
    eventId: revisionEventId(revisionId, index),
    eventSequence: season.ledgerRevision + index + 1,
    eventType: latest.eventType === 'VOID' ? 'VOID' : 'REPLACEMENT',
    matchId: latest.matchId,
    targetEventId: latest.eventId,
    firstUserId: latest.firstUserId,
    secondUserId: latest.secondUserId,
    winnerSeat: latest.eventType === 'VOID' ? null : latest.winnerSeat,
    resultType: latest.eventType === 'VOID' ? 'PLATFORM_NO_CONTEST' : latest.resultType,
    ratedAt: new Date(latest.ratedAt.getTime()),
    algorithmVersion: targetConfig.algorithmVersion,
  }));
  const materialization = materializeRankedRatingLedger(
    [...snapshot.events, ...directives],
    targetConfig,
    snapshot.seeds
  );
  const targetEnvironment = buildRankedCompetitiveEnvironmentIdentity(cardCatalog, targetConfig, {
    rulesVersion: season.rulesVersion,
    deckPolicyVersion: season.deckPolicyVersion,
  });
  const playerChanges = comparePlayers(
    snapshot.currentRatings,
    materialization.players,
    snapshot.playerNames,
    season.leaderboardMinimumMatchCount,
    targetConfig.placementMatchCount
  );
  const stepChanges = compareMaterializationSteps(
    sourceMaterialization.steps,
    materialization.steps
  );
  const preview: Omit<RankedRatingRevisionPreview, 'previewToken'> = {
    schemaVersion: 'loveca-ranked-rating-revision-preview-v1',
    seasonId: season.id,
    sourceAlgorithmVersion: sourceConfig.algorithmVersion,
    targetAlgorithmVersion: targetConfig.algorithmVersion,
    sourceConfig,
    targetConfig,
    sourceLedgerRevision: season.ledgerRevision,
    projectedLedgerRevision: season.ledgerRevision + directives.length,
    previewExpiresAt: expiresAt,
    blockers: snapshot.blockers,
    canApply: season.queueAdmission === 'PAUSED' && blockerCount(snapshot.blockers) === 0,
    materializedMatchCount: materialization.steps.length,
    affectedMatchCount: stepChanges.affectedMatchCount,
    affectedPlayerCount: playerChanges.length,
    leaderboardEnteredCount: playerChanges.filter(
      (change) => change.rankBefore === null && change.rankAfter !== null
    ).length,
    leaderboardLeftCount: playerChanges.filter(
      (change) => change.rankBefore !== null && change.rankAfter === null
    ).length,
    seedDeviationClampCount: targetSeedNormalization.clampedCount,
    maximumAbsoluteRatingChange: maximum(
      playerChanges.map((change) => Math.abs(change.ratingDelta))
    ),
    maximumAbsoluteRankChange: maximum(
      playerChanges.map((change) => Math.abs(change.rankDelta ?? 0))
    ),
    maximumAbsolutePerMatchDeltaChange: stepChanges.maximumAbsoluteDeltaChange,
    playerChanges,
  };
  return {
    snapshot,
    revisionId,
    targetConfig,
    targetCompetitiveEnvironmentId: targetEnvironment.competitiveEnvironmentId,
    directives,
    materialization,
    preview,
    reason,
  };
}

function editableParametersEqual(
  source: RankedRatingConfig,
  parameters: RankedRatingRevisionParameters
): boolean {
  const growthEqual = source.growthPool
    ? Boolean(
        parameters.growthPool &&
        source.growthPool.enabled === parameters.growthPool.enabled &&
        source.growthPool.centerRating === parameters.growthPool.centerRating &&
        source.growthPool.maximumTotalAdjustment === parameters.growthPool.maximumTotalAdjustment &&
        source.growthPool.transitionWidth === parameters.growthPool.transitionWidth &&
        source.growthPool.negativeWinnerShare === parameters.growthPool.negativeWinnerShare
      )
    : parameters.growthPool === undefined;
  return (
    source.ratingScale === parameters.ratingScale &&
    source.minimumRatingDeviation === parameters.minimumRatingDeviation &&
    source.placementMatchCount === parameters.placementMatchCount &&
    growthEqual
  );
}

function buildTargetConfig(
  source: RankedRatingConfig,
  baseAlgorithmVersion: 'GLICKO1_PER_MATCH_V3' | 'GLICKO1_PER_MATCH_V4',
  parameters: RankedRatingRevisionParameters,
  revisionId: string
): RankedRatingConfig {
  const growthPool = buildGrowthPool(baseAlgorithmVersion, source.growthPool, parameters);
  const sourceSoftReset = source.parameterRevision
    ? {
        mode: source.parameterRevision.sourceSoftResetMode,
        center: source.parameterRevision.sourceSoftResetCenter,
        retention: source.parameterRevision.sourceSoftResetRetention,
        minimumDeviation: source.parameterRevision.sourceSoftResetMinimumDeviation,
      }
    : {
        mode: source.softResetMode,
        center: source.softResetCenter,
        retention: source.softResetRetention,
        minimumDeviation: source.softResetMinimumDeviation,
      };
  const target: RankedRatingConfig = {
    ...source,
    algorithmVersion: `${baseAlgorithmVersion}${RANKED_RATING_REVISION_ALGORITHM_MARKER}${revisionId}`,
    ratingScale: parameters.ratingScale,
    minimumRatingDeviation: parameters.minimumRatingDeviation,
    softResetMinimumDeviation: Math.max(
      sourceSoftReset.minimumDeviation,
      parameters.minimumRatingDeviation
    ),
    placementMatchCount: parameters.placementMatchCount,
    ...(growthPool ? { growthPool } : { growthPool: undefined }),
    parameterRevision: {
      mode: 'ADMIN_SEASON_RECALCULATION',
      revisionId,
      baseAlgorithmVersion,
      sourceSoftResetMode: sourceSoftReset.mode,
      sourceSoftResetCenter: sourceSoftReset.center,
      sourceSoftResetRetention: sourceSoftReset.retention,
      sourceSoftResetMinimumDeviation: sourceSoftReset.minimumDeviation,
    },
  };
  try {
    assertValidRankedRatingConfig(target);
  } catch (error) {
    throw revisionError(
      'RANKED_RATING_REVISION_PARAMETERS_INVALID',
      `评分参数无效：${error instanceof Error ? error.message : String(error)}`
    );
  }
  return target;
}

function buildGrowthPool(
  baseAlgorithmVersion: string,
  source: RankedGrowthPoolConfig | undefined,
  parameters: RankedRatingRevisionParameters
): RankedGrowthPoolConfig | undefined {
  if (baseAlgorithmVersion === 'GLICKO1_PER_MATCH_V3') {
    if (parameters.growthPool) {
      throw revisionError(
        'RANKED_RATING_REVISION_GROWTH_UNSUPPORTED',
        'V3 参数修订不能新增 V4 成长池；请在 V4 赛季中调整成长参数'
      );
    }
    return undefined;
  }
  if (!source || !parameters.growthPool) {
    throw revisionError(
      'RANKED_RATING_REVISION_GROWTH_REQUIRED',
      'V4 参数修订必须提供完整成长池参数'
    );
  }
  return {
    ...source,
    enabled: parameters.growthPool.enabled,
    centerRating: parameters.growthPool.centerRating,
    maximumTotalAdjustment: parameters.growthPool.maximumTotalAdjustment,
    transitionWidth: parameters.growthPool.transitionWidth,
    negativeWinnerShare: parameters.growthPool.negativeWinnerShare,
  };
}

function getBaseAlgorithmVersion(
  config: RankedRatingConfig
): 'GLICKO1_PER_MATCH_V3' | 'GLICKO1_PER_MATCH_V4' {
  const base = isRankedRatingParameterRevisionConfig(config)
    ? config.parameterRevision.baseAlgorithmVersion
    : config.algorithmVersion;
  if (!SUPPORTED_BASE_ALGORITHMS.has(base)) {
    throw revisionError(
      'RANKED_RATING_REVISION_ALGORITHM_UNSUPPORTED',
      '只支持对 V3 或 V4 评分公式家族创建参数修订',
      409
    );
  }
  return base as 'GLICKO1_PER_MATCH_V3' | 'GLICKO1_PER_MATCH_V4';
}

function normalizeSeeds(
  seeds: ReadonlyMap<string, GlickoRatingState>,
  target: RankedRatingConfig
): { readonly seeds: ReadonlyMap<string, GlickoRatingState>; readonly clampedCount: number } {
  let clampedCount = 0;
  const normalized = new Map<string, GlickoRatingState>();
  for (const [userId, seed] of seeds) {
    const ratingDeviation = Math.min(
      target.maximumRatingDeviation,
      Math.max(target.minimumRatingDeviation, seed.ratingDeviation)
    );
    if (ratingDeviation !== seed.ratingDeviation) {
      clampedCount += 1;
    }
    normalized.set(userId, { ...seed, ratingDeviation });
  }
  return { seeds: normalized, clampedCount };
}

function collectLatestDirectives(
  events: readonly RankedRatingEvent[]
): readonly RankedRatingEvent[] {
  const latestByMatch = new Map<string, RankedRatingEvent>();
  for (const event of [...events].sort(
    (first, second) => first.eventSequence - second.eventSequence
  )) {
    latestByMatch.set(event.matchId, event);
  }
  return [...latestByMatch.values()].sort(
    (first, second) =>
      first.ratedAt.getTime() - second.ratedAt.getTime() ||
      compareText(first.matchId, second.matchId) ||
      first.eventSequence - second.eventSequence
  );
}

function comparePlayers(
  before: ReadonlyMap<string, GlickoRatingState>,
  after: ReadonlyMap<string, GlickoRatingState>,
  playerNames: ReadonlyMap<string, string>,
  beforeMinimumMatches: number,
  afterMinimumMatches: number
): readonly RankedRatingRevisionPlayerChange[] {
  const beforeRanks = rankPlayers(before, beforeMinimumMatches);
  const afterRanks = rankPlayers(after, afterMinimumMatches);
  const userIds = new Set([...before.keys(), ...after.keys()]);
  return [...userIds]
    .sort(compareText)
    .map((userId) => {
      const oldState = before.get(userId) ?? null;
      const newState = after.get(userId) ?? null;
      const rankBefore = beforeRanks.get(userId) ?? null;
      const rankAfter = afterRanks.get(userId) ?? null;
      return {
        userId,
        playerName: playerNames.get(userId) ?? userId,
        before: oldState,
        after: newState,
        ratingDelta: (newState?.rating ?? 0) - (oldState?.rating ?? 0),
        ratingDeviationDelta: (newState?.ratingDeviation ?? 0) - (oldState?.ratingDeviation ?? 0),
        ratedMatchCountDelta: (newState?.ratedMatchCount ?? 0) - (oldState?.ratedMatchCount ?? 0),
        rankBefore,
        rankAfter,
        rankDelta: rankBefore === null || rankAfter === null ? null : rankAfter - rankBefore,
      };
    })
    .filter(
      (change) =>
        !statesEqual(change.before, change.after) || change.rankBefore !== change.rankAfter
    );
}

function rankPlayers(
  players: ReadonlyMap<string, GlickoRatingState>,
  minimumMatches: number
): ReadonlyMap<string, number> {
  const ranked = [...players]
    .filter(([, state]) => state.ratedMatchCount >= minimumMatches)
    .sort(
      ([firstId, first], [secondId, second]) =>
        second.rating - first.rating || compareText(firstId, secondId)
    );
  return new Map(ranked.map(([userId], index) => [userId, index + 1]));
}

function compareMaterializationSteps(
  before: readonly RankedRatingMaterializationStep[],
  after: readonly RankedRatingMaterializationStep[]
): { readonly affectedMatchCount: number; readonly maximumAbsoluteDeltaChange: number } {
  if (before.length !== after.length) {
    throw revisionError(
      'RANKED_RATING_REVISION_MATERIALIZATION_MISMATCH',
      '新旧参数回放得到的有效对局数不一致',
      500
    );
  }
  let affectedMatchCount = 0;
  let maximumAbsoluteDeltaChange = 0;
  for (let index = 0; index < before.length; index += 1) {
    const oldStep = before[index]!;
    const newStep = after[index]!;
    if (oldStep.matchId !== newStep.matchId) {
      throw revisionError(
        'RANKED_RATING_REVISION_MATERIALIZATION_ORDER_MISMATCH',
        '新旧参数回放的对局顺序不一致',
        500
      );
    }
    const firstDifference =
      newStep.firstAfter.rating -
      newStep.firstBefore.rating -
      (oldStep.firstAfter.rating - oldStep.firstBefore.rating);
    const secondDifference =
      newStep.secondAfter.rating -
      newStep.secondBefore.rating -
      (oldStep.secondAfter.rating - oldStep.secondBefore.rating);
    const matchMaximum = Math.max(Math.abs(firstDifference), Math.abs(secondDifference));
    maximumAbsoluteDeltaChange = Math.max(maximumAbsoluteDeltaChange, matchMaximum);
    if (matchMaximum > 1e-9) {
      affectedMatchCount += 1;
    }
  }
  return { affectedMatchCount, maximumAbsoluteDeltaChange };
}

function assertProjectionMatches(
  current: ReadonlyMap<string, GlickoRatingState>,
  materialized: ReadonlyMap<string, GlickoRatingState>
): void {
  const userIds = new Set([...current.keys(), ...materialized.keys()]);
  for (const userId of userIds) {
    if (!statesEqual(current.get(userId) ?? null, materialized.get(userId) ?? null)) {
      throw revisionError(
        'RANKED_RATING_REVISION_PROJECTION_MISMATCH',
        '当前积分投影与冻结参数的流水回放不一致，已拒绝修订',
        409
      );
    }
  }
}

function statesEqual(first: GlickoRatingState | null, second: GlickoRatingState | null): boolean {
  return (
    first?.rating === second?.rating &&
    first?.ratingDeviation === second?.ratingDeviation &&
    first?.ratedMatchCount === second?.ratedMatchCount &&
    (first?.lastRatedAt?.getTime() ?? null) === (second?.lastRatedAt?.getTime() ?? null)
  );
}

function assertApplySafety(snapshot: RankedRatingRevisionSnapshot): void {
  if (snapshot.season.queueAdmission !== 'PAUSED') {
    throw revisionError('RANKED_RATING_REVISION_QUEUE_OPEN', '应用修订前必须先暂停排位匹配', 409);
  }
  if (blockerCount(snapshot.blockers) > 0) {
    throw revisionError(
      'RANKED_RATING_REVISION_BLOCKED',
      `存在未清空的排位运行状态或冻结环境异常：${JSON.stringify(snapshot.blockers)}`,
      409
    );
  }
}

function blockerCount(blockers: RankedRatingRevisionBlockers): number {
  return (
    blockers.pendingMatches +
    blockers.runningMatches +
    blockers.activeTickets +
    blockers.activeReservations +
    blockers.activeParticipations +
    blockers.matchEnvironmentMismatches +
    blockers.matchRecordRulesMismatches
  );
}

function assertLedgerRevision(events: readonly RankedRatingEvent[], revision: number): void {
  const maximumSequence = events.reduce(
    (maximumValue, event) => Math.max(maximumValue, event.eventSequence),
    0
  );
  if (events.length !== revision || maximumSequence !== revision) {
    throw revisionError(
      'RANKED_RATING_REVISION_LEDGER_INVALID',
      `流水 revision ${revision} 与 ${events.length} 条事件/最大序号 ${maximumSequence} 不一致`,
      409
    );
  }
}

function createTokenPayload(
  plan: RankedRatingRevisionPlan,
  parameters: RankedRatingRevisionParameters,
  expiresAt: Date,
  previewAdminUserId: string
): PreviewTokenPayload {
  return {
    schemaVersion: 'loveca-ranked-rating-revision-token-v1',
    seasonId: plan.snapshot.season.id,
    revisionId: plan.revisionId,
    sourceAlgorithmVersion: plan.snapshot.season.ratingAlgorithmVersion,
    sourceConfigHash: hashValue(plan.snapshot.season.ratingConfig),
    sourceLedgerRevision: plan.snapshot.season.ledgerRevision,
    sourceCompetitiveEnvironmentId: plan.snapshot.season.competitiveEnvironmentId,
    sourceRulesVersion: plan.snapshot.season.rulesVersion,
    sourceCardCatalogVersion: plan.snapshot.season.cardCatalogVersion,
    sourceCardCatalogHash: plan.snapshot.season.cardCatalogHash,
    sourceDeckPolicyVersion: plan.snapshot.season.deckPolicyVersion,
    targetConfigHash: hashValue(plan.targetConfig),
    parameters,
    reason: plan.reason,
    previewAdminUserId,
    expiresAt: expiresAt.toISOString(),
  };
}

function signPreviewToken(payload: PreviewTokenPayload, secret: string): string {
  const encodedPayload = Buffer.from(stableJsonStringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyAndReadPreviewToken(token: string, secret: string, now: Date): PreviewTokenPayload {
  const [encodedPayload, actualSignature, extra] = token.split('.');
  if (!encodedPayload || !actualSignature || extra) {
    throw revisionError(
      'RANKED_RATING_REVISION_PREVIEW_INVALID',
      '回算预览令牌无效，请重新预览',
      409
    );
  }
  const expectedSignature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  if (!safeTextEquals(actualSignature, expectedSignature)) {
    throw revisionError(
      'RANKED_RATING_REVISION_PREVIEW_INVALID',
      '回算预览令牌校验失败，请重新预览',
      409
    );
  }
  let payload: PreviewTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as PreviewTokenPayload;
  } catch {
    throw revisionError(
      'RANKED_RATING_REVISION_PREVIEW_INVALID',
      '回算预览令牌内容无效，请重新预览',
      409
    );
  }
  if (
    payload.schemaVersion !== 'loveca-ranked-rating-revision-token-v1' ||
    !Number.isFinite(new Date(payload.expiresAt).getTime())
  ) {
    throw revisionError(
      'RANKED_RATING_REVISION_PREVIEW_INVALID',
      '回算预览令牌版本无效，请重新预览',
      409
    );
  }
  if (new Date(payload.expiresAt).getTime() <= now.getTime()) {
    throw revisionError(
      'RANKED_RATING_REVISION_PREVIEW_EXPIRED',
      '回算预览已过期，请重新预览',
      409
    );
  }
  return payload;
}

function assertTokenMatchesPlan(
  payload: PreviewTokenPayload,
  plan: RankedRatingRevisionPlan
): void {
  if (
    payload.sourceAlgorithmVersion !== plan.snapshot.season.ratingAlgorithmVersion ||
    payload.sourceConfigHash !== hashValue(plan.snapshot.season.ratingConfig) ||
    payload.sourceLedgerRevision !== plan.snapshot.season.ledgerRevision ||
    payload.sourceCompetitiveEnvironmentId !== plan.snapshot.season.competitiveEnvironmentId ||
    payload.sourceRulesVersion !== plan.snapshot.season.rulesVersion ||
    payload.sourceCardCatalogVersion !== plan.snapshot.season.cardCatalogVersion ||
    payload.sourceCardCatalogHash !== plan.snapshot.season.cardCatalogHash ||
    payload.sourceDeckPolicyVersion !== plan.snapshot.season.deckPolicyVersion ||
    payload.targetConfigHash !== hashValue(plan.targetConfig)
  ) {
    throw revisionError(
      'RANKED_RATING_REVISION_PREVIEW_STALE',
      '赛季配置或积分流水已变化，请重新预览',
      409
    );
  }
}

function validatePreviewInput(input: RankedRatingRevisionPreviewInput): void {
  if (!input.seasonId.trim() || !input.adminUserId.trim()) {
    throw revisionError('RANKED_RATING_REVISION_INPUT_REQUIRED', '缺少赛季或管理员身份');
  }
  const reasonLength = input.reason.trim().length;
  if (reasonLength < 5 || reasonLength > 1_000) {
    throw revisionError('RANKED_RATING_REVISION_REASON_INVALID', '调整原因必须为 5–1000 个字符');
  }
}

function readStoredConfig(algorithmVersion: string, value: unknown): RankedRatingConfig {
  const stored = value as RankedRatingConfig;
  try {
    assertValidRankedRatingConfig(stored);
  } catch (error) {
    throw revisionError(
      'RANKED_RATING_REVISION_STORED_CONFIG_INVALID',
      `赛季冻结的评分配置无效：${error instanceof Error ? error.message : String(error)}`,
      500
    );
  }
  if (stored.algorithmVersion !== algorithmVersion || algorithmVersion.includes('SHADOW')) {
    throw revisionError(
      'RANKED_RATING_REVISION_STORED_CONFIG_MISMATCH',
      '赛季算法版本与冻结配置不一致',
      500
    );
  }
  return stored;
}

function normalizeRevisionId(value: string): string {
  const normalized = value.replaceAll('-', '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalized)) {
    throw revisionError('RANKED_RATING_REVISION_ID_INVALID', '无法生成合法的评分参数修订标识', 500);
  }
  return normalized;
}

function revisionEventId(revisionId: string, index: number): string {
  const suffix = createHash('sha256').update(`${revisionId}:${index}`).digest('hex').slice(0, 32);
  return `${suffix.slice(0, 8)}-${suffix.slice(8, 12)}-${suffix.slice(12, 16)}-${suffix.slice(16, 20)}-${suffix.slice(20)}`;
}

function hashValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJsonStringify(value)).digest('hex')}`;
}

function safeTextEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function assertRevisionChain(
  season: {
    readonly active_rating_revision_id: string | null;
    readonly rating_algorithm_version: string;
    readonly ledger_revision: number;
  },
  ratingConfig: RankedRatingConfig,
  revisions: readonly {
    readonly id: string;
    readonly revision_number: number;
    readonly source_revision_id: string | null;
    readonly source_algorithm_version: string;
    readonly target_algorithm_version: string;
    readonly source_ledger_revision: number;
    readonly target_ledger_revision: number;
    readonly source_config: unknown;
    readonly source_config_hash: string;
    readonly target_config: unknown;
    readonly target_config_hash: string;
  }[]
): void {
  let previous: (typeof revisions)[number] | undefined;
  for (const revision of revisions) {
    try {
      assertValidRankedRatingConfig(revision.source_config as RankedRatingConfig);
      assertValidRankedRatingConfig(revision.target_config as RankedRatingConfig);
    } catch {
      throw revisionError(
        'RANKED_RATING_REVISION_CHAIN_INVALID',
        '评分参数修订链包含无效配置，已拒绝继续回算',
        409
      );
    }
    const validLink = previous
      ? revision.revision_number === previous.revision_number + 1 &&
        revision.source_revision_id === previous.id &&
        revision.source_algorithm_version === previous.target_algorithm_version &&
        revision.source_ledger_revision >= previous.target_ledger_revision &&
        revision.source_config_hash === previous.target_config_hash
      : revision.revision_number === 1 &&
        revision.source_revision_id === null &&
        !isRankedRatingParameterRevisionConfig(revision.source_config as RankedRatingConfig);
    if (
      !validLink ||
      revision.source_config_hash !== hashValue(revision.source_config) ||
      (revision.source_config as RankedRatingConfig).algorithmVersion !==
        revision.source_algorithm_version ||
      revision.target_ledger_revision < revision.source_ledger_revision ||
      revision.target_config_hash !== hashValue(revision.target_config) ||
      (revision.target_config as RankedRatingConfig).algorithmVersion !==
        revision.target_algorithm_version
    ) {
      throw revisionError(
        'RANKED_RATING_REVISION_CHAIN_INVALID',
        '评分参数修订链完整性校验失败，已拒绝继续回算',
        409
      );
    }
    previous = revision;
  }
  const latest = revisions.at(-1);
  const currentMatches = latest
    ? season.active_rating_revision_id === latest.id &&
      season.rating_algorithm_version === latest.target_algorithm_version &&
      season.ledger_revision >= latest.target_ledger_revision &&
      hashValue(ratingConfig) === latest.target_config_hash
    : season.active_rating_revision_id === null &&
      !isRankedRatingParameterRevisionConfig(ratingConfig);
  if (!currentMatches) {
    throw revisionError(
      'RANKED_RATING_REVISION_CHAIN_INVALID',
      '当前赛季指向与评分参数修订链不一致，已拒绝继续回算',
      409
    );
  }
}

function previewSummary(
  preview: Omit<RankedRatingRevisionPreview, 'previewToken'> | RankedRatingRevisionPreview
): Readonly<Record<string, unknown>> {
  return {
    sourceAlgorithmVersion: preview.sourceAlgorithmVersion,
    targetAlgorithmVersion: preview.targetAlgorithmVersion,
    sourceLedgerRevision: preview.sourceLedgerRevision,
    projectedLedgerRevision: preview.projectedLedgerRevision,
    materializedMatchCount: preview.materializedMatchCount,
    affectedMatchCount: preview.affectedMatchCount,
    affectedPlayerCount: preview.affectedPlayerCount,
    leaderboardEnteredCount: preview.leaderboardEnteredCount,
    leaderboardLeftCount: preview.leaderboardLeftCount,
    seedDeviationClampCount: preview.seedDeviationClampCount,
    maximumAbsoluteRatingChange: preview.maximumAbsoluteRatingChange,
    maximumAbsoluteRankChange: preview.maximumAbsoluteRankChange,
    maximumAbsolutePerMatchDeltaChange: preview.maximumAbsolutePerMatchDeltaChange,
    blockers: preview.blockers,
  };
}

function maximum(values: readonly number[]): number {
  return values.reduce((current, value) => Math.max(current, value), 0);
}

export class PostgresRankedRatingRevisionRepository implements RankedRatingRevisionRepository {
  constructor(private readonly client: PoolClient) {}

  async loadSnapshot(seasonId: string, lock: boolean): Promise<RankedRatingRevisionSnapshot> {
    const seasonResult = await this.client.query<{
      readonly id: string;
      readonly lifecycle: RankedRatingRevisionSeasonSnapshot['lifecycle'];
      readonly queue_admission: RankedRatingRevisionSeasonSnapshot['queueAdmission'];
      readonly competitive_environment_id: string;
      readonly rules_version: string;
      readonly card_catalog_version: string;
      readonly card_catalog_hash: string;
      readonly deck_policy_version: string;
      readonly rating_algorithm_version: string;
      readonly rating_config: unknown;
      readonly leaderboard_minimum_match_count: number;
      readonly ledger_revision: number;
      readonly active_rating_revision_id: string | null;
    }>(
      `SELECT id, lifecycle, queue_admission, competitive_environment_id,
              rules_version, card_catalog_version, card_catalog_hash, deck_policy_version,
              rating_algorithm_version, rating_config, leaderboard_minimum_match_count,
              ledger_revision, active_rating_revision_id
       FROM ranked_seasons
       WHERE id = $1${lock ? '\n       FOR UPDATE' : ''}`,
      [seasonId]
    );
    const seasonRow = seasonResult.rows[0];
    if (!seasonRow) {
      throw revisionError('RANKED_RATING_REVISION_SEASON_NOT_FOUND', '排位赛季不存在', 404);
    }
    const blockerResult = await this.client.query<{
      readonly pending_matches: number | string;
      readonly running_matches: number | string;
      readonly active_tickets: number | string;
      readonly active_reservations: number | string;
      readonly active_participations: number | string;
    }>(
      `SELECT
           (SELECT COUNT(*) FROM ranked_matches
            WHERE season_id = $1 AND rating_status = 'PENDING') AS pending_matches,
           (SELECT COUNT(*) FROM ranked_matches AS ranked_match
            JOIN match_records AS record ON record.match_id = ranked_match.match_id
            WHERE ranked_match.season_id = $1 AND record.status = 'IN_PROGRESS') AS running_matches,
           (SELECT COUNT(*) FROM public_table_tickets
            WHERE season_id = $1 AND queue_kind = 'RANKED'
              AND state IN ('WAITING', 'RESERVED')) AS active_tickets,
           (SELECT COUNT(*) FROM public_table_reservations
            WHERE season_id = $1 AND queue_kind = 'RANKED'
              AND (state IN ('PENDING_CONFIRMATION', 'CREATING_ROOM')
                   OR (state = 'MATCHED' AND match_id IS NULL))) AS active_reservations,
           (SELECT COUNT(*) FROM gameplay_participations AS participation
            LEFT JOIN public_table_tickets AS ticket ON ticket.id = participation.ticket_id
            LEFT JOIN ranked_matches AS ranked_match ON ranked_match.match_id = participation.match_id
            WHERE (ticket.season_id = $1 OR ranked_match.season_id = $1)
              AND participation.kind IN ('RANKED_QUEUE', 'ONLINE_ROOM', 'ONLINE_MATCH')) AS active_participations`,
      [seasonId]
    );
    const environmentResult = await this.client.query<{
      readonly rating_algorithm_version: string;
      readonly rules_version: string;
      readonly card_catalog_version: string;
      readonly card_catalog_hash: string;
      readonly deck_policy_version: string;
      readonly match_record_rules_version: string;
    }>(
      `SELECT ranked_match.rating_algorithm_version, ranked_match.rules_version,
                  ranked_match.card_catalog_version, ranked_match.card_catalog_hash,
                  ranked_match.deck_policy_version, record.rules_version AS match_record_rules_version
           FROM ranked_matches AS ranked_match
           JOIN match_records AS record ON record.match_id = ranked_match.match_id
           WHERE ranked_match.season_id = $1
           ORDER BY ranked_match.match_id${lock ? '\n           FOR UPDATE OF ranked_match, record' : ''}`,
      [seasonId]
    );
    const eventResult = await this.client.query<{
      readonly id: string;
      readonly event_sequence: number;
      readonly event_type: RankedRatingEvent['eventType'];
      readonly match_id: string;
      readonly target_event_id: string | null;
      readonly first_user_id: string;
      readonly second_user_id: string;
      readonly winner_seat: RankedRatingEvent['winnerSeat'];
      readonly result_type: RankedRatingEvent['resultType'];
      readonly rated_at: Date | string;
      readonly algorithm_version: string;
    }>(
      `SELECT id, event_sequence, event_type, match_id, target_event_id,
                  first_user_id, second_user_id, winner_seat, result_type,
                  rated_at, algorithm_version
           FROM ranked_rating_events
           WHERE season_id = $1
           ORDER BY event_sequence${lock ? '\n           FOR UPDATE' : ''}`,
      [seasonId]
    );
    const seedResult = await this.client.query<{
      readonly user_id: string;
      readonly rating: number;
      readonly rating_deviation: number;
    }>(
      `SELECT user_id, rating, rating_deviation
           FROM ranked_player_seeds
           WHERE season_id = $1
           ORDER BY user_id`,
      [seasonId]
    );
    const ratingResult = await this.client.query<{
      readonly user_id: string;
      readonly username: string | null;
      readonly display_name: string | null;
      readonly rating: number;
      readonly rating_deviation: number;
      readonly rated_match_count: number;
      readonly last_rated_at: Date | string | null;
    }>(
      `SELECT rating.user_id, profile.username, profile.display_name,
                  rating.rating, rating.rating_deviation,
                  rating.rated_match_count, rating.last_rated_at
           FROM ranked_player_ratings AS rating
           LEFT JOIN profiles AS profile ON profile.id = rating.user_id
           WHERE rating.season_id = $1
           ORDER BY rating.user_id${lock ? '\n           FOR UPDATE OF rating' : ''}`,
      [seasonId]
    );
    const revisionResult = await this.client.query<{
      readonly id: string;
      readonly revision_number: number;
      readonly source_revision_id: string | null;
      readonly source_algorithm_version: string;
      readonly target_algorithm_version: string;
      readonly source_ledger_revision: number;
      readonly target_ledger_revision: number;
      readonly source_config: unknown;
      readonly source_config_hash: string;
      readonly target_config: unknown;
      readonly target_config_hash: string;
    }>(
      `SELECT id, revision_number, source_revision_id,
                  source_algorithm_version, target_algorithm_version,
                  source_ledger_revision, target_ledger_revision,
                  source_config, source_config_hash, target_config, target_config_hash
           FROM ranked_rating_revisions
           WHERE season_id = $1
           ORDER BY revision_number${lock ? '\n           FOR UPDATE' : ''}`,
      [seasonId]
    );
    let matchEnvironmentMismatches = 0;
    let matchRecordRulesMismatches = 0;
    for (const row of environmentResult.rows) {
      if (
        row.rating_algorithm_version !== seasonRow.rating_algorithm_version ||
        row.rules_version !== seasonRow.rules_version ||
        row.card_catalog_version !== seasonRow.card_catalog_version ||
        row.card_catalog_hash !== seasonRow.card_catalog_hash ||
        row.deck_policy_version !== seasonRow.deck_policy_version
      ) {
        matchEnvironmentMismatches += 1;
      }
      if (row.match_record_rules_version !== row.rules_version) {
        matchRecordRulesMismatches += 1;
      }
    }
    const blocker = blockerResult.rows[0]!;
    const ratingConfig = readStoredConfig(
      seasonRow.rating_algorithm_version,
      seasonRow.rating_config
    );
    assertRevisionChain(seasonRow, ratingConfig, revisionResult.rows);
    return {
      season: {
        id: seasonRow.id,
        lifecycle: seasonRow.lifecycle,
        queueAdmission: seasonRow.queue_admission,
        competitiveEnvironmentId: seasonRow.competitive_environment_id,
        rulesVersion: seasonRow.rules_version,
        cardCatalogVersion: seasonRow.card_catalog_version,
        cardCatalogHash: seasonRow.card_catalog_hash,
        deckPolicyVersion: seasonRow.deck_policy_version,
        ratingAlgorithmVersion: seasonRow.rating_algorithm_version,
        ratingConfig,
        leaderboardMinimumMatchCount: seasonRow.leaderboard_minimum_match_count,
        ledgerRevision: seasonRow.ledger_revision,
        activeRatingRevisionId: seasonRow.active_rating_revision_id,
      },
      blockers: {
        pendingMatches: Number(blocker.pending_matches),
        runningMatches: Number(blocker.running_matches),
        activeTickets: Number(blocker.active_tickets),
        activeReservations: Number(blocker.active_reservations),
        activeParticipations: Number(blocker.active_participations),
        matchEnvironmentMismatches,
        matchRecordRulesMismatches,
      },
      events: eventResult.rows.map((row) => ({
        eventId: row.id,
        eventSequence: row.event_sequence,
        eventType: row.event_type,
        matchId: row.match_id,
        targetEventId: row.target_event_id,
        firstUserId: row.first_user_id,
        secondUserId: row.second_user_id,
        winnerSeat: row.winner_seat,
        resultType: row.result_type,
        ratedAt: new Date(row.rated_at),
        algorithmVersion: row.algorithm_version,
      })),
      seeds: new Map(
        seedResult.rows.map((row) => [
          row.user_id,
          {
            rating: Number(row.rating),
            ratingDeviation: Number(row.rating_deviation),
            ratedMatchCount: 0,
            lastRatedAt: null,
          },
        ])
      ),
      currentRatings: new Map(
        ratingResult.rows.map((row) => [
          row.user_id,
          {
            rating: Number(row.rating),
            ratingDeviation: Number(row.rating_deviation),
            ratedMatchCount: row.rated_match_count,
            lastRatedAt: row.last_rated_at === null ? null : new Date(row.last_rated_at),
          },
        ])
      ),
      playerNames: new Map(
        ratingResult.rows.map((row) => [
          row.user_id,
          row.display_name?.trim() || row.username?.trim() || row.user_id,
        ])
      ),
      nextRevisionNumber: (revisionResult.rows.at(-1)?.revision_number ?? 0) + 1,
    };
  }

  async applyPlan(plan: RankedRatingRevisionPlan, adminUserId: string): Promise<void> {
    const revisionUuid = toUuid(plan.revisionId);
    await this.client.query(
      `INSERT INTO ranked_rating_revisions (
         id, season_id, revision_number, source_revision_id,
         source_algorithm_version, target_algorithm_version,
         source_config, target_config, source_config_hash, target_config_hash,
         target_competitive_environment_id, source_ledger_revision, target_ledger_revision,
         reason, preview_summary, applied_by, applied_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10,
         $11, $12, $13, $14, $15::jsonb, $16, NOW()
       )`,
      [
        revisionUuid,
        plan.snapshot.season.id,
        plan.snapshot.nextRevisionNumber,
        plan.snapshot.season.activeRatingRevisionId,
        plan.snapshot.season.ratingAlgorithmVersion,
        plan.targetConfig.algorithmVersion,
        JSON.stringify(plan.snapshot.season.ratingConfig),
        JSON.stringify(plan.targetConfig),
        hashValue(plan.snapshot.season.ratingConfig),
        hashValue(plan.targetConfig),
        plan.targetCompetitiveEnvironmentId,
        plan.snapshot.season.ledgerRevision,
        plan.preview.projectedLedgerRevision,
        plan.reason,
        JSON.stringify(previewSummary(plan.preview)),
        adminUserId,
      ]
    );
    for (const directive of plan.directives) {
      await this.client.query(
        `INSERT INTO ranked_rating_events (
           id, season_id, event_sequence, event_type, idempotency_key,
           match_id, target_event_id, first_user_id, second_user_id,
           winner_seat, result_type, rated_at, algorithm_version, reason, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          directive.eventId,
          plan.snapshot.season.id,
          directive.eventSequence,
          directive.eventType,
          `rating-revision:${plan.revisionId}:${directive.matchId}`,
          directive.matchId,
          directive.targetEventId,
          directive.firstUserId,
          directive.secondUserId,
          directive.winnerSeat,
          directive.resultType,
          directive.ratedAt,
          directive.algorithmVersion,
          plan.reason,
          adminUserId,
        ]
      );
    }
    const snapshotEventId = plan.directives.at(-1)?.eventId;
    if (snapshotEventId) {
      for (const step of plan.materialization.steps) {
        await insertMaterializationStep(this.client, snapshotEventId, step);
      }
    }
    await this.client.query('DELETE FROM ranked_player_ratings WHERE season_id = $1', [
      plan.snapshot.season.id,
    ]);
    for (const [userId, state] of plan.materialization.players) {
      await this.client.query(
        `INSERT INTO ranked_player_ratings (
           season_id, user_id, rating, rating_deviation,
           rated_match_count, last_rated_at, ledger_revision, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          plan.snapshot.season.id,
          userId,
          state.rating,
          state.ratingDeviation,
          state.ratedMatchCount,
          state.lastRatedAt,
          plan.preview.projectedLedgerRevision,
        ]
      );
    }
    await this.client.query(
      `UPDATE ranked_matches
       SET rating_algorithm_version = $2,
           updated_at = NOW()
       WHERE season_id = $1`,
      [plan.snapshot.season.id, plan.targetConfig.algorithmVersion]
    );
    const updated = await this.client.query(
      `UPDATE ranked_seasons
       SET competitive_environment_id = $2,
           rating_algorithm_version = $3,
           rating_config = $4::jsonb,
           leaderboard_minimum_match_count = $5,
           ledger_revision = $6,
           active_rating_revision_id = $7,
           updated_by = $8,
           updated_at = NOW()
       WHERE id = $1
         AND lifecycle = 'ACTIVE'
         AND queue_admission = 'PAUSED'
         AND rating_algorithm_version = $9
         AND ledger_revision = $10`,
      [
        plan.snapshot.season.id,
        plan.targetCompetitiveEnvironmentId,
        plan.targetConfig.algorithmVersion,
        JSON.stringify(plan.targetConfig),
        plan.targetConfig.placementMatchCount,
        plan.preview.projectedLedgerRevision,
        revisionUuid,
        adminUserId,
        plan.snapshot.season.ratingAlgorithmVersion,
        plan.snapshot.season.ledgerRevision,
      ]
    );
    if (updated.rowCount !== 1) {
      throw revisionError(
        'RANKED_RATING_REVISION_APPLY_CONFLICT',
        '赛季在回算事务中发生变化，本次操作已回滚',
        409
      );
    }
  }

  async listHistory(seasonId: string): Promise<readonly RankedRatingRevisionHistoryItem[]> {
    const result = await this.client.query<{
      readonly id: string;
      readonly revision_number: number;
      readonly source_algorithm_version: string;
      readonly target_algorithm_version: string;
      readonly source_config: unknown;
      readonly target_config: unknown;
      readonly source_ledger_revision: number;
      readonly target_ledger_revision: number;
      readonly reason: string;
      readonly preview_summary: Readonly<Record<string, unknown>>;
      readonly applied_by: string | null;
      readonly applied_at: Date | string;
      readonly current: boolean;
    }>(
      `SELECT revision.id, revision.revision_number,
              revision.source_algorithm_version, revision.target_algorithm_version,
              revision.source_config, revision.target_config,
              revision.source_ledger_revision, revision.target_ledger_revision,
              revision.reason, revision.preview_summary, revision.applied_by,
              revision.applied_at,
              season.active_rating_revision_id = revision.id AS current
       FROM ranked_rating_revisions AS revision
       JOIN ranked_seasons AS season ON season.id = revision.season_id
       WHERE revision.season_id = $1
       ORDER BY revision.revision_number DESC`,
      [seasonId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      revisionNumber: row.revision_number,
      sourceAlgorithmVersion: row.source_algorithm_version,
      targetAlgorithmVersion: row.target_algorithm_version,
      sourceConfig: row.source_config as RankedRatingConfig,
      targetConfig: row.target_config as RankedRatingConfig,
      sourceLedgerRevision: row.source_ledger_revision,
      targetLedgerRevision: row.target_ledger_revision,
      reason: row.reason,
      previewSummary: row.preview_summary,
      appliedBy: row.applied_by,
      appliedAt: new Date(row.applied_at),
      current: row.current,
    }));
  }
}

async function insertMaterializationStep(
  client: PoolClient,
  eventId: string,
  step: RankedRatingMaterializationStep
): Promise<void> {
  await client.query(
    `INSERT INTO ranked_rating_event_steps (
       event_id, step_index, source_result_event_id, match_id,
       first_user_id, second_user_id, winner_seat, rated_at,
       first_before_rating, first_before_deviation, first_before_match_count,
       first_before_last_rated_at, first_after_rating, first_after_deviation,
       first_after_match_count, first_after_last_rated_at,
       second_before_rating, second_before_deviation, second_before_match_count,
       second_before_last_rated_at, second_after_rating, second_after_deviation,
       second_after_match_count, second_after_last_rated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14, $15, $16,
       $17, $18, $19, $20, $21, $22, $23, $24
     )`,
    [
      eventId,
      step.stepIndex,
      step.sourceResultEventId,
      step.matchId,
      step.firstUserId,
      step.secondUserId,
      step.winnerSeat,
      step.ratedAt,
      step.firstBefore.rating,
      step.firstBefore.ratingDeviation,
      step.firstBefore.ratedMatchCount,
      step.firstBefore.lastRatedAt,
      step.firstAfter.rating,
      step.firstAfter.ratingDeviation,
      step.firstAfter.ratedMatchCount,
      step.firstAfter.lastRatedAt,
      step.secondBefore.rating,
      step.secondBefore.ratingDeviation,
      step.secondBefore.ratedMatchCount,
      step.secondBefore.lastRatedAt,
      step.secondAfter.rating,
      step.secondAfter.ratingDeviation,
      step.secondAfter.ratedMatchCount,
      step.secondAfter.lastRatedAt,
    ]
  );
}

async function withSerializableRevisionTransaction<T>(
  callback: (repository: RankedRatingRevisionRepository) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const result = await callback(new PostgresRankedRatingRevisionRepository(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function toUuid(value: string): string {
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function revisionError(
  code: string,
  message: string,
  statusCode = 400
): RankedRatingRevisionServiceError {
  return new RankedRatingRevisionServiceError(code, message, statusCode);
}

function writeRevisionAudit(event: RankedRatingRevisionAuditEvent): void {
  console.info(
    JSON.stringify({
      scope: 'ranked_rating_revision',
      occurredAt: new Date().toISOString(),
      ...event,
    })
  );
}

export const rankedRatingRevisionService = new RankedRatingRevisionService();
