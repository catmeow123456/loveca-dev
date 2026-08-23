import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import {
  classifyDeck,
  type DeckCardInput,
  type DeckClassifierSnapshot,
} from '../src/server/services/deck-classifier-engine.js';
import {
  buildDeckClassifierSnapshot,
  type DraftArchetypeRow,
  type DraftRuleRow,
  type DraftTemplateRow,
  type StoredDeckClassifierSnapshot,
} from '../src/server/services/deck-classifier-release.js';
import type {
  MatchRecorderCardSummary,
  MatchRecorderDeckSnapshotInput,
} from '../src/server/services/match-recorder-service.js';
import { getBaseCardCode } from '../src/shared/utils/card-code.js';

const DEFAULT_MATCH_COUNT = 50;
const DEFAULT_RUN_KEY = 'classifier-pie-v1';
const DEFAULT_PLAYERS = ['test_admin', 'test_player_1', 'test_player_2'] as const;
const FIXTURE_PREFIX = 'deck-classifier-fixture';
const AMBIGUOUS_LIVE_COUNTS = new Map<string, number>([
  ['PL!-bp4-021', 4],
  ['PL!-bp6-022', 3],
  ['PL!-bp6-024', 3],
  ['PL!N-bp4-028', 2],
]);

type FixtureMode = 'dry-run' | 'apply';
type FixtureDeckKind = 'CLASSIFIED' | 'UNKNOWN' | 'AMBIGUOUS';

export interface LocalDeckClassifierFixtureOptions {
  readonly mode: FixtureMode;
  readonly yes: boolean;
  readonly seasonKey: string;
  readonly matchCount: number;
  readonly runKey: string;
  readonly playerUsernames: readonly string[];
}

interface SeasonRow {
  readonly id: string;
  readonly season_key: string;
  readonly name: string;
  readonly lifecycle: string;
  readonly rules_version: string;
  readonly card_catalog_version: string;
  readonly card_catalog_hash: string;
  readonly deck_policy_version: string;
  readonly ledger_revision: number;
}

interface PlayerRow {
  readonly id: string;
  readonly username: string;
  readonly display_name: string | null;
}

interface CardRow {
  readonly card_code: string;
  readonly card_type: 'MEMBER' | 'LIVE' | 'ENERGY';
  readonly name_jp: string | null;
  readonly name_cn: string | null;
  readonly image_filename: string | null;
}

interface TemplateCatalogRow extends DraftTemplateRow {
  readonly archetype_key: string;
  readonly archetype_name: string;
}

interface FixtureDeck {
  readonly key: string;
  readonly name: string;
  readonly kind: FixtureDeckKind;
  readonly archetypeId: string | null;
  readonly cards: readonly DeckCardInput[];
  readonly fingerprint: string;
}

export interface FixturePlayerRef {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
}

export interface FixtureMatchPlan {
  readonly index: number;
  readonly matchId: string;
  readonly firstPlayerIndex: number;
  readonly secondPlayerIndex: number;
  readonly firstDeckKey: string;
  readonly secondDeckKey: string;
  readonly winnerSeat: 'FIRST' | 'SECOND';
}

interface FixtureCatalog {
  readonly snapshot: StoredDeckClassifierSnapshot;
  readonly decks: readonly FixtureDeck[];
  readonly cardsByBaseCode: ReadonlyMap<string, CardRow>;
  readonly energyDeck: readonly string[];
}

interface ExistingFixtureRow {
  readonly match_id: string;
  readonly season_id: string | null;
  readonly first_user_id: string | null;
  readonly second_user_id: string | null;
  readonly rating_status: string | null;
  readonly winner_seat: string | null;
  readonly first_fingerprint: string | null;
  readonly second_fingerprint: string | null;
  readonly observation_count: number | string;
}

interface ApplySummary {
  created: number;
  skipped: number;
}

const PLAYER_DECK_WEIGHTS: readonly (readonly number[])[] = [
  [59, 18, 12, 0, 0, 0, 5, 6],
  [6, 42, 24, 15, 0, 0, 6, 7],
  [6, 6, 6, 15, 24, 12, 18, 13],
];

