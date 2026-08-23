import type { PoolClient } from 'pg';
import type {
  DeckClassificationRunView,
  DeckClassifierArchetypeView,
  DeckClassifierDisplayMode,
  DeckClassifierOverviewView,
  DeckClassifierOverrideView,
  DeckClassifierPreviewView,
  DeckClassifierReleaseView,
  DeckClassifierReviewItemView,
  DeckClassifierRuleDefinitionView,
  DeckClassifierRuleView,
  DeckClassifierTemplateCardView,
  DeckClassifierTemplateView,
  DeckEnvironmentSection,
} from '../../online/deck-classifier-types.js';
import type { UserRole } from '../../shared/auth/permissions.js';
import { pool } from '../db/pool.js';
import {
  classifyDeck,
  fingerprintNormalizedDeck,
  normalizeDeck,
} from './deck-classifier-engine.js';
import {
  buildDeckClassifierSnapshot,
  hashDeckClassifierSnapshot,
  readRuleConditions,
  readTemplateCards,
  type DraftArchetypeRow,
  type DraftRuleRow,
  type DraftTemplateRow,
  type StoredDeckClassifierSnapshot,
} from './deck-classifier-release.js';
import { writeManagementAudit } from './management-audit-service.js';
import { stableJsonStringify } from './replay-payload-serialization.js';

export interface DeckClassifierOperator {
  readonly actorUserId: string;
  readonly actorRole: UserRole;
  readonly requestId: string;
}

export interface DeckClassifierArchetypeInput {
  readonly expectedDraftRevision: number;
  readonly archetypeKey: string;
  readonly name: string;
  readonly groupName: string;
  readonly description: string;
  readonly color: string;
  readonly representativeCardCode: string | null;
  readonly sortOrder: number;
  readonly reason: string;
}

export interface DeckClassifierArchetypeUpdateInput {
  readonly expectedDraftRevision: number;
  readonly name: string;
  readonly groupName: string;
  readonly description: string;
  readonly sortOrder: number;
  readonly reason: string;
}

export interface DeckClassifierArchetypeDisplayInput {
  readonly color: string;
  readonly representativeCardCode: string | null;
  readonly reason: string;
}

export interface DeckClassifierDisplaySettingsInput {
  readonly displayMode: Exclude<DeckClassifierDisplayMode, 'HIDDEN'>;
  readonly visibleSections: readonly DeckEnvironmentSection[];
  readonly cardDisplayMode: Exclude<DeckClassifierDisplayMode, 'HIDDEN'>;
  readonly cardVisibleSections: readonly DeckEnvironmentSection[];
  readonly topRankedPlayerCount: number;
  readonly reason: string;
}

export interface DeckClassifierTemplateFromMatchInput {
  readonly expectedDraftRevision: number;
  readonly archetypeId: string;
  readonly matchId: string;
  readonly seat: 'FIRST' | 'SECOND';
  readonly name: string;
  readonly sourceNote: string;
  readonly reason: string;
}

export interface DeckClassifierTemplateFromReviewInput {
  readonly expectedDraftRevision: number;
  readonly archetypeId: string;
  readonly deckFingerprint: string;
  readonly name: string;
  readonly sourceNote: string;
  readonly reason: string;
}

export interface DeckClassifierTemplateUpdateInput {
  readonly expectedDraftRevision: number;
  readonly archetypeId: string;
  readonly name: string;
  readonly cards: readonly DeckClassifierTemplateCardView[];
  readonly sourceNote: string;
  readonly enabled: boolean;
  readonly reason: string;
}

export interface DeckClassifierRuleInput {
  readonly expectedDraftRevision: number;
  readonly archetypeId: string;
  readonly name: string;
  readonly priority: number;
  readonly definition: DeckClassifierRuleDefinitionView;
  readonly enabled: boolean;
  readonly reason: string;
}

export interface DeckClassifierOverrideInput {
  readonly deckFingerprint: string;
  readonly targetStatus: 'CLASSIFIED' | 'UNKNOWN' | 'EXCLUDED';
  readonly archetypeId: string | null;
  readonly appliesToFutureReleases: boolean;
  readonly idempotencyKey: string;
  readonly reason: string;
}

interface ArchetypeRow extends DraftArchetypeRow {
  readonly color_key: string;
  readonly representative_card_code: string | null;
  readonly lifecycle: 'ACTIVE' | 'ARCHIVED';
  readonly template_count: number | string;
  readonly rule_count: number | string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface TemplateRow extends DraftTemplateRow {
  readonly name: string;
  readonly deck_fingerprint: string;
  readonly source_kind: 'MATCH_OBSERVATION' | 'SEED_PACKAGE' | 'MANUAL';
  readonly source_match_id: string | null;
  readonly source_seat: 'FIRST' | 'SECOND' | null;
  readonly source_note: string;
  readonly enabled: boolean;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface RuleRow extends DraftRuleRow {
  readonly name: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface ReleaseRow {
  readonly id: string;
  readonly version: number;
  readonly status: 'BUILDING' | 'ACTIVE' | 'SUPERSEDED' | 'FAILED';
  readonly snapshot_json: unknown;
  readonly config_hash: string;
  readonly reason: string;
  readonly published_at: Date | string;
  readonly activated_at: Date | string | null;
}

interface RunRow {
  readonly id: string;
  readonly release_id: string;
  readonly release_version: number;
  readonly status: DeckClassificationRunView['status'];
  readonly trigger: DeckClassificationRunView['trigger'];
  readonly scope_season_id: string | null;
  readonly reason: string;
  readonly total_count: number | string;
  readonly processed_count: number | string;
  readonly classified_count: number | string;
  readonly unknown_count: number | string;
  readonly ambiguous_count: number | string;
  readonly invalid_count: number | string;
  readonly excluded_count: number | string;
  readonly changed_count: number | string;
  readonly error_message: string | null;
  readonly created_at: Date | string;
  readonly started_at: Date | string | null;
  readonly finished_at: Date | string | null;
}

interface ReviewRow {
  readonly deck_fingerprint: string;
  readonly status: 'UNKNOWN' | 'AMBIGUOUS';
  readonly occurrence_count: number | string;
  readonly player_count: number | string;
  readonly season_count: number | string;
  readonly first_observed_at: Date | string;
  readonly last_observed_at: Date | string;
  readonly cards: unknown;
  readonly evidence: unknown;
}

interface ObservationFingerprintRow {
  readonly deck_fingerprint: string;
  readonly main_deck_cards: unknown;
  readonly occurrence_count: number | string;
}

interface PriorAssignmentRow {
  readonly deck_fingerprint: string;
  readonly status: string;
  readonly archetype_id: string | null;
}

interface OverrideRow {
  readonly id: string;
  readonly deck_fingerprint: string;
  readonly archetype_id: string | null;
  readonly target_status: 'CLASSIFIED' | 'UNKNOWN' | 'EXCLUDED';
}

interface OverrideListRow {
  readonly id: string;
  readonly deck_fingerprint: string;
  readonly archetype_id: string | null;
  readonly target_status: 'CLASSIFIED' | 'UNKNOWN' | 'EXCLUDED';
  readonly reason: string;
  readonly applies_to_future_releases: boolean;
  readonly release_id: string | null;
  readonly cards: unknown;
  readonly created_at: Date | string;
}

export class DeckClassifierAdminServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'DeckClassifierAdminServiceError';
  }
}

export class DeckClassifierAdminService {
  async getOverview(): Promise<DeckClassifierOverviewView> {
    const [settings, archetypes, templates, rules, releases, runs, reviewQueue, overrides] =
      await Promise.all([
        pool.query<{
          display_mode: DeckClassifierDisplayMode;
          show_usage: boolean;
          show_winner: boolean;
          show_top_ranked: boolean;
          card_display_mode: DeckClassifierDisplayMode;
          card_show_usage: boolean;
          card_show_winner: boolean;
          card_show_top_ranked: boolean;
          top_ranked_player_count: number;
          draft_revision: number;
        }>(
          `SELECT display_mode, show_usage, show_winner, show_top_ranked,
                  card_display_mode, card_show_usage, card_show_winner,
                  card_show_top_ranked,
                  top_ranked_player_count, draft_revision
           FROM deck_classifier_settings WHERE id = 1`
        ),
        pool.query<ArchetypeRow>(ARCHETYPES_QUERY),
        pool.query<TemplateRow>(TEMPLATES_QUERY),
        pool.query<RuleRow>(RULES_QUERY),
        pool.query<ReleaseRow>(
          `SELECT * FROM deck_classifier_releases
           ORDER BY (status = 'ACTIVE') DESC, version DESC
           LIMIT 30`
        ),
        pool.query<RunRow>(`${RUNS_QUERY} LIMIT 30`),
        this.listReviewQueue(),
        pool.query<OverrideListRow>(
          `SELECT override.id, override.deck_fingerprint, override.archetype_id,
                override.target_status, override.reason,
                override.applies_to_future_releases, override.release_id, override.created_at,
                observation.main_deck_cards AS cards
         FROM deck_classification_overrides AS override
         LEFT JOIN LATERAL (
           SELECT main_deck_cards
           FROM ranked_deck_observations
           WHERE deck_fingerprint = override.deck_fingerprint
           ORDER BY observed_at DESC, match_id DESC, seat DESC
           LIMIT 1
         ) AS observation ON TRUE
         WHERE override.revoked_at IS NULL
           AND (
             override.applies_to_future_releases = true
             OR EXISTS (
               SELECT 1
               FROM deck_classifier_releases AS release
               WHERE release.id = override.release_id AND release.status = 'ACTIVE'
             )
           )
         ORDER BY created_at DESC, id DESC
         LIMIT 200`
        ),
      ]);
    const releaseViews = releases.rows.map(toReleaseView);
    const currentSettings = settings.rows[0];
    return {
      displayMode: currentSettings?.display_mode ?? 'BOTH',
      visibleSections: currentSettings ? readVisibleSections(currentSettings) : ['USAGE', 'WINNER'],
      cardDisplayMode: currentSettings?.card_display_mode ?? 'PLAYER_EQUAL',
      cardVisibleSections: currentSettings ? readCardVisibleSections(currentSettings) : ['USAGE'],
      topRankedPlayerCount: currentSettings?.top_ranked_player_count ?? 30,
      draftRevision: settings.rows[0]?.draft_revision ?? 0,
      activeRelease: releaseViews.find((release) => release.status === 'ACTIVE') ?? null,
      archetypes: archetypes.rows.map(toArchetypeView),
      templates: templates.rows.map(toTemplateView),
      rules: rules.rows.map(toRuleView),
      releases: releaseViews,
      runs: runs.rows.map(toRunView),
      reviewQueue,
      overrides: overrides.rows.map(toOverrideView),
    };
  }

