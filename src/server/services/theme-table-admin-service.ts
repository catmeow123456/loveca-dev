import { createHash, randomUUID } from 'node:crypto';
import * as yaml from 'yaml';
import type {
  ThemeAdminDeckView,
  ThemeAdminEventView,
  ThemeAdminMatchupView,
  ThemeAdminMetricsView,
  ThemeTableEvaluationPolicy,
} from '../../online/theme-table-types.js';
import { DeckConfigSchema, DeckLoader } from '../../domain/card-data/deck-loader.js';
import { deckConfigToRecordPayload } from '../../domain/card-data/deck-record-utils.js';
import type { AnyCardData } from '../../domain/entities/card.js';
import { pool } from '../db/pool.js';
import { getCurrentRankedCardCatalogIdentity } from '../rating/ranked-environment.js';
import { loadOwnedDeckForOnlineMatch } from './online-room-service.js';
import {
  DeckPayloadValidationError,
  prepareDeckPayloadForStorage,
} from './deck-storage-service.js';
import { encodePublicTableRuntimeDeck } from './public-table-deck-snapshot.js';
import { REPLAY_RULES_VERSION } from './replay-constants.js';
import type { RankedSeasonOpenWindow } from './ranked-season-service.js';

export const THEME_ALLOCATION_ALGORITHM_VERSION = 'THEME_WEIGHTED_PAIR_V1';

interface QueryResult<T> {
  readonly rows: T[];
  readonly rowCount?: number | null;
}

interface ThemeAdminQuery {
  <T = unknown>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

interface ThemeRow {
  readonly id: string;
  readonly version_key: string;
  readonly name: string;
  readonly lifecycle: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
  readonly environment_id: string;
  readonly rules_environment_id: string;
  readonly card_catalog_hash: string;
  readonly allocation_algorithm_version: string;
  readonly platform_time_zone: string;
  readonly open_windows: RankedSeasonOpenWindow[];
  readonly starts_at: Date | string;
  readonly ends_at: Date | string;
  readonly schedule_label: string;
  readonly summary: string;
  readonly announcement: string;
  readonly evaluation_policy: ThemeTableEvaluationPolicy;
}

interface AdminDeckRow {
  readonly id: string;
  readonly deck_key: string;
  readonly display_name: string;
  readonly deck_list: unknown;
  readonly content_hash: string;
  readonly play_style_tags: unknown;
  readonly difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  readonly source_label: string;
  readonly source_url: string | null;
  readonly review_note: string;
  readonly approved_at: Date | string;
}

interface MatchupRow {
  readonly id: string;
  readonly first_deck_version_id: string;
  readonly first_deck_name: string;
  readonly second_deck_version_id: string;
  readonly second_deck_name: string;
  readonly weight: number;
  readonly enabled: boolean;
  readonly test_summary: Record<string, unknown>;
  readonly approved_at: Date | string;
}

export interface ThemeAdminDraftInput {
  readonly versionKey: string;
  readonly name: string;
  readonly platformTimeZone: string;
  readonly openWindows: readonly RankedSeasonOpenWindow[];
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly scheduleLabel: string;
  readonly summary: string;
  readonly announcement: string;
  readonly evaluationPolicy: ThemeTableEvaluationPolicy;
}

export interface ThemeAdminOperationsInput {
  readonly name: string;
  readonly openWindows: readonly RankedSeasonOpenWindow[];
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly scheduleLabel: string;
  readonly summary: string;
  readonly announcement: string;
}

interface ThemeAdminDeckMetadataInput {
  readonly deckKey: string;
  readonly displayName: string;
  readonly playStyleTags: readonly string[];
  readonly difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  readonly sourceLabel: string;
  readonly sourceUrl?: string | null;
  readonly reviewNote: string;
}

export type ThemeAdminDeckInput = ThemeAdminDeckMetadataInput &
  (
    | { readonly sourceType: 'CLOUD'; readonly sourceDeckId: string }
    | { readonly sourceType: 'YAML'; readonly yamlContent: string }
  );

export type ThemeAdminDeckUpdateInput = Omit<ThemeAdminDeckMetadataInput, 'deckKey'> &
  (
    | { readonly sourceType: 'CLOUD'; readonly sourceDeckId: string }
    | { readonly sourceType: 'YAML'; readonly yamlContent: string }
  );

interface ThemeDeckSnapshotSource {
  readonly runtimeDeck: Awaited<ReturnType<typeof loadOwnedDeckForOnlineMatch>>['runtimeDeck'];
}

export interface ThemeAdminMatchupInput {
  readonly firstDeckVersionId: string;
  readonly secondDeckVersionId: string;
  readonly weight: number;
  readonly testSummary: Readonly<Record<string, unknown>>;
}

export class ThemeTableAdminServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'ThemeTableAdminServiceError';
  }
}

export class ThemeTableAdminService {
  private readonly query: ThemeAdminQuery;

  constructor(
    options: {
      readonly query?: ThemeAdminQuery;
      readonly now?: () => Date;
      readonly createId?: () => string;
      readonly getCatalog?: typeof getCurrentRankedCardCatalogIdentity;
      readonly loadDeck?: typeof loadOwnedDeckForOnlineMatch;
      readonly loadYamlDeck?: (yamlContent: string) => Promise<ThemeDeckSnapshotSource>;
    } = {}
  ) {
    this.query =
      options.query ??
      (async <T>(text: string, values?: readonly unknown[]) => {
        const result = await pool.query(text, values as unknown[]);
        return { rows: result.rows as T[], rowCount: result.rowCount };
      });
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.getCatalog = options.getCatalog ?? getCurrentRankedCardCatalogIdentity;
    this.loadDeck = options.loadDeck ?? loadOwnedDeckForOnlineMatch;
    this.loadYamlDeck = options.loadYamlDeck ?? loadThemeDeckFromYaml;
  }

  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly getCatalog: typeof getCurrentRankedCardCatalogIdentity;
  private readonly loadDeck: typeof loadOwnedDeckForOnlineMatch;
  private readonly loadYamlDeck: (yamlContent: string) => Promise<ThemeDeckSnapshotSource>;

