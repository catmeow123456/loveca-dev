import JSZip from 'jszip';
import type { RankedDeckObservationCard } from '../db/schema.js';

export const RANKED_ANALYSIS_EXPORT_SCHEMA_VERSION = 'loveca-ranked-analysis-export-v1';

export interface RankedAnalysisSeasonRow {
  readonly season_key: string;
  readonly name: string;
  readonly lifecycle: string;
  readonly starts_at: Date | string;
  readonly scheduled_ends_at: Date | string;
  readonly closed_at: Date | string | null;
  readonly rules_version: string;
  readonly card_catalog_version: string;
  readonly card_catalog_hash: string;
  readonly deck_policy_version: string;
  readonly rating_algorithm_version: string;
  readonly rating_config: unknown;
  readonly leaderboard_minimum_match_count: number;
  readonly ledger_revision: number;
}

export interface RankedAnalysisMatchRow {
  readonly match_id: string;
  readonly first_user_id: string;
  readonly second_user_id: string;
  readonly rating_status: string;
  readonly winner_seat: string | null;
  readonly result_type: string | null;
  readonly used_free: boolean;
  readonly rules_version: string;
  readonly card_catalog_version: string;
  readonly card_catalog_hash: string;
  readonly deck_policy_version: string;
  readonly rating_algorithm_version: string;
  readonly ended_at: Date | string | null;
  readonly settled_at: Date | string | null;
  readonly created_at: Date | string;
}

export interface RankedAnalysisRatingEventRow {
  readonly id: string;
  readonly event_sequence: number;
  readonly event_type: string;
  readonly match_id: string;
  readonly target_event_id: string | null;
  readonly first_user_id: string;
  readonly second_user_id: string;
  readonly winner_seat: string | null;
  readonly result_type: string;
  readonly rated_at: Date | string;
  readonly algorithm_version: string;
  readonly created_at: Date | string;
}

export interface RankedAnalysisRatingStepRow {
  readonly event_id: string;
  readonly step_index: number;
  readonly source_result_event_id: string;
  readonly match_id: string;
  readonly first_user_id: string;
  readonly second_user_id: string;
  readonly winner_seat: string;
  readonly rated_at: Date | string;
  readonly first_before_rating: number;
  readonly first_before_deviation: number;
  readonly first_before_match_count: number;
  readonly first_before_last_rated_at: Date | string | null;
  readonly first_after_rating: number;
  readonly first_after_deviation: number;
  readonly first_after_match_count: number;
  readonly first_after_last_rated_at: Date | string | null;
  readonly second_before_rating: number;
  readonly second_before_deviation: number;
  readonly second_before_match_count: number;
  readonly second_before_last_rated_at: Date | string | null;
  readonly second_after_rating: number;
  readonly second_after_deviation: number;
  readonly second_after_match_count: number;
  readonly second_after_last_rated_at: Date | string | null;
  readonly created_at: Date | string;
}

export interface RankedAnalysisSeedRow {
  readonly user_id: string;
  readonly source_season_key: string | null;
  readonly rating: number;
  readonly rating_deviation: number;
  readonly created_at: Date | string;
}

export interface RankedAnalysisProjectionRow {
  readonly user_id: string;
  readonly rating: number;
  readonly rating_deviation: number;
  readonly rated_match_count: number;
  readonly last_rated_at: Date | string | null;
  readonly ledger_revision: number;
  readonly updated_at: Date | string;
}

export interface RankedAnalysisDeckObservationRow {
  readonly match_id: string;
  readonly seat: 'FIRST' | 'SECOND';
  readonly user_id: string;
  readonly deck_fingerprint: string;
  readonly main_deck_cards: unknown;
  readonly observed_at: Date | string;
}

export interface RankedAnalysisExportSource {
  readonly season: RankedAnalysisSeasonRow;
  readonly matches: readonly RankedAnalysisMatchRow[];
  readonly ratingEvents: readonly RankedAnalysisRatingEventRow[];
  readonly ratingSteps: readonly RankedAnalysisRatingStepRow[];
  readonly seeds: readonly RankedAnalysisSeedRow[];
  readonly projections: readonly RankedAnalysisProjectionRow[];
  readonly deckObservations: readonly RankedAnalysisDeckObservationRow[];
}

