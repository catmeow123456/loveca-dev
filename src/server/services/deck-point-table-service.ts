import { pool } from '../db/pool.js';
import { getBaseCardCode } from '../../shared/utils/card-code.js';
import {
  DECK_POINT_TABLE_TIME_ZONE,
  diffDeckPointTables,
  shanghaiEffectiveDateTimeToInstant,
  toDeckPointTableRules,
  validateDeckPointTableEntries,
  type DeckPointTableDiff,
  type DeckPointTableEntry,
  type DeckPointTableLifecycle,
  type DeckPointTableRules,
} from '../../domain/rules/deck-point-table.js';

interface QueryResult<T> {
  readonly rows: T[];
  readonly rowCount?: number | null;
}

interface QueryClient {
  query<T = unknown>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

interface TransactionPool {
  connect(): Promise<
    QueryClient & {
      release(): void;
    }
  >;
}

interface DeckPointTableRow {
  readonly id: string;
  readonly version: string;
  readonly display_name: string;
  readonly lifecycle: DeckPointTableLifecycle;
  readonly retirement_reason: 'REPLACED' | 'SCHEDULE_CANCELLED' | 'MANUALLY_DISCARDED' | null;
  readonly point_limit: number;
  readonly effective_from: Date | string | null;
  readonly published_at: Date | string | null;
  readonly revision: number;
  readonly created_by: string | null;
  readonly updated_by: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface DeckPointTableEntryRow {
  readonly table_id: string;
  readonly base_card_code: string;
  readonly points: number;
  readonly card_code?: string | null;
  readonly name_cn?: string | null;
  readonly name_jp?: string | null;
  readonly card_type?: string | null;
  readonly cost?: number | null;
  readonly score?: number | null;
}

export interface DeckPointTableEntryView extends DeckPointTableEntry {
  readonly cardCode?: string;
  readonly cardNameCn?: string;
  readonly cardNameJp?: string;
  readonly cardType?: string;
  readonly cost?: number;
  readonly score?: number;
}

export interface DeckPointTableView {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly lifecycle: DeckPointTableLifecycle;
  readonly retirementReason: 'REPLACED' | 'SCHEDULE_CANCELLED' | 'MANUALLY_DISCARDED' | null;
  readonly pointLimit: number;
  readonly effectiveFrom: string | null;
  readonly publishedAt: string | null;
  readonly platformTimeZone: typeof DECK_POINT_TABLE_TIME_ZONE;
  readonly entries: readonly DeckPointTableEntryView[];
  readonly revision: number;
  readonly createdBy: string | null;
  readonly updatedBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DeckPointTableAuditView {
  readonly id: string;
  readonly tableId: string;
  readonly action: string;
  readonly adminUserId: string | null;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface CreateDeckPointTableDraftInput {
  readonly version: string;
  readonly displayName: string;
  readonly pointLimit: number;
  readonly entries: readonly DeckPointTableEntry[];
}

export interface UpdateDeckPointTableInput extends CreateDeckPointTableDraftInput {
  readonly effectiveDateTime?: string;
  readonly expectedRevision: number;
}

export interface CopyDeckPointTableDraftInput {
  readonly version: string;
  readonly displayName: string;
}

export interface PublishDeckPointTableInput {
  readonly mode: 'IMMEDIATE' | 'SCHEDULED';
  readonly effectiveDateTime?: string;
  readonly expectedRevision: number;
  /** Active table observed by the mandatory diff preview. */
  readonly expectedActiveTableId: string;
}

export interface DiscardDeckPointTableInput {
  readonly expectedRevision: number;
  readonly replacementTableId?: string;
  readonly replacementExpectedRevision?: number;
}

export interface DeleteDeckPointTableResult {
  readonly id: string;
  readonly deleted: true;
}

export class DeckPointTableServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'DeckPointTableServiceError';
  }
}

export class DeckPointTableService {
  private readonly query: QueryClient['query'];
  private readonly transactionPool: TransactionPool;
  private readonly now: () => Date;

  constructor(
    deps: {
      readonly query?: QueryClient['query'];
      readonly transactionPool?: TransactionPool;
      readonly now?: () => Date;
    } = {}
  ) {
    this.query =
      deps.query ??
      (async <T>(text: string, values?: readonly unknown[]) => {
        const result = await pool.query(text, values as unknown[]);
        return { rows: result.rows as T[], rowCount: result.rowCount };
      });
    this.transactionPool = deps.transactionPool ?? pool;
    this.now = deps.now ?? (() => new Date());
  }