  async getEnvironmentPreview() {
    const catalog = await this.getCatalog();
    return {
      rulesEnvironmentId: REPLAY_RULES_VERSION,
      cardCatalogHash: catalog.cardCatalogHash,
      publishedCardCount: catalog.publishedCardCount,
      allocationAlgorithmVersion: THEME_ALLOCATION_ALGORITHM_VERSION,
    };
  }

  async listEvents(): Promise<ThemeAdminEventView[]> {
    const result = await this.query<ThemeRow>(
      `SELECT * FROM theme_table_versions ORDER BY starts_at DESC, created_at DESC`
    );
    return Promise.all(result.rows.map((row) => this.projectEvent(row)));
  }

  async createDraft(adminUserId: string, input: ThemeAdminDraftInput) {
    assertDraftInput(input);
    const catalog = await this.getCatalog(true);
    const id = this.createId();
    const environmentId = hashEnvironment({
      versionKey: input.versionKey,
      rulesEnvironmentId: REPLAY_RULES_VERSION,
      cardCatalogHash: catalog.cardCatalogHash,
      allocationAlgorithmVersion: THEME_ALLOCATION_ALGORITHM_VERSION,
    });
    const result = await this.query<ThemeRow>(
      `INSERT INTO theme_table_versions (
         id, version_key, name, lifecycle, environment_id, rules_environment_id,
         card_catalog_hash, allocation_algorithm_version, platform_time_zone,
         open_windows, starts_at, ends_at, schedule_label, summary, announcement,
         evaluation_policy, created_at, updated_at
       ) VALUES (
         $1, $2, $3, 'DRAFT', $4, $5, $6, $7, $8,
         $9::jsonb, $10, $11, $12, $13, $14, $15::jsonb, $16, $16
       ) RETURNING *`,
      [
        id,
        input.versionKey,
        input.name,
        environmentId,
        REPLAY_RULES_VERSION,
        catalog.cardCatalogHash,
        THEME_ALLOCATION_ALGORITHM_VERSION,
        input.platformTimeZone,
        JSON.stringify(input.openWindows),
        input.startsAt,
        input.endsAt,
        input.scheduleLabel,
        input.summary,
        input.announcement,
        JSON.stringify(input.evaluationPolicy),
        this.now(),
      ]
    );
    audit('THEME_DRAFT_CREATED', adminUserId, id, { versionKey: input.versionKey });
    return this.projectEvent(requireRow(result.rows[0], 'THEME_DRAFT_CREATE_FAILED'));
  }

  async updateDraft(adminUserId: string, themeId: string, input: ThemeAdminDraftInput) {
    assertDraftInput(input);
    const current = await this.requireDraft(themeId);
    if (input.versionKey !== current.version_key) {
      throw adminError('THEME_VERSION_KEY_FROZEN', '版本标识参与环境身份计算，创建后不能修改', 409);
    }
    const result = await this.query<ThemeRow>(
      `UPDATE theme_table_versions
       SET name = $2,
           platform_time_zone = $3,
           open_windows = $4::jsonb,
           starts_at = $5,
           ends_at = $6,
           schedule_label = $7,
           summary = $8,
           announcement = $9,
           evaluation_policy = $10::jsonb,
           updated_at = $11
       WHERE id = $1 AND lifecycle = 'DRAFT'
       RETURNING *`,
      [
        themeId,
        input.name,
        input.platformTimeZone,
        JSON.stringify(input.openWindows),
        input.startsAt,
        input.endsAt,
        input.scheduleLabel,
        input.summary,
        input.announcement,
        JSON.stringify(input.evaluationPolicy),
        this.now(),
      ]
    );
    const row = result.rows[0];
    if (!row) throw adminError('THEME_DRAFT_NOT_EDITABLE', '只有草稿活动可以编辑', 409);
    audit('THEME_DRAFT_UPDATED', adminUserId, themeId);
    return this.projectEvent(row);
  }

  async updateOperations(adminUserId: string, themeId: string, input: ThemeAdminOperationsInput) {
    assertOperationsInput(input);
    const result = await this.query<ThemeRow>(
      `UPDATE theme_table_versions
       SET name = $2,
           open_windows = $3::jsonb,
           starts_at = $4,
           ends_at = $5,
           schedule_label = $6,
           summary = $7,
           announcement = $8,
           updated_at = $9
       WHERE id = $1 AND lifecycle IN ('ACTIVE', 'PAUSED')
       RETURNING *`,
      [
        themeId,
        input.name.trim(),
        JSON.stringify(input.openWindows),
        input.startsAt,
        input.endsAt,
        input.scheduleLabel.trim(),
        input.summary.trim(),
        input.announcement.trim(),
        this.now(),
      ]
    );
    const row = result.rows[0];
    if (!row) {
      const theme = await this.requireTheme(themeId);
      throw adminError(
        'THEME_OPERATIONS_NOT_EDITABLE',
        theme.lifecycle === 'CLOSED'
          ? '已结束的主题赛季不能编辑'
          : '只有已开始的主题赛季可以这样编辑',
        409
      );
    }
    audit('THEME_OPERATIONS_UPDATED', adminUserId, themeId);
    return this.projectEvent(row);
  }

