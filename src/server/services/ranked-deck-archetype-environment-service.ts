import type {
  DeckArchetypeEnvironmentEntryView,
  DeckArchetypeEnvironmentView,
  DeckClassifierDisplayMode,
  DeckEnvironmentSection,
} from '../../online/deck-classifier-types.js';
import { pool } from '../db/pool.js';
import {
  hashDeckClassifierSnapshot,
  readDeckClassifierSnapshot,
  type DeckClassifierReleaseArchetype,
} from './deck-classifier-release.js';

export interface DeckArchetypeEnvironmentQueryResult<T> {
  readonly rows: T[];
  readonly rowCount?: number | null;
}

export interface DeckArchetypeEnvironmentQueryClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<DeckArchetypeEnvironmentQueryResult<T>>;
}

interface SeasonRow {
  readonly id: string;
}

interface ActiveReleaseRow {
  readonly display_mode: DeckClassifierDisplayMode;
  readonly show_usage: boolean;
  readonly show_winner: boolean;
  readonly show_top_ranked: boolean;
  readonly top_ranked_player_count: number;
  readonly id: string | null;
  readonly version: number | null;
  readonly snapshot_json: unknown;
  readonly config_hash: string | null;
  readonly published_at: Date | string | null;
  readonly activated_at: Date | string | null;
}

interface EffectiveDisplaySettings {
  readonly displayMode: DeckClassifierDisplayMode;
  readonly visibleSections: readonly DeckEnvironmentSection[];
  readonly topRankedPlayerCount: number;
}

const DEFAULT_DISPLAY_SETTINGS: EffectiveDisplaySettings = {
  displayMode: 'BOTH',
  visibleSections: ['USAGE', 'WINNER'],
  topRankedPlayerCount: 30,
};

export interface DeckArchetypeAssignmentStatsRow {
  readonly settled_match_count: number | string;
  readonly observed_match_count: number | string;
  readonly assigned_observation_count: number | string;
  readonly recognized_observation_count: number | string;
  readonly top_ranked_eligible_player_count: number | string;
  readonly match_id: string | null;
  readonly seat: 'FIRST' | 'SECOND' | null;
  readonly user_id: string | null;
  readonly winner_seat: 'FIRST' | 'SECOND' | null;
  readonly status: 'CLASSIFIED' | 'UNKNOWN' | 'AMBIGUOUS' | null;
  readonly archetype_id: string | null;
  readonly top_ranked: boolean | null;
}

export interface DeckArchetypeDisplayRow {
  readonly id: string;
  readonly color_key: string;
  readonly representative_card_code: string | null;
  readonly representative_image_filename: string | null;
}

export interface DeckClassifierEnvironmentArchetype extends DeckClassifierReleaseArchetype {
  readonly color: string;
  readonly representativeCardCode: string | null;
  readonly representativeImageFilename: string | null;
}

export interface AggregateDeckArchetypeEnvironmentInput {
  readonly seasonId: string;
  readonly displayMode: DeckClassifierDisplayMode;
  readonly visibleSections: readonly DeckEnvironmentSection[];
  readonly topRankedPlayerCount: number;
  readonly topRankedEligiblePlayerCount: number;
  readonly release: { readonly id: string; readonly version: number; readonly publishedAt: number };
  readonly archetypes: readonly DeckClassifierEnvironmentArchetype[];
  readonly settledMatchCount: number;
  readonly observedMatchCount: number;
  readonly assignedObservationCount: number;
  readonly recognizedObservationCount: number;
  readonly assignments: readonly {
    readonly matchId: string;
    readonly seat: 'FIRST' | 'SECOND';
    readonly userId: string;
    readonly winnerSeat: 'FIRST' | 'SECOND';
    readonly status: 'CLASSIFIED' | 'UNKNOWN' | 'AMBIGUOUS';
    readonly archetypeId: string | null;
    readonly topRanked: boolean;
  }[];
}