  async getCurrentTable(): Promise<DeckPointTableView> {
    return this.withTransaction(async (client) => {
      const currentId = await this.reconcileLifecycle(client, this.now());
      const result = await client.query<DeckPointTableRow>(
        `SELECT * FROM deck_point_tables
         WHERE id = $1 AND lifecycle = 'ACTIVE'
         LIMIT 1`,
        [currentId]
      );
      const row = result.rows[0];
      if (!row) {
        throw new DeckPointTableServiceError(
          'POINT_TABLE_NOT_CONFIGURED',
          '当前没有已生效的PT限制表',
          503
        );
      }
      const tables = await this.hydrateRows([row], <T>(text: string, values?: readonly unknown[]) =>
        client.query<T>(text, values)
      );
      const table = tables[0];
      if (!table) {
        throw new DeckPointTableServiceError(
          'POINT_TABLE_NOT_CONFIGURED',
          '当前没有已生效的PT限制表',
          503
        );
      }
      return table;
    });
  }

  async getCurrentRules(): Promise<DeckPointTableRules> {
    return toRules(await this.getCurrentTable());
  }

  async listTables(): Promise<DeckPointTableView[]> {
    await this.withTransaction((client) => this.reconcileLifecycle(client, this.now()));
    const result = await this.query<DeckPointTableRow>(
      `SELECT * FROM deck_point_tables
       ORDER BY
         CASE lifecycle
           WHEN 'ACTIVE' THEN 0
           WHEN 'SCHEDULED' THEN 1
           WHEN 'DRAFT' THEN 2
           ELSE 3
         END,
         effective_from DESC NULLS LAST,
         created_at DESC`
    );
    return this.hydrateRows(result.rows, this.query);
  }

  async getTable(id: string): Promise<DeckPointTableView | null> {
    const result = await this.query<DeckPointTableRow>(
      'SELECT * FROM deck_point_tables WHERE id = $1 LIMIT 1',
      [id]
    );
    if (!result.rows[0]) return null;
    return (await this.hydrateRows([result.rows[0]], this.query))[0] ?? null;
  }

  async listAudit(id: string): Promise<DeckPointTableAuditView[]> {
    if (!(await this.getTable(id))) throw notFound();
    const result = await this.query<{
      id: string;
      table_id: string;
      action: string;
      admin_user_id: string | null;
      detail: Record<string, unknown> | null;
      created_at: Date | string;
    }>(
      `SELECT id, table_id, action, admin_user_id, detail, created_at
       FROM deck_point_table_audit_logs
       WHERE table_id = $1
       ORDER BY created_at DESC, id DESC`,
      [id]
    );
    return result.rows.map((row) => ({
      id: row.id,
      tableId: row.table_id,
      action: row.action,
      adminUserId: row.admin_user_id,
      detail: row.detail ?? {},
      createdAt: requiredIso(row.created_at),
    }));
  }