  async getClassificationRun(runId: string): Promise<DeckClassificationRunView> {
    const result = await pool.query<RunRow>(`${RUNS_SELECT} WHERE run.id = $1`, [runId]);
    return toRunView(
      requireRow(result.rows[0], 'DECK_CLASSIFICATION_RUN_NOT_FOUND', '卡组重分类任务不存在', 404)
    );
  }

  async listReviewQueue(limit = 100): Promise<readonly DeckClassifierReviewItemView[]> {
    const result = await pool.query<ReviewRow>(
      `WITH active_release AS (
         SELECT id
         FROM deck_classifier_releases
         WHERE status = 'ACTIVE'
       ), grouped AS (
         SELECT
           observation.deck_fingerprint,
           assignment.status,
           count(*) AS occurrence_count,
           count(DISTINCT observation.user_id) AS player_count,
           count(DISTINCT observation.season_id) AS season_count,
           min(observation.observed_at) AS first_observed_at,
           max(observation.observed_at) AS last_observed_at,
           (array_agg(assignment.evidence ORDER BY assignment.classified_at DESC))[1] AS evidence
         FROM deck_classification_assignments AS assignment
         JOIN active_release ON active_release.id = assignment.release_id
         JOIN ranked_deck_observations AS observation
           ON observation.match_id = assignment.match_id
          AND observation.seat = assignment.seat
         WHERE assignment.status IN ('UNKNOWN', 'AMBIGUOUS')
         GROUP BY observation.deck_fingerprint, assignment.status
       ), sample_observation AS (
         SELECT DISTINCT ON (observation.deck_fingerprint)
           observation.deck_fingerprint,
           observation.main_deck_cards
         FROM ranked_deck_observations AS observation
         JOIN grouped ON grouped.deck_fingerprint = observation.deck_fingerprint
         ORDER BY observation.deck_fingerprint, observation.observed_at DESC
       )
       SELECT grouped.*, sample_observation.main_deck_cards AS cards
       FROM grouped
       JOIN sample_observation USING (deck_fingerprint)
       ORDER BY occurrence_count DESC, last_observed_at DESC, deck_fingerprint ASC
       LIMIT $1`,
      [Math.max(1, Math.min(500, limit))]
    );
    return result.rows.map(toReviewView);
  }

  async updateDisplaySettings(
    input: DeckClassifierDisplaySettingsInput,
    operator: DeckClassifierOperator
  ): Promise<{
    readonly displayMode: DeckClassifierDisplayMode;
    readonly visibleSections: readonly DeckEnvironmentSection[];
    readonly cardDisplayMode: DeckClassifierDisplayMode;
    readonly cardVisibleSections: readonly DeckEnvironmentSection[];
    readonly topRankedPlayerCount: number;
  }> {
    return withTransaction(async (client) => {
      const visibleSections = [...new Set(input.visibleSections)];
      const showUsage = visibleSections.includes('USAGE');
      const showWinner = visibleSections.includes('WINNER');
      const showTopRanked = visibleSections.includes('TOP_RANKED');
      const displayMode: DeckClassifierDisplayMode =
        visibleSections.length === 0 ? 'HIDDEN' : input.displayMode;
      const cardVisibleSections = [...new Set(input.cardVisibleSections)];
      const cardShowUsage = cardVisibleSections.includes('USAGE');
      const cardShowWinner = cardVisibleSections.includes('WINNER');
      const cardShowTopRanked = cardVisibleSections.includes('TOP_RANKED');
      const cardDisplayMode: DeckClassifierDisplayMode =
        cardVisibleSections.length === 0 ? 'HIDDEN' : input.cardDisplayMode;
      const before = await client.query(
        `SELECT display_mode, show_usage, show_winner, show_top_ranked,
                card_display_mode, card_show_usage, card_show_winner, card_show_top_ranked,
                top_ranked_player_count
         FROM deck_classifier_settings WHERE id = 1 FOR UPDATE`
      );
      await client.query(
        `UPDATE deck_classifier_settings
            SET display_mode = $1, show_usage = $2, show_winner = $3,
                show_top_ranked = $4, card_display_mode = $5,
                card_show_usage = $6, card_show_winner = $7,
                card_show_top_ranked = $8, top_ranked_player_count = $9,
                updated_by = $10, updated_at = NOW()
          WHERE id = 1`,
        [
          displayMode,
          showUsage,
          showWinner,
          showTopRanked,
          cardDisplayMode,
          cardShowUsage,
          cardShowWinner,
          cardShowTopRanked,
          input.topRankedPlayerCount,
          operator.actorUserId,
        ]
      );
      await writeClassifierAudit(client, operator, {
        action: 'DISPLAY_SETTINGS_UPDATED',
        targetType: 'SETTINGS',
        targetId: 'global',
        reason: input.reason,
        before: before.rows[0] ?? null,
        after: {
          displayMode,
          visibleSections,
          cardDisplayMode,
          cardVisibleSections,
          topRankedPlayerCount: input.topRankedPlayerCount,
        },
      });
      return {
        displayMode,
        visibleSections,
        cardDisplayMode,
        cardVisibleSections,
        topRankedPlayerCount: input.topRankedPlayerCount,
      };
    });
  }