export interface RankedAnalysisExportFiles {
  readonly filename: string;
  readonly files: Readonly<Record<string, string>>;
}

type CsvValue = string | number | boolean | null;

interface DeckExportEntry {
  readonly deckId: string;
  readonly cards: readonly RankedDeckObservationCard[];
}

export function buildRankedAnalysisExportFiles(
  source: RankedAnalysisExportSource,
  generatedAt = new Date()
): RankedAnalysisExportFiles {
  const matches = [...source.matches].sort(
    (left, right) =>
      toTimestamp(left.created_at) - toTimestamp(right.created_at) ||
      left.match_id.localeCompare(right.match_id)
  );
  const ratingEvents = [...source.ratingEvents].sort(
    (left, right) => left.event_sequence - right.event_sequence || left.id.localeCompare(right.id)
  );
  const eventSequences = new Map(
    ratingEvents.map((event) => [event.id, event.event_sequence] as const)
  );
  const ratingSteps = [...source.ratingSteps].sort(
    (left, right) =>
      requireEventSequence(eventSequences, left.event_id) -
        requireEventSequence(eventSequences, right.event_id) || left.step_index - right.step_index
  );
  const playerIds = collectPlayerIds(source);
  const playerAliases = aliasMap(playerIds, 'player_', 6);
  const matchAliases = aliasMap(
    matches.map((match) => match.match_id),
    'match_',
    6
  );
  const eventAliases = aliasMap(
    ratingEvents.map((event) => event.id),
    'event_',
    6
  );
  const { deckAliases, decks } = collectDecks(source.deckObservations);

  const matchRows: CsvValue[][] = matches.map((match) => [
    requireAlias(matchAliases, match.match_id, 'match'),
    requireAlias(playerAliases, match.first_user_id, 'player'),
    requireAlias(playerAliases, match.second_user_id, 'player'),
    match.rating_status,
    match.winner_seat,
    match.result_type,
    match.used_free,
    match.rules_version,
    match.card_catalog_version,
    match.card_catalog_hash,
    match.deck_policy_version,
    match.rating_algorithm_version,
    isoDate(match.ended_at),
    isoDate(match.settled_at),
    isoDate(match.created_at),
  ]);
  const ratingEventRows: CsvValue[][] = ratingEvents.map((event) => [
    requireAlias(eventAliases, event.id, 'event'),
    event.event_sequence,
    event.event_type,
    requireAlias(matchAliases, event.match_id, 'match'),
    event.target_event_id
      ? requireAlias(eventAliases, event.target_event_id, 'target event')
      : null,
    requireAlias(playerAliases, event.first_user_id, 'player'),
    requireAlias(playerAliases, event.second_user_id, 'player'),
    event.winner_seat,
    event.result_type,
    isoDate(event.rated_at),
    event.algorithm_version,
    isoDate(event.created_at),
  ]);
  const ratingStepRows: CsvValue[][] = ratingSteps.map((step) => [
    requireAlias(eventAliases, step.event_id, 'event'),
    step.step_index,
    requireAlias(eventAliases, step.source_result_event_id, 'source event'),
    requireAlias(matchAliases, step.match_id, 'match'),
    requireAlias(playerAliases, step.first_user_id, 'player'),
    requireAlias(playerAliases, step.second_user_id, 'player'),
    step.winner_seat,
    isoDate(step.rated_at),
    step.first_before_rating,
    step.first_before_deviation,
    step.first_before_match_count,
    isoDate(step.first_before_last_rated_at),
    step.first_after_rating,
    step.first_after_deviation,
    step.first_after_match_count,
    isoDate(step.first_after_last_rated_at),
    step.second_before_rating,
    step.second_before_deviation,
    step.second_before_match_count,
    isoDate(step.second_before_last_rated_at),
    step.second_after_rating,
    step.second_after_deviation,
    step.second_after_match_count,
    isoDate(step.second_after_last_rated_at),
    isoDate(step.created_at),
  ]);
  const seedRows: CsvValue[][] = [...source.seeds]
    .sort((left, right) =>
      requireAlias(playerAliases, left.user_id, 'player').localeCompare(
        requireAlias(playerAliases, right.user_id, 'player')
      )
    )
    .map((seed) => [
      requireAlias(playerAliases, seed.user_id, 'player'),
      seed.source_season_key,
      seed.rating,
      seed.rating_deviation,
      isoDate(seed.created_at),
    ]);
  const projectionRows: CsvValue[][] = [...source.projections]
    .sort((left, right) =>
      requireAlias(playerAliases, left.user_id, 'player').localeCompare(
        requireAlias(playerAliases, right.user_id, 'player')
      )
    )
    .map((projection) => [
      requireAlias(playerAliases, projection.user_id, 'player'),
      projection.rating,
      projection.rating_deviation,
      projection.rated_match_count,
      isoDate(projection.last_rated_at),
      projection.ledger_revision,
      isoDate(projection.updated_at),
    ]);
  const observationRows: CsvValue[][] = [...source.deckObservations]
    .sort(
      (left, right) =>
        requireAlias(matchAliases, left.match_id, 'match').localeCompare(
          requireAlias(matchAliases, right.match_id, 'match')
        ) || left.seat.localeCompare(right.seat)
    )
    .map((observation) => [
      requireAlias(matchAliases, observation.match_id, 'match'),
      observation.seat,
      requireAlias(playerAliases, observation.user_id, 'player'),
      requireAlias(deckAliases, observation.deck_fingerprint, 'deck'),
      isoDate(observation.observed_at),
    ]);
  const deckCardRows: CsvValue[][] = decks.flatMap(({ deckId, cards }) =>
    cards.map((card) => [
      deckId,
      card.baseCardCode,
      card.cardCode,
      card.name,
      card.cardType,
      card.count,
    ])
  );

  const rowCounts = {
    matches: matchRows.length,
    ratingEvents: ratingEventRows.length,
    ratingSteps: ratingStepRows.length,
    playerSeeds: seedRows.length,
    playerProjections: projectionRows.length,
    deckObservations: observationRows.length,
    uniqueDecks: decks.length,
    deckCards: deckCardRows.length,
  };
  const manifest = {
    schemaVersion: RANKED_ANALYSIS_EXPORT_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    privacy: {
      identifierScope: '本次导出包',
      playerIds: '已替换为 player_XXXXXX，不包含用户名、显示名或账号 UUID',
      matchIds: '已替换为 match_XXXXXX，不包含原始对局 ID',
      ratingEventIds: '已替换为 event_XXXXXX，不包含原始事件 UUID',
      deckFingerprints: '已替换为 deck_XXXXXX，仅保留包内同卡组关联',
    },
    season: {
      seasonKey: source.season.season_key,
      name: source.season.name,
      lifecycle: source.season.lifecycle,
      startsAt: isoDate(source.season.starts_at),
      scheduledEndsAt: isoDate(source.season.scheduled_ends_at),
      closedAt: isoDate(source.season.closed_at),
      rulesVersion: source.season.rules_version,
      cardCatalogVersion: source.season.card_catalog_version,
      cardCatalogHash: source.season.card_catalog_hash,
      deckPolicyVersion: source.season.deck_policy_version,
      ratingAlgorithmVersion: source.season.rating_algorithm_version,
      ratingConfig: source.season.rating_config,
      leaderboardMinimumMatchCount: source.season.leaderboard_minimum_match_count,
      ledgerRevision: source.season.ledger_revision,
    },
    files: {
      'matches.csv': '排位对局结果事实，不含 match_records 完整记录或游戏状态',
      'rating_events.csv': '积分流水及修正关系，不含操作原因、幂等键或管理员身份',
      'rating_steps.csv': '每个流水步骤的双方积分、RD 和计分场次前后值',
      'player_seeds.csv': '赛季初始种子；玩家标识仅在本导出包内有效',
      'player_projections.csv': '当前积分投影；玩家标识仅在本导出包内有效',
      'deck_observations.csv': '逐局逐席位的长期排位卡组观察与匿名卡组标识',
      'deck_cards.csv': '按匿名卡组标识去重的主卡组卡牌与数量',
    },
    rowCounts,
    excluded: [
      'match_records 完整对局记录及其卡组快照',
      'authority checkpoint 与任何游戏状态快照',
      'timeline、public/private events 与 decision records',
      '聊天、房间、旁观与调试回放数据',
      '能量卡组与逐张实体卡实例',
      '用户名、显示名、邮箱、账号 UUID、原始对局 ID、原始事件 UUID与卡组指纹',
      '积分波动分位数、排行榜情景等派生分析结论',
    ],
    sourceBoundary: [
      'ranked_seasons',
      'ranked_matches',
      'ranked_rating_events',
      'ranked_rating_event_steps',
      'ranked_player_seeds',
      'ranked_player_ratings',
      'ranked_deck_observations',
    ],
  };
  const files: Record<string, string> = {
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'matches.csv': toCsv(
      [
        'match_id',
        'first_player_id',
        'second_player_id',
        'rating_status',
        'winner_seat',
        'result_type',
        'used_free',
        'rules_version',
        'card_catalog_version',
        'card_catalog_hash',
        'deck_policy_version',
        'rating_algorithm_version',
        'ended_at',
        'settled_at',
        'created_at',
      ],
      matchRows
    ),
    'rating_events.csv': toCsv(
      [
        'event_id',
        'event_sequence',
        'event_type',
        'match_id',
        'target_event_id',
        'first_player_id',
        'second_player_id',
        'winner_seat',
        'result_type',
        'rated_at',
        'algorithm_version',
        'created_at',
      ],
      ratingEventRows
    ),
    'rating_steps.csv': toCsv(
      [
        'event_id',
        'step_index',
        'source_result_event_id',
        'match_id',
        'first_player_id',
        'second_player_id',
        'winner_seat',
        'rated_at',
        'first_before_rating',
        'first_before_deviation',
        'first_before_match_count',
        'first_before_last_rated_at',
        'first_after_rating',
        'first_after_deviation',
        'first_after_match_count',
        'first_after_last_rated_at',
        'second_before_rating',
        'second_before_deviation',
        'second_before_match_count',
        'second_before_last_rated_at',
        'second_after_rating',
        'second_after_deviation',
        'second_after_match_count',
        'second_after_last_rated_at',
        'created_at',
      ],
      ratingStepRows
    ),
    'player_seeds.csv': toCsv(
      ['player_id', 'source_season_key', 'rating', 'rating_deviation', 'created_at'],
      seedRows
    ),
    'player_projections.csv': toCsv(
      [
        'player_id',
        'rating',
        'rating_deviation',
        'rated_match_count',
        'last_rated_at',
        'ledger_revision',
        'updated_at',
      ],
      projectionRows
    ),
    'deck_observations.csv': toCsv(
      ['match_id', 'seat', 'player_id', 'deck_id', 'observed_at'],
      observationRows
    ),
    'deck_cards.csv': toCsv(
      ['deck_id', 'base_card_code', 'card_code', 'card_name', 'card_type', 'count'],
      deckCardRows
    ),
  };
  return {
    filename: `loveca-ranked-analysis-${safeFilenamePart(source.season.season_key)}-${fileStamp(generatedAt)}.zip`,
    files,
  };
}