  async createDraft(
    input: CreateDeckPointTableDraftInput,
    adminUserId: string
  ): Promise<DeckPointTableView> {
    const normalized = await this.normalizeTableInput(input, { query: this.query });
    const id = await this.withTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO deck_point_tables (
          version, display_name, lifecycle, point_limit, created_by, updated_by
        ) VALUES ($1, $2, 'DRAFT', $3, $4, $4)
        RETURNING id`,
        [normalized.version, normalized.displayName, normalized.pointLimit, adminUserId]
      );
      const tableId = requiredId(inserted.rows[0]?.id);
      await replaceEntries(client, tableId, normalized.entries);
      await writeAudit(client, tableId, 'DRAFT_CREATED', adminUserId, {
        version: normalized.version,
      });
      return tableId;
    });
    return this.requireTable(id);
  }

  async updateTable(
    id: string,
    input: UpdateDeckPointTableInput,
    adminUserId: string
  ): Promise<DeckPointTableView> {
    const normalized = await this.normalizeTableInput(input, { query: this.query });
    const now = this.now();
    const outcome = await this.withTransaction(async (client) => {
      await this.reconcileLifecycle(client, now);
      const current = await lockTable(client, id);
      if (current.revision !== input.expectedRevision) return 'REVISION_CONFLICT' as const;
      const effectiveFrom = resolveUpdatedEffectiveFrom(current, input.effectiveDateTime, now);
      const updated = await client.query<{ id: string }>(
        `UPDATE deck_point_tables
         SET version = $1,
             display_name = $2,
             point_limit = $3,
             effective_from = $4,
             revision = revision + 1,
             updated_by = $5,
             updated_at = now()
         WHERE id = $6 AND revision = $7
         RETURNING id`,
        [
          normalized.version,
          normalized.displayName,
          normalized.pointLimit,
          effectiveFrom,
          adminUserId,
          id,
          input.expectedRevision,
        ]
      );
      if (!updated.rows[0]) throw revisionConflict();
      await replaceEntries(client, id, normalized.entries);
      await writeAudit(client, id, 'TABLE_UPDATED', adminUserId, {
        lifecycle: current.lifecycle,
        priorRevision: input.expectedRevision,
        effectiveFrom: effectiveFrom?.toISOString() ?? null,
      });
      if (
        current.lifecycle === 'SCHEDULED' &&
        effectiveFrom &&
        effectiveFrom.getTime() <= now.getTime()
      ) {
        await this.reconcileLifecycle(client, now);
      }
      return 'UPDATED' as const;
    });
    if (outcome === 'REVISION_CONFLICT') throw revisionConflict();
    return this.requireTable(id);
  }

  async createRollbackDraft(
    sourceTableId: string,
    input: CopyDeckPointTableDraftInput,
    adminUserId: string
  ): Promise<DeckPointTableView> {
    const source = await this.getTable(sourceTableId);
    if (!source) throw notFound();
    const normalized = await this.normalizeTableInput(
      {
        version: input.version,
        displayName: input.displayName,
        pointLimit: source.pointLimit,
        entries: source.entries,
      },
      { query: this.query }
    );
    const id = await this.withTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO deck_point_tables (
          version, display_name, lifecycle, point_limit, created_by, updated_by
        ) VALUES ($1, $2, 'DRAFT', $3, $4, $4)
        RETURNING id`,
        [normalized.version, normalized.displayName, normalized.pointLimit, adminUserId]
      );
      const tableId = requiredId(inserted.rows[0]?.id);
      await replaceEntries(client, tableId, normalized.entries);
      await writeAudit(client, tableId, 'ROLLBACK_DRAFT_CREATED', adminUserId, {
        sourceTableId,
        sourceVersion: source.version,
      });
      return tableId;
    });
    return this.requireTable(id);
  }

  async previewDiff(
    id: string,
    compareToId?: string
  ): Promise<{
    readonly before: Pick<DeckPointTableView, 'id' | 'version' | 'displayName'>;
    readonly after: Pick<DeckPointTableView, 'id' | 'version' | 'displayName'>;
    readonly activeTable: Pick<DeckPointTableView, 'id' | 'version' | 'revision'>;
    readonly diff: DeckPointTableDiff;
  }> {
    const [after, active] = await Promise.all([this.getTable(id), this.getCurrentTable()]);
    const before = compareToId ? await this.getTable(compareToId) : active;
    if (!after || !before) throw notFound();
    return {
      before: pickIdentity(before),
      after: pickIdentity(after),
      activeTable: {
        id: active.id,
        version: active.version,
        revision: active.revision,
      },
      diff: diffDeckPointTables(toDiffRules(before), toDiffRules(after)),
    };
  }

  async publish(
    id: string,
    input: PublishDeckPointTableInput,
    adminUserId: string
  ): Promise<DeckPointTableView> {
    const now = this.now();
    let effectiveFrom: Date;
    if (input.mode === 'IMMEDIATE') {
      effectiveFrom = now;
    } else {
      try {
        effectiveFrom = shanghaiEffectiveDateTimeToInstant(input.effectiveDateTime ?? '');
      } catch (error) {
        throw new DeckPointTableServiceError(
          'INVALID_EFFECTIVE_DATE_TIME',
          error instanceof Error ? error.message : '生效时间非法'
        );
      }
      if (effectiveFrom.getTime() <= now.getTime()) {
        throw new DeckPointTableServiceError(
          'INVALID_EFFECTIVE_DATE_TIME',
          '定时生效时间必须晚于当前服务端时间'
        );
      }
    }

    const outcome = await this.withTransaction(async (client) => {
      const activeTableId = await this.reconcileLifecycle(client, now);
      if (activeTableId !== input.expectedActiveTableId) {
        // As with cancellation at the boundary, a lifecycle reconciliation
        // that just activated a schedule must commit even though this stale
        // publish request itself is rejected outside the transaction.
        return 'ACTIVE_CHANGED' as const;
      }
      const target = await lockTable(client, id);
      assertDraftRevision(target, input.expectedRevision);
      await this.validateStoredTable(client, target);

      if (input.mode === 'SCHEDULED') {
        const scheduled = await client.query<{ id: string }>(
          `SELECT id FROM deck_point_tables
           WHERE lifecycle = 'SCHEDULED' AND id <> $1
           LIMIT 1 FOR UPDATE`,
          [id]
        );
        if (scheduled.rows[0]) {
          throw new DeckPointTableServiceError(
            'POINT_TABLE_SCHEDULE_EXISTS',
            '已有一张待生效PT限制表，请先取消其排期',
            409
          );
        }
        await updatePublishedTable(
          client,
          target,
          'SCHEDULED',
          effectiveFrom,
          now,
          adminUserId,
          'PUBLISHED_SCHEDULED'
        );
        return 'PUBLISHED' as const;
      }

      const scheduled = await client.query<{ id: string }>(
        `SELECT id FROM deck_point_tables WHERE lifecycle = 'SCHEDULED' LIMIT 1 FOR UPDATE`
      );
      if (scheduled.rows[0]) {
        throw new DeckPointTableServiceError(
          'POINT_TABLE_SCHEDULE_EXISTS',
          '已有一张待生效PT限制表，请先取消其排期',
          409
        );
      }
      await retireActiveTable(client, id, adminUserId);
      await updatePublishedTable(
        client,
        target,
        'ACTIVE',
        effectiveFrom,
        now,
        adminUserId,
        'PUBLISHED_IMMEDIATELY'
      );
      return 'PUBLISHED' as const;
    });
    if (outcome === 'ACTIVE_CHANGED') {
      throw new DeckPointTableServiceError(
        'POINT_TABLE_ACTIVE_CHANGED',
        '当前生效PT限制表已变更，请重新预览差异后再发布',
        409
      );
    }
    return this.requireTable(id);
  }

  async cancelSchedule(
    id: string,
    expectedRevision: number,
    adminUserId: string
  ): Promise<DeckPointTableView> {
    const cancelled = await this.withTransaction(async (client) => {
      await this.reconcileLifecycle(client, this.now());
      const target = await lockTable(client, id);
      if (target.lifecycle !== 'SCHEDULED') {
        // Do not throw inside the transaction: reconciliation may just have
        // activated this table at the effective boundary and must commit.
        return false;
      }
      assertRevision(target, expectedRevision);
      const updated = await client.query<{ id: string }>(
        `UPDATE deck_point_tables
         SET lifecycle = 'RETIRED',
             retirement_reason = 'SCHEDULE_CANCELLED',
             revision = revision + 1,
             updated_by = $1,
             updated_at = now()
         WHERE id = $2 AND revision = $3
         RETURNING id`,
        [adminUserId, id, expectedRevision]
      );
      if (!updated.rows[0]) throw revisionConflict();
      await writeAudit(client, id, 'SCHEDULE_CANCELLED', adminUserId, {
        effectiveFrom: toIso(target.effective_from),
      });
      return true;
    });
    if (!cancelled) {
      throw new DeckPointTableServiceError(
        'POINT_TABLE_NOT_SCHEDULED',
        '只有待生效PT限制表可以取消排期',
        409
      );
    }
    return this.requireTable(id);
  }

  async discardTable(
    id: string,
    input: DiscardDeckPointTableInput,
    adminUserId: string
  ): Promise<DeckPointTableView> {
    const now = this.now();
    const outcome = await this.withTransaction(async (client) => {
      await this.reconcileLifecycle(client, now);
      const target = await lockTable(client, id);
      if (target.revision !== input.expectedRevision) return 'REVISION_CONFLICT' as const;
      if (target.lifecycle === 'RETIRED') return 'ALREADY_RETIRED' as const;

      if (target.lifecycle !== 'ACTIVE') {
        await retireTableManually(client, target, adminUserId);
        return 'DISCARDED' as const;
      }

      if (!input.replacementTableId || input.replacementExpectedRevision === undefined) {
        return 'REPLACEMENT_REQUIRED' as const;
      }
      if (input.replacementTableId === id) return 'INVALID_REPLACEMENT' as const;

      const replacement = await lockTable(client, input.replacementTableId);
      if (replacement.revision !== input.replacementExpectedRevision) {
        return 'REPLACEMENT_REVISION_CONFLICT' as const;
      }
      await this.validateStoredTable(client, replacement);

      const retired = await client.query<{ id: string }>(
        `UPDATE deck_point_tables
         SET lifecycle = 'RETIRED',
             retirement_reason = 'MANUALLY_DISCARDED',
             revision = revision + 1,
             updated_by = $1,
             updated_at = now()
         WHERE id = $2 AND revision = $3
         RETURNING id`,
        [adminUserId, target.id, target.revision]
      );
      if (!retired.rows[0]) throw revisionConflict();

      const activated = await client.query<{ id: string }>(
        `UPDATE deck_point_tables
         SET lifecycle = 'ACTIVE',
             retirement_reason = NULL,
             effective_from = $1,
             published_at = COALESCE(published_at, $1),
             revision = revision + 1,
             updated_by = $2,
             updated_at = now()
         WHERE id = $3 AND revision = $4
         RETURNING id`,
        [now, adminUserId, replacement.id, replacement.revision]
      );
      if (!activated.rows[0]) throw revisionConflict();

      await writeAudit(client, target.id, 'MANUALLY_DISCARDED', adminUserId, {
        replacementTableId: replacement.id,
        replacementVersion: replacement.version,
      });
      await writeAudit(client, replacement.id, 'ACTIVATED_AS_REPLACEMENT', adminUserId, {
        replacedTableId: target.id,
        replacedVersion: target.version,
        priorLifecycle: replacement.lifecycle,
        effectiveFrom: now.toISOString(),
      });
      return 'DISCARDED' as const;
    });

    if (outcome === 'REVISION_CONFLICT') throw revisionConflict();
    if (outcome === 'REPLACEMENT_REVISION_CONFLICT') {
      throw new DeckPointTableServiceError(
        'POINT_TABLE_REPLACEMENT_REVISION_CONFLICT',
        '替代PT限制表已被其他操作更新，请刷新后重试',
        409
      );
    }
    if (outcome === 'REPLACEMENT_REQUIRED') {
      throw new DeckPointTableServiceError(
        'POINT_TABLE_REPLACEMENT_REQUIRED',
        '废弃当前生效PT限制表时必须选择替代表',
        409
      );
    }
    if (outcome === 'INVALID_REPLACEMENT') {
      throw new DeckPointTableServiceError(
        'POINT_TABLE_INVALID_REPLACEMENT',
        '当前生效PT限制表不能替代自身',
        409
      );
    }
    if (outcome === 'ALREADY_RETIRED') {
      throw new DeckPointTableServiceError(
        'POINT_TABLE_ALREADY_RETIRED',
        '该PT限制表已废弃；如需移除请执行删除',
        409
      );
    }
    return this.requireTable(id);
  }

  async deleteTable(id: string, expectedRevision: number): Promise<DeleteDeckPointTableResult> {
    const outcome = await this.withTransaction(async (client) => {
      await this.reconcileLifecycle(client, this.now());
      const target = await lockTable(client, id);
      if (target.revision !== expectedRevision) return 'REVISION_CONFLICT' as const;
      if (target.lifecycle !== 'RETIRED') return 'NOT_RETIRED' as const;
      const deleted = await client.query<{ id: string }>(
        `DELETE FROM deck_point_tables
         WHERE id = $1 AND revision = $2 AND lifecycle = 'RETIRED'
         RETURNING id`,
        [id, expectedRevision]
      );
      if (!deleted.rows[0]) throw revisionConflict();
      return 'DELETED' as const;
    });
    if (outcome === 'REVISION_CONFLICT') throw revisionConflict();
    if (outcome === 'NOT_RETIRED') {
      throw new DeckPointTableServiceError(
        'POINT_TABLE_DELETE_REQUIRES_RETIRED',
        '只能删除已废弃的PT限制表',
        409
      );
    }
    return { id, deleted: true };
  }

  private async normalizeTableInput(input: CreateDeckPointTableDraftInput, client: QueryClient) {
    const version = input.version.trim();
    const displayName = input.displayName.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(version)) {
      throw new DeckPointTableServiceError(
        'INVALID_POINT_TABLE',
        '版本标识只能包含字母、数字、点、下划线和连字符，长度为2-64'
      );
    }
    if (!displayName || displayName.length > 100) {
      throw new DeckPointTableServiceError('INVALID_POINT_TABLE', '显示名称长度必须为1-100');
    }
    if (!Number.isSafeInteger(input.pointLimit) || input.pointLimit < 1 || input.pointLimit > 99) {
      throw new DeckPointTableServiceError('INVALID_POINT_TABLE', '卡组PT上限必须为1-99的整数');
    }

    const cards = await client.query<{ card_code: string }>(
      `SELECT card_code FROM cards WHERE status = 'PUBLISHED'`
    );
    const knownBaseCardCodes = new Set(cards.rows.map((row) => getBaseCardCode(row.card_code)));
    const validation = validateDeckPointTableEntries(input.entries, knownBaseCardCodes);
    if (!validation.valid) {
      throw new DeckPointTableServiceError(
        'INVALID_POINT_TABLE',
        validation.errors.slice(0, 8).join('; ')
      );
    }
    return {
      version,
      displayName,
      pointLimit: input.pointLimit,
      entries: validation.entries,
    };
  }

  private async validateStoredTable(client: QueryClient, table: DeckPointTableRow): Promise<void> {
    const entries = await client.query<{ base_card_code: string; points: number }>(
      `SELECT base_card_code, points
       FROM deck_point_table_entries
       WHERE table_id = $1`,
      [table.id]
    );
    await this.normalizeTableInput(
      {
        version: table.version,
        displayName: table.display_name,
        pointLimit: table.point_limit,
        entries: entries.rows.map((entry) => ({
          baseCardCode: entry.base_card_code,
          points: entry.points,
        })),
      },
      client
    );
  }

  private async reconcileLifecycle(client: QueryClient, now: Date): Promise<string> {
    const states = await client.query<DeckPointTableRow>(
      `SELECT * FROM deck_point_tables
       WHERE lifecycle IN ('ACTIVE', 'SCHEDULED')
       ORDER BY effective_from ASC
       FOR UPDATE`
    );
    const active = states.rows.find((row) => row.lifecycle === 'ACTIVE');
    const scheduled = states.rows.find((row) => row.lifecycle === 'SCHEDULED');
    if (scheduled?.effective_from && toDate(scheduled.effective_from).getTime() <= now.getTime()) {
      if (active) {
        await client.query(
          `UPDATE deck_point_tables
           SET lifecycle = 'RETIRED',
               retirement_reason = 'REPLACED',
               revision = revision + 1,
               updated_at = now()
           WHERE id = $1`,
          [active.id]
        );
        await writeAudit(client, active.id, 'RETIRED_BY_REPLACEMENT', null, {
          replacementTableId: scheduled.id,
          replacementVersion: scheduled.version,
        });
      }
      await client.query(
        `UPDATE deck_point_tables
         SET lifecycle = 'ACTIVE', revision = revision + 1, updated_at = now()
         WHERE id = $1`,
        [scheduled.id]
      );
      await writeAudit(client, scheduled.id, 'SCHEDULE_ACTIVATED', null, {
        effectiveFrom: toIso(scheduled.effective_from),
      });
      return scheduled.id;
    }
    if (!active) {
      throw new DeckPointTableServiceError(
        'POINT_TABLE_NOT_CONFIGURED',
        '当前没有已生效的PT限制表',
        503
      );
    }
    return active.id;
  }

  private async hydrateRows(
    rows: readonly DeckPointTableRow[],
    client: QueryClient['query']
  ): Promise<DeckPointTableView[]> {
    if (rows.length === 0) return [];
    const entries = await client<DeckPointTableEntryRow>(
      `SELECT
         e.table_id,
         e.base_card_code,
         e.points,
         c.card_code,
         c.name_cn,
         c.name_jp,
         c.card_type,
         c.cost,
         c.score
       FROM deck_point_table_entries e
       LEFT JOIN LATERAL (
         SELECT card_code, name_cn, name_jp, card_type, cost, score
         FROM cards
         WHERE status = 'PUBLISHED'
           AND regexp_replace(card_code, '-[^-]+$', '') = e.base_card_code
         ORDER BY card_code
         LIMIT 1
       ) c ON true
       WHERE e.table_id = ANY($1::uuid[])
       ORDER BY e.points DESC, e.base_card_code ASC`,
      [rows.map((row) => row.id)]
    );
    const byTable = new Map<string, DeckPointTableEntryView[]>();
    for (const entry of entries.rows) {
      const target = byTable.get(entry.table_id) ?? [];
      target.push({
        baseCardCode: entry.base_card_code,
        points: entry.points,
        ...(entry.card_code ? { cardCode: entry.card_code } : {}),
        ...(entry.name_cn ? { cardNameCn: entry.name_cn } : {}),
        ...(entry.name_jp ? { cardNameJp: entry.name_jp } : {}),
        ...(entry.card_type ? { cardType: entry.card_type } : {}),
        ...(entry.cost !== null && entry.cost !== undefined ? { cost: entry.cost } : {}),
        ...(entry.score !== null && entry.score !== undefined ? { score: entry.score } : {}),
      });
      byTable.set(entry.table_id, target);
    }
    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      displayName: row.display_name,
      lifecycle: row.lifecycle,
      retirementReason: row.retirement_reason,
      pointLimit: row.point_limit,
      effectiveFrom: toIso(row.effective_from),
      publishedAt: toIso(row.published_at),
      platformTimeZone: DECK_POINT_TABLE_TIME_ZONE,
      entries: byTable.get(row.id) ?? [],
      revision: row.revision,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: requiredIso(row.created_at),
      updatedAt: requiredIso(row.updated_at),
    }));
  }

  private async requireTable(id: string): Promise<DeckPointTableView> {
    const result = await this.getTable(id);
    if (!result) throw notFound();
    return result;
  }

  private async withTransaction<T>(callback: (client: QueryClient) => Promise<T>): Promise<T> {
    const client = await this.transactionPool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await assertExactlyOneActiveTable(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }
}