  async createArchetype(
    input: DeckClassifierArchetypeInput,
    operator: DeckClassifierOperator
  ): Promise<DeckClassifierArchetypeView> {
    return withTransaction(async (client) => {
      await assertAndBumpDraftRevision(client, input.expectedDraftRevision);
      await requireRepresentativeCard(client, input.representativeCardCode);
      const inserted = await client.query<ArchetypeRow>(
        `INSERT INTO deck_archetypes (
           archetype_key, name, group_name, description, color_key, representative_card_code,
           sort_order, created_by, updated_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         RETURNING *, 0::bigint AS template_count, 0::bigint AS rule_count`,
        [
          input.archetypeKey,
          input.name,
          input.groupName,
          input.description,
          input.color,
          input.representativeCardCode,
          input.sortOrder,
          operator.actorUserId,
        ]
      );
      const row = requireRow(inserted.rows[0], 'DECK_ARCHETYPE_CREATE_FAILED', '卡组分类创建失败');
      await writeClassifierAudit(client, operator, {
        action: 'ARCHETYPE_CREATED',
        targetType: 'ARCHETYPE',
        targetId: row.id,
        reason: input.reason,
        after: row,
      });
      return toArchetypeView(row);
    });
  }

  async updateArchetype(
    archetypeId: string,
    input: DeckClassifierArchetypeUpdateInput,
    operator: DeckClassifierOperator
  ): Promise<DeckClassifierArchetypeView> {
    return withTransaction(async (client) => {
      await assertAndBumpDraftRevision(client, input.expectedDraftRevision);
      const before = await loadArchetypeForUpdate(client, archetypeId);
      const updated = await client.query<ArchetypeRow>(
        `UPDATE deck_archetypes
            SET name = $2, group_name = $3, description = $4, sort_order = $5,
                updated_by = $6, updated_at = NOW()
          WHERE id = $1
          RETURNING *,
            (SELECT count(*) FROM deck_archetype_templates WHERE archetype_id = $1) AS template_count,
            (SELECT count(*) FROM deck_archetype_rules WHERE archetype_id = $1) AS rule_count`,
        [
          archetypeId,
          input.name,
          input.groupName,
          input.description,
          input.sortOrder,
          operator.actorUserId,
        ]
      );
      const row = requireRow(updated.rows[0], 'DECK_ARCHETYPE_NOT_FOUND', '卡组分类不存在', 404);
      await writeClassifierAudit(client, operator, {
        action: 'ARCHETYPE_UPDATED',
        targetType: 'ARCHETYPE',
        targetId: archetypeId,
        reason: input.reason,
        before,
        after: row,
      });
      return toArchetypeView(row);
    });
  }

  async updateArchetypeDisplay(
    archetypeId: string,
    input: DeckClassifierArchetypeDisplayInput,
    operator: DeckClassifierOperator
  ): Promise<DeckClassifierArchetypeView> {
    return withTransaction(async (client) => {
      await requireRepresentativeCard(client, input.representativeCardCode);
      const before = await loadArchetypeForUpdate(client, archetypeId);
      const updated = await client.query<ArchetypeRow>(
        `UPDATE deck_archetypes
            SET color_key = $2, representative_card_code = $3,
                updated_by = $4, updated_at = NOW()
          WHERE id = $1
          RETURNING *,
            (SELECT count(*) FROM deck_archetype_templates WHERE archetype_id = $1) AS template_count,
            (SELECT count(*) FROM deck_archetype_rules WHERE archetype_id = $1) AS rule_count`,
        [archetypeId, input.color, input.representativeCardCode, operator.actorUserId]
      );
      const row = requireRow(updated.rows[0], 'DECK_ARCHETYPE_NOT_FOUND', '卡组分类不存在', 404);
      await writeClassifierAudit(client, operator, {
        action: 'ARCHETYPE_DISPLAY_UPDATED',
        targetType: 'ARCHETYPE',
        targetId: archetypeId,
        reason: input.reason,
        before: {
          color: before.color_key,
          representativeCardCode: before.representative_card_code,
        },
        after: {
          color: row.color_key,
          representativeCardCode: row.representative_card_code,
        },
      });
      return toArchetypeView(row);
    });
  }

  async archiveArchetype(
    archetypeId: string,
    expectedDraftRevision: number,
    reason: string,
    operator: DeckClassifierOperator
  ): Promise<void> {
    await withTransaction(async (client) => {
      await assertAndBumpDraftRevision(client, expectedDraftRevision);
      const before = await loadArchetypeForUpdate(client, archetypeId);
      await client.query(
        `UPDATE deck_archetypes
            SET lifecycle = 'ARCHIVED', updated_by = $2, updated_at = NOW()
          WHERE id = $1`,
        [archetypeId, operator.actorUserId]
      );
      await client.query(
        `UPDATE deck_archetype_templates
            SET enabled = false, updated_by = $2, updated_at = NOW()
          WHERE archetype_id = $1 AND enabled = true`,
        [archetypeId, operator.actorUserId]
      );
      await client.query(
        `UPDATE deck_archetype_rules
            SET enabled = false, updated_by = $2, updated_at = NOW()
          WHERE archetype_id = $1 AND enabled = true`,
        [archetypeId, operator.actorUserId]
      );
      await writeClassifierAudit(client, operator, {
        action: 'ARCHETYPE_ARCHIVED',
        targetType: 'ARCHETYPE',
        targetId: archetypeId,
        reason,
        before,
        after: { ...before, lifecycle: 'ARCHIVED' },
      });
    });
  }

  async createTemplateFromMatch(
    input: DeckClassifierTemplateFromMatchInput,
    operator: DeckClassifierOperator
  ): Promise<DeckClassifierTemplateView> {
    return withTransaction(async (client) => {
      await assertAndBumpDraftRevision(client, input.expectedDraftRevision);
      await requireActiveArchetype(client, input.archetypeId);
      const observation = await client.query<{
        deck_fingerprint: string;
        main_deck_cards: unknown;
      }>(
        `SELECT deck_fingerprint, main_deck_cards
         FROM ranked_deck_observations
         WHERE match_id = $1 AND seat = $2`,
        [input.matchId, input.seat]
      );
      const fact = requireRow(
        observation.rows[0],
        'DECK_OBSERVATION_NOT_FOUND',
        '指定对局席位没有可导入的长期卡组观察',
        404
      );
      const cards = readObservationCards(fact.main_deck_cards);
      const inserted = await client.query<TemplateRow>(
        `INSERT INTO deck_archetype_templates (
           archetype_id, name, deck_fingerprint, cards, source_kind, source_match_id,
           source_seat, source_note, created_by, updated_by
         )
         VALUES ($1, $2, $3, $4::jsonb, 'MATCH_OBSERVATION', $5, $6, $7, $8, $8)
         RETURNING *`,
        [
          input.archetypeId,
          input.name,
          fact.deck_fingerprint,
          stableJsonStringify(cards),
          input.matchId,
          input.seat,
          input.sourceNote,
          operator.actorUserId,
        ]
      );
      const row = requireRow(inserted.rows[0], 'DECK_TEMPLATE_CREATE_FAILED', '卡组样板创建失败');
      await writeClassifierAudit(client, operator, {
        action: 'TEMPLATE_IMPORTED_FROM_MATCH',
        targetType: 'TEMPLATE',
        targetId: row.id,
        reason: input.reason,
        after: row,
      });
      return toTemplateView(row);
    });
  }

