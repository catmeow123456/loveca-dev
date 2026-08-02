import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import {
  GLICKO1_PER_MATCH_V2,
  GLICKO1_PER_MATCH_V3,
  assertValidGlicko1Config,
  type Glicko1Config,
  type GlickoRatingState,
} from '../rating/glicko.js';
import {
  buildRankedCompetitiveEnvironmentIdentity,
  type RankedCardCatalogIdentity,
} from '../rating/ranked-environment.js';
import {
  materializeRankedRatingLedger,
  resolveEffectiveRankedResults,
  type RankedRatingEvent,
  type RankedRatingMaterialization,
  type RankedRatingMaterializationStep,
} from '../rating/ranked-ledger.js';

const MIGRATION_REASON = 'Active season rating algorithm migration: GLICKO1_PER_MATCH_V2 -> V3';

export interface RankedV3MigrationInput {
  readonly seasonId: string;
  readonly cardCatalog: RankedCardCatalogIdentity;
  readonly apply: boolean;
  readonly expectedLedgerRevision?: number;
  readonly adminUserId?: string;
}

export interface RankedV3MigrationBlockers {
  readonly pendingMatches: number;
  readonly activeTickets: number;
  readonly activeReservations: number;
  readonly activeParticipations: number;
  readonly rankedMatchEnvironmentMismatches: number;
  readonly matchRecordRulesMismatches: number;
}

export interface RankedV3MigrationFrozenEnvironment {
  readonly ratingAlgorithmVersion: string;
  readonly rulesVersion: string;
  readonly cardCatalogVersion: string;
  readonly cardCatalogHash: string;
  readonly deckPolicyVersion: string;
}

export interface RankedV3MigrationMatchEnvironmentRecord extends RankedV3MigrationFrozenEnvironment {
  readonly matchRecordRulesVersion: string;
}

export interface RankedV3MigrationPlayerChange {
  readonly userId: string;
  readonly before: GlickoRatingState | null;
  readonly after: GlickoRatingState | null;
  readonly ratingDelta: number;
  readonly ratingDeviationDelta: number;
  readonly ratedMatchCountDelta: number;
}

export interface RankedV3MigrationReport {
  readonly schemaVersion: 'loveca-ranked-v3-migration-v1';
  readonly mode: 'DRY_RUN' | 'APPLY';
  readonly alreadyApplied: boolean;
  readonly seasonId: string;
  readonly lifecycle: 'ACTIVE' | 'FINALIZING';
  readonly sourceAlgorithmVersion: string;
  readonly targetAlgorithmVersion: typeof GLICKO1_PER_MATCH_V3.algorithmVersion;
  readonly sourceLedgerRevision: number;
  readonly targetLedgerRevision: number;
  readonly existingEventCount: number;
  readonly appendedDirectiveCount: number;
  readonly materializedMatchCount: number;
  readonly affectedPlayerCount: number;
  readonly blockers: RankedV3MigrationBlockers;
  readonly targetCompetitiveEnvironmentId: string;
  readonly playerChanges: readonly RankedV3MigrationPlayerChange[];
}

interface RankedV3MigrationSeason {
  readonly id: string;
  readonly lifecycle: 'DRAFT' | 'ACTIVE' | 'FINALIZING' | 'CLOSED';
  readonly queueAdmission: 'OPEN' | 'PAUSED';
  readonly competitiveEnvironmentId: string;
  readonly rulesVersion: string;
  readonly cardCatalogVersion: string;
  readonly cardCatalogHash: string;
  readonly deckPolicyVersion: string;
  readonly ratingAlgorithmVersion: string;
  readonly ratingConfig: Glicko1Config;
  readonly ledgerRevision: number;
}

export interface RankedV3MigrationSnapshot {
  readonly season: RankedV3MigrationSeason;
  readonly blockers: RankedV3MigrationBlockers;
  readonly events: readonly RankedRatingEvent[];
  readonly seeds: ReadonlyMap<string, GlickoRatingState>;
  readonly currentRatings: ReadonlyMap<string, GlickoRatingState>;
}

