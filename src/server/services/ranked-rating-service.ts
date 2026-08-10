import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { createInitialGlickoRatingState, type GlickoRatingState } from '../rating/glicko.js';
import {
  assertValidRankedRatingConfig,
  rateRankedHeadToHead,
  type RankedRatingConfig,
} from '../rating/ranked-rating.js';
import {
  materializeRankedRatingLedger,
  type RankedRatingEvent,
  type RankedRatingEventType,
  type RankedRatingMaterializationStep,
  type RankedResultType,
  type RankedWinnerSeat,
} from '../rating/ranked-ledger.js';
import { awardEligibleFirstRankedSeasonBadges } from '../player-badges/award.js';
import { captureRankedDeckObservations } from './ranked-deck-observation-service.js';
import { stableJsonStringify } from './replay-payload-serialization.js';

export interface RankedRatingQueryResult<T> {
  readonly rows: T[];
  readonly rowCount?: number | null;
}

export interface RankedRatingQueryClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<RankedRatingQueryResult<T>>;
}

interface RankedRatingServiceDeps {
  readonly transaction?: <T>(
    callback: (client: RankedRatingQueryClient) => Promise<T>
  ) => Promise<T>;
  readonly createId?: () => string;
}

export interface RegisterRankedMatchInput {
  readonly seasonId: string;
  readonly matchId: string;
}

export interface RegisteredRankedMatch {
  readonly seasonId: string;
  readonly matchId: string;
  readonly firstUserId: string;
  readonly secondUserId: string;
  readonly ratingStatus: 'PENDING' | 'SETTLED' | 'VOIDED';
}

export interface RankedRatingMutationResult {
  readonly seasonId: string;
  readonly matchId: string;
  readonly eventId: string;
  readonly eventType: RankedRatingEventType;
  readonly ledgerRevision: number;
  readonly alreadyApplied: boolean;
  readonly materializedMatchCount: number;
  readonly affectedPlayerCount: number;
}

export interface CorrectRankedMatchInput {
  readonly seasonId: string;
  readonly matchId: string;
  readonly action: 'VOID' | 'REPLACE';
  readonly replacementWinnerSeat?: RankedWinnerSeat;
  readonly replacementResultType?: 'NORMAL' | 'SURRENDER' | 'DISCONNECT_FORFEIT';
  readonly expectedTargetEventId: string;
  readonly reason: string;
  readonly adminUserId: string;
  readonly idempotencyKey: string;
  readonly expectedLedgerRevision: number;
}

interface RegisterContextRow {
  readonly season_id: string;
  readonly lifecycle: 'DRAFT' | 'ACTIVE' | 'FINALIZING' | 'CLOSED';
  readonly rules_version: string;
  readonly card_catalog_version: string;
  readonly card_catalog_hash: string;
  readonly deck_policy_version: string;
  readonly rating_algorithm_version: string;
  readonly match_id: string;
  readonly match_status: string;
  readonly completeness: string;
  readonly origin_kind: string;
  readonly first_user_id: string;
  readonly second_user_id: string;
  readonly match_rules_version: string;
}

interface RegisteredMatchRow {
  readonly season_id: string;
  readonly match_id: string;
  readonly first_user_id: string;
  readonly second_user_id: string;
  readonly rating_status: 'PENDING' | 'SETTLED' | 'VOIDED';
}

interface SettlementContextRow {
  readonly season_id: string;
  readonly lifecycle: 'DRAFT' | 'ACTIVE' | 'FINALIZING' | 'CLOSED';
  readonly ledger_revision: number;
  readonly season_rules_version: string;
  readonly season_card_catalog_version: string;
  readonly season_card_catalog_hash: string;
  readonly season_deck_policy_version: string;
  readonly season_algorithm_version: string;
  readonly rating_config: unknown;
  readonly match_id: string;
  readonly rating_status: 'PENDING' | 'SETTLED' | 'VOIDED';
  readonly first_user_id: string;
  readonly second_user_id: string;
  readonly ranked_rules_version: string;
  readonly ranked_card_catalog_version: string;
  readonly ranked_card_catalog_hash: string;
  readonly ranked_deck_policy_version: string;
  readonly ranked_algorithm_version: string;
  readonly ranked_result_type:
    'NORMAL' | 'SURRENDER' | 'DISCONNECT_FORFEIT' | 'PLATFORM_NO_CONTEST' | null;
  readonly record_status: string;
  readonly completeness: string;
  readonly origin_kind: string;
  readonly record_first_user_id: string;
  readonly record_second_user_id: string;
  readonly winner_seat: string | null;
  readonly end_reason: string | null;
  readonly ended_at: Date | string | null;
  readonly sealed_at: Date | string | null;
  readonly match_rules_version: string;
  readonly used_free: boolean;
}

interface SeasonLockRow {
  readonly season_id: string;
  readonly lifecycle: 'DRAFT' | 'ACTIVE' | 'FINALIZING' | 'CLOSED';
  readonly ledger_revision: number;
  readonly rating_algorithm_version: string;
  readonly rating_config: unknown;
}

interface RatingStateRow {
  readonly user_id: string;
  readonly rating: number;
  readonly rating_deviation: number;
  readonly rated_match_count: number;
  readonly last_rated_at: Date | string | null;
}