function toRules(table: DeckPointTableView): DeckPointTableRules {
  if (!table.effectiveFrom) {
    throw new DeckPointTableServiceError(
      'POINT_TABLE_NOT_PUBLISHED',
      '草稿PT限制表不能用于卡组校验',
      409
    );
  }
  return toDeckPointTableRules({
    version: table.version,
    pointLimit: table.pointLimit,
    effectiveFrom: table.effectiveFrom,
    entries: table.entries,
  });
}

function toDiffRules(table: DeckPointTableView) {
  return {
    pointLimit: table.pointLimit,
    entries: Object.fromEntries(table.entries.map((entry) => [entry.baseCardCode, entry.points])),
  };
}

async function lockTable(client: QueryClient, id: string): Promise<DeckPointTableRow> {
  const result = await client.query<DeckPointTableRow>(
    'SELECT * FROM deck_point_tables WHERE id = $1 FOR UPDATE',
    [id]
  );
  if (!result.rows[0]) throw notFound();
  return result.rows[0];
}

function assertDraftRevision(table: DeckPointTableRow, expectedRevision: number): void {
  if (table.lifecycle !== 'DRAFT') {
    throw new DeckPointTableServiceError('POINT_TABLE_NOT_DRAFT', '只有草稿PT限制表可以发布', 409);
  }
  assertRevision(table, expectedRevision);
}