export interface RankedV3MigrationPlan {
  readonly snapshot: RankedV3MigrationSnapshot;
  readonly targetConfig: Glicko1Config;
  readonly targetCompetitiveEnvironmentId: string;
  readonly directives: readonly RankedRatingEvent[];
  readonly materialization: RankedRatingMaterialization;
  readonly report: RankedV3MigrationReport;
}

export interface RankedV3MigrationRepository {
  loadSnapshot(seasonId: string, lock: boolean): Promise<RankedV3MigrationSnapshot>;
  applyPlan(
    plan: RankedV3MigrationPlan,
    input: Required<Pick<RankedV3MigrationInput, 'seasonId' | 'adminUserId'>> & {
      readonly targetCompetitiveEnvironmentId: string;
    }
  ): Promise<void>;
}

interface RankedV3MigrationServiceDeps {
  readonly transaction?: <T>(
    callback: (repository: RankedV3MigrationRepository) => Promise<T>
  ) => Promise<T>;
  readonly createId?: () => string;
}

export class RankedV3MigrationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'RankedV3MigrationError';
  }
}

export class RankedV3MigrationService {
  private readonly transaction: <T>(
    callback: (repository: RankedV3MigrationRepository) => Promise<T>
  ) => Promise<T>;
  private readonly createId: () => string;

  constructor(deps: RankedV3MigrationServiceDeps = {}) {
    this.transaction = deps.transaction ?? withSerializableMigrationTransaction;
    this.createId = deps.createId ?? randomUUID;
  }

  async migrate(input: RankedV3MigrationInput): Promise<RankedV3MigrationReport> {
    validateInput(input);
    return this.transaction(async (repository) => {
      const snapshot = await repository.loadSnapshot(input.seasonId, input.apply);
      const plan = buildPlan(snapshot, input, this.createId);
      if (!input.apply || plan.report.alreadyApplied) {
        return plan.report;
      }
      if (input.expectedLedgerRevision !== snapshot.season.ledgerRevision) {
        throw migrationError(
          'RANKED_V3_MIGRATION_REVISION_MISMATCH',
          `流水 revision 已变化；期望 ${input.expectedLedgerRevision ?? '未提供'}，实际 ${snapshot.season.ledgerRevision}`
        );
      }
      await repository.applyPlan(plan, {
        seasonId: input.seasonId,
        adminUserId: input.adminUserId!,
        targetCompetitiveEnvironmentId: plan.targetCompetitiveEnvironmentId,
      });
      return plan.report;
    });
  }
}