interface RatingEventRow {
  readonly id: string;
  readonly event_sequence: number;
  readonly event_type: RankedRatingEventType;
  readonly match_id: string;
  readonly target_event_id: string | null;
  readonly first_user_id: string;
  readonly second_user_id: string;
  readonly winner_seat: RankedWinnerSeat | null;
  readonly result_type: RankedResultType;
  readonly rated_at: Date | string;
  readonly algorithm_version: string;
}

interface ExistingEventRow {
  readonly id: string;
  readonly event_type: RankedRatingEventType;
  readonly match_id: string;
  readonly event_sequence: number;
  readonly winner_seat: RankedWinnerSeat | null;
  readonly result_type: RankedResultType;
  readonly reason: string | null;
}

interface LatestSettlementOrderRow {
  readonly rated_at: Date | string;
  readonly match_id: string;
}

interface CorrectionMatchRow {
  readonly match_id: string;
  readonly result_type:
    'NORMAL' | 'SURRENDER' | 'DISCONNECT_FORFEIT' | 'PLATFORM_NO_CONTEST' | null;
}

export class RankedRatingServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'RankedRatingServiceError';
  }
}

export class RankedRatingService {
  private readonly transaction: <T>(
    callback: (client: RankedRatingQueryClient) => Promise<T>
  ) => Promise<T>;
  private readonly createId: () => string;

  constructor(deps: RankedRatingServiceDeps = {}) {
    this.transaction = deps.transaction ?? withSerializableTransaction;
    this.createId = deps.createId ?? randomUUID;
  }

  async registerMatch(input: RegisterRankedMatchInput): Promise<RegisteredRankedMatch> {
    return this.transaction(async (client) => {
      const context = await loadRegisterContext(client, input);
      validateRegisterContext(context);

      await client.query(
        `INSERT INTO ranked_matches (
           match_id,
           season_id,
           first_user_id,
           second_user_id,
           rating_status,
           used_free,
           rules_version,
           card_catalog_version,
           card_catalog_hash,
           deck_policy_version,
           rating_algorithm_version
         )
         VALUES ($1, $2, $3, $4, 'PENDING', false, $5, $6, $7, $8, $9)
         ON CONFLICT (match_id) DO NOTHING`,
        [
          context.match_id,
          context.season_id,
          context.first_user_id,
          context.second_user_id,
          context.rules_version,
          context.card_catalog_version,
          context.card_catalog_hash,
          context.deck_policy_version,
          context.rating_algorithm_version,
        ]
      );

      const registered = await loadRegisteredMatch(client, input.matchId);
      if (
        registered.season_id !== input.seasonId ||
        registered.first_user_id !== context.first_user_id ||
        registered.second_user_id !== context.second_user_id
      ) {
        throw serviceError(
          'RANKED_MATCH_BINDING_CONFLICT',
          '对局已经绑定到不同的排位赛季或参与者',
          409
        );
      }
      await captureRankedDeckObservations(client, {
        seasonId: context.season_id,
        matchId: context.match_id,
        firstUserId: context.first_user_id,
        secondUserId: context.second_user_id,
      });
      return mapRegisteredMatch(registered);
    });
  }

  async unregisterPendingMatch(matchId: string): Promise<void> {
    return this.transaction(async (client) => {
      const result = await client.query(
        `DELETE FROM ranked_matches AS ranked_match
         WHERE ranked_match.match_id = $1
           AND ranked_match.rating_status = 'PENDING'
           AND NOT EXISTS (
             SELECT 1
             FROM ranked_rating_events AS event
             WHERE event.match_id = ranked_match.match_id
           )
         RETURNING ranked_match.match_id`,
        [matchId]
      );
      if ((result.rowCount ?? 0) !== 1) {
        throw serviceError('RANKED_MATCH_UNREGISTER_CONFLICT', '排位对局已经进入不可回滚状态', 409);
      }
    });
  }