interface MutableAggregate {
  readonly metadata: EffectiveArchetype;
  appearanceCount: number;
  winnerCount: number;
  mirrorAppearanceCount: number;
  nonMirrorAppearanceCount: number;
  nonMirrorWinnerCount: number;
  readonly players: Set<string>;
  readonly appearancesByPlayer: Map<string, number>;
  readonly winsByPlayer: Map<string, number>;
  readonly topRankedAppearancesByPlayer: Map<string, number>;
}

interface EffectiveArchetype {
  readonly id: string;
  readonly archetypeKey: string;
  readonly name: string;
  readonly groupName: string;
  readonly color: string;
  readonly representativeCardCode: string | null;
  readonly representativeImageFilename: string | null;
  readonly sortOrder: number;
  readonly classificationStatus: 'CLASSIFIED' | 'UNKNOWN' | 'AMBIGUOUS';
}

const UNKNOWN_ARCHETYPE: EffectiveArchetype = {
  id: 'system:other_unknown',
  archetypeKey: 'other_unknown',
  name: '其他／未识别',
  groupName: '系统',
  color: '#94A3B8',
  representativeCardCode: null,
  representativeImageFilename: null,
  sortOrder: 1_000_000,
  classificationStatus: 'UNKNOWN',
};

const AMBIGUOUS_ARCHETYPE: EffectiveArchetype = {
  id: 'system:ambiguous',
  archetypeKey: 'ambiguous',
  name: '分类冲突／待复核',
  groupName: '系统',
  color: '#F59E0B',
  representativeCardCode: null,
  representativeImageFilename: null,
  sortOrder: 1_000_001,
  classificationStatus: 'AMBIGUOUS',
};

export class RankedDeckArchetypeEnvironmentServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'RankedDeckArchetypeEnvironmentServiceError';
  }
}

export class RankedDeckArchetypeEnvironmentService {
  constructor(private readonly queryClient: DeckArchetypeEnvironmentQueryClient = pool) {}