function buildPlan(
  snapshot: RankedV3MigrationSnapshot,
  input: RankedV3MigrationInput,
  createId: () => string
): RankedV3MigrationPlan {
  const { season } = snapshot;
  if (season.lifecycle !== 'ACTIVE' && season.lifecycle !== 'FINALIZING') {
    throw migrationError('RANKED_V3_MIGRATION_LIFECYCLE_INVALID', '只能迁移进行中或收口中的赛季');
  }
  if (season.queueAdmission !== 'PAUSED') {
    throw migrationError('RANKED_V3_MIGRATION_QUEUE_OPEN', '迁移前必须暂停排位候场');
  }
  assertNoBlockers(snapshot.blockers);
  const sourceConfig = normalizeMigrationSourceConfig(
    season.ratingAlgorithmVersion,
    season.ratingConfig
  );
  if (sourceConfig.algorithmVersion !== season.ratingAlgorithmVersion) {
    throw migrationError(
      'RANKED_V3_MIGRATION_STORED_CONFIG_MISMATCH',
      '赛季的算法版本与冻结配置不一致'
    );
  }
  assertLedgerRevision(snapshot.events, season.ledgerRevision);

  const targetConfig: Glicko1Config = {
    ...GLICKO1_PER_MATCH_V3,
    softResetMode: sourceConfig.softResetMode,
    softResetCenter: sourceConfig.softResetCenter,
    softResetRetention: sourceConfig.softResetRetention,
    softResetMinimumDeviation: sourceConfig.softResetMinimumDeviation,
  };
  assertValidGlicko1Config(targetConfig);
  if (
    input.cardCatalog.cardCatalogVersion !== season.cardCatalogVersion ||
    input.cardCatalog.cardCatalogHash !== season.cardCatalogHash
  ) {
    throw migrationError(
      'RANKED_V3_MIGRATION_CARD_CATALOG_MISMATCH',
      '当前发布卡池与赛季冻结卡池不一致'
    );
  }
  const targetEnvironment = buildRankedCompetitiveEnvironmentIdentity(
    input.cardCatalog,
    targetConfig,
    {
      rulesVersion: season.rulesVersion,
      deckPolicyVersion: season.deckPolicyVersion,
    }
  );

  if (season.ratingAlgorithmVersion === GLICKO1_PER_MATCH_V3.algorithmVersion) {
    if (season.competitiveEnvironmentId !== targetEnvironment.competitiveEnvironmentId) {
      throw migrationError(
        'RANKED_V3_MIGRATION_ALREADY_APPLIED_ENVIRONMENT_MISMATCH',
        '赛季已标记为 V3，但竞技环境身份与 V3 冻结配置不一致'
      );
    }
    const materialization = materializeRankedRatingLedger(
      snapshot.events,
      targetConfig,
      snapshot.seeds
    );
    assertProjectionMatches(snapshot.currentRatings, materialization.players);
    return {
      snapshot,
      targetConfig,
      targetCompetitiveEnvironmentId: targetEnvironment.competitiveEnvironmentId,
      directives: [],
      materialization,
      report: createReport(
        snapshot,
        input,
        targetEnvironment.competitiveEnvironmentId,
        [],
        materialization,
        true
      ),
    };
  }
  if (season.ratingAlgorithmVersion !== GLICKO1_PER_MATCH_V2.algorithmVersion) {
    throw migrationError(
      'RANKED_V3_MIGRATION_SOURCE_ALGORITHM_UNSUPPORTED',
      `只支持从 ${GLICKO1_PER_MATCH_V2.algorithmVersion} 迁移`
    );
  }

  assertV2ConfigUnchanged(sourceConfig);
  resolveEffectiveRankedResults(snapshot.events, sourceConfig);
  const sourceMaterialization = materializeRankedRatingLedger(
    snapshot.events,
    sourceConfig,
    snapshot.seeds
  );
  assertProjectionMatches(snapshot.currentRatings, sourceMaterialization.players);
  const latestDirectives = collectLatestDirectives(snapshot.events);
  const directives = latestDirectives.map((latest, index): RankedRatingEvent => ({
    eventId: createId(),
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
  return {
    snapshot,
    targetConfig,
    targetCompetitiveEnvironmentId: targetEnvironment.competitiveEnvironmentId,
    directives,
    materialization,
    report: createReport(
      snapshot,
      input,
      targetEnvironment.competitiveEnvironmentId,
      directives,
      materialization,
      false
    ),
  };
}

function createReport(
  snapshot: RankedV3MigrationSnapshot,
  input: RankedV3MigrationInput,
  targetCompetitiveEnvironmentId: string,
  directives: readonly RankedRatingEvent[],
  materialization: RankedRatingMaterialization,
  alreadyApplied: boolean
): RankedV3MigrationReport {
  const playerChanges = comparePlayers(snapshot.currentRatings, materialization.players);
  return {
    schemaVersion: 'loveca-ranked-v3-migration-v1',
    mode: input.apply ? 'APPLY' : 'DRY_RUN',
    alreadyApplied,
    seasonId: snapshot.season.id,
    lifecycle: snapshot.season.lifecycle as 'ACTIVE' | 'FINALIZING',
    sourceAlgorithmVersion: snapshot.season.ratingAlgorithmVersion,
    targetAlgorithmVersion: GLICKO1_PER_MATCH_V3.algorithmVersion,
    sourceLedgerRevision: snapshot.season.ledgerRevision,
    targetLedgerRevision: snapshot.season.ledgerRevision + directives.length,
    existingEventCount: snapshot.events.length,
    appendedDirectiveCount: directives.length,
    materializedMatchCount: materialization.steps.length,
    affectedPlayerCount: playerChanges.length,
    blockers: snapshot.blockers,
    targetCompetitiveEnvironmentId,
    playerChanges,
  };
}

function collectLatestDirectives(
  events: readonly RankedRatingEvent[]
): readonly RankedRatingEvent[] {
  const latestByMatch = new Map<string, RankedRatingEvent>();
  for (const event of [...events].sort((a, b) => a.eventSequence - b.eventSequence)) {
    latestByMatch.set(event.matchId, event);
  }
  return [...latestByMatch.values()].sort(
    (a, b) =>
      a.ratedAt.getTime() - b.ratedAt.getTime() ||
      compareText(a.matchId, b.matchId) ||
      a.eventSequence - b.eventSequence
  );
}

function comparePlayers(
  before: ReadonlyMap<string, GlickoRatingState>,
  after: ReadonlyMap<string, GlickoRatingState>
): readonly RankedV3MigrationPlayerChange[] {
  const userIds = new Set([...before.keys(), ...after.keys()]);
  return [...userIds]
    .sort(compareText)
    .map((userId) => {
      const oldState = before.get(userId) ?? null;
      const newState = after.get(userId) ?? null;
      return {
        userId,
        before: oldState,
        after: newState,
        ratingDelta: (newState?.rating ?? 0) - (oldState?.rating ?? 0),
        ratingDeviationDelta: (newState?.ratingDeviation ?? 0) - (oldState?.ratingDeviation ?? 0),
        ratedMatchCountDelta: (newState?.ratedMatchCount ?? 0) - (oldState?.ratedMatchCount ?? 0),
      };
    })
    .filter((change) => !statesEqual(change.before, change.after));
}

function assertProjectionMatches(
  current: ReadonlyMap<string, GlickoRatingState>,
  projected: ReadonlyMap<string, GlickoRatingState>
): void {
  if (comparePlayers(current, projected).length > 0) {
    throw migrationError(
      'RANKED_V3_MIGRATION_PROJECTION_MISMATCH',
      '当前积分投影与冻结算法的流水重放不一致'
    );
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

function assertNoBlockers(blockers: RankedV3MigrationBlockers): void {
  const activeCount =
    blockers.pendingMatches +
    blockers.activeTickets +
    blockers.activeReservations +
    blockers.activeParticipations +
    blockers.rankedMatchEnvironmentMismatches +
    blockers.matchRecordRulesMismatches;
  if (activeCount > 0) {
    throw migrationError(
      'RANKED_V3_MIGRATION_BLOCKED',
      `存在未清空的排位运行状态或冻结环境异常：${JSON.stringify(blockers)}`
    );
  }
}

export function countRankedV3MigrationEnvironmentMismatches(
  records: readonly RankedV3MigrationMatchEnvironmentRecord[],
  season: RankedV3MigrationFrozenEnvironment
): Pick<
  RankedV3MigrationBlockers,
  'rankedMatchEnvironmentMismatches' | 'matchRecordRulesMismatches'
> {
  let rankedMatchEnvironmentMismatches = 0;
  let matchRecordRulesMismatches = 0;
  for (const record of records) {
    if (
      record.ratingAlgorithmVersion !== season.ratingAlgorithmVersion ||
      record.rulesVersion !== season.rulesVersion ||
      record.cardCatalogVersion !== season.cardCatalogVersion ||
      record.cardCatalogHash !== season.cardCatalogHash ||
      record.deckPolicyVersion !== season.deckPolicyVersion
    ) {
      rankedMatchEnvironmentMismatches += 1;
    }
    if (record.matchRecordRulesVersion !== season.rulesVersion) {
      matchRecordRulesMismatches += 1;
    }
  }
  return { rankedMatchEnvironmentMismatches, matchRecordRulesMismatches };
}

function assertLedgerRevision(events: readonly RankedRatingEvent[], revision: number): void {
  const maximumSequence = events.reduce(
    (maximum, event) => Math.max(maximum, event.eventSequence),
    0
  );
  if (maximumSequence !== revision || events.length !== revision) {
    throw migrationError(
      'RANKED_V3_MIGRATION_LEDGER_REVISION_INVALID',
      `流水 revision ${revision} 与 ${events.length} 条事件/最大序号 ${maximumSequence} 不一致`
    );
  }
}

function assertV2ConfigUnchanged(config: Glicko1Config): void {
  const mutableSoftResetKeys = new Set([
    'softResetMode',
    'softResetCenter',
    'softResetRetention',
    'softResetMinimumDeviation',
  ]);
  for (const key of Object.keys(GLICKO1_PER_MATCH_V2) as (keyof Glicko1Config)[]) {
    if (!mutableSoftResetKeys.has(key) && config[key] !== GLICKO1_PER_MATCH_V2[key]) {
      throw migrationError(
        'RANKED_V3_MIGRATION_SOURCE_CONFIG_DRIFTED',
        `V2 冻结配置 ${key} 已偏离发布值`
      );
    }
  }
}

/**
 * The running S1 V2 row predates the persisted ratingScale field. Only this
 * exact stopped-migration boundary may hydrate that one legacy omission.
 * Normal season/runtime readers continue to require a complete frozen config.
 */
function normalizeMigrationSourceConfig(
  algorithmVersion: string,
  value: Glicko1Config
): Glicko1Config {
  const record = value as Glicko1Config & { readonly ratingScale?: number };
  const normalized =
    algorithmVersion === GLICKO1_PER_MATCH_V2.algorithmVersion &&
    !Object.prototype.hasOwnProperty.call(record, 'ratingScale')
      ? { ...record, ratingScale: GLICKO1_PER_MATCH_V2.ratingScale }
      : record;
  try {
    assertValidGlicko1Config(normalized);
  } catch (error) {
    throw migrationError(
      'RANKED_V3_MIGRATION_STORED_CONFIG_INVALID',
      `赛季冻结评分配置无效：${error instanceof Error ? error.message : String(error)}`
    );
  }
  return normalized;
}

function validateInput(input: RankedV3MigrationInput): void {
  if (input.seasonId.trim().length === 0) {
    throw migrationError('RANKED_V3_MIGRATION_SEASON_REQUIRED', '缺少赛季 ID');
  }
  if (
    !/^sha256:[0-9a-f]{64}$/.test(input.cardCatalog.cardCatalogHash) ||
    input.cardCatalog.cardCatalogVersion.trim().length === 0 ||
    !Number.isInteger(input.cardCatalog.publishedCardCount) ||
    input.cardCatalog.publishedCardCount < 0
  ) {
    throw migrationError('RANKED_V3_MIGRATION_ENVIRONMENT_INVALID', '当前发布卡池身份无效');
  }
  if (input.apply) {
    if (!Number.isInteger(input.expectedLedgerRevision) || input.expectedLedgerRevision! < 0) {
      throw migrationError(
        'RANKED_V3_MIGRATION_EXPECTED_REVISION_REQUIRED',
        'apply 必须显式提供 dry-run 得到的 expectedLedgerRevision'
      );
    }
    if (!input.adminUserId?.trim()) {
      throw migrationError('RANKED_V3_MIGRATION_ADMIN_REQUIRED', 'apply 必须提供管理员用户 ID');
    }
  }
}

export class PostgresRankedV3MigrationRepository implements RankedV3MigrationRepository {
  constructor(private readonly client: PoolClient) {}

  async loadSnapshot(seasonId: string, lock: boolean): Promise<RankedV3MigrationSnapshot> {
    const seasonResult = await this.client.query<{
      readonly id: string;
      readonly lifecycle: RankedV3MigrationSeason['lifecycle'];
      readonly queue_admission: RankedV3MigrationSeason['queueAdmission'];
      readonly competitive_environment_id: string;
      readonly rules_version: string;
      readonly card_catalog_version: string;
      readonly card_catalog_hash: string;
      readonly deck_policy_version: string;
      readonly rating_algorithm_version: string;
      readonly rating_config: unknown;
      readonly ledger_revision: number;
    }>(
      `SELECT id, lifecycle, queue_admission, competitive_environment_id,
              rules_version, card_catalog_version, card_catalog_hash, deck_policy_version,
              rating_algorithm_version, rating_config, ledger_revision
       FROM ranked_seasons
       WHERE id = $1${lock ? '\n       FOR UPDATE' : ''}`,
      [seasonId]
    );
    const seasonRow = seasonResult.rows[0];
    if (!seasonRow) {
      throw migrationError('RANKED_V3_MIGRATION_SEASON_NOT_FOUND', '排位赛季不存在');
    }
    const ratingConfig = seasonRow.rating_config as Glicko1Config;
    const [blockerResult, environmentResult, eventResult, seedResult, ratingResult] =
      await Promise.all([
        this.client.query<{
          readonly pending_matches: string | number;
          readonly active_tickets: string | number;
          readonly active_reservations: string | number;
          readonly active_participations: string | number;
        }>(
          `SELECT
           (SELECT COUNT(*) FROM ranked_matches
            WHERE season_id = $1 AND rating_status = 'PENDING') AS pending_matches,
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
        ),
        this.client.query<{
          readonly rating_algorithm_version: string;
          readonly rules_version: string;
          readonly card_catalog_version: string;
          readonly card_catalog_hash: string;
          readonly deck_policy_version: string;
          readonly match_record_rules_version: string;
        }>(
          `SELECT ranked_match.rating_algorithm_version,
                ranked_match.rules_version,
                ranked_match.card_catalog_version,
                ranked_match.card_catalog_hash,
                ranked_match.deck_policy_version,
                record.rules_version AS match_record_rules_version
         FROM ranked_matches AS ranked_match
         JOIN match_records AS record ON record.match_id = ranked_match.match_id
         WHERE ranked_match.season_id = $1
         ORDER BY ranked_match.match_id${lock ? '\n         FOR UPDATE OF ranked_match, record' : ''}`,
          [seasonId]
        ),
        this.client.query<{
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
         ORDER BY event_sequence${lock ? '\n         FOR UPDATE' : ''}`,
          [seasonId]
        ),
        this.client.query<{
          readonly user_id: string;
          readonly rating: number;
          readonly rating_deviation: number;
        }>(
          `SELECT user_id, rating, rating_deviation
         FROM ranked_player_seeds
         WHERE season_id = $1
         ORDER BY user_id`,
          [seasonId]
        ),
        this.client.query<{
          readonly user_id: string;
          readonly rating: number;
          readonly rating_deviation: number;
          readonly rated_match_count: number;
          readonly last_rated_at: Date | string | null;
        }>(
          `SELECT user_id, rating, rating_deviation, rated_match_count, last_rated_at
         FROM ranked_player_ratings
         WHERE season_id = $1
         ORDER BY user_id${lock ? '\n         FOR UPDATE' : ''}`,
          [seasonId]
        ),
      ]);
    const blocker = blockerResult.rows[0]!;
    const environmentMismatches = countRankedV3MigrationEnvironmentMismatches(
      environmentResult.rows.map((row) => ({
        ratingAlgorithmVersion: row.rating_algorithm_version,
        rulesVersion: row.rules_version,
        cardCatalogVersion: row.card_catalog_version,
        cardCatalogHash: row.card_catalog_hash,
        deckPolicyVersion: row.deck_policy_version,
        matchRecordRulesVersion: row.match_record_rules_version,
      })),
      {
        ratingAlgorithmVersion: seasonRow.rating_algorithm_version,
        rulesVersion: seasonRow.rules_version,
        cardCatalogVersion: seasonRow.card_catalog_version,
        cardCatalogHash: seasonRow.card_catalog_hash,
        deckPolicyVersion: seasonRow.deck_policy_version,
      }
    );
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
        ledgerRevision: seasonRow.ledger_revision,
      },
      blockers: {
        pendingMatches: Number(blocker.pending_matches),
        activeTickets: Number(blocker.active_tickets),
        activeReservations: Number(blocker.active_reservations),
        activeParticipations: Number(blocker.active_participations),
        ...environmentMismatches,
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
    };
  }

  async applyPlan(
    plan: RankedV3MigrationPlan,
    input: Required<Pick<RankedV3MigrationInput, 'seasonId' | 'adminUserId'>> & {
      readonly targetCompetitiveEnvironmentId: string;
    }
  ): Promise<void> {
    for (const directive of plan.directives) {
      await this.client.query(
        `INSERT INTO ranked_rating_events (
           id, season_id, event_sequence, event_type, idempotency_key,
           match_id, target_event_id, first_user_id, second_user_id,
           winner_seat, result_type, rated_at, algorithm_version, reason, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          directive.eventId,
          input.seasonId,
          directive.eventSequence,
          directive.eventType,
          `algorithm-migration:v3:${directive.matchId}`,
          directive.matchId,
          directive.targetEventId,
          directive.firstUserId,
          directive.secondUserId,
          directive.winnerSeat,
          directive.resultType,
          directive.ratedAt,
          directive.algorithmVersion,
          MIGRATION_REASON,
          input.adminUserId,
        ]
      );
    }
    const snapshotEventId = plan.directives.at(-1)?.eventId;
    if (snapshotEventId) {
      for (const step of plan.materialization.steps) {
        await insertMaterializationStep(this.client, snapshotEventId, step);
      }
    }
    await this.client.query(`DELETE FROM ranked_player_ratings WHERE season_id = $1`, [
      input.seasonId,
    ]);
    for (const [userId, state] of plan.materialization.players) {
      await this.client.query(
        `INSERT INTO ranked_player_ratings (
           season_id, user_id, rating, rating_deviation,
           rated_match_count, last_rated_at, ledger_revision, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          input.seasonId,
          userId,
          state.rating,
          state.ratingDeviation,
          state.ratedMatchCount,
          state.lastRatedAt,
          plan.report.targetLedgerRevision,
        ]
      );
    }
    await this.client.query(
      `UPDATE ranked_matches
       SET rating_algorithm_version = $2, updated_at = NOW()
       WHERE season_id = $1`,
      [input.seasonId, plan.targetConfig.algorithmVersion]
    );
    const updated = await this.client.query(
      `UPDATE ranked_seasons
       SET competitive_environment_id = $2,
           rating_algorithm_version = $3,
           rating_config = $4::jsonb,
           ledger_revision = $5,
           updated_by = $6,
           updated_at = NOW()
       WHERE id = $1
         AND queue_admission = 'PAUSED'
         AND rating_algorithm_version = $7
         AND ledger_revision = $8`,
      [
        input.seasonId,
        input.targetCompetitiveEnvironmentId,
        plan.targetConfig.algorithmVersion,
        JSON.stringify(plan.targetConfig),
        plan.report.targetLedgerRevision,
        input.adminUserId,
        GLICKO1_PER_MATCH_V2.algorithmVersion,
        plan.snapshot.season.ledgerRevision,
      ]
    );
    if (updated.rowCount !== 1) {
      throw migrationError(
        'RANKED_V3_MIGRATION_APPLY_CONFLICT',
        '赛季在迁移事务中发生变化，已回滚'
      );
    }
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

async function withSerializableMigrationTransaction<T>(
  callback: (repository: RankedV3MigrationRepository) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const result = await callback(new PostgresRankedV3MigrationRepository(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function migrationError(code: string, message: string): RankedV3MigrationError {
  return new RankedV3MigrationError(code, message);
}