  async settleMatch(
    matchId: string,
    expectedConfig?: RankedRatingConfig
  ): Promise<RankedRatingMutationResult> {
    if (expectedConfig) {
      assertPersistentConfig(expectedConfig);
    }
    return this.transaction(async (client) => {
      const context = await loadSettlementContext(client, matchId);
      const config = readStoredPersistentConfig(
        context.season_algorithm_version,
        context.rating_config,
        expectedConfig
      );
      validateSettlementContext(context, config);

      if (context.rating_status !== 'PENDING') {
        const existing = await loadInitialSettlementEvent(client, context.season_id, matchId);
        return {
          seasonId: context.season_id,
          matchId,
          eventId: existing.id,
          eventType: existing.event_type,
          ledgerRevision: context.ledger_revision,
          alreadyApplied: true,
          materializedMatchCount: 0,
          affectedPlayerCount: 0,
        };
      }

      const ratedAt = requireDate(context.ended_at, 'RANKED_MATCH_ENDED_AT_REQUIRED');
      const winnerSeat = requireWinnerSeat(context.winner_seat);
      const resultType = mapResultType(context);
      const revision = context.ledger_revision + 1;
      const eventId = this.createId();
      const event: RankedRatingEvent = {
        eventId,
        eventSequence: revision,
        eventType: 'SETTLEMENT',
        matchId,
        targetEventId: null,
        firstUserId: context.first_user_id,
        secondUserId: context.second_user_id,
        winnerSeat,
        resultType,
        ratedAt,
        algorithmVersion: config.algorithmVersion,
      };
      const latestSettlement = await loadLatestSettlementOrder(client, context.season_id);

      if (
        latestSettlement !== null &&
        (ratedAt.getTime() < latestSettlement.ratedAt.getTime() ||
          (ratedAt.getTime() === latestSettlement.ratedAt.getTime() &&
            matchId < latestSettlement.matchId))
      ) {
        const existingEvents = await loadRatingEvents(client, context.season_id);
        const seeds = await loadRatingSeeds(client, context.season_id);
        const materialization = materializeRankedRatingLedger(
          [...existingEvents, event],
          config,
          seeds
        );
        await insertRatingEvent(client, event, {
          seasonId: context.season_id,
          idempotencyKey: `settle:${matchId}`,
          reason: null,
          createdBy: null,
        });
        for (const step of materialization.steps) {
          await insertMaterializationStep(client, eventId, step);
        }
        await replaceRatingProjection(client, context.season_id, materialization.players, revision);
        await updateSettledRankedMatch(
          client,
          matchId,
          winnerSeat,
          resultType,
          ratedAt,
          context.used_free
        );
        await setSeasonLedgerRevision(client, context.season_id, revision);
        await awardEligibleFirstRankedSeasonBadges(client, {
          seasonId: context.season_id,
          userIds: [...materialization.players.keys()],
        });
        return {
          seasonId: context.season_id,
          matchId,
          eventId,
          eventType: 'SETTLEMENT',
          ledgerRevision: revision,
          alreadyApplied: false,
          materializedMatchCount: materialization.steps.length,
          affectedPlayerCount: materialization.players.size,
        };
      }

      const states = await loadRatingStates(client, context.season_id, [
        context.first_user_id,
        context.second_user_id,
      ]);
      const firstBefore =
        states.get(context.first_user_id) ?? createInitialGlickoRatingState(config);
      const secondBefore =
        states.get(context.second_user_id) ?? createInitialGlickoRatingState(config);
      const rated = rateRankedHeadToHead(
        firstBefore,
        secondBefore,
        winnerSeat === 'FIRST' ? 1 : 0,
        ratedAt,
        config
      );
      const step: RankedRatingMaterializationStep = {
        stepIndex: 0,
        sourceResultEventId: eventId,
        matchId,
        firstUserId: context.first_user_id,
        secondUserId: context.second_user_id,
        winnerSeat,
        ratedAt,
        firstBefore,
        secondBefore,
        firstAfter: rated.first,
        secondAfter: rated.second,
      };

      await insertRatingEvent(client, event, {
        seasonId: context.season_id,
        idempotencyKey: `settle:${matchId}`,
        reason: null,
        createdBy: null,
      });
      await insertMaterializationStep(client, eventId, step);
      await upsertRatingState(
        client,
        context.season_id,
        context.first_user_id,
        rated.first,
        revision
      );
      await upsertRatingState(
        client,
        context.season_id,
        context.second_user_id,
        rated.second,
        revision
      );
      await updateSettledRankedMatch(
        client,
        matchId,
        winnerSeat,
        resultType,
        ratedAt,
        context.used_free
      );
      await setSeasonLedgerRevision(client, context.season_id, revision);
      await awardEligibleFirstRankedSeasonBadges(client, {
        seasonId: context.season_id,
        userIds: [context.first_user_id, context.second_user_id],
      });

      return {
        seasonId: context.season_id,
        matchId,
        eventId,
        eventType: 'SETTLEMENT',
        ledgerRevision: revision,
        alreadyApplied: false,
        materializedMatchCount: 1,
        affectedPlayerCount: 2,
      };
    });
  }