export async function createRankedAnalysisZip(
  source: RankedAnalysisExportSource,
  generatedAt = new Date()
): Promise<{ readonly filename: string; readonly buffer: Buffer }> {
  const exportFiles = buildRankedAnalysisExportFiles(source, generatedAt);
  const zip = new JSZip();
  for (const [filename, content] of Object.entries(exportFiles.files)) {
    zip.file(filename, content);
  }
  return {
    filename: exportFiles.filename,
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  };
}

function collectPlayerIds(source: RankedAnalysisExportSource): string[] {
  const ids = new Set<string>();
  for (const match of source.matches) {
    ids.add(match.first_user_id);
    ids.add(match.second_user_id);
  }
  for (const event of source.ratingEvents) {
    ids.add(event.first_user_id);
    ids.add(event.second_user_id);
  }
  for (const step of source.ratingSteps) {
    ids.add(step.first_user_id);
    ids.add(step.second_user_id);
  }
  for (const seed of source.seeds) ids.add(seed.user_id);
  for (const projection of source.projections) ids.add(projection.user_id);
  for (const observation of source.deckObservations) ids.add(observation.user_id);
  return [...ids].sort();
}

function collectDecks(observations: readonly RankedAnalysisDeckObservationRow[]): {
  readonly deckAliases: Map<string, string>;
  readonly decks: DeckExportEntry[];
} {
  const fingerprints = [...new Set(observations.map((row) => row.deck_fingerprint))].sort();
  const deckAliases = aliasMap(fingerprints, 'deck_', 6);
  const canonicalCards = new Map<string, string>();
  const decksByFingerprint = new Map<string, DeckExportEntry>();
  for (const observation of observations) {
    const cards = readObservationCards(observation.main_deck_cards);
    const serialized = JSON.stringify(cards);
    const previous = canonicalCards.get(observation.deck_fingerprint);
    if (previous !== undefined && previous !== serialized) {
      throw new Error('同一卡组指纹对应的卡组观察内容不一致');
    }
    canonicalCards.set(observation.deck_fingerprint, serialized);
    decksByFingerprint.set(observation.deck_fingerprint, {
      deckId: requireAlias(deckAliases, observation.deck_fingerprint, 'deck'),
      cards,
    });
  }
  return {
    deckAliases,
    decks: fingerprints.map((fingerprint) => {
      const deck = decksByFingerprint.get(fingerprint);
      if (!deck) throw new Error('卡组观察缺少卡组内容');
      return deck;
    }),
  };
}