export function parseLocalDeckClassifierFixtureOptions(
  argv: readonly string[]
): LocalDeckClassifierFixtureOptions {
  let mode: FixtureMode = 'dry-run';
  let yes = false;
  let seasonKey = '';
  let matchCount = DEFAULT_MATCH_COUNT;
  let runKey = DEFAULT_RUN_KEY;
  let playerUsernames: readonly string[] = DEFAULT_PLAYERS;

  for (const argument of argv) {
    if (argument === '--apply') mode = 'apply';
    else if (argument === '--dry-run') mode = 'dry-run';
    else if (argument === '--yes') yes = true;
    else if (argument.startsWith('--season-key=')) {
      seasonKey = argument.slice('--season-key='.length).trim();
    } else if (argument.startsWith('--match-count=')) {
      matchCount = Number(argument.slice('--match-count='.length));
    } else if (argument.startsWith('--run-key=')) {
      runKey = argument.slice('--run-key='.length).trim();
    } else if (argument.startsWith('--players=')) {
      playerUsernames = argument
        .slice('--players='.length)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (argument === '--help' || argument === '-h') {
      process.stdout.write(
        '用法：pnpm deck-classifier:seed-test-fixtures -- --season-key=<key> [--match-count=50] [--run-key=classifier-pie-v1] [--players=a,b,c] [--dry-run|--apply --yes]\n'
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(seasonKey)) {
    throw new Error('--season-key 是必填项，且格式必须符合排位赛季 key');
  }
  if (!Number.isSafeInteger(matchCount) || matchCount < 10 || matchCount > 100) {
    throw new Error('--match-count 必须是 10 到 100 之间的整数');
  }
  if (!/^[a-z0-9][a-z0-9_-]{2,40}$/.test(runKey)) {
    throw new Error('--run-key 必须由小写字母、数字、下划线或短横线组成');
  }
  if (playerUsernames.length !== 3 || new Set(playerUsernames).size !== 3) {
    throw new Error('--players 必须提供三个互不相同的本地测试用户名');
  }
  if (mode === 'apply' && !yes) throw new Error('--apply 必须同时提供 --yes');

  return { mode, yes, seasonKey, matchCount, runKey, playerUsernames };
}

export function assertLocalTestDatabaseUrl(rawValue: string | undefined): URL {
  if (!rawValue) throw new Error('必须显式设置本地测试 DATABASE_URL');
  const url = new URL(rawValue);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('fixture DATABASE_URL 必须使用 PostgreSQL');
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('fixture 只允许连接 localhost/127.0.0.1/::1');
  }
  if ((url.port || '5432') !== '5432') throw new Error('fixture 只允许连接本地 5432 端口');
  if (
    url.pathname !== '/loveca' ||
    decodeURIComponent(url.username) !== 'loveca' ||
    decodeURIComponent(url.password) !== 'loveca_dev'
  ) {
    throw new Error('fixture 只允许连接本地 loveca 测试数据库及固定测试凭据');
  }
  if (process.env.NODE_ENV === 'production') throw new Error('生产环境禁止运行本地 fixture');
  return url;
}

export function buildPlayerPairSchedule(matchCount: number): readonly {
  readonly firstPlayerIndex: number;
  readonly secondPlayerIndex: number;
}[] {
  const pairs = [
    [0, 1],
    [1, 2],
    [2, 0],
  ] as const;
  return Array.from({ length: matchCount }, (_, index) => {
    const pair = pairs[index % pairs.length]!;
    return { firstPlayerIndex: pair[0], secondPlayerIndex: pair[1] };
  });
}

export function allocateWeightedDeckKeys(
  count: number,
  deckKeys: readonly string[],
  weights: readonly number[],
  seed: string
): readonly string[] {
  if (deckKeys.length !== weights.length || deckKeys.length === 0) {
    throw new Error('fixture 卡组 key 与权重数量不一致');
  }
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  if (weights.some((value) => !Number.isFinite(value) || value < 0) || totalWeight <= 0) {
    throw new Error('fixture 卡组权重无效');
  }
  const raw = weights.map((weight) => (weight / totalWeight) * count);
  const allocations = raw.map(Math.floor);
  let remaining = count - allocations.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (const entry of order) {
    if (remaining <= 0) break;
    allocations[entry.index] = (allocations[entry.index] ?? 0) + 1;
    remaining -= 1;
  }
  const result = deckKeys.flatMap((key, index) =>
    Array.from({ length: allocations[index] ?? 0 }, () => key)
  );
  return deterministicShuffle(result, seed);
}

export function buildFixtureMatchPlans(input: {
  readonly matchCount: number;
  readonly runKey: string;
  readonly deckKeys: readonly string[];
}): readonly FixtureMatchPlan[] {
  if (input.deckKeys.length !== 8) {
    throw new Error('fixture 计划必须包含六个已分类卡组、未知卡组和冲突卡组');
  }
  const pairs = buildPlayerPairSchedule(input.matchCount);
  const appearances = [0, 0, 0];
  for (const pair of pairs) {
    appearances[pair.firstPlayerIndex] += 1;
    appearances[pair.secondPlayerIndex] += 1;
  }
  const queues = appearances.map((count, playerIndex) =>
    allocateWeightedDeckKeys(
      count,
      input.deckKeys,
      PLAYER_DECK_WEIGHTS[playerIndex]!,
      `${input.runKey}:player:${playerIndex}`
    )
  );
  const offsets = [0, 0, 0];
  const strength = new Map(input.deckKeys.map((key, index) => [key, Math.max(0, 6 - index)]));

  return pairs.map((pair, index) => {
    const firstDeckKey = queues[pair.firstPlayerIndex]![offsets[pair.firstPlayerIndex]++]!;
    const secondDeckKey = queues[pair.secondPlayerIndex]![offsets[pair.secondPlayerIndex]++]!;
    const firstStrength = strength.get(firstDeckKey) ?? 0;
    const secondStrength = strength.get(secondDeckKey) ?? 0;
    let winnerSeat: 'FIRST' | 'SECOND';
    if (firstStrength === secondStrength) winnerSeat = index % 2 === 0 ? 'FIRST' : 'SECOND';
    else winnerSeat = firstStrength > secondStrength ? 'FIRST' : 'SECOND';
    if ((index + 1) % 5 === 0 && firstStrength !== secondStrength) {
      winnerSeat = winnerSeat === 'FIRST' ? 'SECOND' : 'FIRST';
    }
    return {
      index: index + 1,
      matchId: `${FIXTURE_PREFIX}:${input.runKey}:${String(index + 1).padStart(3, '0')}`,
      firstPlayerIndex: pair.firstPlayerIndex,
      secondPlayerIndex: pair.secondPlayerIndex,
      firstDeckKey,
      secondDeckKey,
      winnerSeat,
    };
  });
}

async function main(): Promise<void> {
  const options = parseLocalDeckClassifierFixtureOptions(process.argv.slice(2));
  assertLocalTestDatabaseUrl(process.env.DATABASE_URL);
  applyLocalRuntimeDefaults();

  const { pool } = await import('../src/server/db/pool.js');
  try {
    const season = await loadSeason(pool, options.seasonKey);
    const players = await loadPlayers(pool, options.playerUsernames);
    const catalog = await loadFixtureCatalog(pool);
    const plans = buildFixtureMatchPlans({
      matchCount: options.matchCount,
      runKey: options.runKey,
      deckKeys: catalog.decks.map((deck) => deck.key),
    });
    const existing = await loadExistingFixtures(pool, options.runKey);
    assertExistingFixturesMatch(existing, plans, season, players, catalog.decks);
    if (options.mode === 'dry-run') {
      process.stdout.write(
        `${JSON.stringify(buildReport(options, season, players, catalog.decks, plans, { created: 0, skipped: existing.size }), null, 2)}\n`
      );
      return;
    }
    const summary = await applyFixtures(pool, season, players, catalog, plans, existing);
    process.stdout.write(
      `${JSON.stringify(buildReport(options, season, players, catalog.decks, plans, summary), null, 2)}\n`
    );
  } finally {
    await pool.end();
  }
}

function applyLocalRuntimeDefaults(): void {
  process.env.NODE_ENV ??= 'development';
  process.env.PORT ??= '3007';
  process.env.JWT_SECRET ??= 'loveca_test_jwt_secret_32_chars_min';
  process.env.JWT_REFRESH_SECRET ??= 'loveca_test_refresh_secret_32_chars';
  process.env.FRONTEND_URL ??= 'http://localhost:5173';
  process.env.MINIO_ENDPOINT ??= 'localhost';
  process.env.MINIO_PORT ??= '9000';
  process.env.MINIO_ACCESS_KEY ??= 'minioadmin';
  process.env.MINIO_SECRET_KEY ??= 'minioadmin';
  process.env.MINIO_BUCKET ??= 'loveca-cards';
  process.env.MINIO_USE_SSL ??= 'false';
  process.env.AI_EFFECT_EXTRACTION_ENCRYPTION_KEY ??= '1'.repeat(64);
  process.env.AI_EFFECT_EXTRACTION_ALLOWED_HOSTS ??= 'api.example.com';
}

async function loadSeason(pool: Pool, seasonKey: string): Promise<SeasonRow> {
  const result = await pool.query<SeasonRow>(
    `SELECT id, season_key, name, lifecycle, rules_version, card_catalog_version,
            card_catalog_hash, deck_policy_version, ledger_revision
     FROM ranked_seasons WHERE season_key = $1`,
    [seasonKey]
  );
  const season = result.rows[0];
  if (!season) throw new Error(`找不到本地测试赛季：${seasonKey}`);
  if (season.lifecycle !== 'ACTIVE') throw new Error('fixture 只允许写入 ACTIVE 本地测试赛季');
  return season;
}

async function loadPlayers(
  pool: Pool,
  usernames: readonly string[]
): Promise<readonly FixturePlayerRef[]> {
  const result = await pool.query<PlayerRow>(
    `SELECT id, username, display_name FROM profiles WHERE username = ANY($1::text[])`,
    [[...usernames]]
  );
  const byUsername = new Map(result.rows.map((row) => [row.username, row]));
  return usernames.map((username) => {
    const row = byUsername.get(username);
    if (!row) throw new Error(`找不到本地测试玩家：${username}`);
    return { id: row.id, username, displayName: row.display_name ?? username };
  });
}

async function loadFixtureCatalog(pool: Pool): Promise<FixtureCatalog> {
  const [archetypesResult, templatesResult, rulesResult, cardsResult] = await Promise.all([
    pool.query<DraftArchetypeRow>(
      `SELECT id, archetype_key, name, group_name, description, sort_order
       FROM deck_archetypes WHERE lifecycle = 'ACTIVE' ORDER BY sort_order, archetype_key`
    ),
    pool.query<TemplateCatalogRow>(
      `SELECT template.id, template.archetype_id, template.cards,
              archetype.archetype_key, archetype.name AS archetype_name
       FROM deck_archetype_templates AS template
       JOIN deck_archetypes AS archetype ON archetype.id = template.archetype_id
       WHERE template.enabled AND archetype.lifecycle = 'ACTIVE'
       ORDER BY archetype.sort_order, archetype.archetype_key, template.created_at, template.id`
    ),
    pool.query<DraftRuleRow>(
      `SELECT rule.id, rule.archetype_id, rule.priority, rule.definition
       FROM deck_archetype_rules AS rule
       JOIN deck_archetypes AS archetype ON archetype.id = rule.archetype_id
       WHERE rule.enabled AND archetype.lifecycle = 'ACTIVE' ORDER BY rule.priority, rule.id`
    ),
    pool.query<CardRow>(
      `SELECT card_code, card_type, name_jp, name_cn, image_filename
       FROM cards WHERE status = 'PUBLISHED' ORDER BY card_code`
    ),
  ]);
  const snapshot = buildDeckClassifierSnapshot({
    releaseVersion: 1,
    archetypes: archetypesResult.rows,
    templates: templatesResult.rows,
    rules: rulesResult.rows,
  });
  const cardsByBaseCode = buildCardsByBaseCode(cardsResult.rows);
  const selected = selectExactClassifiedDecks(snapshot, templatesResult.rows, cardsByBaseCode, 6);
  const unknown = buildUnknownDeck(snapshot, cardsResult.rows, cardsByBaseCode);
  const ambiguous = buildAmbiguousDeck(snapshot, cardsResult.rows, cardsByBaseCode);
  const energyCards = cardsResult.rows.filter((card) => card.card_type === 'ENERGY');
  if (energyCards.length === 0) throw new Error('本地卡牌库没有可用 ENERGY 卡');
  const energyDeck = Array.from(
    { length: 12 },
    (_, index) => energyCards[index % energyCards.length]!.card_code
  );
  return { snapshot, decks: [...selected, unknown, ambiguous], cardsByBaseCode, energyDeck };
}

function buildCardsByBaseCode(rows: readonly CardRow[]): ReadonlyMap<string, CardRow> {
  const result = new Map<string, CardRow>();
  for (const row of rows) {
    if (row.card_type === 'ENERGY') continue;
    const baseCardCode = getBaseCardCode(row.card_code);
    if (!result.has(baseCardCode)) result.set(baseCardCode, row);
  }
  return result;
}

function selectExactClassifiedDecks(
  snapshot: StoredDeckClassifierSnapshot,
  templates: readonly TemplateCatalogRow[],
  cardsByBaseCode: ReadonlyMap<string, CardRow>,
  count: number
): readonly FixtureDeck[] {
  const selected: FixtureDeck[] = [];
  const usedArchetypes = new Set<string>();
  for (const template of templates) {
    if (usedArchetypes.has(template.archetype_id)) continue;
    const cards = template.cards as readonly DeckCardInput[];
    if (!cards.every((card) => cardsByBaseCode.has(card.baseCardCode ?? ''))) continue;
    const classification = classifyDeck(cards, snapshot);
    if (
      classification.decision !== 'CLASSIFIED' ||
      classification.method !== 'EXACT' ||
      classification.archetypeId !== template.archetype_id ||
      !classification.deckFingerprint
    ) {
      continue;
    }
    selected.push({
      key: `classified:${template.archetype_key}`,
      name: template.archetype_name,
      kind: 'CLASSIFIED',
      archetypeId: template.archetype_id,
      cards,
      fingerprint: classification.deckFingerprint,
    });
    usedArchetypes.add(template.archetype_id);
    if (selected.length === count) break;
  }
  if (selected.length !== count) throw new Error(`无法找到 ${count} 个可落地的精确分类样板`);
  return selected;
}

function buildUnknownDeck(
  snapshot: DeckClassifierSnapshot,
  rows: readonly CardRow[],
  cardsByBaseCode: ReadonlyMap<string, CardRow>
): FixtureDeck {
  const ruleCodes = collectRuleCardCodes(snapshot);
  const members = uniqueBaseCodes(rows, 'MEMBER').filter((code) => !ruleCodes.has(code));
  const lives = uniqueBaseCodes(rows, 'LIVE').filter((code) => !ruleCodes.has(code));
  for (let offset = 0; offset < 100; offset += 1) {
    const cards: DeckCardInput[] = [
      ...selectRotatingCodes(members, offset * 7, 12).map((baseCardCode) => ({
        baseCardCode,
        cardType: 'MEMBER' as const,
        count: 4,
      })),
      ...selectRotatingCodes(lives, offset * 5, 3).map((baseCardCode) => ({
        baseCardCode,
        cardType: 'LIVE' as const,
        count: 4,
      })),
    ];
    if (cards.some((card) => !cardsByBaseCode.has(card.baseCardCode!))) continue;
    const classification = classifyDeck(cards, snapshot);
    if (classification.decision === 'UNKNOWN' && classification.deckFingerprint) {
      return {
        key: 'system:unknown-fixture',
        name: '其他／未识别 fixture',
        kind: 'UNKNOWN',
        archetypeId: null,
        cards,
        fingerprint: classification.deckFingerprint,
      };
    }
  }
  throw new Error('无法从当前卡牌库构造稳定的 UNKNOWN fixture');
}

function buildAmbiguousDeck(
  snapshot: DeckClassifierSnapshot,
  rows: readonly CardRow[],
  cardsByBaseCode: ReadonlyMap<string, CardRow>
): FixtureDeck {
  const memberCodes = uniqueBaseCodes(rows, 'MEMBER');
  const cards: DeckCardInput[] = [
    ...memberCodes.slice(0, 12).map((baseCardCode) => ({
      baseCardCode,
      cardType: 'MEMBER' as const,
      count: 4,
    })),
    ...[...AMBIGUOUS_LIVE_COUNTS].map(([baseCardCode, count]) => ({
      baseCardCode,
      cardType: 'LIVE' as const,
      count,
    })),
  ];
  if (cards.some((card) => !cardsByBaseCode.has(card.baseCardCode!))) {
    throw new Error('当前卡牌库缺少构造规则冲突 fixture 所需的 LIVE 卡');
  }
  const classification = classifyDeck(cards, snapshot);
  if (
    classification.decision !== 'AMBIGUOUS' ||
    classification.reason !== 'RULE_CONFLICT' ||
    !classification.deckFingerprint
  ) {
    throw new Error('当前分类规则无法生成预期的 RULE_CONFLICT fixture');
  }
  return {
    key: 'system:ambiguous-fixture',
    name: '分类冲突／待复核 fixture',
    kind: 'AMBIGUOUS',
    archetypeId: null,
    cards,
    fingerprint: classification.deckFingerprint,
  };
}

function collectRuleCardCodes(snapshot: DeckClassifierSnapshot): ReadonlySet<string> {
  const result = new Set<string>();
  for (const rule of snapshot.rules ?? []) {
    for (const constraint of [
      ...(rule.conditions.includeAll ?? []),
      ...(rule.conditions.includeAny ?? []),
      ...(rule.conditions.forbidAny ?? []),
    ]) {
      result.add(getBaseCardCode(constraint.baseCardCode));
    }
    for (const sum of rule.conditions.countSums ?? []) {
      for (const code of sum.baseCardCodes) result.add(getBaseCardCode(code));
    }
  }
  return result;
}

function uniqueBaseCodes(rows: readonly CardRow[], cardType: 'MEMBER' | 'LIVE'): string[] {
  return [
    ...new Set(
      rows.filter((row) => row.card_type === cardType).map((row) => getBaseCardCode(row.card_code))
    ),
  ];
}

function selectRotatingCodes(codes: readonly string[], offset: number, count: number): string[] {
  if (codes.length < count) throw new Error('本地卡牌库不足以构造 fixture 卡组');
  return Array.from({ length: count }, (_, index) => codes[(offset + index) % codes.length]!);
}

async function loadExistingFixtures(
  pool: Pool,
  runKey: string
): Promise<ReadonlyMap<string, ExistingFixtureRow>> {
  const result = await pool.query<ExistingFixtureRow>(
    `SELECT record.match_id, ranked_match.season_id, ranked_match.first_user_id,
            ranked_match.second_user_id, ranked_match.rating_status, ranked_match.winner_seat,
            max(observation.deck_fingerprint) FILTER (WHERE observation.seat = 'FIRST') AS first_fingerprint,
            max(observation.deck_fingerprint) FILTER (WHERE observation.seat = 'SECOND') AS second_fingerprint,
            count(observation.match_id) AS observation_count
     FROM match_records AS record
     LEFT JOIN ranked_matches AS ranked_match ON ranked_match.match_id = record.match_id
     LEFT JOIN ranked_deck_observations AS observation ON observation.match_id = record.match_id
     WHERE record.match_id LIKE $1
     GROUP BY record.match_id, ranked_match.season_id, ranked_match.first_user_id,
              ranked_match.second_user_id, ranked_match.rating_status, ranked_match.winner_seat
     ORDER BY record.match_id`,
    [`${FIXTURE_PREFIX}:${runKey}:%`]
  );
  return new Map(result.rows.map((row) => [row.match_id, row]));
}

function assertExistingFixturesMatch(
  existing: ReadonlyMap<string, ExistingFixtureRow>,
  plans: readonly FixtureMatchPlan[],
  season: SeasonRow,
  players: readonly FixturePlayerRef[],
  decks: readonly FixtureDeck[]
): void {
  const plansById = new Map(plans.map((plan) => [plan.matchId, plan]));
  const decksByKey = new Map(decks.map((deck) => [deck.key, deck]));
  for (const row of existing.values()) {
    const plan = plansById.get(row.match_id);
    if (!plan) throw new Error(`run-key 已存在计划外 fixture：${row.match_id}`);
    const first = players[plan.firstPlayerIndex]!;
    const second = players[plan.secondPlayerIndex]!;
    const firstDeck = decksByKey.get(plan.firstDeckKey)!;
    const secondDeck = decksByKey.get(plan.secondDeckKey)!;
    if (
      row.season_id !== season.id ||
      row.first_user_id !== first.id ||
      row.second_user_id !== second.id ||
      row.rating_status !== 'SETTLED' ||
      row.winner_seat !== plan.winnerSeat ||
      row.first_fingerprint !== firstDeck.fingerprint ||
      row.second_fingerprint !== secondDeck.fingerprint ||
      Number(row.observation_count) !== 2
    ) {
      throw new Error(`fixture ${row.match_id} 已存在但与当前计划不一致，请更换 --run-key`);
    }
  }
}

async function applyFixtures(
  pool: Pool,
  season: SeasonRow,
  players: readonly FixturePlayerRef[],
  catalog: FixtureCatalog,
  plans: readonly FixtureMatchPlan[],
  existing: ReadonlyMap<string, ExistingFixtureRow>
): Promise<ApplySummary> {
  const { MatchRecorderService } = await import('../src/server/services/match-recorder-service.js');
  const { RankedRatingService } = await import('../src/server/services/ranked-rating-service.js');
  const decksByKey = new Map(catalog.decks.map((deck) => [deck.key, deck]));
  const latestResult = await pool.query<{ latest: Date | string | null }>(
    `SELECT max(ended_at) AS latest FROM ranked_matches WHERE season_id = $1`,
    [season.id]
  );
  const latest = latestResult.rows[0]?.latest;
  const baseTime = Math.max(
    Date.now() - (plans.length + 1) * 60_000,
    latest ? new Date(latest).getTime() + 60_000 : 0
  );
  const summary: ApplySummary = { created: 0, skipped: 0 };

  for (const plan of plans) {
    if (existing.has(plan.matchId)) {
      summary.skipped += 1;
      continue;
    }
    const first = players[plan.firstPlayerIndex]!;
    const second = players[plan.secondPlayerIndex]!;
    const firstDeck = decksByKey.get(plan.firstDeckKey)!;
    const secondDeck = decksByKey.get(plan.secondDeckKey)!;
    const startedAt = baseTime + plan.index * 60_000;
    const endedAt = startedAt + 30_000;
    const client = await pool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      const transaction = async <T>(callback: (queryClient: PoolClient) => Promise<T>) =>
        callback(client);
      const recorder = new MatchRecorderService({
        now: () => endedAt,
        queryClient: client,
        transaction,
      });
      const rating = new RankedRatingService({ transaction });
      await recorder.beginMatch({
        matchId: plan.matchId,
        roomCode: `DCF-${String(plan.index).padStart(3, '0')}`,
        matchMode: 'ONLINE',
        automationGameMode: 'DEBUG',
        originKind: 'RANKED',
        originLabel: '本地卡组分类饼图 fixture',
        startedAt,
        participants: {
          FIRST: participantInput(first, 'FIRST', plan.matchId),
          SECOND: participantInput(second, 'SECOND', plan.matchId),
        },
        deckSnapshots: {
          FIRST: deckSnapshotInput(first, 'FIRST', firstDeck, catalog, season, startedAt),
          SECOND: deckSnapshotInput(second, 'SECOND', secondDeck, catalog, season, startedAt),
        },
        rulesVersion: season.rules_version,
        cardDataVersion: season.card_catalog_version,
        cardDataHash: season.card_catalog_hash,
        replayCapabilities: [],
        replayLimitations: [],
      });
      await rating.registerMatch({ seasonId: season.id, matchId: plan.matchId });
      await recorder.sealMatch({
        matchId: plan.matchId,
        status: 'COMPLETED',
        completeness: 'FULL',
        endedAt,
        sealedAt: endedAt,
        winnerSeat: plan.winnerSeat,
        endReason: 'LOCAL_DECK_CLASSIFIER_FIXTURE',
        turnCount: 6 + (plan.index % 7),
        phase: 'LIVE_RESULT_PHASE',
        subPhase: 'NONE',
      });
      await rating.settleMatch(plan.matchId);
      await client.query('COMMIT');
      summary.created += 1;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  return summary;
}

function participantInput(player: FixturePlayerRef, seat: 'FIRST' | 'SECOND', matchId: string) {
  return {
    seat,
    userId: player.id,
    displayName: player.displayName,
    playerId: `${matchId}:${seat}`,
    participantKind: 'USER' as const,
    ownerUserId: player.id,
  };
}

function deckSnapshotInput(
  player: FixturePlayerRef,
  seat: 'FIRST' | 'SECOND',
  deck: FixtureDeck,
  catalog: FixtureCatalog,
  season: SeasonRow,
  startedAt: number
): MatchRecorderDeckSnapshotInput {
  const mainDeck = deck.cards.flatMap((entry) => {
    const row = catalog.cardsByBaseCode.get(entry.baseCardCode!);
    if (!row) throw new Error(`卡牌库缺少 ${entry.baseCardCode}`);
    return Array.from({ length: entry.count }, () => row.card_code);
  });
  const summariesByCode = new Map(
    [...catalog.cardsByBaseCode.values()].map((row) => [row.card_code, row])
  );
  const cardSummaries: Record<string, MatchRecorderCardSummary> = {};
  for (const cardCode of new Set([...mainDeck, ...catalog.energyDeck])) {
    const row = summariesByCode.get(cardCode);
    cardSummaries[cardCode] = row
      ? {
          cardCode,
          name: row.name_cn ?? row.name_jp ?? cardCode,
          cardType: row.card_type,
          ...(row.image_filename ? { imageFilename: row.image_filename } : {}),
        }
      : { cardCode, name: cardCode, cardType: 'ENERGY' };
  }
  return {
    seat,
    userId: player.id,
    sourceDeckId: null,
    sourceDeckName: deck.name,
    source: 'ONLINE_RUNTIME_DECK' as const,
    mainDeck,
    energyDeck: catalog.energyDeck,
    cardSummaries,
    validationState: 'VALID' as const,
    pointTableVersion: season.deck_policy_version,
    pointTotal: 0,
    pointLimit: 100,
    cardDataVersion: season.card_catalog_version,
    cardDataHash: season.card_catalog_hash,
    lockedAt: startedAt,
  };
}

function buildReport(
  options: LocalDeckClassifierFixtureOptions,
  season: SeasonRow,
  players: readonly FixturePlayerRef[],
  decks: readonly FixtureDeck[],
  plans: readonly FixtureMatchPlan[],
  summary: ApplySummary
) {
  const appearances = new Map<string, number>();
  const wins = new Map<string, number>();
  for (const plan of plans) {
    appearances.set(plan.firstDeckKey, (appearances.get(plan.firstDeckKey) ?? 0) + 1);
    appearances.set(plan.secondDeckKey, (appearances.get(plan.secondDeckKey) ?? 0) + 1);
    const winnerKey = plan.winnerSeat === 'FIRST' ? plan.firstDeckKey : plan.secondDeckKey;
    wins.set(winnerKey, (wins.get(winnerKey) ?? 0) + 1);
  }
  return {
    script: 'seed-local-deck-classifier-fixtures',
    mode: options.mode,
    database: 'localhost:5432/loveca',
    runKey: options.runKey,
    season: {
      id: season.id,
      seasonKey: season.season_key,
      name: season.name,
      ledgerRevisionBeforeRun: season.ledger_revision,
    },
    matchCount: plans.length,
    observationCount: plans.length * 2,
    createdMatchCount: summary.created,
    skippedExistingMatchCount: summary.skipped,
    players: players.map((player) => player.username),
    decks: decks.map((deck) => ({
      key: deck.key,
      name: deck.name,
      expectedStatus: deck.kind,
      appearanceCount: appearances.get(deck.key) ?? 0,
      winnerCount: wins.get(deck.key) ?? 0,
      fingerprint: deck.fingerprint,
    })),
    apply: options.mode === 'apply',
  };
}

function deterministicShuffle<T>(values: readonly T[], seed: string): T[] {
  const result = [...values];
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0) || 1;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const target = (state >>> 0) % (index + 1);
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
