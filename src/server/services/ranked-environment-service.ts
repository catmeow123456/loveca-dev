import type {
  RankedSeasonCardEnvironmentWeighting,
  RankedSeasonCardRankingView,
  RankedSeasonCardUsageView,
  RankedSeasonEnvironmentView,
} from '../../online/ranked-types.js';
import type {
  DeckClassifierDisplayMode,
  DeckEnvironmentSection,
} from '../../online/deck-classifier-types.js';
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

interface EnvironmentDisplaySettingsRow {
  readonly card_display_mode: DeckClassifierDisplayMode;
  readonly card_show_usage: boolean;
  readonly card_show_winner: boolean;
  readonly card_show_top_ranked: boolean;
  readonly top_ranked_player_count: number;
}

interface EffectiveCardDisplaySettings {
  readonly displayMode: DeckClassifierDisplayMode;
  readonly visibleSections: readonly DeckEnvironmentSection[];
  readonly topRankedPlayerCount: number;
}

interface ObservationRow {
  readonly match_id: string;
  readonly seat: 'FIRST' | 'SECOND';
  readonly user_id: string;
  readonly winner_seat: 'FIRST' | 'SECOND';
  readonly top_ranked: boolean;
  readonly main_deck_cards: unknown;
}

interface EnvironmentStatsRow {
  readonly settled_match_count: number | string;
  readonly top_ranked_eligible_player_count: number | string;
  readonly match_id: string | null;
  readonly seat: 'FIRST' | 'SECOND' | null;
  readonly user_id: string | null;
  readonly winner_seat: 'FIRST' | 'SECOND' | null;
  readonly top_ranked: boolean | null;
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

interface ParsedObservation extends Omit<ObservationRow, 'main_deck_cards'> {
  readonly cards: readonly ObservationCard[];
}

interface MutableCardAggregate {
  metadata: ObservationCard;
  deckCount: number;
  totalCopies: number;
  readonly deckCountByPlayer: Map<string, number>;
}

export interface AggregateRankedSeasonEnvironmentInput {
  readonly seasonId: string;
  readonly displayMode: DeckClassifierDisplayMode;
  readonly visibleSections: readonly DeckEnvironmentSection[];
  readonly topRankedPlayerCount: number;
  readonly topRankedEligiblePlayerCount: number;
  readonly observations: readonly ObservationRow[];
  readonly settledMatchCount: number;
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

    const settingsResult = await this.queryClient.query<EnvironmentDisplaySettingsRow>(
      `SELECT card_display_mode, card_show_usage, card_show_winner,
              card_show_top_ranked, top_ranked_player_count
       FROM deck_classifier_settings
       WHERE id = 1`
    );
    const settings = readCardDisplaySettings(settingsResult.rows[0]);
    if (settings.visibleSections.length === 0) {
      return emptyEnvironment(seasonId, settings);
    }

    const stats = await this.queryClient.query<EnvironmentStatsRow>(RANKED_CARD_STATS_QUERY, [
      seasonId,
      settings.topRankedPlayerCount,
      settings.visibleSections.includes('TOP_RANKED'),
    ]);
    const firstStatsRow = stats.rows[0];
    if (!firstStatsRow) {
      throw environmentError(
        'RANKED_ENVIRONMENT_AGGREGATION_INVALID',
        '赛季环境统计查询没有返回汇总行',
        500
      );
    }

    return aggregateRankedSeasonEnvironment({
      seasonId,
      displayMode: settings.displayMode,
      visibleSections: settings.visibleSections,
      topRankedPlayerCount: settings.topRankedPlayerCount,
      topRankedEligiblePlayerCount: readNonNegativeCount(
        firstStatsRow.top_ranked_eligible_player_count
      ),
      observations: readObservationRows(stats.rows),
      settledMatchCount: readNonNegativeCount(firstStatsRow.settled_match_count),
    });
  }
}