  async addDeck(adminUserId: string, themeId: string, input: ThemeAdminDeckInput) {
    const theme = await this.requireDeckPoolEditable(themeId);
    await this.assertCurrentEnvironmentForDeckChange(theme);
    const deck =
      input.sourceType === 'YAML'
        ? await this.loadYamlDeck(input.yamlContent)
        : await this.loadDeck(adminUserId, input.sourceDeckId);
    const encoded = encodePublicTableRuntimeDeck(deck.runtimeDeck);
    const result = await this.query<AdminDeckRow>(
      `WITH inserted_deck AS (
         INSERT INTO theme_prebuilt_deck_versions (
           id, theme_table_version_id, deck_key, display_name, runtime_deck, deck_list,
           content_hash, play_style_tags, difficulty, source_label, source_url,
           review_note, approved_at, created_at
         )
         SELECT
           $1, $2, $3, $4, $5::jsonb, $6::jsonb,
           $7, $8::jsonb, $9, $10, $11, $12, $13, $13
         FROM theme_table_versions AS theme
         WHERE theme.id = $2 AND theme.lifecycle IN ('DRAFT', 'ACTIVE', 'PAUSED')
         RETURNING id, deck_key, display_name, deck_list, content_hash,
                   play_style_tags, difficulty, source_label, source_url,
                   review_note, approved_at
       ), inserted_matchups AS (
         INSERT INTO theme_matchup_pair_versions (
           theme_table_version_id, first_deck_version_id, second_deck_version_id,
           weight, enabled, test_summary, approved_at, created_at, updated_at
         )
         SELECT
           $2,
           CASE WHEN existing.id < inserted.id THEN existing.id ELSE inserted.id END,
           CASE WHEN existing.id < inserted.id THEN inserted.id ELSE existing.id END,
           1, TRUE, jsonb_build_object('summary', '随卡组池自动启用'), $13, $13, $13
         FROM theme_prebuilt_deck_versions AS existing
         CROSS JOIN inserted_deck AS inserted
         WHERE existing.theme_table_version_id = $2
           AND existing.retired_at IS NULL
         UNION ALL
         SELECT
           $2, inserted.id, inserted.id,
           1, TRUE, jsonb_build_object('summary', '随卡组池自动启用'), $13, $13, $13
         FROM inserted_deck AS inserted
         ON CONFLICT (
           theme_table_version_id, first_deck_version_id, second_deck_version_id
         ) DO NOTHING
       )
       SELECT * FROM inserted_deck`,
      [
        this.createId(),
        themeId,
        input.deckKey,
        input.displayName,
        encoded.json,
        JSON.stringify(toDeckList(deck.runtimeDeck.mainDeck, deck.runtimeDeck.energyDeck)),
        encoded.contentHash,
        JSON.stringify(input.playStyleTags),
        input.difficulty,
        input.sourceLabel,
        input.sourceUrl ?? null,
        input.reviewNote,
        this.now(),
      ]
    );
    const row = result.rows[0];
    if (!row) throw adminError('THEME_DECK_POOL_CHANGED', '卡组池状态已变化，请刷新后重试', 409);
    audit('THEME_DECK_ADDED', adminUserId, themeId, { deckKey: input.deckKey });
    return mapDeck(row);
  }

  async updateDeck(
    adminUserId: string,
    themeId: string,
    deckId: string,
    input: ThemeAdminDeckUpdateInput
  ) {
    const theme = await this.requireDeckPoolEditable(themeId);
    await this.assertCurrentEnvironmentForDeckChange(theme);
    const deck =
      input.sourceType === 'YAML'
        ? await this.loadYamlDeck(input.yamlContent)
        : await this.loadDeck(adminUserId, input.sourceDeckId);
    const encoded = encodePublicTableRuntimeDeck(deck.runtimeDeck);
    const replacementId = this.createId();
    const result = await this.query<AdminDeckRow>(
      `WITH target_deck AS (
         SELECT deck.id, deck.deck_key
         FROM theme_prebuilt_deck_versions AS deck
         JOIN theme_table_versions AS theme
           ON theme.id = deck.theme_table_version_id
          AND theme.lifecycle IN ('DRAFT', 'ACTIVE', 'PAUSED')
         WHERE deck.id = $3
           AND deck.theme_table_version_id = $2
           AND deck.retired_at IS NULL
       ), retired_deck AS (
         UPDATE theme_prebuilt_deck_versions AS deck
         SET retired_at = $13
         FROM target_deck AS target
         WHERE deck.id = target.id
           AND deck.retired_at IS NULL
         RETURNING target.id, target.deck_key
       ), disabled_matchups AS (
         UPDATE theme_matchup_pair_versions AS pair
         SET enabled = FALSE, disabled_at = $13, updated_at = $13
         FROM retired_deck AS retired
         WHERE pair.theme_table_version_id = $2
           AND pair.enabled = TRUE
           AND (pair.first_deck_version_id = retired.id OR pair.second_deck_version_id = retired.id)
         RETURNING pair.id
       ), inserted_deck AS (
         INSERT INTO theme_prebuilt_deck_versions (
           id, theme_table_version_id, deck_key, display_name, runtime_deck, deck_list,
           content_hash, play_style_tags, difficulty, source_label, source_url,
           review_note, approved_at, created_at
         )
         SELECT
           $1, $2, retired.deck_key, $4, $5::jsonb, $6::jsonb,
           $7, $8::jsonb, $9, $10, $11, $12, $13, $13
         FROM retired_deck AS retired
         RETURNING id, deck_key, display_name, deck_list, content_hash,
                   play_style_tags, difficulty, source_label, source_url,
                   review_note, approved_at
       ), inserted_matchups AS (
         INSERT INTO theme_matchup_pair_versions (
           theme_table_version_id, first_deck_version_id, second_deck_version_id,
           weight, enabled, test_summary, approved_at, created_at, updated_at
         )
         SELECT
           $2,
           CASE WHEN existing.id < inserted.id THEN existing.id ELSE inserted.id END,
           CASE WHEN existing.id < inserted.id THEN inserted.id ELSE existing.id END,
           1, TRUE, jsonb_build_object('summary', '随卡组池自动启用'), $13, $13, $13
         FROM theme_prebuilt_deck_versions AS existing
         CROSS JOIN inserted_deck AS inserted
         WHERE existing.theme_table_version_id = $2
           AND existing.retired_at IS NULL
           AND existing.id <> $3
         UNION ALL
         SELECT
           $2, inserted.id, inserted.id,
           1, TRUE, jsonb_build_object('summary', '随卡组池自动启用'), $13, $13, $13
         FROM inserted_deck AS inserted
         ON CONFLICT (
           theme_table_version_id, first_deck_version_id, second_deck_version_id
         ) DO NOTHING
       )
       SELECT * FROM inserted_deck`,
      [
        replacementId,
        themeId,
        deckId,
        input.displayName,
        encoded.json,
        JSON.stringify(toDeckList(deck.runtimeDeck.mainDeck, deck.runtimeDeck.energyDeck)),
        encoded.contentHash,
        JSON.stringify(input.playStyleTags),
        input.difficulty,
        input.sourceLabel,
        input.sourceUrl ?? null,
        input.reviewNote,
        this.now(),
      ]
    );
    const row = result.rows[0];
    if (!row) throw adminError('THEME_DECK_NOT_FOUND', '卡组池中没有这副卡组', 404);
    audit('THEME_DECK_UPDATED', adminUserId, themeId, {
      previousDeckVersionId: deckId,
      deckVersionId: replacementId,
    });
    return mapDeck(row);
  }