  async getSeasonEnvironment(seasonId: string): Promise<DeckArchetypeEnvironmentView> {
    const season = await this.queryClient.query<SeasonRow>(
      `SELECT id FROM ranked_seasons
       WHERE id = $1 AND lifecycle IN ('ACTIVE', 'FINALIZING', 'CLOSED')`,
      [seasonId]
    );
    if (!season.rows[0]) {
      throw environmentError('RANKED_SEASON_NOT_FOUND', '排位赛季不存在', 404);
    }

    const releaseResult = await this.queryClient.query<ActiveReleaseRow>(
      `SELECT settings.display_mode, settings.show_usage, settings.show_winner,
              settings.show_top_ranked, settings.top_ranked_player_count,
              release.id, release.version, release.snapshot_json,
              release.config_hash, release.published_at, release.activated_at
       FROM deck_classifier_settings AS settings
       LEFT JOIN deck_classifier_releases AS release ON release.status = 'ACTIVE'
       WHERE settings.id = 1`
    );
    const release = releaseResult.rows[0];
    const displaySettings = release ? readDisplaySettings(release) : DEFAULT_DISPLAY_SETTINGS;
    if (displaySettings.visibleSections.length === 0) {
      return emptyEnvironment(seasonId, displaySettings, 0);
    }
    if (!release?.id || release.version === null || release.published_at === null) {
      const settled = await this.queryClient.query<{ count: number | string }>(
        `SELECT count(*) AS count FROM ranked_matches
         WHERE season_id = $1 AND rating_status = 'SETTLED'`,
        [seasonId]
      );
      return emptyEnvironment(seasonId, displaySettings, readCount(settled.rows[0]?.count ?? 0));
    }
    const snapshot = readDeckClassifierSnapshot(release.snapshot_json);
    if (!release.config_hash || hashDeckClassifierSnapshot(snapshot) !== release.config_hash) {
      throw environmentError(
        'RANKED_DECK_CLASSIFIER_SNAPSHOT_INVALID',
        '卡组分类发布快照完整性校验失败',
        500
      );
    }
    const archetypeDisplayResult = await this.queryClient.query<DeckArchetypeDisplayRow>(
      `SELECT archetype.id, archetype.color_key, archetype.representative_card_code,
              representative_card.image_filename AS representative_image_filename
       FROM deck_archetypes AS archetype
       LEFT JOIN cards AS representative_card
         ON representative_card.card_code = archetype.representative_card_code
       WHERE archetype.id = ANY($1::uuid[])`,
      [snapshot.archetypes.map((archetype) => archetype.id)]
    );
    const archetypes = mergeLiveArchetypeDisplaySettings(
      snapshot.archetypes,
      archetypeDisplayResult.rows
    );
    const stats = await this.queryClient.query<DeckArchetypeAssignmentStatsRow>(
      DECK_ARCHETYPE_STATS_QUERY,
      [seasonId, release.id, displaySettings.topRankedPlayerCount]
    );
    const first = stats.rows[0];
    if (!first) {
      throw environmentError(
        'RANKED_DECK_ARCHETYPE_AGGREGATION_INVALID',
        '赛季卡组分类统计查询没有返回汇总行',
        500
      );
    }
    return aggregateDeckArchetypeEnvironment({
      seasonId,
      displayMode: displaySettings.displayMode,
      visibleSections: displaySettings.visibleSections,
      topRankedPlayerCount: displaySettings.topRankedPlayerCount,
      topRankedEligiblePlayerCount: readCount(first.top_ranked_eligible_player_count),
      release: {
        id: release.id,
        version: release.version,
        publishedAt: toTimestamp(release.activated_at ?? release.published_at),
      },
      archetypes,
      settledMatchCount: readCount(first.settled_match_count),
      observedMatchCount: readCount(first.observed_match_count),
      assignedObservationCount: readCount(first.assigned_observation_count),
      recognizedObservationCount: readCount(first.recognized_observation_count),
      assignments: stats.rows.flatMap((row) => {
        if (!row.match_id || !row.seat || !row.user_id || !row.winner_seat || !row.status) {
          return [];
        }
        return [
          {
            matchId: row.match_id,
            seat: row.seat,
            userId: row.user_id,
            winnerSeat: row.winner_seat,
            status: row.status,
            archetypeId: row.archetype_id,
            topRanked: row.top_ranked === true,
          },
        ];
      }),
    });
  }
}