export function aggregateRankedSeasonEnvironment(
  input: AggregateRankedSeasonEnvironmentInput
): RankedSeasonEnvironmentView {
  readNonNegativeCount(input.settledMatchCount);
  readNonNegativeCount(input.topRankedEligiblePlayerCount);
  if (
    !Number.isSafeInteger(input.topRankedPlayerCount) ||
    input.topRankedPlayerCount < 10 ||
    input.topRankedPlayerCount > 100 ||
    input.topRankedEligiblePlayerCount > input.topRankedPlayerCount
  ) {
    throw environmentError(
      'RANKED_ENVIRONMENT_AGGREGATION_INVALID',
      '赛季环境高排名玩家样本数量无效',
      500
    );
  }
  validateDisplaySettings(input.displayMode, input.visibleSections);

  const parsedObservations: ParsedObservation[] = input.observations.map((observation) => ({
    match_id: observation.match_id,
    seat: observation.seat,
    user_id: observation.user_id,
    winner_seat: observation.winner_seat,
    top_ranked: observation.top_ranked,
    cards: readObservationCards(observation.main_deck_cards, observation.match_id),
  }));
  const rowsByMatch = new Map<string, ParsedObservation[]>();
  for (const observation of parsedObservations) {
    const rows = rowsByMatch.get(observation.match_id) ?? [];
    rows.push(observation);
    rowsByMatch.set(observation.match_id, rows);
  }
  for (const rows of rowsByMatch.values()) validateAnalyzableMatch(rows);

  const analyzedMatchCount = rowsByMatch.size;
  if (analyzedMatchCount > input.settledMatchCount) {
    throw environmentError(
      'RANKED_ENVIRONMENT_AGGREGATION_INVALID',
      '赛季环境可分析对局数超过已结算对局数',
      500
    );
  }

  const playerCount = new Set(parsedObservations.map((observation) => observation.user_id)).size;
  const winnerObservations = input.visibleSections.includes('WINNER')
    ? parsedObservations.filter((observation) => observation.seat === observation.winner_seat)
    : [];
  const topRankedObservations = input.visibleSections.includes('TOP_RANKED')
    ? parsedObservations.filter((observation) => observation.top_ranked)
    : [];
  const winningPlayerCount = new Set(winnerObservations.map((observation) => observation.user_id))
    .size;
  const topRankedAnalyzedPlayerCount = new Set(
    topRankedObservations.map((observation) => observation.user_id)
  ).size;
  if (topRankedAnalyzedPlayerCount > input.topRankedEligiblePlayerCount) {
    throw environmentError(
      'RANKED_ENVIRONMENT_AGGREGATION_INVALID',
      '赛季环境高排名玩家观察数量超过符合门槛人数',
      500
    );
  }

  const rankings: RankedSeasonCardRankingView[] = [];
  for (const section of input.visibleSections) {
    const cohort =
      section === 'WINNER'
        ? winnerObservations
        : section === 'TOP_RANKED'
          ? topRankedObservations
          : parsedObservations;
    const weightings: readonly RankedSeasonCardEnvironmentWeighting[] =
      section === 'TOP_RANKED' ? ['PLAYER_EQUAL'] : weightingsForMode(input.displayMode);
    for (const weighting of weightings) {
      rankings.push({
        section,
        weighting,
        cards: buildCardRanking(cohort, weighting),
      });
    }
  }

  return {
    seasonId: input.seasonId,
    displayMode: input.displayMode,
    visibleSections: input.visibleSections,
    topRankedPlayerCount: input.topRankedPlayerCount,
    sample: {
      settledMatchCount: input.settledMatchCount,
      analyzedMatchCount,
      deckObservationCount: parsedObservations.length,
      playerCount,
      winningPlayerCount,
      topRankedEligiblePlayerCount: input.visibleSections.includes('TOP_RANKED')
        ? input.topRankedEligiblePlayerCount
        : 0,
      topRankedAnalyzedPlayerCount,
      topRankedDeckObservationCount: topRankedObservations.length,
      coverageRate:
        input.settledMatchCount === 0 ? 0 : analyzedMatchCount / input.settledMatchCount,
    },
    rankings,
  };
}