function resolveUpdatedEffectiveFrom(
  table: DeckPointTableRow,
  effectiveDateTime: string | undefined,
  now: Date
): Date | null {
  if (effectiveDateTime === undefined) {
    return table.effective_from ? toDate(table.effective_from) : null;
  }
  if (table.lifecycle === 'DRAFT') {
    throw new DeckPointTableServiceError(
      'POINT_TABLE_DRAFT_EFFECTIVE_TIME_FORBIDDEN',
      '草稿PT限制表不能设置生效时间，请在发布时设置',
      409
    );
  }
  try {
    const effectiveFrom = shanghaiEffectiveDateTimeToInstant(effectiveDateTime);
    if (table.lifecycle === 'ACTIVE' && effectiveFrom.getTime() > now.getTime()) {
      throw new DeckPointTableServiceError(
        'POINT_TABLE_ACTIVE_EFFECTIVE_TIME_IN_FUTURE',
        '当前生效PT限制表的生效时间不得晚于当前时间；未来启用请使用排期发布或替换',
        409
      );
    }
    return effectiveFrom;
  } catch (error) {
    if (error instanceof DeckPointTableServiceError) throw error;
    throw new DeckPointTableServiceError(
      'INVALID_EFFECTIVE_DATE_TIME',
      error instanceof Error ? error.message : '生效时间非法'
    );
  }
}