  async deleteDeck(adminUserId: string, themeId: string, deckId: string) {
    await this.requireDeckPoolEditable(themeId);
    const result = await this.query<{ id: string; disabled_matchup_count: string }>(
      `WITH target_deck AS (
         SELECT deck.id
         FROM theme_prebuilt_deck_versions AS deck
         JOIN theme_table_versions AS theme
           ON theme.id = deck.theme_table_version_id
          AND theme.lifecycle IN ('DRAFT', 'ACTIVE', 'PAUSED')
         WHERE deck.id = $2
           AND deck.theme_table_version_id = $1
           AND deck.retired_at IS NULL
       ), retired_deck AS (
         UPDATE theme_prebuilt_deck_versions AS deck
         SET retired_at = $3
         FROM target_deck AS target
         WHERE deck.id = target.id
           AND deck.retired_at IS NULL
         RETURNING deck.id
       ), disabled_matchups AS (
         UPDATE theme_matchup_pair_versions AS pair
         SET enabled = FALSE, disabled_at = $3, updated_at = $3
         FROM retired_deck AS retired
         WHERE pair.theme_table_version_id = $1
           AND pair.enabled = TRUE
           AND (pair.first_deck_version_id = retired.id OR pair.second_deck_version_id = retired.id)
         RETURNING pair.id
       ), paused_theme AS (
         UPDATE theme_table_versions AS theme
         SET lifecycle = 'PAUSED', updated_at = $3
         FROM retired_deck AS retired
         WHERE theme.id = $1
           AND theme.lifecycle = 'ACTIVE'
           AND NOT EXISTS (
             SELECT 1
             FROM theme_matchup_pair_versions AS candidate
             JOIN theme_prebuilt_deck_versions AS first_deck
               ON first_deck.id = candidate.first_deck_version_id
              AND first_deck.retired_at IS NULL
             JOIN theme_prebuilt_deck_versions AS second_deck
               ON second_deck.id = candidate.second_deck_version_id
              AND second_deck.retired_at IS NULL
             WHERE candidate.theme_table_version_id = theme.id
               AND candidate.enabled = TRUE
               AND candidate.first_deck_version_id <> retired.id
               AND candidate.second_deck_version_id <> retired.id
           )
         RETURNING theme.id
       )
       SELECT retired_deck.id,
              (SELECT COUNT(*) FROM disabled_matchups)::text AS disabled_matchup_count
       FROM retired_deck`,
      [themeId, deckId, this.now()]
    );
    const row = result.rows[0];
    if (!row) throw adminError('THEME_DECK_NOT_FOUND', '卡组池中没有这副卡组', 404);
    audit('THEME_DECK_RETIRED', adminUserId, themeId, {
      deckId,
      disabledMatchupCount: Number(row.disabled_matchup_count),
    });
    return { id: row.id, disabledMatchupCount: Number(row.disabled_matchup_count) };
  }

  async addMatchup(adminUserId: string, themeId: string, input: ThemeAdminMatchupInput) {
    await this.requireDraft(themeId);
    const [firstDeckVersionId, secondDeckVersionId] = [
      input.firstDeckVersionId,
      input.secondDeckVersionId,
    ].sort((first, second) => first.localeCompare(second));
    const result = await this.query<MatchupRow>(
      `INSERT INTO theme_matchup_pair_versions (
         id, theme_table_version_id, first_deck_version_id, second_deck_version_id,
         weight, enabled, test_summary, approved_at, created_at, updated_at
       )
       SELECT $1, $2, first_deck.id, second_deck.id, $5, TRUE, $6::jsonb, $7, $7, $7
       FROM theme_prebuilt_deck_versions AS first_deck
       JOIN theme_prebuilt_deck_versions AS second_deck
         ON second_deck.id = $4
        AND second_deck.theme_table_version_id = $2
        AND second_deck.retired_at IS NULL
       JOIN theme_table_versions AS theme
         ON theme.id = first_deck.theme_table_version_id AND theme.lifecycle = 'DRAFT'
       WHERE first_deck.id = $3
         AND first_deck.theme_table_version_id = $2
         AND first_deck.retired_at IS NULL
       RETURNING id, first_deck_version_id, second_deck_version_id, weight, enabled,
                 test_summary, approved_at,
                 (SELECT display_name FROM theme_prebuilt_deck_versions WHERE id = first_deck_version_id) AS first_deck_name,
                 (SELECT display_name FROM theme_prebuilt_deck_versions WHERE id = second_deck_version_id) AS second_deck_name`,
      [
        this.createId(),
        themeId,
        firstDeckVersionId,
        secondDeckVersionId,
        input.weight,
        JSON.stringify(input.testSummary),
        this.now(),
      ]
    );
    const row = result.rows[0];
    if (!row) throw adminError('THEME_MATCHUP_DECK_INVALID', '组合中的预组不属于当前活动', 409);
    audit('THEME_MATCHUP_ADDED', adminUserId, themeId, { matchupId: row.id });
    return mapMatchup(row);
  }