function buildCardRanking(
  observations: readonly ParsedObservation[],
  weighting: RankedSeasonCardEnvironmentWeighting
): readonly RankedSeasonCardUsageView[] {
  const deckCountByPlayer = new Map<string, number>();
  const aggregates = new Map<string, MutableCardAggregate>();
  for (const observation of observations) {
    deckCountByPlayer.set(
      observation.user_id,
      (deckCountByPlayer.get(observation.user_id) ?? 0) + 1
    );
    for (const card of observation.cards) {
      const aggregate = aggregates.get(card.baseCardCode) ?? {
        metadata: card,
        deckCount: 0,
        totalCopies: 0,
        deckCountByPlayer: new Map<string, number>(),
      };
      if (aggregate.metadata.cardType !== card.cardType) {
        throw environmentError(
          'RANKED_ENVIRONMENT_OBSERVATION_INVALID',
          `基础卡号 ${card.baseCardCode} 的卡牌类型不一致`,
          500
        );
      }
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

  const cohortPlayerCount = deckCountByPlayer.size;
  return [...aggregates.entries()]
    .map(([baseCardCode, aggregate]): Omit<RankedSeasonCardUsageView, 'rank'> => {
      let adoptionRate = 0;
      if (weighting === 'MATCH_EQUAL') {
        adoptionRate = observations.length === 0 ? 0 : aggregate.deckCount / observations.length;
      } else {
        let playerBalancedUsage = 0;
        for (const [userId, deckCount] of aggregate.deckCountByPlayer) {
          const playerTotal = deckCountByPlayer.get(userId);
          if (!playerTotal) {
            throw environmentError(
              'RANKED_ENVIRONMENT_AGGREGATION_INVALID',
              '赛季环境玩家样本不一致',
              500
            );
          }
          playerBalancedUsage += deckCount / playerTotal;
        }
        adoptionRate = cohortPlayerCount === 0 ? 0 : playerBalancedUsage / cohortPlayerCount;
      }
      return {
        baseCardCode,
        cardCode: aggregate.metadata.cardCode,
        name: aggregate.metadata.name,
        cardType: aggregate.metadata.cardType,
        imageFilename: aggregate.metadata.imageFilename,
        adoptionRate: clampRate(adoptionRate),
        playerCount: aggregate.deckCountByPlayer.size,
        deckCount: aggregate.deckCount,
        averageCopies: aggregate.deckCount === 0 ? 0 : aggregate.totalCopies / aggregate.deckCount,
      };
    })
    .sort(
      (left, right) =>
        right.adoptionRate - left.adoptionRate ||
        right.playerCount - left.playerCount ||
        right.deckCount - left.deckCount ||
        compareCardCodes(left.baseCardCode, right.baseCardCode)
    )
    .slice(0, 30)
    .map((card, index) => ({ ...card, rank: index + 1 }));
}

function validateAnalyzableMatch(rows: readonly ParsedObservation[]): void {
  if (
    rows.length !== 2 ||
    new Set(rows.map((row) => row.seat)).size !== 2 ||
    new Set(rows.map((row) => row.user_id)).size !== 2 ||
    new Set(rows.map((row) => row.winner_seat)).size !== 1
  ) {
    throw environmentError(
      'RANKED_ENVIRONMENT_AGGREGATION_INVALID',
      '可分析排位对局没有恰好两席一致的卡组观察',
      500
    );
  }
}

function weightingsForMode(
  displayMode: DeckClassifierDisplayMode
): readonly RankedSeasonCardEnvironmentWeighting[] {
  if (displayMode === 'PLAYER_EQUAL') return ['PLAYER_EQUAL'];
  if (displayMode === 'MATCH_EQUAL') return ['MATCH_EQUAL'];
  if (displayMode === 'BOTH') return ['PLAYER_EQUAL', 'MATCH_EQUAL'];
  return [];
}

function readObservationRows(rows: readonly EnvironmentStatsRow[]): ObservationRow[] {
  const observations: ObservationRow[] = [];
  for (const row of rows) {
    if (row.match_id === null) {
      if (
        row.seat !== null ||
        row.user_id !== null ||
        row.winner_seat !== null ||
        row.top_ranked !== null ||
        row.main_deck_cards !== null
      ) {
        throw environmentError(
          'RANKED_ENVIRONMENT_AGGREGATION_INVALID',
          '赛季环境统计返回了不完整的观察行',
          500
        );
      }
      continue;
    }
    if (!row.seat || !row.user_id || !row.winner_seat || typeof row.top_ranked !== 'boolean') {
      throw environmentError(
        'RANKED_ENVIRONMENT_AGGREGATION_INVALID',
        '赛季环境统计返回了不完整的观察行',
        500
      );
    }
    observations.push({
      match_id: row.match_id,
      seat: row.seat,
      user_id: row.user_id,
      winner_seat: row.winner_seat,
      top_ranked: row.top_ranked,
      main_deck_cards: row.main_deck_cards,
    });
  }
  return observations;
}

function readObservationCards(value: unknown, matchId: string): ObservationCard[] {
  if (!Array.isArray(value) || value.length === 0) throw invalidObservation(matchId);
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry)) throw invalidObservation(matchId);
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
    return { baseCardCode, cardCode, name, cardType, count, imageFilename };
  });
}

function readCardDisplaySettings(
  row: EnvironmentDisplaySettingsRow | undefined
): EffectiveCardDisplaySettings {
  if (!row) {
    throw environmentError('RANKED_ENVIRONMENT_DISPLAY_INVALID', '赛季卡牌展示设置不存在', 500);
  }
  const visibleSections: DeckEnvironmentSection[] = [];
  if (row.card_show_usage) visibleSections.push('USAGE');
  if (row.card_show_winner) visibleSections.push('WINNER');
  if (row.card_show_top_ranked) visibleSections.push('TOP_RANKED');
  validateDisplaySettings(row.card_display_mode, visibleSections);
  if (
    !Number.isInteger(row.top_ranked_player_count) ||
    row.top_ranked_player_count < 10 ||
    row.top_ranked_player_count > 100
  ) {
    throw environmentError('RANKED_ENVIRONMENT_DISPLAY_INVALID', '高排名玩家统计人数无效', 500);
  }
  return {
    displayMode: row.card_display_mode,
    visibleSections,
    topRankedPlayerCount: row.top_ranked_player_count,
  };
}