export function aggregateDeckArchetypeEnvironment(
  input: AggregateDeckArchetypeEnvironmentInput
): DeckArchetypeEnvironmentView {
  const metadataById = new Map<string, EffectiveArchetype>(
    input.archetypes.map((archetype) => [
      archetype.id,
      { ...archetype, classificationStatus: 'CLASSIFIED' as const },
    ])
  );
  const effectiveRows = input.assignments.map((assignment) => ({
    ...assignment,
    metadata: resolveEffectiveArchetype(assignment, metadataById),
  }));
  const rowsByMatch = new Map<string, typeof effectiveRows>();
  const appearancesPerPlayer = new Map<string, number>();
  const winsPerPlayer = new Map<string, number>();
  const topRankedAppearancesPerPlayer = new Map<string, number>();
  const aggregates = new Map<string, MutableAggregate>();

  for (const row of effectiveRows) {
    const matchRows = rowsByMatch.get(row.matchId) ?? [];
    matchRows.push(row);
    rowsByMatch.set(row.matchId, matchRows);
    appearancesPerPlayer.set(row.userId, (appearancesPerPlayer.get(row.userId) ?? 0) + 1);
    const isWinner = row.seat === row.winnerSeat;
    if (isWinner) winsPerPlayer.set(row.userId, (winsPerPlayer.get(row.userId) ?? 0) + 1);
    const aggregate = getAggregate(aggregates, row.metadata);
    aggregate.appearanceCount += 1;
    aggregate.players.add(row.userId);
    aggregate.appearancesByPlayer.set(
      row.userId,
      (aggregate.appearancesByPlayer.get(row.userId) ?? 0) + 1
    );
    if (isWinner) {
      aggregate.winnerCount += 1;
      aggregate.winsByPlayer.set(row.userId, (aggregate.winsByPlayer.get(row.userId) ?? 0) + 1);
    }
    if (row.topRanked) {
      topRankedAppearancesPerPlayer.set(
        row.userId,
        (topRankedAppearancesPerPlayer.get(row.userId) ?? 0) + 1
      );
      aggregate.topRankedAppearancesByPlayer.set(
        row.userId,
        (aggregate.topRankedAppearancesByPlayer.get(row.userId) ?? 0) + 1
      );
    }
  }

  for (const rows of rowsByMatch.values()) {
    if (rows.length !== 2) {
      throw environmentError(
        'RANKED_DECK_ARCHETYPE_AGGREGATION_INVALID',
        '可分析排位对局没有恰好两席分类结果',
        500
      );
    }
    const [first, second] = rows;
    if (!first || !second) continue;
    if (first.metadata.id === second.metadata.id) {
      getAggregate(aggregates, first.metadata).mirrorAppearanceCount += 2;
      continue;
    }
    if (
      first.metadata.classificationStatus === 'CLASSIFIED' &&
      second.metadata.classificationStatus === 'CLASSIFIED'
    ) {
      for (const row of rows) {
        const aggregate = getAggregate(aggregates, row.metadata);
        aggregate.nonMirrorAppearanceCount += 1;
        if (row.seat === row.winnerSeat) aggregate.nonMirrorWinnerCount += 1;
      }
    }
  }

  const analyzedMatchCount = rowsByMatch.size;
  const deckObservationCount = input.observedMatchCount * 2;
  if (
    input.observedMatchCount > input.settledMatchCount ||
    input.assignedObservationCount > deckObservationCount ||
    input.recognizedObservationCount > input.assignedObservationCount ||
    effectiveRows.length > input.assignedObservationCount ||
    analyzedMatchCount > input.observedMatchCount ||
    input.topRankedEligiblePlayerCount > input.topRankedPlayerCount ||
    topRankedAppearancesPerPlayer.size > input.topRankedEligiblePlayerCount
  ) {
    throw environmentError(
      'RANKED_DECK_ARCHETYPE_AGGREGATION_INVALID',
      '卡组分类统计的结算、观察、分类或可分析样本数量不一致',
      500
    );
  }
  const playerCount = appearancesPerPlayer.size;
  const winningPlayerCount = winsPerPlayer.size;
  const topRankedAnalyzedPlayerCount = topRankedAppearancesPerPlayer.size;
  const entries = [...aggregates.values()]
    .map((aggregate): DeckArchetypeEnvironmentEntryView => {
      let playerEqualUsageRate = 0;
      for (const [userId, count] of aggregate.appearancesByPlayer) {
        playerEqualUsageRate += count / requirePositive(appearancesPerPlayer.get(userId));
      }
      let playerEqualWinnerRate = 0;
      for (const [userId, count] of aggregate.winsByPlayer) {
        playerEqualWinnerRate += count / requirePositive(winsPerPlayer.get(userId));
      }
      let topRankedPlayerEqualUsageRate = 0;
      for (const [userId, count] of aggregate.topRankedAppearancesByPlayer) {
        topRankedPlayerEqualUsageRate +=
          count / requirePositive(topRankedAppearancesPerPlayer.get(userId));
      }
      return {
        archetypeId: aggregate.metadata.id,
        archetypeKey: aggregate.metadata.archetypeKey,
        name: aggregate.metadata.name,
        groupName: aggregate.metadata.groupName,
        color: aggregate.metadata.color,
        representativeCardCode: aggregate.metadata.representativeCardCode ?? null,
        representativeImageFilename: aggregate.metadata.representativeImageFilename ?? null,
        sortOrder: aggregate.metadata.sortOrder,
        classificationStatus: aggregate.metadata.classificationStatus,
        appearanceCount: aggregate.appearanceCount,
        winnerCount: aggregate.winnerCount,
        playerCount: aggregate.players.size,
        playerEqualUsageRate: playerCount === 0 ? 0 : clampRate(playerEqualUsageRate / playerCount),
        matchEqualUsageRate:
          effectiveRows.length === 0
            ? 0
            : clampRate(aggregate.appearanceCount / effectiveRows.length),
        playerEqualWinnerRate:
          winningPlayerCount === 0 ? 0 : clampRate(playerEqualWinnerRate / winningPlayerCount),
        matchEqualWinnerRate:
          analyzedMatchCount === 0 ? 0 : clampRate(aggregate.winnerCount / analyzedMatchCount),
        winRate:
          aggregate.appearanceCount === 0
            ? null
            : clampRate(aggregate.winnerCount / aggregate.appearanceCount),
        nonMirrorAppearanceCount: aggregate.nonMirrorAppearanceCount,
        nonMirrorWinRate:
          aggregate.nonMirrorAppearanceCount === 0
            ? null
            : clampRate(aggregate.nonMirrorWinnerCount / aggregate.nonMirrorAppearanceCount),
        mirrorAppearanceCount: aggregate.mirrorAppearanceCount,
        topRankedPlayerEqualUsageRate:
          topRankedAnalyzedPlayerCount === 0
            ? 0
            : clampRate(topRankedPlayerEqualUsageRate / topRankedAnalyzedPlayerCount),
      };
    })
    .sort(
      (left, right) =>
        right.matchEqualUsageRate - left.matchEqualUsageRate ||
        left.sortOrder - right.sortOrder ||
        left.archetypeKey.localeCompare(right.archetypeKey)
    );

  return {
    available: true,
    seasonId: input.seasonId,
    displayMode: input.displayMode,
    visibleSections: input.visibleSections,
    topRankedPlayerCount: input.topRankedPlayerCount,
    release: input.release,
    sample: {
      settledMatchCount: input.settledMatchCount,
      analyzedMatchCount,
      deckObservationCount,
      assignedDeckObservationCount: input.assignedObservationCount,
      recognizedDeckObservationCount: input.recognizedObservationCount,
      playerCount,
      winningPlayerCount,
      topRankedEligiblePlayerCount: input.topRankedEligiblePlayerCount,
      topRankedAnalyzedPlayerCount,
      observationCoverageRate:
        input.settledMatchCount === 0
          ? 0
          : clampRate(input.observedMatchCount / input.settledMatchCount),
      classificationCoverageRate:
        deckObservationCount === 0
          ? 0
          : clampRate(input.assignedObservationCount / deckObservationCount),
    },
    archetypes: entries,
  };
}