  async setMatchupEnabled(
    adminUserId: string,
    themeId: string,
    matchupId: string,
    enabled: boolean
  ) {
    const theme = await this.requireTheme(themeId);
    if (enabled && theme.lifecycle !== 'DRAFT') {
      throw adminError('THEME_MATCHUP_ENABLE_FROZEN', '活动发布后不能追加或重新启用组合', 409);
    }
    if (theme.lifecycle === 'CLOSED') {
      throw adminError('THEME_EVENT_CLOSED', '已结束活动不能修改组合', 409);
    }
    const result = await this.query<MatchupRow>(
      `WITH updated_pair AS (
         UPDATE theme_matchup_pair_versions AS pair
         SET enabled = $3,
             disabled_at = CASE WHEN $3 THEN NULL ELSE $4 END,
             updated_at = $4
         FROM theme_table_versions AS theme
         WHERE pair.id = $2
           AND pair.theme_table_version_id = $1
           AND theme.id = pair.theme_table_version_id
           AND theme.lifecycle <> 'CLOSED'
           AND ($3 = FALSE OR theme.lifecycle = 'DRAFT')
           AND ($3 = FALSE OR NOT EXISTS (
             SELECT 1 FROM theme_prebuilt_deck_versions AS retired_deck
             WHERE retired_deck.id IN (pair.first_deck_version_id, pair.second_deck_version_id)
               AND retired_deck.retired_at IS NOT NULL
           ))
         RETURNING pair.*
       ), paused_theme AS (
         UPDATE theme_table_versions AS theme
         SET lifecycle = 'PAUSED', updated_at = $4
         WHERE theme.id = $1
           AND theme.lifecycle = 'ACTIVE'
           AND $3 = FALSE
           AND EXISTS (SELECT 1 FROM updated_pair)
           AND NOT EXISTS (
             SELECT 1
             FROM theme_matchup_pair_versions AS candidate
             JOIN theme_prebuilt_deck_versions AS first_deck
               ON first_deck.id = candidate.first_deck_version_id
              AND first_deck.retired_at IS NULL
             JOIN theme_prebuilt_deck_versions AS second_deck
               ON second_deck.id = candidate.second_deck_version_id
              AND second_deck.retired_at IS NULL
             WHERE candidate.theme_table_version_id = theme.id
               AND candidate.enabled = TRUE
           )
         RETURNING theme.id
       )
       SELECT pair.id, pair.first_deck_version_id,
              first_deck.display_name AS first_deck_name,
              pair.second_deck_version_id,
              second_deck.display_name AS second_deck_name,
              pair.weight, pair.enabled, pair.test_summary, pair.approved_at
       FROM updated_pair AS pair
       JOIN theme_prebuilt_deck_versions AS first_deck
         ON first_deck.id = pair.first_deck_version_id
       JOIN theme_prebuilt_deck_versions AS second_deck
         ON second_deck.id = pair.second_deck_version_id`,
      [themeId, matchupId, enabled, this.now()]
    );
    const row = result.rows[0];
    if (!row) throw adminError('THEME_MATCHUP_NOT_FOUND', '主题组合不存在', 404);
    audit(enabled ? 'THEME_MATCHUP_ENABLED' : 'THEME_MATCHUP_DISABLED', adminUserId, themeId, {
      matchupId,
    });
    return mapMatchup(row);
  }

  async runLifecycleAction(
    adminUserId: string,
    themeId: string,
    action: 'ACTIVATE' | 'PAUSE' | 'RESUME' | 'CLOSE'
  ) {
    const theme = await this.requireTheme(themeId);
    if (action === 'ACTIVATE') {
      if (theme.lifecycle !== 'DRAFT') {
        throw adminError('THEME_ACTIVATION_FORBIDDEN', '只有草稿活动可以发布', 409);
      }
      await this.assertPublishable(theme);
      await this.runLifecycleMutation(
        `UPDATE theme_table_versions
         SET lifecycle = 'ACTIVE', activated_at = $2, updated_at = $2
         WHERE id = $1
           AND lifecycle = 'DRAFT'
           AND (SELECT COUNT(*) FROM theme_prebuilt_deck_versions
                WHERE theme_table_version_id = $1 AND retired_at IS NULL) >= 1
           AND EXISTS (
             SELECT 1
             FROM theme_matchup_pair_versions AS pair
             JOIN theme_prebuilt_deck_versions AS first_deck
               ON first_deck.id = pair.first_deck_version_id AND first_deck.retired_at IS NULL
             JOIN theme_prebuilt_deck_versions AS second_deck
               ON second_deck.id = pair.second_deck_version_id AND second_deck.retired_at IS NULL
             WHERE pair.theme_table_version_id = $1 AND pair.enabled = TRUE
           )
         RETURNING id`,
        [themeId, this.now()]
      );
    } else if (action === 'PAUSE') {
      if (theme.lifecycle !== 'ACTIVE') {
        throw adminError('THEME_PAUSE_FORBIDDEN', '只有开放中的活动可以暂停', 409);
      }
      await this.runLifecycleMutation(
        `UPDATE theme_table_versions SET lifecycle = 'PAUSED', updated_at = $2
         WHERE id = $1 AND lifecycle = 'ACTIVE'
         RETURNING id`,
        [themeId, this.now()]
      );
    } else if (action === 'RESUME') {
      if (theme.lifecycle !== 'PAUSED') {
        throw adminError('THEME_RESUME_FORBIDDEN', '只有暂停中的活动可以恢复', 409);
      }
      await this.assertPublishable(theme);
      await this.runLifecycleMutation(
        `UPDATE theme_table_versions SET lifecycle = 'ACTIVE', updated_at = $2
         WHERE id = $1
           AND lifecycle = 'PAUSED'
           AND EXISTS (
             SELECT 1
             FROM theme_matchup_pair_versions AS pair
             JOIN theme_prebuilt_deck_versions AS first_deck
               ON first_deck.id = pair.first_deck_version_id AND first_deck.retired_at IS NULL
             JOIN theme_prebuilt_deck_versions AS second_deck
               ON second_deck.id = pair.second_deck_version_id AND second_deck.retired_at IS NULL
             WHERE pair.theme_table_version_id = $1 AND pair.enabled = TRUE
           )
         RETURNING id`,
        [themeId, this.now()]
      );
    } else {
      if (theme.lifecycle !== 'ACTIVE' && theme.lifecycle !== 'PAUSED') {
        throw adminError('THEME_CLOSE_FORBIDDEN', '只有已发布活动可以结束', 409);
      }
      await this.runLifecycleMutation(
        `UPDATE theme_table_versions
         SET lifecycle = 'CLOSED', closed_at = $2, updated_at = $2
         WHERE id = $1 AND lifecycle IN ('ACTIVE', 'PAUSED')
         RETURNING id`,
        [themeId, this.now()]
      );
    }
    audit(`THEME_${action}`, adminUserId, themeId);
    return this.getEvent(themeId);
  }

