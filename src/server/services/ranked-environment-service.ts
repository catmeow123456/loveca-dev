import type {
  RankedSeasonCardUsageView,
  RankedSeasonEnvironmentView,
} from '../../online/ranked-types.js';
import { pool } from '../db/pool.js';

export interface RankedEnvironmentQueryResult<T> {
  readonly rows: T[];
  readonly rowCount?: number | null;
}

export interface RankedEnvironmentQueryClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<RankedEnvironmentQueryResult<T>>;
}

interface EnvironmentSeasonRow {
  readonly id: string;
}

interface CountRow {
  readonly count: number | string;
}

interface ObservationRow {
  readonly match_id: string;
  readonly seat: 'FIRST' | 'SECOND';
  readonly user_id: string;
  readonly main_deck_cards: unknown;
}

interface ObservationCard {
  readonly baseCardCode: string;
  readonly cardCode: string;
  readonly name: string;
  readonly cardType: 'MEMBER' | 'LIVE';
  readonly count: number;
  readonly imageFilename: string | null;
}

interface MutableCardAggregate {
  metadata: ObservationCard;
  deckCount: number;
  totalCopies: number;
  readonly deckCountByPlayer: Map<string, number>;
}

export class RankedEnvironmentServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'RankedEnvironmentServiceError';
  }
}

export class RankedEnvironmentService {
  constructor(private readonly queryClient: RankedEnvironmentQueryClient = pool) {}

  async getSeasonEnvironment(seasonId: string): Promise<RankedSeasonEnvironmentView> {
    const season = await this.queryClient.query<EnvironmentSeasonRow>(
      `SELECT id
       FROM ranked_seasons
       WHERE id = $1
         AND lifecycle IN ('ACTIVE', 'FINALIZING', 'CLOSED')`,
      [seasonId]
    );
    if (!season.rows[0]) {
      throw environmentError('RANKED_SEASON_NOT_FOUND', '排位赛季不存在', 404);
    }

    const [settledCount, observations] = await Promise.all([
      this.queryClient.query<CountRow>(
        `SELECT count(*) AS count
         FROM ranked_matches
         WHERE season_id = $1
           AND rating_status = 'SETTLED'`,
        [seasonId]
      ),
      this.queryClient.query<ObservationRow>(
        `WITH analyzable_matches AS (
           SELECT
             ranked_match.match_id,
             ranked_match.first_user_id,
             ranked_match.second_user_id
           FROM ranked_matches AS ranked_match
           JOIN ranked_deck_observations AS observation
             ON observation.match_id = ranked_match.match_id
            AND observation.season_id = ranked_match.season_id
           WHERE ranked_match.season_id = $1
             AND ranked_match.rating_status = 'SETTLED'
           GROUP BY
             ranked_match.match_id,
             ranked_match.first_user_id,
             ranked_match.second_user_id
           HAVING count(*) = 2
             AND count(*) FILTER (WHERE observation.seat = 'FIRST') = 1
             AND count(*) FILTER (WHERE observation.seat = 'SECOND') = 1
             AND bool_and(
               observation.user_id = CASE observation.seat
                 WHEN 'FIRST' THEN ranked_match.first_user_id
                 ELSE ranked_match.second_user_id
               END
             )
         )
         SELECT
           observation.match_id,
           observation.seat,
           observation.user_id,
           observation.main_deck_cards
         FROM analyzable_matches AS analyzable
         JOIN ranked_deck_observations AS observation
           ON observation.match_id = analyzable.match_id
         ORDER BY observation.match_id ASC, observation.seat ASC`,
        [seasonId]
      ),
    ]);

    return aggregateRankedSeasonEnvironment(
      seasonId,
      observations.rows,
      readNonNegativeCount(settledCount.rows[0]?.count ?? 0)
    );
  }
}