  async correctMatch(
    input: CorrectRankedMatchInput,
    expectedConfig?: RankedRatingConfig
  ): Promise<RankedRatingMutationResult> {
    if (expectedConfig) {
      assertPersistentConfig(expectedConfig);
    }
    validateCorrectionInput(input);

    return this.transaction(async (client) => {
      const season = await lockSeason(client, input.seasonId);
      const config = readStoredPersistentConfig(
        season.rating_algorithm_version,
        season.rating_config,
        expectedConfig
      );
      validateMutableSeason(season, config);
      const existing = await findEventByIdempotencyKey(
        client,
        input.seasonId,
        input.idempotencyKey
      );
      if (existing) {
        const expectedEventType: RankedRatingEventType =
          input.action === 'VOID' ? 'VOID' : 'REPLACEMENT';
        const expectedWinnerSeat =
          input.action === 'VOID' ? null : (input.replacementWinnerSeat ?? null);
        const expectedResultType =
          input.action === 'VOID' ? 'PLATFORM_NO_CONTEST' : input.replacementResultType;
        if (
          existing.match_id !== input.matchId ||
          existing.event_type !== expectedEventType ||
          existing.winner_seat !== expectedWinnerSeat ||
          existing.result_type !== expectedResultType ||
          existing.reason !== input.reason.trim()
        ) {
          throw serviceError(
            'RANKED_CORRECTION_IDEMPOTENCY_CONFLICT',
            '该幂等键已经用于不同的排位更正请求',
            409
          );
        }
        return {
          seasonId: input.seasonId,
          matchId: existing.match_id,
          eventId: existing.id,
          eventType: existing.event_type,
          ledgerRevision: season.ledger_revision,
          alreadyApplied: true,
          materializedMatchCount: 0,
          affectedPlayerCount: 0,
        };
      }
      if (season.ledger_revision !== input.expectedLedgerRevision) {
        throw serviceError(
          'RANKED_CORRECTION_PREVIEW_STALE',
          '评分流水已在预览后发生变化，请重新预览更正影响',
          409
        );
      }

      await lockCorrectionMatch(client, input.seasonId, input.matchId);
      const existingEvents = await loadRatingEvents(client, input.seasonId);
      const latest = [...existingEvents].reverse().find((event) => event.matchId === input.matchId);
      if (!latest) {
        throw serviceError('RANKED_CORRECTION_TARGET_NOT_FOUND', '找不到可以更正的排位结算', 404);
      }
      if (latest.eventId !== input.expectedTargetEventId) {
        throw serviceError(
          'RANKED_CORRECTION_PREVIEW_STALE',
          '更正目标已在预览后发生变化，请重新预览',
          409
        );
      }

      const revision = season.ledger_revision + 1;
      const eventId = this.createId();
      const eventType: RankedRatingEventType = input.action === 'VOID' ? 'VOID' : 'REPLACEMENT';
      const correction: RankedRatingEvent = {
        eventId,
        eventSequence: revision,
        eventType,
        matchId: latest.matchId,
        targetEventId: latest.eventId,
        firstUserId: latest.firstUserId,
        secondUserId: latest.secondUserId,
        winnerSeat: input.action === 'VOID' ? null : input.replacementWinnerSeat!,
        resultType: input.action === 'VOID' ? 'PLATFORM_NO_CONTEST' : input.replacementResultType!,
        ratedAt: latest.ratedAt,
        algorithmVersion: config.algorithmVersion,
      };
      const seeds = await loadRatingSeeds(client, input.seasonId);
      const materialization = materializeRankedRatingLedger(
        [...existingEvents, correction],
        config,
        seeds
      );

      await insertRatingEvent(client, correction, {
        seasonId: input.seasonId,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason.trim(),
        createdBy: input.adminUserId,
      });
      for (const step of materialization.steps) {
        await insertMaterializationStep(client, eventId, step);
      }

      await replaceRatingProjection(client, input.seasonId, materialization.players, revision);
      await client.query(
        `UPDATE ranked_matches
         SET rating_status = $2,
             winner_seat = $3,
             result_type = $4,
             settled_at = NOW(),
             updated_at = NOW()
         WHERE season_id = $1
           AND match_id = $5`,
        [
          input.seasonId,
          input.action === 'VOID' ? 'VOIDED' : 'SETTLED',
          input.action === 'VOID' ? null : input.replacementWinnerSeat,
          input.action === 'VOID' ? 'PLATFORM_NO_CONTEST' : input.replacementResultType,
          input.matchId,
        ]
      );
      await setSeasonLedgerRevision(client, input.seasonId, revision);
      await awardEligibleFirstRankedSeasonBadges(client, {
        seasonId: input.seasonId,
        userIds: [...materialization.players.keys()],
      });

      return {
        seasonId: input.seasonId,
        matchId: input.matchId,
        eventId,
        eventType,
        ledgerRevision: revision,
        alreadyApplied: false,
        materializedMatchCount: materialization.steps.length,
        affectedPlayerCount: materialization.players.size,
      };
    });
  }
}

async function loadRegisterContext(
  client: RankedRatingQueryClient,
  input: RegisterRankedMatchInput
): Promise<RegisterContextRow> {
  const result = await client.query<RegisterContextRow>(
    `SELECT
       season.id AS season_id,
       season.lifecycle,
       season.rules_version,
       season.card_catalog_version,
       season.card_catalog_hash,
       season.deck_policy_version,
       season.rating_algorithm_version,
       record.match_id,
       record.status AS match_status,
       record.completeness,
       record.origin_kind,
       record.first_user_id,
       record.second_user_id,
       record.rules_version AS match_rules_version
     FROM ranked_seasons AS season
     JOIN match_records AS record ON record.match_id = $2
     WHERE season.id = $1
     FOR UPDATE OF season, record`,
    [input.seasonId, input.matchId]
  );
  const row = result.rows[0];
  if (!row) {
    throw serviceError('RANKED_REGISTER_CONTEXT_NOT_FOUND', '赛季或对局不存在', 404);
  }
  return row;
}