  async createTemplateFromReview(
    input: DeckClassifierTemplateFromReviewInput,
    operator: DeckClassifierOperator
  ): Promise<DeckClassifierTemplateView> {
    return withTransaction(async (client) => {
      await assertAndBumpDraftRevision(client, input.expectedDraftRevision);
      await requireActiveArchetype(client, input.archetypeId);
      const observation = await client.query<{
        deck_fingerprint: string;
        main_deck_cards: unknown;
      }>(
        `SELECT observation.deck_fingerprint, observation.main_deck_cards
         FROM ranked_deck_observations AS observation
         JOIN deck_classifier_releases AS release ON release.status = 'ACTIVE'
         JOIN deck_classification_assignments AS assignment
           ON assignment.match_id = observation.match_id
          AND assignment.seat = observation.seat
          AND assignment.release_id = release.id
         WHERE observation.deck_fingerprint = $1
           AND assignment.status IN ('UNKNOWN', 'AMBIGUOUS')
         ORDER BY observation.observed_at DESC, observation.match_id ASC, observation.seat ASC
         LIMIT 1`,
        [input.deckFingerprint]
      );
      const fact = requireRow(
        observation.rows[0],
        'DECK_CLASSIFIER_REVIEW_ITEM_NOT_FOUND',
        '该构筑已不在当前待处理队列，请刷新后重试',
        409
      );
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM deck_archetype_templates
         WHERE deck_fingerprint = $1
         ORDER BY enabled DESC, updated_at DESC
         LIMIT 1
         FOR UPDATE`,
        [input.deckFingerprint]
      );
      if (existing.rows[0]) {
        throw classifierError(
          'DECK_TEMPLATE_ALREADY_EXISTS',
          '该构筑已经在样板库中，请到样板库编辑或重新启用',
          409
        );
      }
      const cards = readObservationCards(fact.main_deck_cards);
      const inserted = await client.query<TemplateRow>(
        `INSERT INTO deck_archetype_templates (
           archetype_id, name, deck_fingerprint, cards, source_kind,
           source_note, enabled, created_by, updated_by
         )
         VALUES ($1, $2, $3, $4::jsonb, 'MANUAL', $5, true, $6, $6)
         RETURNING *`,
        [
          input.archetypeId,
          input.name,
          fact.deck_fingerprint,
          stableJsonStringify(cards),
          input.sourceNote,
          operator.actorUserId,
        ]
      );
      const row = requireRow(inserted.rows[0], 'DECK_TEMPLATE_CREATE_FAILED', '卡组样板创建失败');
      await writeClassifierAudit(client, operator, {
        action: 'TEMPLATE_CREATED_FROM_REVIEW',
        targetType: 'TEMPLATE',
        targetId: row.id,
        reason: input.reason,
        after: row,
      });
      return toTemplateView(row);
    });
  }

  async updateTemplate(
    templateId: string,
    input: DeckClassifierTemplateUpdateInput,
    operator: DeckClassifierOperator
  ): Promise<DeckClassifierTemplateView> {
    const normalized = normalizeDeck(input.cards);
    if (!normalized.valid) {
      throw classifierError(
        'DECK_TEMPLATE_INVALID',
        normalized.issues.map((issue) => issue.message).join('；'),
        400
      );
    }
    const cards: readonly DeckClassifierTemplateCardView[] = [
      ...normalized.deck.members.map((card) => ({ ...card, cardType: 'MEMBER' as const })),
      ...normalized.deck.lives.map((card) => ({ ...card, cardType: 'LIVE' as const })),
    ];
    const deckFingerprint = fingerprintNormalizedDeck(normalized.deck);
    return withTransaction(async (client) => {
      await assertAndBumpDraftRevision(client, input.expectedDraftRevision);
      await requireActiveArchetype(client, input.archetypeId);
      const before = await loadTemplateForUpdate(client, templateId);
      const updated = await client.query<TemplateRow>(
        `UPDATE deck_archetype_templates
            SET archetype_id = $2, name = $3, deck_fingerprint = $4, cards = $5::jsonb,
                source_note = $6, enabled = $7, updated_by = $8, updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [
          templateId,
          input.archetypeId,
          input.name,
          deckFingerprint,
          stableJsonStringify(cards),
          input.sourceNote,
          input.enabled,
          operator.actorUserId,
        ]
      );
      const row = requireRow(updated.rows[0], 'DECK_TEMPLATE_NOT_FOUND', '卡组样板不存在', 404);
      await writeClassifierAudit(client, operator, {
        action: 'TEMPLATE_UPDATED',
        targetType: 'TEMPLATE',
        targetId: templateId,
        reason: input.reason,
        before,
        after: row,
      });
      return toTemplateView(row);
    });
  }

  async deleteTemplate(
    templateId: string,
    expectedDraftRevision: number,
    reason: string,
    operator: DeckClassifierOperator
  ): Promise<void> {
    await withTransaction(async (client) => {
      await assertAndBumpDraftRevision(client, expectedDraftRevision);
      const before = await loadTemplateForUpdate(client, templateId);
      await client.query('DELETE FROM deck_archetype_templates WHERE id = $1', [templateId]);
      await writeClassifierAudit(client, operator, {
        action: 'TEMPLATE_DELETED',
        targetType: 'TEMPLATE',
        targetId: templateId,
        reason,
        before,
      });
    });
  }

  async createRule(
    input: DeckClassifierRuleInput,
    operator: DeckClassifierOperator
  ): Promise<DeckClassifierRuleView> {
    readRuleConditions(input.definition);
    return withTransaction(async (client) => {
      await assertAndBumpDraftRevision(client, input.expectedDraftRevision);
      await requireActiveArchetype(client, input.archetypeId);
      const inserted = await client.query<RuleRow>(
        `INSERT INTO deck_archetype_rules (
           archetype_id, name, priority, definition, enabled, created_by, updated_by
         )
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $6)
         RETURNING *`,
        [
          input.archetypeId,
          input.name,
          input.priority,
          stableJsonStringify(input.definition),
          input.enabled,
          operator.actorUserId,
        ]
      );
      const row = requireRow(inserted.rows[0], 'DECK_RULE_CREATE_FAILED', '卡组识别规则创建失败');
      await writeClassifierAudit(client, operator, {
        action: 'RULE_CREATED',
        targetType: 'RULE',
        targetId: row.id,
        reason: input.reason,
        after: row,
      });
      return toRuleView(row);
    });
  }