export function mergeLiveArchetypeDisplaySettings(
  archetypes: readonly DeckClassifierReleaseArchetype[],
  displayRows: readonly DeckArchetypeDisplayRow[]
): readonly DeckClassifierEnvironmentArchetype[] {
  const byId = new Map(displayRows.map((row) => [row.id, row]));
  if (byId.size !== displayRows.length) {
    throw environmentError(
      'RANKED_DECK_ARCHETYPE_DISPLAY_INVALID',
      '卡组分类展示设置包含重复分类',
      500
    );
  }
  return archetypes.map((archetype) => {
    const display = byId.get(archetype.id);
    if (!display) {
      throw environmentError(
        'RANKED_DECK_ARCHETYPE_DISPLAY_INVALID',
        `卡组分类 ${archetype.archetypeKey} 缺少展示设置`,
        500
      );
    }
    if (!/^#[0-9a-f]{6}$/i.test(display.color_key)) {
      throw environmentError(
        'RANKED_DECK_ARCHETYPE_DISPLAY_INVALID',
        `卡组分类 ${archetype.archetypeKey} 的展示颜色无效`,
        500
      );
    }
    return {
      ...archetype,
      color: display.color_key.toUpperCase(),
      representativeCardCode: display.representative_card_code,
      representativeImageFilename: display.representative_image_filename,
    };
  });
}