function validateRegisterContext(context: RegisterContextRow): void {
  if (context.lifecycle !== 'ACTIVE' && context.lifecycle !== 'FINALIZING') {
    throw serviceError('RANKED_SEASON_NOT_ACTIVE', '当前赛季不接受新的排位对局', 409);
  }
  if (
    context.origin_kind !== 'RANKED' ||
    context.match_status !== 'IN_PROGRESS' ||
    context.completeness !== 'FULL'
  ) {
    throw serviceError(
      'RANKED_MATCH_RECORD_INELIGIBLE',
      '只有完整且正在进行的排位来源对局可以绑定赛季',
      409
    );
  }
  if (context.match_rules_version !== context.rules_version) {
    throw serviceError(
      'RANKED_MATCH_RULES_VERSION_MISMATCH',
      '对局规则版本与赛季冻结环境不一致',
      409
    );
  }
  if (
    context.first_user_id.trim().length === 0 ||
    context.second_user_id.trim().length === 0 ||
    context.first_user_id === context.second_user_id
  ) {
    throw serviceError('RANKED_MATCH_PARTICIPANTS_INVALID', '排位对局参与者无效', 409);
  }
}

async function loadRegisteredMatch(
  client: RankedRatingQueryClient,
  matchId: string
): Promise<RegisteredMatchRow> {
  const result = await client.query<RegisteredMatchRow>(
    `SELECT season_id, match_id, first_user_id, second_user_id, rating_status
     FROM ranked_matches
     WHERE match_id = $1`,
    [matchId]
  );
  const row = result.rows[0];
  if (!row) {
    throw serviceError('RANKED_MATCH_REGISTER_FAILED', '排位对局绑定失败', 500);
  }
  return row;
}

function mapRegisteredMatch(row: RegisteredMatchRow): RegisteredRankedMatch {
  return {
    seasonId: row.season_id,
    matchId: row.match_id,
    firstUserId: row.first_user_id,
    secondUserId: row.second_user_id,
    ratingStatus: row.rating_status,
  };
}

async function loadSettlementContext(
  client: RankedRatingQueryClient,
  matchId: string
): Promise<SettlementContextRow> {
  const result = await client.query<SettlementContextRow>(
    `SELECT
       season.id AS season_id,
       season.lifecycle,
       season.ledger_revision,
       season.rules_version AS season_rules_version,
       season.card_catalog_version AS season_card_catalog_version,
       season.card_catalog_hash AS season_card_catalog_hash,
       season.deck_policy_version AS season_deck_policy_version,
       season.rating_algorithm_version AS season_algorithm_version,
       season.rating_config,
       ranked_match.match_id,
       ranked_match.rating_status,
       ranked_match.first_user_id,
       ranked_match.second_user_id,
       ranked_match.rules_version AS ranked_rules_version,
       ranked_match.card_catalog_version AS ranked_card_catalog_version,
       ranked_match.card_catalog_hash AS ranked_card_catalog_hash,
       ranked_match.deck_policy_version AS ranked_deck_policy_version,
       ranked_match.rating_algorithm_version AS ranked_algorithm_version,
       ranked_match.result_type AS ranked_result_type,
       record.status AS record_status,
       record.completeness,
       record.origin_kind,
       record.first_user_id AS record_first_user_id,
       record.second_user_id AS record_second_user_id,
       record.winner_seat,
       record.end_reason,
       record.ended_at,
       record.sealed_at,
       record.rules_version AS match_rules_version,
       EXISTS (
         SELECT 1
         FROM match_timeline_entries AS timeline
         WHERE timeline.match_id = ranked_match.match_id
           AND (
             timeline.dedupe_key LIKE '%:MANUAL_MODE_ACCEPTED:%'
             OR timeline.dedupe_key LIKE '%:MANUAL_MODE_CHANGED:FREE:%'
           )
       ) AS used_free
     FROM ranked_matches AS ranked_match
     JOIN ranked_seasons AS season ON season.id = ranked_match.season_id
     JOIN match_records AS record ON record.match_id = ranked_match.match_id
     WHERE ranked_match.match_id = $1
     FOR UPDATE OF season, ranked_match, record`,
    [matchId]
  );
  const row = result.rows[0];
  if (!row) {
    throw serviceError('RANKED_SETTLEMENT_CONTEXT_NOT_FOUND', '排位结算上下文不存在', 404);
  }
  return row;
}

function validateSettlementContext(
  context: SettlementContextRow,
  config: RankedRatingConfig
): void {
  if (context.lifecycle !== 'ACTIVE' && context.lifecycle !== 'FINALIZING') {
    throw serviceError('RANKED_SEASON_NOT_SETTLEABLE', '当前赛季不能继续结算', 409);
  }
  assertConfigMatches(context.season_algorithm_version, context.rating_config, config);
  if (
    context.ranked_algorithm_version !== context.season_algorithm_version ||
    context.ranked_rules_version !== context.season_rules_version ||
    context.ranked_card_catalog_version !== context.season_card_catalog_version ||
    context.ranked_card_catalog_hash !== context.season_card_catalog_hash ||
    context.ranked_deck_policy_version !== context.season_deck_policy_version
  ) {
    throw serviceError(
      'RANKED_MATCH_ENVIRONMENT_MISMATCH',
      '排位对局绑定环境与赛季冻结环境不一致',
      409
    );
  }
  if (
    context.origin_kind !== 'RANKED' ||
    context.completeness !== 'FULL' ||
    (context.record_status !== 'COMPLETED' && context.record_status !== 'SURRENDERED') ||
    context.sealed_at === null ||
    context.ended_at === null
  ) {
    throw serviceError(
      'RANKED_MATCH_RESULT_INELIGIBLE',
      '只有完整封存并形成权威胜负的排位对局可以结算',
      409
    );
  }
  if (
    context.first_user_id !== context.record_first_user_id ||
    context.second_user_id !== context.record_second_user_id
  ) {
    throw serviceError(
      'RANKED_MATCH_PARTICIPANT_MISMATCH',
      '排位绑定参与者与权威对局记录不一致',
      409
    );
  }
  if (context.match_rules_version !== context.season_rules_version) {
    throw serviceError(
      'RANKED_MATCH_RULES_VERSION_MISMATCH',
      '对局规则版本与赛季冻结环境不一致',
      409
    );
  }
  requireWinnerSeat(context.winner_seat);
}