async function assertExactlyOneActiveTable(client: QueryClient): Promise<void> {
  const result = await client.query<{ active_count: number | string }>(
    `SELECT count(*) AS active_count
     FROM deck_point_tables
     WHERE lifecycle = 'ACTIVE'`
  );
  if (Number(result.rows[0]?.active_count) !== 1) {
    throw new DeckPointTableServiceError(
      'POINT_TABLE_ACTIVE_INVARIANT_VIOLATION',
      '任何PT限制表操作后必须保留且仅保留一张生效表',
      500
    );
  }
}

function assertRevision(table: DeckPointTableRow, expectedRevision: number): void {
  if (table.revision !== expectedRevision) throw revisionConflict();
}

async function replaceEntries(
  client: QueryClient,
  tableId: string,
  entries: readonly DeckPointTableEntry[]
): Promise<void> {
  await client.query('DELETE FROM deck_point_table_entries WHERE table_id = $1', [tableId]);
  if (entries.length === 0) return;
  const params: unknown[] = [];
  const values = entries.map((entry, index) => {
    const offset = index * 3;
    params.push(tableId, entry.baseCardCode, entry.points);
    return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
  });
  await client.query(
    `INSERT INTO deck_point_table_entries (table_id, base_card_code, points)
     VALUES ${values.join(', ')}`,
    params
  );
}