const DECK_ARCHETYPE_STATS_QUERY = `WITH season_settings AS MATERIALIZED (
  SELECT leaderboard_minimum_match_count
  FROM ranked_seasons
  WHERE id = $1
), top_ranked_players AS MATERIALIZED (
  SELECT rating.user_id
  FROM ranked_player_ratings AS rating
  CROSS JOIN season_settings AS season
  WHERE rating.season_id = $1
    AND rating.rated_match_count >= season.leaderboard_minimum_match_count
  ORDER BY rating.rating DESC, rating.user_id ASC
  LIMIT $3
), settled_matches AS MATERIALIZED (
  SELECT match_id, first_user_id, second_user_id, winner_seat
  FROM ranked_matches
  WHERE season_id = $1 AND rating_status = 'SETTLED'
), observed_matches AS MATERIALIZED (
  SELECT ranked_match.match_id
  FROM settled_matches AS ranked_match
  JOIN ranked_deck_observations AS observation
    ON observation.match_id = ranked_match.match_id AND observation.season_id = $1
  GROUP BY ranked_match.match_id, ranked_match.first_user_id, ranked_match.second_user_id
  HAVING count(*) = 2
    AND count(*) FILTER (WHERE observation.seat = 'FIRST') = 1
    AND count(*) FILTER (WHERE observation.seat = 'SECOND') = 1
    AND bool_and(observation.user_id = CASE observation.seat
      WHEN 'FIRST' THEN ranked_match.first_user_id ELSE ranked_match.second_user_id END)
), candidate_rows AS MATERIALIZED (
  SELECT observation.match_id, observation.seat, observation.user_id,
         ranked_match.winner_seat, assignment.status, assignment.archetype_id,
         top_player.user_id IS NOT NULL AS top_ranked
  FROM observed_matches
  JOIN settled_matches AS ranked_match USING (match_id)
  JOIN ranked_deck_observations AS observation
    ON observation.match_id = ranked_match.match_id AND observation.season_id = $1
  JOIN deck_classification_assignments AS assignment
    ON assignment.match_id = observation.match_id
   AND assignment.seat = observation.seat
   AND assignment.release_id = $2
  LEFT JOIN top_ranked_players AS top_player ON top_player.user_id = observation.user_id
  WHERE assignment.status IN ('CLASSIFIED', 'UNKNOWN', 'AMBIGUOUS')
), analyzable_matches AS MATERIALIZED (
  SELECT match_id
  FROM candidate_rows
  GROUP BY match_id
  HAVING count(*) = 2
    AND count(*) FILTER (WHERE seat = 'FIRST') = 1
    AND count(*) FILTER (WHERE seat = 'SECOND') = 1
), effective_rows AS (
  SELECT candidate.*
  FROM candidate_rows AS candidate
  JOIN analyzable_matches USING (match_id)
), totals AS (
  SELECT
    (SELECT count(*) FROM settled_matches) AS settled_match_count,
    (SELECT count(*) FROM observed_matches) AS observed_match_count,
    (SELECT count(*) FROM candidate_rows) AS assigned_observation_count,
    (SELECT count(*) FROM candidate_rows WHERE status = 'CLASSIFIED') AS recognized_observation_count,
    (SELECT count(*) FROM top_ranked_players) AS top_ranked_eligible_player_count
)
SELECT totals.*, effective.match_id, effective.seat, effective.user_id,
       effective.winner_seat, effective.status, effective.archetype_id, effective.top_ranked
FROM totals
LEFT JOIN effective_rows AS effective ON TRUE
ORDER BY effective.match_id ASC NULLS LAST, effective.seat ASC NULLS LAST`;

function resolveEffectiveArchetype(
  assignment: AggregateDeckArchetypeEnvironmentInput['assignments'][number],
  metadataById: ReadonlyMap<string, EffectiveArchetype>
): EffectiveArchetype {
  if (assignment.status === 'UNKNOWN') return UNKNOWN_ARCHETYPE;
  if (assignment.status === 'AMBIGUOUS') return AMBIGUOUS_ARCHETYPE;
  if (!assignment.archetypeId) {
    throw environmentError(
      'RANKED_DECK_ARCHETYPE_ASSIGNMENT_INVALID',
      '已分类卡组缺少分类 ID',
      500
    );
  }
  const metadata = metadataById.get(assignment.archetypeId);
  if (!metadata) {
    throw environmentError(
      'RANKED_DECK_ARCHETYPE_ASSIGNMENT_INVALID',
      '卡组分类结果不在对应发布快照中',
      500
    );
  }
  return metadata;
}