async function loadRatingStates(
  client: RankedRatingQueryClient,
  seasonId: string,
  userIds: readonly string[]
): Promise<ReadonlyMap<string, GlickoRatingState>> {
  const result = await client.query<RatingStateRow>(
    `SELECT user_id, rating, rating_deviation, rated_match_count, last_rated_at
     FROM ranked_player_ratings
     WHERE season_id = $1
       AND user_id = ANY($2::uuid[])
     ORDER BY user_id
     FOR UPDATE`,
    [seasonId, userIds]
  );
  return new Map(
    result.rows.map((row) => [
      row.user_id,
      {
        rating: Number(row.rating),
        ratingDeviation: Number(row.rating_deviation),
        ratedMatchCount: row.rated_match_count,
        lastRatedAt: row.last_rated_at === null ? null : new Date(row.last_rated_at),
      },
    ])
  );
}

async function loadRatingSeeds(
  client: RankedRatingQueryClient,
  seasonId: string
): Promise<ReadonlyMap<string, GlickoRatingState>> {
  const result = await client.query<{
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
  return new Map(
    result.rows.map((row) => [
      row.user_id,
      {
        rating: Number(row.rating),
        ratingDeviation: Number(row.rating_deviation),
        ratedMatchCount: 0,
        lastRatedAt: null,
      },
    ])
  );
}

async function loadLatestSettlementOrder(
  client: RankedRatingQueryClient,
  seasonId: string
): Promise<{ readonly ratedAt: Date; readonly matchId: string } | null> {
  const result = await client.query<LatestSettlementOrderRow>(
    `SELECT rated_at, match_id
     FROM ranked_rating_events
     WHERE season_id = $1
       AND event_type = 'SETTLEMENT'
     ORDER BY rated_at DESC, match_id DESC
     LIMIT 1`,
    [seasonId]
  );
  const row = result.rows[0];
  return row
    ? {
        ratedAt: requireDate(row.rated_at, 'RANKED_LATEST_RATED_AT_INVALID'),
        matchId: row.match_id,
      }
    : null;
}

async function insertRatingEvent(
  client: RankedRatingQueryClient,
  event: RankedRatingEvent,
  metadata: {
    readonly seasonId: string;
    readonly idempotencyKey: string;
    readonly reason: string | null;
    readonly createdBy: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO ranked_rating_events (
       id,
       season_id,
       event_sequence,
       event_type,
       idempotency_key,
       match_id,
       target_event_id,
       first_user_id,
       second_user_id,
       winner_seat,
       result_type,
       rated_at,
       algorithm_version,
       reason,
       created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      event.eventId,
      metadata.seasonId,
      event.eventSequence,
      event.eventType,
      metadata.idempotencyKey,
      event.matchId,
      event.targetEventId,
      event.firstUserId,
      event.secondUserId,
      event.winnerSeat,
      event.resultType,
      event.ratedAt,
      event.algorithmVersion,
      metadata.reason,
      metadata.createdBy,
    ]
  );
}

async function insertMaterializationStep(
  client: RankedRatingQueryClient,
  eventId: string,
  step: RankedRatingMaterializationStep
): Promise<void> {
  await client.query(
    `INSERT INTO ranked_rating_event_steps (
       event_id,
       step_index,
       source_result_event_id,
       match_id,
       first_user_id,
       second_user_id,
       winner_seat,
       rated_at,
       first_before_rating,
       first_before_deviation,
       first_before_match_count,
       first_before_last_rated_at,
       first_after_rating,
       first_after_deviation,
       first_after_match_count,
       first_after_last_rated_at,
       second_before_rating,
       second_before_deviation,
       second_before_match_count,
       second_before_last_rated_at,
       second_after_rating,
       second_after_deviation,
       second_after_match_count,
       second_after_last_rated_at
     )
     VALUES (
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

async function upsertRatingState(
  client: RankedRatingQueryClient,
  seasonId: string,
  userId: string,
  state: GlickoRatingState,
  revision: number
): Promise<void> {
  await client.query(
    `INSERT INTO ranked_player_ratings (
       season_id,
       user_id,
       rating,
       rating_deviation,
       rated_match_count,
       last_rated_at,
       ledger_revision,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (season_id, user_id) DO UPDATE
     SET rating = EXCLUDED.rating,
         rating_deviation = EXCLUDED.rating_deviation,
         rated_match_count = EXCLUDED.rated_match_count,
         last_rated_at = EXCLUDED.last_rated_at,
         ledger_revision = EXCLUDED.ledger_revision,
         updated_at = NOW()`,
    [
      seasonId,
      userId,
      state.rating,
      state.ratingDeviation,
      state.ratedMatchCount,
      state.lastRatedAt,
      revision,
    ]
  );
}

async function replaceRatingProjection(
  client: RankedRatingQueryClient,
  seasonId: string,
  players: ReadonlyMap<string, GlickoRatingState>,
  revision: number
): Promise<void> {
  await client.query(`DELETE FROM ranked_player_ratings WHERE season_id = $1`, [seasonId]);
  for (const [userId, state] of players) {
    await upsertRatingState(client, seasonId, userId, state, revision);
  }
}

async function updateSettledRankedMatch(
  client: RankedRatingQueryClient,
  matchId: string,
  winnerSeat: RankedWinnerSeat,
  resultType: 'NORMAL' | 'SURRENDER' | 'DISCONNECT_FORFEIT',
  endedAt: Date,
  usedFree: boolean
): Promise<void> {
  await client.query(
    `UPDATE ranked_matches
     SET rating_status = 'SETTLED',
         winner_seat = $2,
         result_type = $3,
         ended_at = $4,
         used_free = $5,
         settled_at = NOW(),
         updated_at = NOW()
     WHERE match_id = $1`,
    [matchId, winnerSeat, resultType, endedAt, usedFree]
  );
}

async function setSeasonLedgerRevision(
  client: RankedRatingQueryClient,
  seasonId: string,
  revision: number
): Promise<void> {
  await client.query(
    `UPDATE ranked_seasons
     SET ledger_revision = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [seasonId, revision]
  );
}

async function loadInitialSettlementEvent(
  client: RankedRatingQueryClient,
  seasonId: string,
  matchId: string
): Promise<ExistingEventRow> {
  const result = await client.query<ExistingEventRow>(
    `SELECT id, event_type, match_id, event_sequence, winner_seat, result_type, reason
     FROM ranked_rating_events
     WHERE season_id = $1
       AND match_id = $2
       AND event_type = 'SETTLEMENT'`,
    [seasonId, matchId]
  );
  const row = result.rows[0];
  if (!row) {
    throw serviceError(
      'RANKED_SETTLEMENT_STATE_CORRUPTED',
      '排位对局状态已结算但缺少初始流水',
      500
    );
  }
  return row;
}

async function lockSeason(
  client: RankedRatingQueryClient,
  seasonId: string
): Promise<SeasonLockRow> {
  const result = await client.query<SeasonLockRow>(
    `SELECT
       id AS season_id,
       lifecycle,
       ledger_revision,
       rating_algorithm_version,
       rating_config
     FROM ranked_seasons
     WHERE id = $1
     FOR UPDATE`,
    [seasonId]
  );
  const row = result.rows[0];
  if (!row) {
    throw serviceError('RANKED_SEASON_NOT_FOUND', '排位赛季不存在', 404);
  }
  return row;
}

function validateMutableSeason(season: SeasonLockRow, config: RankedRatingConfig): void {
  if (season.lifecycle !== 'ACTIVE' && season.lifecycle !== 'FINALIZING') {
    throw serviceError('RANKED_SEASON_NOT_SETTLEABLE', '当前赛季不能更正结算', 409);
  }
  assertConfigMatches(season.rating_algorithm_version, season.rating_config, config);
}

async function findEventByIdempotencyKey(
  client: RankedRatingQueryClient,
  seasonId: string,
  idempotencyKey: string
): Promise<ExistingEventRow | null> {
  const result = await client.query<ExistingEventRow>(
    `SELECT id, event_type, match_id, event_sequence, winner_seat, result_type, reason
     FROM ranked_rating_events
     WHERE season_id = $1
       AND idempotency_key = $2`,
    [seasonId, idempotencyKey]
  );
  return result.rows[0] ?? null;
}

async function lockCorrectionMatch(
  client: RankedRatingQueryClient,
  seasonId: string,
  matchId: string
): Promise<CorrectionMatchRow> {
  const result = await client.query<CorrectionMatchRow>(
    `SELECT match_id, result_type
     FROM ranked_matches
     WHERE season_id = $1
       AND match_id = $2
     FOR UPDATE`,
    [seasonId, matchId]
  );
  const row = result.rows[0];
  if (!row) {
    throw serviceError('RANKED_MATCH_NOT_FOUND', '排位对局不存在', 404);
  }
  return row;
}

async function loadRatingEvents(
  client: RankedRatingQueryClient,
  seasonId: string
): Promise<RankedRatingEvent[]> {
  const result = await client.query<RatingEventRow>(
    `SELECT
       id,
       event_sequence,
       event_type,
       match_id,
       target_event_id,
       first_user_id,
       second_user_id,
       winner_seat,
       result_type,
       rated_at,
       algorithm_version
     FROM ranked_rating_events
     WHERE season_id = $1
     ORDER BY event_sequence`,
    [seasonId]
  );
  return result.rows.map((row) => ({
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
  }));
}

function assertPersistentConfig(config: RankedRatingConfig): void {
  assertValidRankedRatingConfig(config);
  if (config.algorithmVersion.trim().length === 0 || config.algorithmVersion.includes('SHADOW')) {
    throw serviceError(
      'RANKED_PERSISTENT_ALGORITHM_INVALID',
      '正式排位流水不能使用空版本或 SHADOW 算法版本',
      500
    );
  }
}

function readStoredPersistentConfig(
  algorithmVersion: string,
  storedConfig: unknown,
  expectedConfig?: RankedRatingConfig
): RankedRatingConfig {
  const config = storedConfig as RankedRatingConfig;
  try {
    assertPersistentConfig(config);
  } catch (error) {
    throw serviceError(
      'RANKED_STORED_CONFIG_INVALID',
      error instanceof Error ? error.message : '赛季冻结的评分算法配置无效',
      500
    );
  }
  if (algorithmVersion !== config.algorithmVersion) {
    throw serviceError(
      'RANKED_STORED_CONFIG_VERSION_MISMATCH',
      '赛季冻结的评分算法版本与配置不一致',
      500
    );
  }
  if (expectedConfig && stableJsonStringify(expectedConfig) !== stableJsonStringify(config)) {
    throw serviceError(
      'RANKED_RATING_CONFIG_MISMATCH',
      '调用方期望的评分配置与赛季冻结配置不一致',
      409
    );
  }
  return config;
}

function assertConfigMatches(
  algorithmVersion: string,
  storedConfig: unknown,
  config: RankedRatingConfig
): void {
  if (
    algorithmVersion !== config.algorithmVersion ||
    stableJsonStringify(storedConfig) !== stableJsonStringify(config)
  ) {
    throw serviceError('RANKED_ALGORITHM_CONFIG_MISMATCH', '结算算法与赛季冻结配置不一致', 409);
  }
}

function validateCorrectionInput(input: CorrectRankedMatchInput): void {
  if (input.reason.trim().length === 0) {
    throw serviceError('RANKED_CORRECTION_REASON_REQUIRED', '更正结算必须填写原因');
  }
  if (input.idempotencyKey.trim().length === 0) {
    throw serviceError('RANKED_CORRECTION_IDEMPOTENCY_REQUIRED', '更正结算缺少幂等键');
  }
  if (!Number.isInteger(input.expectedLedgerRevision) || input.expectedLedgerRevision < 0) {
    throw serviceError(
      'RANKED_CORRECTION_EXPECTED_REVISION_INVALID',
      '更正必须携带有效的预览流水版本'
    );
  }
  if (input.adminUserId.trim().length === 0) {
    throw serviceError('RANKED_CORRECTION_ADMIN_REQUIRED', '更正结算缺少管理员身份');
  }
  if (
    input.action === 'REPLACE' &&
    input.replacementWinnerSeat !== 'FIRST' &&
    input.replacementWinnerSeat !== 'SECOND'
  ) {
    throw serviceError('RANKED_REPLACEMENT_WINNER_REQUIRED', '替代结算必须指定胜者');
  }
  if (
    input.action === 'REPLACE' &&
    input.replacementResultType !== 'NORMAL' &&
    input.replacementResultType !== 'SURRENDER' &&
    input.replacementResultType !== 'DISCONNECT_FORFEIT'
  ) {
    throw serviceError('RANKED_REPLACEMENT_RESULT_TYPE_REQUIRED', '替代结算必须指定合法结果类型');
  }
  if (input.expectedTargetEventId.trim().length === 0) {
    throw serviceError('RANKED_CORRECTION_TARGET_REQUIRED', '更正必须绑定预览目标');
  }
}

function requireWinnerSeat(value: string | null): RankedWinnerSeat {
  if (value !== 'FIRST' && value !== 'SECOND') {
    throw serviceError('RANKED_MATCH_WINNER_REQUIRED', '排位对局缺少权威胜者', 409);
  }
  return value;
}

function requireDate(value: Date | string | null, code: string): Date {
  if (value === null) {
    throw serviceError(code, '排位对局缺少有效结算时间', 409);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw serviceError(code, '排位对局结算时间无效', 409);
  }
  return date;
}

function mapResultType(
  context: Pick<SettlementContextRow, 'record_status' | 'end_reason' | 'ranked_result_type'>
): 'NORMAL' | 'SURRENDER' | 'DISCONNECT_FORFEIT' {
  if (context.ranked_result_type === 'DISCONNECT_FORFEIT') {
    return 'DISCONNECT_FORFEIT';
  }
  return context.record_status === 'SURRENDERED' || context.end_reason === 'OPPONENT_SURRENDER'
    ? 'SURRENDER'
    : 'NORMAL';
}

function serviceError(code: string, message: string, statusCode = 400): RankedRatingServiceError {
  return new RankedRatingServiceError(code, message, statusCode);
}

async function withSerializableTransaction<T>(
  callback: (client: RankedRatingQueryClient) => Promise<T>
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (!isRetryableTransactionError(error) || attempt >= 3) {
        throw error;
      }
      await waitForTransactionRetry(attempt);
    } finally {
      client.release();
    }
  }
}

function isRetryableTransactionError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { readonly code?: unknown }).code
      : null;
  return code === '40001' || code === '40P01';
}

async function waitForTransactionRetry(attempt: number): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(resolve, attempt * 10 + Math.floor(Math.random() * 10))
  );
}

export const rankedRatingService = new RankedRatingService();