async function updatePublishedTable(
  client: QueryClient,
  target: DeckPointTableRow,
  lifecycle: 'ACTIVE' | 'SCHEDULED',
  effectiveFrom: Date,
  publishedAt: Date,
  adminUserId: string,
  auditAction: 'PUBLISHED_IMMEDIATELY' | 'PUBLISHED_SCHEDULED'
): Promise<void> {
  const updated = await client.query<{ id: string }>(
    `UPDATE deck_point_tables
     SET lifecycle = $1,
         effective_from = $2,
         published_at = $3,
         revision = revision + 1,
         updated_by = $4,
         updated_at = now()
     WHERE id = $5 AND revision = $6
     RETURNING id`,
    [lifecycle, effectiveFrom, publishedAt, adminUserId, target.id, target.revision]
  );
  if (!updated.rows[0]) throw revisionConflict();
  await writeAudit(client, target.id, auditAction, adminUserId, {
    effectiveFrom: effectiveFrom.toISOString(),
    platformTimeZone: DECK_POINT_TABLE_TIME_ZONE,
  });
}

async function retireActiveTable(
  client: QueryClient,
  exceptId: string,
  adminUserId: string
): Promise<void> {
  const retired = await client.query<{ id: string; version: string }>(
    `UPDATE deck_point_tables
     SET lifecycle = 'RETIRED',
         retirement_reason = 'REPLACED',
         revision = revision + 1,
         updated_by = $1,
         updated_at = now()
     WHERE lifecycle = 'ACTIVE' AND id <> $2
     RETURNING id, version`,
    [adminUserId, exceptId]
  );
  for (const table of retired.rows) {
    await writeAudit(client, table.id, 'RETIRED_BY_REPLACEMENT', adminUserId, {
      replacementTableId: exceptId,
    });
  }
}