function getAggregate(
  aggregates: Map<string, MutableAggregate>,
  metadata: EffectiveArchetype
): MutableAggregate {
  const existing = aggregates.get(metadata.id);
  if (existing) return existing;
  const created: MutableAggregate = {
    metadata,
    appearanceCount: 0,
    winnerCount: 0,
    mirrorAppearanceCount: 0,
    nonMirrorAppearanceCount: 0,
    nonMirrorWinnerCount: 0,
    players: new Set(),
    appearancesByPlayer: new Map(),
    winsByPlayer: new Map(),
    topRankedAppearancesByPlayer: new Map(),
  };
  aggregates.set(metadata.id, created);
  return created;
}

function emptyEnvironment(
  seasonId: string,
  displaySettings: EffectiveDisplaySettings,
  settledMatchCount: number
): DeckArchetypeEnvironmentView {
  return {
    available: false,
    seasonId,
    displayMode: displaySettings.displayMode,
    visibleSections: displaySettings.visibleSections,
    topRankedPlayerCount: displaySettings.topRankedPlayerCount,
    release: null,
    sample: {
      settledMatchCount,
      analyzedMatchCount: 0,
      deckObservationCount: 0,
      assignedDeckObservationCount: 0,
      recognizedDeckObservationCount: 0,
      playerCount: 0,
      winningPlayerCount: 0,
      topRankedEligiblePlayerCount: 0,
      topRankedAnalyzedPlayerCount: 0,
      observationCoverageRate: 0,
      classificationCoverageRate: 0,
    },
    archetypes: [],
  };
}

function readDisplaySettings(row: ActiveReleaseRow): EffectiveDisplaySettings {
  const visibleSections: DeckEnvironmentSection[] = [];
  if (row.show_usage) visibleSections.push('USAGE');
  if (row.show_winner) visibleSections.push('WINNER');
  if (row.show_top_ranked) visibleSections.push('TOP_RANKED');
  if (
    !Number.isInteger(row.top_ranked_player_count) ||
    row.top_ranked_player_count < 10 ||
    row.top_ranked_player_count > 100
  ) {
    throw environmentError('RANKED_DECK_CLASSIFIER_DISPLAY_INVALID', '高排名玩家统计人数无效', 500);
  }
  if ((row.display_mode === 'HIDDEN') !== (visibleSections.length === 0)) {
    throw environmentError(
      'RANKED_DECK_CLASSIFIER_DISPLAY_INVALID',
      '卡组环境展示开关状态不一致',
      500
    );
  }
  return {
    displayMode: row.display_mode,
    visibleSections,
    topRankedPlayerCount: row.top_ranked_player_count,
  };
}

function readCount(value: number | string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw environmentError('RANKED_DECK_ARCHETYPE_COUNT_INVALID', '卡组分类统计数量无效', 500);
  }
  return count;
}

function requirePositive(value: number | undefined): number {
  if (!value || value <= 0) {
    throw environmentError(
      'RANKED_DECK_ARCHETYPE_AGGREGATION_INVALID',
      '卡组分类玩家样本无效',
      500
    );
  }
  return value;
}

function toTimestamp(value: Date | string): number {
  const result = new Date(value).getTime();
  if (!Number.isFinite(result)) {
    throw environmentError('RANKED_DECK_ARCHETYPE_DATE_INVALID', '卡组分类发布时间无效', 500);
  }
  return result;
}

function clampRate(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function environmentError(
  code: string,
  message: string,
  statusCode = 400
): RankedDeckArchetypeEnvironmentServiceError {
  return new RankedDeckArchetypeEnvironmentServiceError(code, message, statusCode);
}

export const rankedDeckArchetypeEnvironmentService = new RankedDeckArchetypeEnvironmentService();