  async getEvent(themeId: string): Promise<ThemeAdminEventView> {
    return this.projectEvent(await this.requireTheme(themeId));
  }

  private async requireDraft(themeId: string) {
    const theme = await this.requireTheme(themeId);
    if (theme.lifecycle !== 'DRAFT') {
      throw adminError('THEME_DRAFT_FROZEN', '活动发布后不能修改预组或新增组合', 409);
    }
    return theme;
  }

  private async requireDeckPoolEditable(themeId: string) {
    const theme = await this.requireTheme(themeId);
    if (theme.lifecycle === 'CLOSED') {
      throw adminError('THEME_DECK_POOL_CLOSED', '已结束的主题赛季不能修改卡组池', 409);
    }
    return theme;
  }

  private async assertCurrentEnvironmentForDeckChange(theme: ThemeRow) {
    if (theme.lifecycle === 'DRAFT') return;
    const catalog = await this.getCatalog(true);
    if (
      theme.rules_environment_id !== REPLAY_RULES_VERSION ||
      theme.card_catalog_hash !== catalog.cardCatalogHash
    ) {
      throw adminError(
        'THEME_ENVIRONMENT_CHANGED',
        '规则或卡牌目录已变化，不能继续修改本期卡组池',
        409
      );
    }
  }

  private async runLifecycleMutation(text: string, values: readonly unknown[]): Promise<void> {
    try {
      const result = await this.query<{ id: string }>(text, values);
      if (!result.rows[0]) {
        throw adminError('THEME_LIFECYCLE_CONFLICT', '活动状态已变化，请刷新后重试', 409);
      }
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        throw adminError('THEME_ACTIVE_VERSION_CONFLICT', '已有其他主题活动处于开放状态', 409);
      }
      throw error;
    }
  }

  private async requireTheme(themeId: string): Promise<ThemeRow> {
    const result = await this.query<ThemeRow>(`SELECT * FROM theme_table_versions WHERE id = $1`, [
      themeId,
    ]);
    const row = result.rows[0];
    if (!row) throw adminError('THEME_EVENT_NOT_FOUND', '主题活动不存在', 404);
    return row;
  }

  private async assertPublishable(theme: ThemeRow) {
    const catalog = await this.getCatalog(true);
    if (
      theme.rules_environment_id !== REPLAY_RULES_VERSION ||
      theme.card_catalog_hash !== catalog.cardCatalogHash
    ) {
      throw adminError(
        'THEME_ENVIRONMENT_CHANGED',
        '规则或卡牌目录已变化，请创建新的活动版本',
        409
      );
    }
    if (new Date(theme.ends_at).getTime() <= this.now().getTime()) {
      throw adminError('THEME_EVENT_ENDED', '活动结束时间已经过去', 409);
    }
    const counts = await this.query<{ deck_count: string; matchup_count: string }>(
      `SELECT
         (SELECT COUNT(*) FROM theme_prebuilt_deck_versions
           WHERE theme_table_version_id = $1 AND retired_at IS NULL)::text AS deck_count,
         (SELECT COUNT(*)
            FROM theme_matchup_pair_versions AS pair
            JOIN theme_prebuilt_deck_versions AS first_deck
              ON first_deck.id = pair.first_deck_version_id AND first_deck.retired_at IS NULL
            JOIN theme_prebuilt_deck_versions AS second_deck
              ON second_deck.id = pair.second_deck_version_id AND second_deck.retired_at IS NULL
           WHERE pair.theme_table_version_id = $1 AND pair.enabled = TRUE)::text AS matchup_count`,
      [theme.id]
    );
    if (Number(counts.rows[0]?.deck_count ?? 0) < 1) {
      throw adminError('THEME_DECK_POOL_INCOMPLETE', '至少需要一副审核通过的预组', 409);
    }
    if (Number(counts.rows[0]?.matchup_count ?? 0) < 1) {
      throw adminError('THEME_MATCHUP_POOL_EMPTY', '至少需要一个已启用的对局组合', 409);
    }
  }

  private async projectEvent(theme: ThemeRow): Promise<ThemeAdminEventView> {
    const [decksResult, matchupsResult, metrics] = await Promise.all([
      this.query<AdminDeckRow>(
        `SELECT id, deck_key, display_name, deck_list, content_hash, play_style_tags,
                difficulty, source_label, source_url, review_note, approved_at
         FROM theme_prebuilt_deck_versions
         WHERE theme_table_version_id = $1
           AND retired_at IS NULL
         ORDER BY deck_key, id`,
        [theme.id]
      ),
      this.query<MatchupRow>(
        `SELECT pair.id, pair.first_deck_version_id, first_deck.display_name AS first_deck_name,
                pair.second_deck_version_id, second_deck.display_name AS second_deck_name,
                pair.weight, pair.enabled, pair.test_summary, pair.approved_at
         FROM theme_matchup_pair_versions AS pair
         JOIN theme_prebuilt_deck_versions AS first_deck ON first_deck.id = pair.first_deck_version_id
         JOIN theme_prebuilt_deck_versions AS second_deck ON second_deck.id = pair.second_deck_version_id
         WHERE pair.theme_table_version_id = $1
           AND first_deck.retired_at IS NULL
           AND second_deck.retired_at IS NULL
         ORDER BY pair.created_at, pair.id`,
        [theme.id]
      ),
      this.loadMetrics(theme.id),
    ]);
    return {
      id: theme.id,
      versionKey: theme.version_key,
      name: theme.name,
      lifecycle: theme.lifecycle,
      environmentId: theme.environment_id,
      rulesEnvironmentId: theme.rules_environment_id,
      cardCatalogHash: theme.card_catalog_hash,
      allocationAlgorithmVersion: theme.allocation_algorithm_version,
      platformTimeZone: theme.platform_time_zone,
      openWindows: theme.open_windows,
      startsAt: new Date(theme.starts_at).getTime(),
      endsAt: new Date(theme.ends_at).getTime(),
      scheduleLabel: theme.schedule_label,
      summary: theme.summary,
      announcement: theme.announcement,
      evaluationPolicy: theme.evaluation_policy,
      decks: decksResult.rows.map(mapDeck),
      matchups: matchupsResult.rows.map(mapMatchup),
      metrics,
    };
  }

  private async loadMetrics(themeId: string): Promise<ThemeAdminMetricsView> {
    const [counts, exposure] = await Promise.all([
      this.query<{
        joined_ticket_count: string;
        assignment_count: string;
        started_match_count: string;
        completed_match_count: string;
        no_fault_requeue_count: string;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM public_table_tickets WHERE theme_table_version_id = $1)::text AS joined_ticket_count,
           (SELECT COUNT(*) FROM theme_table_assignments WHERE theme_table_version_id = $1)::text AS assignment_count,
           (SELECT COUNT(*) FROM theme_table_assignments WHERE theme_table_version_id = $1 AND match_id IS NOT NULL)::text AS started_match_count,
           (SELECT COUNT(*) FROM theme_table_assignments AS assignment
              JOIN match_records AS record ON record.match_id = assignment.match_id
             WHERE assignment.theme_table_version_id = $1
               AND record.status IN ('COMPLETED', 'SURRENDERED'))::text AS completed_match_count,
           (SELECT COUNT(*) FROM public_table_tickets
             WHERE theme_table_version_id = $1 AND terminal_reason = 'NO_FAULT_REQUEUED')::text AS no_fault_requeue_count`,
        [themeId]
      ),
      this.query<{
        deck_version_id: string;
        display_name: string;
        assignment_count: string;
        expected_weight: string;
        total_pair_weight: string;
      }>(
        `SELECT deck.id AS deck_version_id, deck.display_name,
                COALESCE(SUM(
                  (assignment.first_ticket_deck_version_id = deck.id)::int +
                  (assignment.second_ticket_deck_version_id = deck.id)::int
                ), 0)::text AS assignment_count,
                COALESCE((
                  SELECT SUM(
                    pair.weight *
                    ((pair.first_deck_version_id = deck.id)::int +
                     (pair.second_deck_version_id = deck.id)::int)
                  )
                  FROM theme_matchup_pair_versions AS pair
                  WHERE pair.theme_table_version_id = deck.theme_table_version_id
                    AND pair.enabled = TRUE
                ), 0)::text AS expected_weight,
                COALESCE((
                  SELECT SUM(pair.weight)
                  FROM theme_matchup_pair_versions AS pair
                  WHERE pair.theme_table_version_id = deck.theme_table_version_id
                    AND pair.enabled = TRUE
                ), 0)::text AS total_pair_weight
         FROM theme_prebuilt_deck_versions AS deck
         LEFT JOIN theme_table_assignments AS assignment
           ON assignment.theme_table_version_id = deck.theme_table_version_id
          AND (assignment.first_ticket_deck_version_id = deck.id OR assignment.second_ticket_deck_version_id = deck.id)
         WHERE deck.theme_table_version_id = $1
         GROUP BY deck.id, deck.display_name
         ORDER BY deck.deck_key, deck.id`,
        [themeId]
      ),
    ]);
    const row = counts.rows[0];
    return {
      joinedTicketCount: Number(row?.joined_ticket_count ?? 0),
      assignmentCount: Number(row?.assignment_count ?? 0),
      startedMatchCount: Number(row?.started_match_count ?? 0),
      completedMatchCount: Number(row?.completed_match_count ?? 0),
      noFaultRequeueCount: Number(row?.no_fault_requeue_count ?? 0),
      deckExposure: exposure.rows.map((entry) => {
        const assignmentCount = Number(entry.assignment_count);
        const expectedDenominator = Number(entry.total_pair_weight) * 2;
        const actualDenominator = Number(row?.assignment_count ?? 0) * 2;
        const expectedShare =
          expectedDenominator > 0 ? Number(entry.expected_weight) / expectedDenominator : 0;
        const actualShare = actualDenominator > 0 ? assignmentCount / actualDenominator : 0;
        return {
          deckVersionId: entry.deck_version_id,
          displayName: entry.display_name,
          assignmentCount,
          expectedShare,
          actualShare,
          deviation: actualShare - expectedShare,
        };
      }),
    };
  }
}

function assertDraftInput(input: ThemeAdminDraftInput) {
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw adminError('THEME_WINDOW_INVALID', '活动结束时间必须晚于开始时间');
  }
  if (input.openWindows.length === 0) {
    throw adminError('THEME_OPEN_WINDOWS_EMPTY', '至少配置一个开放时段');
  }
  if (input.openWindows.some((window) => window.startMinute >= window.endMinute)) {
    throw adminError('THEME_OPEN_WINDOW_INVALID', '开放时段结束时间必须晚于开始时间');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.platformTimeZone }).format(input.startsAt);
  } catch {
    throw adminError('THEME_TIME_ZONE_INVALID', '活动时区无效');
  }
}

function assertOperationsInput(input: ThemeAdminOperationsInput) {
  if (input.name.trim().length === 0 || input.name.trim().length > 100) {
    throw adminError('THEME_NAME_INVALID', '主题赛季名称不能为空且不能超过 100 个字符');
  }
  if (
    !Number.isFinite(input.startsAt.getTime()) ||
    !Number.isFinite(input.endsAt.getTime()) ||
    input.endsAt.getTime() <= input.startsAt.getTime()
  ) {
    throw adminError('THEME_WINDOW_INVALID', '活动结束时间必须晚于开始时间');
  }
  if (input.openWindows.length === 0) {
    throw adminError('THEME_OPEN_WINDOWS_EMPTY', '至少配置一个开放时段');
  }
  if (input.openWindows.some((window) => window.startMinute >= window.endMinute)) {
    throw adminError('THEME_OPEN_WINDOW_INVALID', '开放时段结束时间必须晚于开始时间');
  }
}

function toDeckList(mainDeck: readonly AnyCardData[], energyDeck: readonly AnyCardData[]) {
  return { mainDeck: countCards(mainDeck), energyDeck: countCards(energyDeck) };
}

function countCards(cards: readonly AnyCardData[]) {
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.cardCode, (counts.get(card.cardCode) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([cardCode, count]) => ({ cardCode, count }));
}

async function loadThemeDeckFromYaml(yamlContent: string): Promise<ThemeDeckSnapshotSource> {
  let rawConfig: unknown;
  try {
    rawConfig = yaml.parse(yamlContent);
  } catch {
    throw adminError('THEME_DECK_YAML_INVALID', 'YAML 文件无法解析');
  }
  const parsed = DeckConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw adminError(
      'THEME_DECK_YAML_INVALID',
      parsed.error.issues[0]?.message ?? 'YAML 卡组结构无效'
    );
  }

  let prepared;
  try {
    const recordPayload = deckConfigToRecordPayload(parsed.data);
    prepared = await prepareDeckPayloadForStorage({
      name: parsed.data.player_name,
      description: parsed.data.description,
      main_deck: recordPayload.main_deck,
      energy_deck: recordPayload.energy_deck,
    });
  } catch (error) {
    if (error instanceof DeckPayloadValidationError) {
      throw adminError('THEME_DECK_YAML_INVALID', error.errors[0] ?? 'YAML 卡组包含不可用卡牌');
    }
    throw error;
  }
  if (!prepared.validation.valid) {
    throw adminError(
      'THEME_DECK_YAML_INVALID',
      prepared.validation.errors[0] ?? 'YAML 卡组不符合当前构筑规则'
    );
  }
  const loaded = new DeckLoader(prepared.registry).loadFromConfig(prepared.config);
  if (!loaded.success || !loaded.deck) {
    throw adminError('THEME_DECK_YAML_INVALID', loaded.errors[0] ?? 'YAML 卡组加载失败');
  }
  return {
    runtimeDeck: {
      mainDeck: [...loaded.deck.mainDeck],
      energyDeck: [...loaded.deck.energyDeck],
    },
  };
}

function mapDeck(row: AdminDeckRow): ThemeAdminDeckView {
  const list = row.deck_list as {
    mainDeck?: readonly { cardCode: string; count: number }[];
    energyDeck?: readonly { cardCode: string; count: number }[];
  };
  return {
    id: row.id,
    deckKey: row.deck_key,
    displayName: row.display_name,
    playStyleTags: Array.isArray(row.play_style_tags)
      ? row.play_style_tags.filter((entry): entry is string => typeof entry === 'string')
      : [],
    difficulty: row.difficulty,
    sourceLabel: row.source_label,
    sourceUrl: row.source_url,
    contentHash: row.content_hash,
    mainDeck: list.mainDeck ?? [],
    energyDeck: list.energyDeck ?? [],
    reviewNote: row.review_note,
    approvedAt: new Date(row.approved_at).getTime(),
  };
}

function mapMatchup(row: MatchupRow): ThemeAdminMatchupView {
  return {
    id: row.id,
    firstDeckVersionId: row.first_deck_version_id,
    firstDeckName: row.first_deck_name,
    secondDeckVersionId: row.second_deck_version_id,
    secondDeckName: row.second_deck_name,
    weight: row.weight,
    enabled: row.enabled,
    testSummary: row.test_summary,
    approvedAt: new Date(row.approved_at).getTime(),
  };
}

function hashEnvironment(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function requireRow<T>(row: T | undefined, code: string): T {
  if (!row) throw adminError(code, '主题牌桌数据写入失败', 500);
  return row;
}

function adminError(code: string, message: string, statusCode = 400) {
  return new ThemeTableAdminServiceError(code, message, statusCode);
}

function isPostgresUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function audit(
  event: string,
  adminUserId: string,
  themeId: string,
  detail: Readonly<Record<string, unknown>> = {}
) {
  console.info(
    JSON.stringify({
      scope: 'theme_table_admin',
      event,
      adminUserId,
      themeId,
      ...detail,
    })
  );
}

export const themeTableAdminService = new ThemeTableAdminService();