async function retireTableManually(
  client: QueryClient,
  target: DeckPointTableRow,
  adminUserId: string
): Promise<void> {
  const retired = await client.query<{ id: string }>(
    `UPDATE deck_point_tables
     SET lifecycle = 'RETIRED',
         retirement_reason = 'MANUALLY_DISCARDED',
         revision = revision + 1,
         updated_by = $1,
         updated_at = now()
     WHERE id = $2 AND revision = $3 AND lifecycle <> 'ACTIVE'
     RETURNING id`,
    [adminUserId, target.id, target.revision]
  );
  if (!retired.rows[0]) throw revisionConflict();
  await writeAudit(client, target.id, 'MANUALLY_DISCARDED', adminUserId, {
    priorLifecycle: target.lifecycle,
    effectiveFrom: toIso(target.effective_from),
  });
}

async function writeAudit(
  client: QueryClient,
  tableId: string,
  action: string,
  adminUserId: string | null,
  detail: Readonly<Record<string, unknown>>
): Promise<void> {
  await client.query(
    `INSERT INTO deck_point_table_audit_logs (table_id, action, admin_user_id, detail)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [tableId, action, adminUserId, JSON.stringify(detail)]
  );
}

function pickIdentity(table: DeckPointTableView) {
  return { id: table.id, version: table.version, displayName: table.displayName };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toIso(value: Date | string | null): string | null {
  return value === null ? null : toDate(value).toISOString();
}

function requiredIso(value: Date | string): string {
  return toDate(value).toISOString();
}

function requiredId(value: string | undefined): string {
  if (!value) {
    throw new DeckPointTableServiceError('POINT_TABLE_WRITE_FAILED', 'PT限制表写入失败', 500);
  }
  return value;
}

function notFound(): DeckPointTableServiceError {
  return new DeckPointTableServiceError('POINT_TABLE_NOT_FOUND', 'PT限制表不存在', 404);
}

function revisionConflict(): DeckPointTableServiceError {
  return new DeckPointTableServiceError(
    'POINT_TABLE_REVISION_CONFLICT',
    'PT限制表已被其他操作更新，请刷新后重试',
    409
  );
}

function mapDatabaseError(error: unknown): unknown {
  if (error instanceof DeckPointTableServiceError) return error;
  const code = (error as { code?: string })?.code;
  if (code === '23505') {
    return new DeckPointTableServiceError(
      'POINT_TABLE_CONFLICT',
      '版本标识重复，或当前/待生效PT限制表已存在',
      409
    );
  }
  return error;
}

export const deckPointTableService = new DeckPointTableService();