  async updateRule(
    ruleId: string,
    input: DeckClassifierRuleInput,
    operator: DeckClassifierOperator
  ): Promise<DeckClassifierRuleView> {
    readRuleConditions(input.definition);
    return withTransaction(async (client) => {
      await assertAndBumpDraftRevision(client, input.expectedDraftRevision);
      await requireActiveArchetype(client, input.archetypeId);
      const before = await loadRuleForUpdate(client, ruleId);
      const updated = await client.query<RuleRow>(
        `UPDATE deck_archetype_rules
            SET archetype_id = $2, name = $3, priority = $4, definition = $5::jsonb,
                enabled = $6, updated_by = $7, updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [
          ruleId,
          input.archetypeId,
          input.name,
          input.priority,
          stableJsonStringify(input.definition),
          input.enabled,
          operator.actorUserId,
        ]
      );
      const row = requireRow(updated.rows[0], 'DECK_RULE_NOT_FOUND', '卡组识别规则不存在', 404);
      await writeClassifierAudit(client, operator, {
        action: 'RULE_UPDATED',
        targetType: 'RULE',
        targetId: ruleId,
        reason: input.reason,
        before,
        after: row,
      });
      return toRuleView(row);
    });
  }

  async deleteRule(
    ruleId: string,
    expectedDraftRevision: number,
    reason: string,
    operator: DeckClassifierOperator
  ): Promise<void> {
    await withTransaction(async (client) => {
      await assertAndBumpDraftRevision(client, expectedDraftRevision);
      const before = await loadRuleForUpdate(client, ruleId);
      await client.query('DELETE FROM deck_archetype_rules WHERE id = $1', [ruleId]);
      await writeClassifierAudit(client, operator, {
        action: 'RULE_DELETED',
        targetType: 'RULE',
        targetId: ruleId,
        reason,
        before,
      });
    });
  }

  async previewRelease(expectedDraftRevision: number): Promise<DeckClassifierPreviewView> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await assertDraftRevision(client, expectedDraftRevision, false);
      const nextVersion = await readNextReleaseVersion(client);
      const snapshot = await loadDraftSnapshot(client, nextVersion);
      const [observations, priorAssignments, overrides] = await Promise.all([
        client.query<ObservationFingerprintRow>(
          `SELECT deck_fingerprint, (array_agg(main_deck_cards ORDER BY observed_at DESC))[1] AS main_deck_cards,
                  count(*) AS occurrence_count
           FROM ranked_deck_observations
           GROUP BY deck_fingerprint
           ORDER BY deck_fingerprint`
        ),
        client.query<PriorAssignmentRow>(
          `SELECT DISTINCT ON (observation.deck_fingerprint)
             observation.deck_fingerprint, assignment.status, assignment.archetype_id
           FROM deck_classification_assignments AS assignment
           JOIN deck_classifier_releases AS release
             ON release.id = assignment.release_id AND release.status = 'ACTIVE'
           JOIN ranked_deck_observations AS observation
             ON observation.match_id = assignment.match_id AND observation.seat = assignment.seat
           ORDER BY observation.deck_fingerprint, assignment.classified_at DESC`
        ),
        loadOverrides(client, null),
      ]);
      const result = previewClassifications(
        snapshot,
        observations.rows,
        priorAssignments.rows,
        overrides
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw normalizeServiceError(error);
    } finally {
      client.release();
    }
  }

  async publishRelease(
    expectedDraftRevision: number,
    reason: string,
    idempotencyKey: string,
    operator: DeckClassifierOperator
  ): Promise<{
    readonly release: DeckClassifierReleaseView;
    readonly run: DeckClassificationRunView;
  }> {
    return withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('deck-classifier-release'))");
      const priorRun = await findClassificationRunByIdempotency(client, idempotencyKey);
      if (priorRun) {
        if (priorRun.trigger !== 'RELEASE_PUBLISHED' || priorRun.scope_season_id !== null) {
          throw classifierError(
            'DECK_CLASSIFICATION_IDEMPOTENCY_CONFLICT',
            '同一幂等键已用于不同的分类任务',
            409
          );
        }
        const priorRelease = await client.query<ReleaseRow>(
          `${RELEASES_QUERY.replace('ORDER BY version DESC', '')} WHERE id = $1`,
          [priorRun.release_id]
        );
        return {
          release: toReleaseView(
            requireRow(
              priorRelease.rows[0],
              'DECK_CLASSIFIER_RELEASE_NOT_FOUND',
              '幂等发布任务对应的分类版本不存在',
              500
            )
          ),
          run: toRunView(priorRun),
        };
      }
      await assertNoBuildingRelease(client);
      await assertDraftRevision(client, expectedDraftRevision);
      const version = await readNextReleaseVersion(client);
      const snapshot = await loadDraftSnapshot(client, version);
      const configHash = hashDeckClassifierSnapshot(snapshot);
      const inserted = await client.query<ReleaseRow>(
        `INSERT INTO deck_classifier_releases (
           version, status, snapshot_json, config_hash, reason, published_by
         )
         VALUES ($1, 'BUILDING', $2::jsonb, $3, $4, $5)
         RETURNING *`,
        [version, stableJsonStringify(snapshot), configHash, reason, operator.actorUserId]
      );
      const releaseRow = requireRow(
        inserted.rows[0],
        'DECK_CLASSIFIER_RELEASE_FAILED',
        '卡组分类版本创建失败'
      );
      const run = await insertClassificationRun(client, {
        releaseId: releaseRow.id,
        trigger: 'RELEASE_PUBLISHED',
        scopeSeasonId: null,
        reason,
        operator,
        idempotencyKey,
      });
      await writeClassifierAudit(client, operator, {
        action: 'RELEASE_BUILD_STARTED',
        targetType: 'RELEASE',
        targetId: releaseRow.id,
        reason,
        after: { version, configHash, runId: run.id },
      });
      return { release: toReleaseView(releaseRow), run };
    });
  }

  async queueReclassification(
    scopeSeasonId: string | null,
    reason: string,
    idempotencyKey: string,
    operator: DeckClassifierOperator
  ): Promise<DeckClassificationRunView> {
    return withTransaction(async (client) => {
      const priorRun = await findClassificationRunByIdempotency(client, idempotencyKey);
      if (priorRun) {
        if (
          priorRun.trigger !== 'MANUAL_RECLASSIFY' ||
          priorRun.scope_season_id !== scopeSeasonId
        ) {
          throw classifierError(
            'DECK_CLASSIFICATION_IDEMPOTENCY_CONFLICT',
            '同一幂等键已用于不同的分类任务',
            409
          );
        }
        return toRunView(priorRun);
      }
      const active = await requireStableActiveRelease(client);
      const run = await insertClassificationRun(client, {
        releaseId: active.id,
        trigger: 'MANUAL_RECLASSIFY',
        scopeSeasonId,
        reason,
        operator,
        idempotencyKey,
      });
      await writeClassifierAudit(client, operator, {
        action: 'RECLASSIFICATION_QUEUED',
        targetType: 'RUN',
        targetId: run.id,
        reason,
        after: { releaseId: active.id, scopeSeasonId },
      });
      return run;
    });
  }

  async setOverride(
    input: DeckClassifierOverrideInput,
    operator: DeckClassifierOperator
  ): Promise<DeckClassificationRunView> {
    return withTransaction(async (client) => {
      const priorOverride = await client.query<
        OverrideListRow & { idempotency_key: string; request_id: string }
      >(
        `SELECT id, deck_fingerprint, archetype_id, target_status, reason,
                applies_to_future_releases, release_id, created_at,
                idempotency_key, request_id
         FROM deck_classification_overrides
         WHERE idempotency_key = $1`,
        [input.idempotencyKey]
      );
      if (priorOverride.rows[0]) {
        const override = priorOverride.rows[0];
        const priorRun = await findClassificationRunByIdempotency(client, input.idempotencyKey);
        if (
          !priorRun ||
          priorRun.trigger !== 'MANUAL_OVERRIDE' ||
          override.deck_fingerprint !== input.deckFingerprint ||
          override.target_status !== input.targetStatus ||
          override.archetype_id !== input.archetypeId ||
          override.applies_to_future_releases !== input.appliesToFutureReleases
        ) {
          throw classifierError(
            'DECK_CLASSIFICATION_IDEMPOTENCY_CONFLICT',
            '同一幂等键已用于不同的人工分类操作',
            409
          );
        }
        return toRunView(priorRun);
      }
      const active = await requireStableActiveRelease(client);
      const observation = await client.query(
        'SELECT 1 FROM ranked_deck_observations WHERE deck_fingerprint = $1 LIMIT 1',
        [input.deckFingerprint]
      );
      if (!observation.rows[0]) {
        throw classifierError('DECK_FINGERPRINT_NOT_FOUND', '指定构筑指纹不存在', 404);
      }
      if (input.targetStatus === 'CLASSIFIED') {
        if (!input.archetypeId) {
          throw classifierError('DECK_OVERRIDE_INVALID', '人工分类必须选择卡组分类');
        }
        await requireActiveArchetype(client, input.archetypeId);
      } else if (input.archetypeId) {
        throw classifierError('DECK_OVERRIDE_INVALID', '未知或排除状态不能指定卡组分类');
      }
      const prior = await client.query(
        `SELECT * FROM deck_classification_overrides
         WHERE deck_fingerprint = $1 AND revoked_at IS NULL
           AND (
             (applies_to_future_releases = true AND $2 = true)
             OR (applies_to_future_releases = false AND $2 = false AND release_id = $3)
           )
         FOR UPDATE`,
        [input.deckFingerprint, input.appliesToFutureReleases, active.id]
      );
      await client.query(
        `UPDATE deck_classification_overrides
            SET revoked_at = NOW(), revoked_by = $2
          WHERE deck_fingerprint = $1 AND revoked_at IS NULL
            AND (
              (applies_to_future_releases = true AND $3 = true)
              OR (applies_to_future_releases = false AND $3 = false AND release_id = $4)
            )`,
        [input.deckFingerprint, operator.actorUserId, input.appliesToFutureReleases, active.id]
      );
      const releaseId = input.appliesToFutureReleases ? null : active.id;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO deck_classification_overrides (
           deck_fingerprint, archetype_id, target_status, reason,
           applies_to_future_releases, release_id, created_by, request_id, idempotency_key
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          input.deckFingerprint,
          input.archetypeId,
          input.targetStatus,
          input.reason,
          input.appliesToFutureReleases,
          releaseId,
          operator.actorUserId,
          operator.requestId,
          input.idempotencyKey,
        ]
      );
      const overrideId = requireRow(
        inserted.rows[0],
        'DECK_OVERRIDE_CREATE_FAILED',
        '人工分类保存失败'
      ).id;
      const run = await insertClassificationRun(client, {
        releaseId: active.id,
        trigger: 'MANUAL_OVERRIDE',
        scopeSeasonId: null,
        reason: input.reason,
        operator,
        idempotencyKey: input.idempotencyKey,
      });
      await writeClassifierAudit(client, operator, {
        action: 'OVERRIDE_CREATED',
        targetType: 'OVERRIDE',
        targetId: overrideId,
        reason: input.reason,
        before: prior.rows,
        after: { ...input, releaseId, runId: run.id },
      });
      return run;
    });
  }

  async revokeOverride(
    overrideId: string,
    reason: string,
    idempotencyKey: string,
    operator: DeckClassifierOperator
  ): Promise<DeckClassificationRunView> {
    return withTransaction(async (client) => {
      const priorRun = await findClassificationRunByIdempotency(client, idempotencyKey);
      if (priorRun) {
        if (priorRun.trigger !== 'MANUAL_OVERRIDE') {
          throw classifierError(
            'DECK_CLASSIFICATION_IDEMPOTENCY_CONFLICT',
            '同一幂等键已用于不同的分类任务',
            409
          );
        }
        const audit = await client.query(
          `SELECT 1 FROM management_audit_logs
           WHERE scope = 'DECK_CLASSIFIER' AND action = 'OVERRIDE_REVOKED'
             AND target_id = $1 AND after ->> 'runId' = $2
           LIMIT 1`,
          [overrideId, priorRun.id]
        );
        if (!audit.rows[0]) {
          throw classifierError(
            'DECK_CLASSIFICATION_IDEMPOTENCY_CONFLICT',
            '同一幂等键已用于其他人工分类操作',
            409
          );
        }
        return toRunView(priorRun);
      }
      const active = await requireStableActiveRelease(client);
      const before = await client.query<OverrideListRow>(
        `SELECT id, deck_fingerprint, archetype_id, target_status, reason,
                applies_to_future_releases, release_id, created_at
         FROM deck_classification_overrides
         WHERE id = $1 AND revoked_at IS NULL
         FOR UPDATE`,
        [overrideId]
      );
      const row = requireRow(
        before.rows[0],
        'DECK_OVERRIDE_NOT_FOUND',
        '人工分类锁定不存在或已撤销',
        404
      );
      await client.query(
        `UPDATE deck_classification_overrides
            SET revoked_at = NOW(), revoked_by = $2
          WHERE id = $1`,
        [overrideId, operator.actorUserId]
      );
      const run = await insertClassificationRun(client, {
        releaseId: active.id,
        trigger: 'MANUAL_OVERRIDE',
        scopeSeasonId: null,
        reason,
        operator,
        idempotencyKey,
      });
      await writeClassifierAudit(client, operator, {
        action: 'OVERRIDE_REVOKED',
        targetType: 'OVERRIDE',
        targetId: overrideId,
        reason,
        before: row,
        after: { revoked: true, runId: run.id },
      });
      return run;
    });
  }
}

const ARCHETYPES_QUERY = `SELECT
  archetype.*,
  (SELECT count(*) FROM deck_archetype_templates AS template
    WHERE template.archetype_id = archetype.id) AS template_count,
  (SELECT count(*) FROM deck_archetype_rules AS rule
    WHERE rule.archetype_id = archetype.id) AS rule_count
FROM deck_archetypes AS archetype
ORDER BY archetype.sort_order ASC, archetype.archetype_key ASC`;

const TEMPLATES_QUERY = `SELECT *
FROM deck_archetype_templates
ORDER BY created_at DESC, id ASC`;

const RULES_QUERY = `SELECT *
FROM deck_archetype_rules
ORDER BY priority ASC, created_at ASC, id ASC`;

const RELEASES_QUERY = `SELECT *
FROM deck_classifier_releases
ORDER BY version DESC`;

const RUNS_SELECT = `SELECT
  run.*,
  release.version AS release_version
FROM deck_classification_runs AS run
JOIN deck_classifier_releases AS release ON release.id = run.release_id`;

const RUNS_QUERY = `${RUNS_SELECT}
ORDER BY run.created_at DESC, run.id DESC`;

async function loadDraftSnapshot(
  client: Pick<PoolClient, 'query'>,
  releaseVersion: number
): Promise<StoredDeckClassifierSnapshot> {
  const [archetypes, templates, rules] = await Promise.all([
    client.query<DraftArchetypeRow>(
      `SELECT archetype.id, archetype.archetype_key, archetype.name, archetype.group_name,
              archetype.description, archetype.sort_order
       FROM deck_archetypes AS archetype
       WHERE archetype.lifecycle = 'ACTIVE'
       ORDER BY archetype.sort_order ASC, archetype.archetype_key ASC`
    ),
    client.query<DraftTemplateRow>(
      `SELECT template.id, template.archetype_id, template.cards
       FROM deck_archetype_templates AS template
       JOIN deck_archetypes AS archetype ON archetype.id = template.archetype_id
       WHERE template.enabled = true AND archetype.lifecycle = 'ACTIVE'
       ORDER BY template.id ASC`
    ),
    client.query<DraftRuleRow>(
      `SELECT rule.id, rule.archetype_id, rule.priority, rule.definition
       FROM deck_archetype_rules AS rule
       JOIN deck_archetypes AS archetype ON archetype.id = rule.archetype_id
       WHERE rule.enabled = true AND archetype.lifecycle = 'ACTIVE'
       ORDER BY rule.priority ASC, rule.id ASC`
    ),
  ]);
  try {
    return buildDeckClassifierSnapshot({
      releaseVersion,
      archetypes: archetypes.rows,
      templates: templates.rows,
      rules: rules.rows,
    });
  } catch (error) {
    throw classifierError(
      'DECK_CLASSIFIER_DRAFT_INVALID',
      error instanceof Error ? error.message : '卡组分类草稿无效'
    );
  }
}

async function loadOverrides(
  client: Pick<PoolClient, 'query'>,
  releaseId: string | null
): Promise<readonly OverrideRow[]> {
  const result = await client.query<OverrideRow>(
    `SELECT DISTINCT ON (deck_fingerprint)
       id, deck_fingerprint, archetype_id, target_status
     FROM deck_classification_overrides
     WHERE revoked_at IS NULL
       AND (
         applies_to_future_releases = true
         OR ($1::uuid IS NOT NULL AND release_id = $1)
       )
     ORDER BY deck_fingerprint, applies_to_future_releases ASC, created_at DESC`,
    [releaseId]
  );
  return result.rows;
}

function previewClassifications(
  snapshot: StoredDeckClassifierSnapshot,
  observations: readonly ObservationFingerprintRow[],
  priorAssignments: readonly PriorAssignmentRow[],
  overrides: readonly OverrideRow[]
): DeckClassifierPreviewView {
  const priorByFingerprint = new Map(
    priorAssignments.map((row) => [row.deck_fingerprint, `${row.status}:${row.archetype_id ?? ''}`])
  );
  const archetypeNames = new Map(snapshot.archetypes.map((entry) => [entry.id, entry.name]));
  const archetypeCounts = new Map<string, number>();
  let observationCount = 0;
  let classifiedCount = 0;
  let unknownCount = 0;
  let ambiguousCount = 0;
  let invalidCount = 0;
  let excludedCount = 0;
  let changedCount = 0;
  const overridesByFingerprint = new Map(
    overrides.map((override) => [override.deck_fingerprint, override])
  );

  for (const observation of observations) {
    const occurrences = readCount(observation.occurrence_count);
    observationCount += occurrences;
    const override = overridesByFingerprint.get(observation.deck_fingerprint);
    const result = override
      ? null
      : classifyDeck(readObservationCards(observation.main_deck_cards), snapshot);
    const decision = override?.target_status ?? result?.decision ?? 'INVALID';
    const archetypeId = override?.archetype_id ?? result?.archetypeId ?? null;
    const resultKey = `${decision}:${archetypeId ?? ''}`;
    if ((priorByFingerprint.get(observation.deck_fingerprint) ?? null) !== resultKey) {
      changedCount += occurrences;
    }
    if (decision === 'CLASSIFIED' && archetypeId) {
      classifiedCount += occurrences;
      archetypeCounts.set(archetypeId, (archetypeCounts.get(archetypeId) ?? 0) + occurrences);
    } else if (decision === 'UNKNOWN') {
      unknownCount += occurrences;
    } else if (decision === 'AMBIGUOUS') {
      ambiguousCount += occurrences;
    } else if (decision === 'EXCLUDED') {
      excludedCount += occurrences;
    } else {
      invalidCount += occurrences;
    }
  }
  return {
    uniqueFingerprintCount: observations.length,
    observationCount,
    classifiedCount,
    unknownCount,
    ambiguousCount,
    invalidCount,
    excludedCount,
    changedCount,
    coverageRate:
      observationCount === excludedCount ? 0 : classifiedCount / (observationCount - excludedCount),
    archetypeCounts: [...archetypeCounts.entries()]
      .map(([archetypeId, count]) => ({
        archetypeId,
        name: archetypeNames.get(archetypeId) ?? archetypeId,
        count,
      }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
  };
}

async function insertClassificationRun(
  client: Pick<PoolClient, 'query'>,
  input: {
    readonly releaseId: string;
    readonly trigger: DeckClassificationRunView['trigger'];
    readonly scopeSeasonId: string | null;
    readonly reason: string;
    readonly operator: DeckClassifierOperator;
    readonly idempotencyKey: string;
  }
): Promise<DeckClassificationRunView> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO deck_classification_runs (
       release_id, trigger, scope_season_id, requested_by, request_id, idempotency_key, reason
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.releaseId,
      input.trigger,
      input.scopeSeasonId,
      input.operator.actorUserId,
      input.operator.requestId,
      input.idempotencyKey,
      input.reason,
    ]
  );
  const runId = inserted.rows[0]?.id;
  if (!runId) {
    const existing = await client.query<RunRow>(
      `${RUNS_SELECT}
       WHERE run.idempotency_key = $1`,
      [input.idempotencyKey]
    );
    const row = requireRow(
      existing.rows[0],
      'DECK_CLASSIFICATION_IDEMPOTENCY_CONFLICT',
      '分类任务幂等键冲突',
      409
    );
    if (
      row.release_id !== input.releaseId ||
      row.trigger !== input.trigger ||
      row.scope_season_id !== input.scopeSeasonId
    ) {
      throw classifierError(
        'DECK_CLASSIFICATION_IDEMPOTENCY_CONFLICT',
        '同一幂等键已用于不同的分类任务',
        409
      );
    }
    return toRunView(row);
  }
  const created = await client.query<RunRow>(`${RUNS_SELECT} WHERE run.id = $1`, [runId]);
  return toRunView(
    requireRow(created.rows[0], 'DECK_CLASSIFICATION_RUN_CREATE_FAILED', '分类任务创建失败')
  );
}

async function findClassificationRunByIdempotency(
  client: Pick<PoolClient, 'query'>,
  idempotencyKey: string
): Promise<RunRow | null> {
  const existing = await client.query<RunRow>(
    `${RUNS_SELECT}
     WHERE run.idempotency_key = $1`,
    [idempotencyKey]
  );
  return existing.rows[0] ?? null;
}

async function readNextReleaseVersion(client: Pick<PoolClient, 'query'>): Promise<number> {
  const result = await client.query<{ next_version: number | string }>(
    'SELECT COALESCE(max(version), 0) + 1 AS next_version FROM deck_classifier_releases'
  );
  const version = Number(result.rows[0]?.next_version);
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw classifierError('DECK_CLASSIFIER_VERSION_INVALID', '卡组分类发布版本无效', 500);
  }
  return version;
}

async function requireActiveRelease(
  client: Pick<PoolClient, 'query'>
): Promise<{ readonly id: string; readonly version: number }> {
  const result = await client.query<{ id: string; version: number }>(
    `SELECT id, version
     FROM deck_classifier_releases
     WHERE status = 'ACTIVE'`
  );
  return requireRow(
    result.rows[0],
    'DECK_CLASSIFIER_NOT_PUBLISHED',
    '尚未发布可用的卡组分类版本',
    409
  );
}

async function requireStableActiveRelease(
  client: Pick<PoolClient, 'query'>
): Promise<{ readonly id: string; readonly version: number }> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('deck-classifier-release'))");
  await assertNoBuildingRelease(client);
  return requireActiveRelease(client);
}

async function assertNoBuildingRelease(client: Pick<PoolClient, 'query'>): Promise<void> {
  const building = await client.query<{ id: string }>(
    `SELECT id FROM deck_classifier_releases WHERE status = 'BUILDING' LIMIT 1`
  );
  if (building.rows[0]) {
    throw classifierError(
      'DECK_CLASSIFIER_RELEASE_BUILDING',
      '新分类版本正在全量构建，请等待构建完成后再重分类或调整人工分类',
      409
    );
  }
}

async function assertDraftRevision(
  client: Pick<PoolClient, 'query'>,
  expectedDraftRevision: number,
  lock = true
): Promise<number> {
  const result = await client.query<{ draft_revision: number }>(
    `SELECT draft_revision FROM deck_classifier_settings WHERE id = 1${lock ? ' FOR UPDATE' : ''}`
  );
  const actual = result.rows[0]?.draft_revision;
  if (actual !== expectedDraftRevision) {
    throw classifierError(
      'DECK_CLASSIFIER_DRAFT_REVISION_CONFLICT',
      '卡组分类草稿已被其他管理员修改，请刷新后重试',
      409
    );
  }
  return actual;
}

async function assertAndBumpDraftRevision(
  client: Pick<PoolClient, 'query'>,
  expectedDraftRevision: number
): Promise<number> {
  const actual = await assertDraftRevision(client, expectedDraftRevision);
  await client.query(
    `UPDATE deck_classifier_settings
        SET draft_revision = draft_revision + 1, updated_at = NOW()
      WHERE id = 1`,
    []
  );
  return actual + 1;
}

async function requireActiveArchetype(
  client: Pick<PoolClient, 'query'>,
  archetypeId: string
): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM deck_archetypes WHERE id = $1 AND lifecycle = 'ACTIVE'`,
    [archetypeId]
  );
  if (!result.rows[0]) {
    throw classifierError('DECK_ARCHETYPE_NOT_FOUND', '启用中的卡组分类不存在', 404);
  }
}

async function requireRepresentativeCard(
  client: Pick<PoolClient, 'query'>,
  cardCode: string | null
): Promise<void> {
  if (cardCode === null) return;
  const result = await client.query<{ card_type: string }>(
    'SELECT card_type FROM cards WHERE card_code = $1',
    [cardCode]
  );
  const cardType = result.rows[0]?.card_type;
  if (cardType !== 'MEMBER' && cardType !== 'LIVE') {
    throw classifierError(
      'DECK_ARCHETYPE_REPRESENTATIVE_CARD_INVALID',
      '代表卡牌不存在，或不是 MEMBER／LIVE 卡牌',
      400
    );
  }
}

async function loadArchetypeForUpdate(
  client: Pick<PoolClient, 'query'>,
  archetypeId: string
): Promise<ArchetypeRow> {
  const result = await client.query<ArchetypeRow>(
    `${ARCHETYPES_QUERY.replace('ORDER BY archetype.sort_order ASC, archetype.archetype_key ASC', '')}
     WHERE archetype.id = $1
     FOR UPDATE`,
    [archetypeId]
  );
  return requireRow(result.rows[0], 'DECK_ARCHETYPE_NOT_FOUND', '卡组分类不存在', 404);
}

async function loadTemplateForUpdate(
  client: Pick<PoolClient, 'query'>,
  templateId: string
): Promise<TemplateRow> {
  const result = await client.query<TemplateRow>(
    'SELECT * FROM deck_archetype_templates WHERE id = $1 FOR UPDATE',
    [templateId]
  );
  return requireRow(result.rows[0], 'DECK_TEMPLATE_NOT_FOUND', '卡组样板不存在', 404);
}

async function loadRuleForUpdate(
  client: Pick<PoolClient, 'query'>,
  ruleId: string
): Promise<RuleRow> {
  const result = await client.query<RuleRow>(
    'SELECT * FROM deck_archetype_rules WHERE id = $1 FOR UPDATE',
    [ruleId]
  );
  return requireRow(result.rows[0], 'DECK_RULE_NOT_FOUND', '卡组识别规则不存在', 404);
}

function toArchetypeView(row: ArchetypeRow): DeckClassifierArchetypeView {
  return {
    id: row.id,
    archetypeKey: row.archetype_key,
    name: row.name,
    groupName: row.group_name,
    description: row.description,
    color: row.color_key,
    representativeCardCode: row.representative_card_code ?? null,
    sortOrder: row.sort_order,
    lifecycle: row.lifecycle,
    templateCount: readCount(row.template_count),
    ruleCount: readCount(row.rule_count),
    createdAt: toTimestamp(row.created_at),
    updatedAt: toTimestamp(row.updated_at),
  };
}

function toTemplateView(row: TemplateRow): DeckClassifierTemplateView {
  return {
    id: row.id,
    archetypeId: row.archetype_id,
    name: row.name,
    deckFingerprint: row.deck_fingerprint,
    cards: row.cards === null ? [] : readObservationCards(row.cards),
    sourceKind: row.source_kind,
    sourceMatchId: row.source_match_id,
    sourceSeat: row.source_seat,
    sourceNote: row.source_note,
    enabled: row.enabled,
    createdAt: toTimestamp(row.created_at),
    updatedAt: toTimestamp(row.updated_at),
  };
}

function toRuleView(row: RuleRow): DeckClassifierRuleView {
  return {
    id: row.id,
    archetypeId: row.archetype_id,
    name: row.name,
    priority: row.priority,
    definition: readRuleConditions(row.definition),
    enabled: row.enabled,
    createdAt: toTimestamp(row.created_at),
    updatedAt: toTimestamp(row.updated_at),
  };
}

function toReleaseView(row: ReleaseRow): DeckClassifierReleaseView {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    configHash: row.config_hash,
    reason: row.reason,
    publishedAt: toTimestamp(row.published_at),
    activatedAt: toNullableTimestamp(row.activated_at),
  };
}

function toRunView(row: RunRow): DeckClassificationRunView {
  return {
    id: row.id,
    releaseId: row.release_id,
    releaseVersion: row.release_version,
    status: row.status,
    trigger: row.trigger,
    scopeSeasonId: row.scope_season_id,
    reason: row.reason,
    totalCount: readCount(row.total_count),
    processedCount: readCount(row.processed_count),
    classifiedCount: readCount(row.classified_count),
    unknownCount: readCount(row.unknown_count),
    ambiguousCount: readCount(row.ambiguous_count),
    invalidCount: readCount(row.invalid_count),
    excludedCount: readCount(row.excluded_count),
    changedCount: readCount(row.changed_count),
    errorMessage: row.error_message,
    createdAt: toTimestamp(row.created_at),
    startedAt: toNullableTimestamp(row.started_at),
    finishedAt: toNullableTimestamp(row.finished_at),
  };
}

function toReviewView(row: ReviewRow): DeckClassifierReviewItemView {
  if (row.status !== 'UNKNOWN' && row.status !== 'AMBIGUOUS') {
    throw classifierError('DECK_CLASSIFIER_REVIEW_INVALID', '待处理分类状态无效', 500);
  }
  return {
    deckFingerprint: row.deck_fingerprint,
    status: row.status,
    occurrenceCount: readCount(row.occurrence_count),
    playerCount: readCount(row.player_count),
    seasonCount: readCount(row.season_count),
    firstObservedAt: toTimestamp(row.first_observed_at),
    lastObservedAt: toTimestamp(row.last_observed_at),
    cards: readObservationCards(row.cards),
    evidence: isRecord(row.evidence) ? row.evidence : {},
  };
}

function toOverrideView(row: OverrideListRow): DeckClassifierOverrideView {
  return {
    id: row.id,
    deckFingerprint: row.deck_fingerprint,
    archetypeId: row.archetype_id,
    targetStatus: row.target_status,
    reason: row.reason,
    appliesToFutureReleases: row.applies_to_future_releases,
    releaseId: row.release_id,
    cards: row.cards === null ? [] : readObservationCards(row.cards),
    createdAt: toTimestamp(row.created_at),
  };
}

function readObservationCards(value: unknown): readonly DeckClassifierTemplateCardView[] {
  const cards = readTemplateCards(value);
  return cards.map((card) => ({
    baseCardCode: card.baseCardCode ?? '',
    cardType: card.cardType,
    count: card.count,
  }));
}

async function writeClassifierAudit(
  client: PoolClient,
  operator: DeckClassifierOperator,
  input: {
    readonly action: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly reason: string;
    readonly before?: unknown;
    readonly after?: unknown;
  }
): Promise<void> {
  await writeManagementAudit(client, {
    actorUserId: operator.actorUserId,
    actorRole: operator.actorRole,
    scope: 'DECK_CLASSIFIER',
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    requestId: operator.requestId,
    result: 'SUCCEEDED',
    reason: input.reason,
    before: input.before,
    after: input.after,
  });
}

async function withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw normalizeServiceError(error);
  } finally {
    client.release();
  }
}