function readObservationCards(value: unknown): RankedDeckObservationCard[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('卡组观察内容无效');
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') throw new Error('卡组观察卡牌无效');
      const card = item as Partial<RankedDeckObservationCard>;
      if (
        typeof card.baseCardCode !== 'string' ||
        typeof card.cardCode !== 'string' ||
        typeof card.name !== 'string' ||
        (card.cardType !== 'MEMBER' && card.cardType !== 'LIVE') ||
        !Number.isInteger(card.count) ||
        (card.count ?? 0) <= 0
      ) {
        throw new Error('卡组观察卡牌字段无效');
      }
      return {
        baseCardCode: card.baseCardCode,
        cardCode: card.cardCode,
        name: card.name,
        cardType: card.cardType,
        count: card.count as number,
      };
    })
    .sort(
      (left, right) =>
        left.baseCardCode.localeCompare(right.baseCardCode) ||
        left.cardCode.localeCompare(right.cardCode)
    );
}

function aliasMap(values: readonly string[], prefix: string, width: number): Map<string, string> {
  return new Map(
    values.map((value, index) => [value, `${prefix}${String(index + 1).padStart(width, '0')}`])
  );
}

function requireAlias(aliases: ReadonlyMap<string, string>, value: string, kind: string): string {
  const alias = aliases.get(value);
  if (!alias) throw new Error(`${kind} 标识缺少匿名映射`);
  return alias;
}

function requireEventSequence(sequences: ReadonlyMap<string, number>, eventId: string): number {
  const sequence = sequences.get(eventId);
  if (sequence === undefined) throw new Error('积分步骤引用了不存在的积分事件');
  return sequence;
}

function isoDate(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('导出数据包含无效日期');
  return date.toISOString();
}

function toTimestamp(value: Date | string): number {
  const iso = isoDate(value);
  if (!iso) throw new Error('导出数据缺少必填日期');
  return Date.parse(iso);
}

function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    if (row.length !== headers.length) throw new Error('CSV 行列数量不一致');
    lines.push(row.map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function csvCell(value: CsvValue): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function safeFilenamePart(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'season';
}

function fileStamp(value: Date): string {
  return value.toISOString().replace(/[-:.]/g, '');
}