export function aggregateRankedSeasonEnvironment(
  seasonId: string,
  observations: readonly ObservationRow[],
  settledMatchCount: number
): RankedSeasonEnvironmentView {
  const playerDeckCounts = new Map<string, number>();
  const aggregates = new Map<string, MutableCardAggregate>();
  const matchIds = new Set<string>();

  for (const observation of observations) {
    matchIds.add(observation.match_id);
    playerDeckCounts.set(observation.user_id, (playerDeckCounts.get(observation.user_id) ?? 0) + 1);
    const cards = readObservationCards(observation.main_deck_cards, observation.match_id);
    for (const card of cards) {
      const aggregate = aggregates.get(card.baseCardCode) ?? {
        metadata: card,
        deckCount: 0,
        totalCopies: 0,
        deckCountByPlayer: new Map<string, number>(),
      };
      if (compareCardCodes(card.cardCode, aggregate.metadata.cardCode) < 0) {
        aggregate.metadata = card;
      }
      aggregate.deckCount += 1;
      aggregate.totalCopies += card.count;
      aggregate.deckCountByPlayer.set(
        observation.user_id,
        (aggregate.deckCountByPlayer.get(observation.user_id) ?? 0) + 1
      );
      aggregates.set(card.baseCardCode, aggregate);
    }
  }

  const playerCount = playerDeckCounts.size;
  const deckObservationCount = observations.length;
  const cardUsage = [...aggregates.entries()]
    .map(([baseCardCode, aggregate]): Omit<RankedSeasonCardUsageView, 'rank'> => {
      let playerBalancedUsage = 0;
      for (const [userId, deckCount] of aggregate.deckCountByPlayer) {
        const playerTotal = playerDeckCounts.get(userId);
        if (!playerTotal) {
          throw environmentError(
            'RANKED_ENVIRONMENT_AGGREGATION_INVALID',
            '赛季环境玩家样本不一致',
            500
          );
        }
        playerBalancedUsage += deckCount / playerTotal;
      }
      return {
        baseCardCode,
        cardCode: aggregate.metadata.cardCode,
        name: aggregate.metadata.name,
        cardType: aggregate.metadata.cardType,
        imageFilename: aggregate.metadata.imageFilename,
        usageRate: playerCount === 0 ? 0 : clampRate(playerBalancedUsage / playerCount),
        deckInclusionRate:
          deckObservationCount === 0 ? 0 : clampRate(aggregate.deckCount / deckObservationCount),
        playerCount: aggregate.deckCountByPlayer.size,
        deckCount: aggregate.deckCount,
        averageCopies: aggregate.deckCount === 0 ? 0 : aggregate.totalCopies / aggregate.deckCount,
      };
    })
    .sort(
      (left, right) =>
        right.usageRate - left.usageRate ||
        right.deckInclusionRate - left.deckInclusionRate ||
        compareCardCodes(left.baseCardCode, right.baseCardCode)
    )
    .slice(0, 30)
    .map((card, index) => ({ ...card, rank: index + 1 }));

  const analyzedMatchCount = matchIds.size;
  return {
    seasonId,
    sample: {
      settledMatchCount,
      analyzedMatchCount,
      deckObservationCount,
      playerCount,
      coverageRate: settledMatchCount === 0 ? 0 : clampRate(analyzedMatchCount / settledMatchCount),
    },
    cardUsage,
  };
}

function readObservationCards(value: unknown, matchId: string): ObservationCard[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw environmentError(
      'RANKED_ENVIRONMENT_OBSERVATION_INVALID',
      `排位对局 ${matchId} 的卡组观察数据无效`,
      500
    );
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw invalidObservation(matchId);
    }
    const baseCardCode = readNonEmptyString(entry.baseCardCode);
    const cardCode = readNonEmptyString(entry.cardCode);
    const name = readNonEmptyString(entry.name);
    const cardType = entry.cardType;
    const count = entry.count;
    const imageFilename =
      entry.imageFilename === undefined || entry.imageFilename === null
        ? null
        : readNonEmptyString(entry.imageFilename);
    if (
      !baseCardCode ||
      !cardCode ||
      !name ||
      (cardType !== 'MEMBER' && cardType !== 'LIVE') ||
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      seen.has(baseCardCode)
    ) {
      throw invalidObservation(matchId);
    }
    seen.add(baseCardCode);
    return {
      baseCardCode,
      cardCode,
      name,
      cardType,
      count,
      imageFilename,
    };
  });
}

function invalidObservation(matchId: string): RankedEnvironmentServiceError {
  return environmentError(
    'RANKED_ENVIRONMENT_OBSERVATION_INVALID',
    `排位对局 ${matchId} 的卡组观察数据无效`,
    500
  );
}

function readNonNegativeCount(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw environmentError('RANKED_ENVIRONMENT_COUNT_INVALID', '赛季环境样本数量无效', 500);
  }
  return parsed;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampRate(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function compareCardCodes(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function environmentError(
  code: string,
  message: string,
  statusCode = 400
): RankedEnvironmentServiceError {
  return new RankedEnvironmentServiceError(code, message, statusCode);
}

export const rankedEnvironmentService = new RankedEnvironmentService();