function normalizeServiceError(error: unknown): unknown {
  if (error instanceof DeckClassifierAdminServiceError) return error;
  if (isRecord(error) && error.code === '23505') {
    return classifierError(
      'DECK_CLASSIFIER_CONFLICT',
      '卡组分类 key、启用样板指纹或幂等键已存在',
      409
    );
  }
  if (isRecord(error) && error.code === '23503') {
    return classifierError('DECK_CLASSIFIER_REFERENCE_INVALID', '关联的卡组分类数据不存在', 409);
  }
  return error;
}

function requireRow<T>(row: T | undefined, code: string, message: string, statusCode = 400): T {
  if (!row) throw classifierError(code, message, statusCode);
  return row;
}

function readCount(value: number | string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw classifierError('DECK_CLASSIFIER_COUNT_INVALID', '卡组分类统计数量无效', 500);
  }
  return count;
}

function readVisibleSections(row: {
  readonly show_usage: boolean;
  readonly show_winner: boolean;
  readonly show_top_ranked: boolean;
}): readonly DeckEnvironmentSection[] {
  const sections: DeckEnvironmentSection[] = [];
  if (row.show_usage) sections.push('USAGE');
  if (row.show_winner) sections.push('WINNER');
  if (row.show_top_ranked) sections.push('TOP_RANKED');
  return sections;
}

function readCardVisibleSections(row: {
  readonly card_show_usage: boolean;
  readonly card_show_winner: boolean;
  readonly card_show_top_ranked: boolean;
}): readonly DeckEnvironmentSection[] {
  const sections: DeckEnvironmentSection[] = [];
  if (row.card_show_usage) sections.push('USAGE');
  if (row.card_show_winner) sections.push('WINNER');
  if (row.card_show_top_ranked) sections.push('TOP_RANKED');
  return sections;
}

function toTimestamp(value: Date | string): number {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    throw classifierError('DECK_CLASSIFIER_DATE_INVALID', '卡组分类时间无效', 500);
  }
  return timestamp;
}

function toNullableTimestamp(value: Date | string | null): number | null {
  return value === null ? null : toTimestamp(value);
}

function classifierError(
  code: string,
  message: string,
  statusCode = 400
): DeckClassifierAdminServiceError {
  return new DeckClassifierAdminServiceError(code, message, statusCode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const deckClassifierAdminService = new DeckClassifierAdminService();