function validateDisplaySettings(
  displayMode: DeckClassifierDisplayMode,
  visibleSections: readonly DeckEnvironmentSection[]
): void {
  if (
    !['HIDDEN', 'PLAYER_EQUAL', 'MATCH_EQUAL', 'BOTH'].includes(displayMode) ||
    new Set(visibleSections).size !== visibleSections.length ||
    visibleSections.some(
      (section) => section !== 'USAGE' && section !== 'WINNER' && section !== 'TOP_RANKED'
    ) ||
    (displayMode === 'HIDDEN') !== (visibleSections.length === 0)
  ) {
    throw environmentError('RANKED_ENVIRONMENT_DISPLAY_INVALID', '卡牌环境展示开关状态不一致', 500);
  }
}

function emptyEnvironment(
  seasonId: string,
  settings: EffectiveCardDisplaySettings
): RankedSeasonEnvironmentView {
  return {
    seasonId,
    displayMode: settings.displayMode,
    visibleSections: settings.visibleSections,
    topRankedPlayerCount: settings.topRankedPlayerCount,
    sample: {
      settledMatchCount: 0,
      analyzedMatchCount: 0,
      deckObservationCount: 0,
      playerCount: 0,
      winningPlayerCount: 0,
      topRankedEligiblePlayerCount: 0,
      topRankedAnalyzedPlayerCount: 0,
      topRankedDeckObservationCount: 0,
      coverageRate: 0,
    },
    rankings: [],
  };
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

const RANKED_CARD_STATS_QUERY = `WITH season_settings AS MATERIALIZED (
  SELECT leaderboard_minimum_match_count
  FROM ranked_seasons
  WHERE id = $1
), top_ranked_players AS MATERIALIZED (
  SELECT rating.user_id
  FROM ranked_player_ratings AS rating
  CROSS JOIN season_settings AS season
  WHERE rating.season_id = $1
    AND rating.rated_match_count >= season.leaderboard_minimum_match_count
    AND $3::boolean
  ORDER BY rating.rating DESC, rating.user_id ASC
  LIMIT $2
), settled_matches AS MATERIALIZED (
  SELECT match_id, first_user_id, second_user_id, winner_seat
  FROM ranked_matches
  WHERE season_id = $1
    AND rating_status = 'SETTLED'
), analyzable_matches AS MATERIALIZED (
  SELECT
    ranked_match.match_id,
    ranked_match.first_user_id,
    ranked_match.second_user_id,
    ranked_match.winner_seat
  FROM settled_matches AS ranked_match
  JOIN ranked_deck_observations AS observation
    ON observation.match_id = ranked_match.match_id
   AND observation.season_id = $1
  GROUP BY
    ranked_match.match_id,
    ranked_match.first_user_id,
    ranked_match.second_user_id,
    ranked_match.winner_seat
  HAVING count(*) = 2
    AND count(*) FILTER (WHERE observation.seat = 'FIRST') = 1
    AND count(*) FILTER (WHERE observation.seat = 'SECOND') = 1
    AND bool_and(
      observation.user_id = CASE observation.seat
        WHEN 'FIRST' THEN ranked_match.first_user_id
        ELSE ranked_match.second_user_id
      END
    )
), observation_rows AS (
  SELECT
    observation.match_id,
    observation.seat,
    observation.user_id,
    analyzable.winner_seat,
    top_player.user_id IS NOT NULL AS top_ranked,
    observation.main_deck_cards
  FROM analyzable_matches AS analyzable
  JOIN ranked_deck_observations AS observation
    ON observation.match_id = analyzable.match_id
   AND observation.season_id = $1
  LEFT JOIN top_ranked_players AS top_player ON top_player.user_id = observation.user_id
), totals AS (
  SELECT
    (SELECT count(*) FROM settled_matches) AS settled_match_count,
    (SELECT count(*) FROM top_ranked_players) AS top_ranked_eligible_player_count
)
SELECT
  totals.settled_match_count,
  totals.top_ranked_eligible_player_count,
  observation.match_id,
  observation.seat,
  observation.user_id,
  observation.winner_seat,
  observation.top_ranked,
  observation.main_deck_cards
FROM totals
LEFT JOIN observation_rows AS observation ON TRUE
ORDER BY observation.match_id ASC NULLS LAST, observation.seat ASC NULLS LAST`;

export const rankedEnvironmentService = new RankedEnvironmentService();
