import { describe, expect, it, vi } from 'vitest';
import { DeckPointTableService } from '../../src/server/services/deck-point-table-service';

type Lifecycle = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'RETIRED';

function createLifecycleHarness(now: Date) {
  const tables = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      version: '2026-04-03',
      display_name: '旧表',
      lifecycle: 'ACTIVE' as Lifecycle,
      retirement_reason: null as 'REPLACED' | 'SCHEDULE_CANCELLED' | 'MANUALLY_DISCARDED' | null,
      point_limit: 9,
      effective_from: '2026-04-02T16:00:00.000Z',
      published_at: '2026-04-02T16:00:00.000Z',
      revision: 1,
      created_by: null,
      updated_by: null,
      created_at: '2026-04-02T16:00:00.000Z',
      updated_at: '2026-04-02T16:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      version: '2026-08-08',
      display_name: '新表',
      lifecycle: 'SCHEDULED' as Lifecycle,
      retirement_reason: null as 'REPLACED' | 'SCHEDULE_CANCELLED' | 'MANUALLY_DISCARDED' | null,
      point_limit: 9,
      effective_from: '2026-08-07T16:00:00.000Z',
      published_at: '2026-08-06T00:00:00.000Z',
      revision: 1,
      created_by: null,
      updated_by: null,
      created_at: '2026-08-06T00:00:00.000Z',
      updated_at: '2026-08-06T00:00:00.000Z',
    },
  ];
  const audits: Array<{ tableId: string; action: string }> = [];
  const operations: string[] = [];
  const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
    await Promise.resolve();
    operations.push(text);
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (text.includes('count(*) AS active_count')) {
      return {
        rows: [{ active_count: tables.filter((table) => table.lifecycle === 'ACTIVE').length }],
      };
    }
    if (text.includes("WHERE lifecycle IN ('ACTIVE', 'SCHEDULED')")) {
      return {
        rows: tables
          .filter((table) => table.lifecycle === 'ACTIVE' || table.lifecycle === 'SCHEDULED')
          .sort((left, right) => left.effective_from.localeCompare(right.effective_from)),
      };
    }
    if (text.includes("SET lifecycle = 'RETIRED'")) {
      const table = tables.find((candidate) => candidate.id === values?.[0]);
      if (table) {
        table.lifecycle = 'RETIRED';
        table.retirement_reason = 'REPLACED';
        table.revision += 1;
      }
      return { rows: [] };
    }
    if (text.includes("SET lifecycle = 'ACTIVE'")) {
      const table = tables.find((candidate) => candidate.id === values?.[0]);
      if (table) {
        table.lifecycle = 'ACTIVE';
        table.revision += 1;
      }
      return { rows: [] };
    }
    if (text.includes('INSERT INTO deck_point_table_audit_logs')) {
      audits.push({ tableId: String(values?.[0]), action: String(values?.[1]) });
      return { rows: [] };
    }
    if (text.includes('SELECT * FROM deck_point_tables') && text.includes('WHERE id = $1')) {
      return { rows: tables.filter((table) => table.id === values?.[0]) };
    }
    if (text.includes('FROM deck_point_table_entries e')) {
      return {
        rows: [
          {
            table_id: String((values?.[0] as string[])?.[0]),
            base_card_code: 'LL-bp2-001',
            points: (values?.[0] as string[])?.[0] === tables[0].id ? 3 : 5,
          },
        ],
      };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  const service = new DeckPointTableService({
    query,
    transactionPool: {
      connect: () => Promise.resolve({ query, release: vi.fn() }),
    },
    now: () => now,
  });
  return { service, tables, audits, operations };
}

describe('DeckPointTableService lifecycle resolver', () => {
  it('keeps the April table active before Beijing midnight on August 8', async () => {
    const harness = createLifecycleHarness(new Date('2026-08-07T15:59:59.999Z'));
    const current = await harness.service.getCurrentTable();
    expect(current.version).toBe('2026-04-03');
    expect(harness.tables.map((table) => table.lifecycle)).toEqual(['ACTIVE', 'SCHEDULED']);
    expect(harness.audits).toEqual([]);
  });

  it('atomically retires the old table and activates the scheduled table at Beijing midnight', async () => {
    const harness = createLifecycleHarness(new Date('2026-08-07T16:00:00.000Z'));
    const current = await harness.service.getCurrentTable();
    expect(current).toMatchObject({
      version: '2026-08-08',
      lifecycle: 'ACTIVE',
      pointLimit: 9,
      entries: [{ baseCardCode: 'LL-bp2-001', points: 5 }],
      retirementReason: null,
    });
    expect(harness.tables.map((table) => table.lifecycle)).toEqual(['RETIRED', 'ACTIVE']);
    expect(harness.tables[0].retirement_reason).toBe('REPLACED');
    expect(harness.audits).toEqual([
      {
        tableId: '11111111-1111-4111-8111-111111111111',
        action: 'RETIRED_BY_REPLACEMENT',
      },
      {
        tableId: '22222222-2222-4222-8222-222222222222',
        action: 'SCHEDULE_ACTIVATED',
      },
    ]);
    const hydrateIndex = harness.operations.findIndex((text) =>
      text.includes('FROM deck_point_table_entries e')
    );
    const commitIndex = harness.operations.indexOf('COMMIT');
    expect(hydrateIndex).toBeGreaterThan(-1);
    expect(commitIndex).toBeGreaterThan(hydrateIndex);
  });
});

interface MutationTable {
  id: string;
  version: string;
  display_name: string;
  lifecycle: Lifecycle;
  retirement_reason: 'REPLACED' | 'SCHEDULE_CANCELLED' | 'MANUALLY_DISCARDED' | null;
  point_limit: number;
  effective_from: string | null;
  published_at: string | null;
  revision: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

function createMutationHarness() {
  let currentNow = new Date('2026-08-06T00:00:00.000Z');
  let publishedCardCodes = ['PL!N-pb1-011-R', 'LL-bp2-001-R+'];
  let idSequence = 0;
  const tables: MutationTable[] = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      version: '2026-04-03',
      display_name: '当前表',
      lifecycle: 'ACTIVE',
      retirement_reason: null,
      point_limit: 9,
      effective_from: '2026-04-02T16:00:00.000Z',
      published_at: '2026-04-02T16:00:00.000Z',
      revision: 1,
      created_by: null,
      updated_by: null,
      created_at: '2026-04-02T16:00:00.000Z',
      updated_at: '2026-04-02T16:00:00.000Z',
    },
  ];
  const entries = new Map<string, Array<{ baseCardCode: string; points: number }>>([
    [tables[0].id, [{ baseCardCode: 'PL!N-pb1-011', points: 1 }]],
  ]);
  const audits: Array<{ tableId: string; action: string }> = [];
  const operations: string[] = [];

  const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
    await Promise.resolve();
    operations.push(text);
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (text.includes('count(*) AS active_count')) {
      return {
        rows: [{ active_count: tables.filter((table) => table.lifecycle === 'ACTIVE').length }],
      };
    }
    if (text.includes("SELECT card_code FROM cards WHERE status = 'PUBLISHED'")) {
      return { rows: publishedCardCodes.map((cardCode) => ({ card_code: cardCode })) };
    }
    if (text.includes('INSERT INTO deck_point_tables')) {
      const version = String(values?.[0]);
      if (tables.some((table) => table.version === version)) {
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      }
      const id = `bbbbbbbb-bbbb-4bbb-8bbb-${String(++idSequence).padStart(12, '0')}`;
      tables.push({
        id,
        version,
        display_name: String(values?.[1]),
        lifecycle: 'DRAFT',
        retirement_reason: null,
        point_limit: Number(values?.[2]),
        effective_from: null,
        published_at: null,
        revision: 1,
        created_by: values?.[3] ?? null,
        updated_by: values?.[3] ?? null,
        created_at: '2026-08-06T00:00:00.000Z',
        updated_at: '2026-08-06T00:00:00.000Z',
      });
      return { rows: [{ id }] };
    }
    if (text.startsWith('DELETE FROM deck_point_table_entries')) {
      entries.set(String(values?.[0]), []);
      return { rows: [] };
    }
    if (text.includes('INSERT INTO deck_point_table_entries')) {
      const grouped = new Map<string, Array<{ baseCardCode: string; points: number }>>();
      for (let index = 0; index < (values?.length ?? 0); index += 3) {
        const tableId = String(values?.[index]);
        const target = grouped.get(tableId) ?? [];
        target.push({
          baseCardCode: String(values?.[index + 1]),
          points: Number(values?.[index + 2]),
        });
        grouped.set(tableId, target);
      }
      for (const [tableId, nextEntries] of grouped) entries.set(tableId, nextEntries);
      return { rows: [] };
    }
    if (text.includes('INSERT INTO deck_point_table_audit_logs')) {
      audits.push({ tableId: String(values?.[0]), action: String(values?.[1]) });
      return { rows: [] };
    }
    if (text.includes("WHERE lifecycle IN ('ACTIVE', 'SCHEDULED')")) {
      return {
        rows: tables.filter(
          (table) => table.lifecycle === 'ACTIVE' || table.lifecycle === 'SCHEDULED'
        ),
      };
    }
    if (text.includes('SELECT * FROM deck_point_tables') && text.includes('WHERE id = $1')) {
      const table = tables.find((candidate) => candidate.id === values?.[0]);
      const activeRequired = text.includes("lifecycle = 'ACTIVE'");
      return { rows: table && (!activeRequired || table.lifecycle === 'ACTIVE') ? [table] : [] };
    }
    if (text.includes('FROM deck_point_table_entries e')) {
      const tableIds = values?.[0] as string[];
      return {
        rows: tableIds.flatMap((tableId) =>
          (entries.get(tableId) ?? []).map((entry) => ({
            table_id: tableId,
            base_card_code: entry.baseCardCode,
            points: entry.points,
          }))
        ),
      };
    }
    if (text.includes('SET version = $1')) {
      const table = tables.find((candidate) => candidate.id === values?.[5]);
      if (!table || table.revision !== values?.[6]) return { rows: [] };
      if (
        tables.some((candidate) => candidate.id !== table.id && candidate.version === values?.[0])
      ) {
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      }
      table.version = String(values?.[0]);
      table.display_name = String(values?.[1]);
      table.point_limit = Number(values?.[2]);
      table.effective_from = values?.[3] ? (values[3] as Date).toISOString() : null;
      table.updated_by = String(values?.[4]);
      table.revision += 1;
      return { rows: [{ id: table.id }] };
    }
    if (text.includes('SELECT base_card_code, points') && text.includes('WHERE table_id = $1')) {
      return {
        rows: (entries.get(String(values?.[0])) ?? []).map((entry) => ({
          base_card_code: entry.baseCardCode,
          points: entry.points,
        })),
      };
    }
    if (text.includes("WHERE lifecycle = 'SCHEDULED'") && text.includes('SELECT id')) {
      const exceptId = values?.[0];
      return {
        rows: tables
          .filter((table) => table.lifecycle === 'SCHEDULED' && table.id !== exceptId)
          .slice(0, 1)
          .map((table) => ({ id: table.id })),
      };
    }
    if (text.includes('SET lifecycle = $1')) {
      const table = tables.find((candidate) => candidate.id === values?.[4]);
      if (!table || table.revision !== values?.[5]) return { rows: [] };
      table.lifecycle = String(values?.[0]) as Lifecycle;
      table.effective_from = (values?.[1] as Date).toISOString();
      table.published_at = (values?.[2] as Date).toISOString();
      table.updated_by = String(values?.[3]);
      table.revision += 1;
      return { rows: [{ id: table.id }] };
    }
    if (
      text.includes("SET lifecycle = 'RETIRED'") &&
      text.includes("retirement_reason = 'REPLACED'") &&
      text.includes('WHERE id = $1')
    ) {
      const table = tables.find((candidate) => candidate.id === values?.[0]);
      if (table) {
        table.lifecycle = 'RETIRED';
        table.retirement_reason = 'REPLACED';
        table.revision += 1;
      }
      return { rows: [] };
    }
    if (text.includes("SET lifecycle = 'ACTIVE'") && text.includes('WHERE id = $1')) {
      const table = tables.find((candidate) => candidate.id === values?.[0]);
      if (table) {
        table.lifecycle = 'ACTIVE';
        table.revision += 1;
      }
      return { rows: [] };
    }
    if (
      text.includes("SET lifecycle = 'RETIRED'") &&
      text.includes("retirement_reason = 'REPLACED'")
    ) {
      const retired = tables.filter(
        (table) => table.lifecycle === 'ACTIVE' && table.id !== values?.[1]
      );
      for (const table of retired) {
        table.lifecycle = 'RETIRED';
        table.retirement_reason = 'REPLACED';
        table.revision += 1;
      }
      return { rows: retired.map((table) => ({ id: table.id, version: table.version })) };
    }
    if (
      text.includes("SET lifecycle = 'RETIRED'") &&
      text.includes("retirement_reason = 'SCHEDULE_CANCELLED'")
    ) {
      const table = tables.find((candidate) => candidate.id === values?.[1]);
      if (!table || table.revision !== values?.[2]) return { rows: [] };
      table.lifecycle = 'RETIRED';
      table.retirement_reason = 'SCHEDULE_CANCELLED';
      table.revision += 1;
      return { rows: [{ id: table.id }] };
    }
    if (
      text.includes("SET lifecycle = 'RETIRED'") &&
      text.includes("retirement_reason = 'MANUALLY_DISCARDED'")
    ) {
      const table = tables.find((candidate) => candidate.id === values?.[1]);
      if (!table || table.revision !== values?.[2]) return { rows: [] };
      table.lifecycle = 'RETIRED';
      table.retirement_reason = 'MANUALLY_DISCARDED';
      table.updated_by = String(values?.[0]);
      table.revision += 1;
      return { rows: [{ id: table.id }] };
    }
    if (text.includes("SET lifecycle = 'ACTIVE'") && text.includes('published_at = COALESCE')) {
      const table = tables.find((candidate) => candidate.id === values?.[2]);
      if (!table || table.revision !== values?.[3]) return { rows: [] };
      table.lifecycle = 'ACTIVE';
      table.retirement_reason = null;
      table.effective_from = (values?.[0] as Date).toISOString();
      table.published_at ??= (values?.[0] as Date).toISOString();
      table.updated_by = String(values?.[1]);
      table.revision += 1;
      return { rows: [{ id: table.id }] };
    }
    if (text.startsWith('DELETE FROM deck_point_tables')) {
      const index = tables.findIndex(
        (table) =>
          table.id === values?.[0] &&
          table.revision === values?.[1] &&
          table.lifecycle === 'RETIRED'
      );
      if (index < 0) return { rows: [] };
      const [deleted] = tables.splice(index, 1);
      entries.delete(String(values?.[0]));
      return { rows: [{ id: deleted!.id }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const service = new DeckPointTableService({
    query,
    transactionPool: { connect: () => Promise.resolve({ query, release: vi.fn() }) },
    now: () => currentNow,
  });
  return {
    service,
    tables,
    entries,
    audits,
    operations,
    setNow(value: Date) {
      currentNow = value;
    },
    setPublishedCardCodes(value: string[]) {
      publishedCardCodes = value;
    },
  };
}

describe('DeckPointTableService mutations', () => {
  it('creates and updates a draft only with known published base codes', async () => {
    const harness = createMutationHarness();
    const draft = await harness.service.createDraft(
      {
        version: 'next',
        displayName: '下一版',
        pointLimit: 9,
        entries: [{ baseCardCode: 'PL!N-pb1-011', points: 2 }],
      },
      'admin-1'
    );
    expect(draft).toMatchObject({ lifecycle: 'DRAFT', revision: 1 });
    const updated = await harness.service.updateTable(
      draft.id,
      {
        version: 'next-v2',
        displayName: '下一版修订',
        pointLimit: 10,
        entries: [{ baseCardCode: 'LL-bp2-001', points: 5 }],
        expectedRevision: 1,
      },
      'admin-1'
    );
    expect(updated).toMatchObject({ version: 'next-v2', pointLimit: 10, revision: 2 });
    await expect(
      harness.service.createDraft(
        {
          version: 'unknown-card',
          displayName: '非法',
          pointLimit: 9,
          entries: [{ baseCardCode: 'PL!N-bp9-999', points: 1 }],
        },
        'admin-1'
      )
    ).rejects.toMatchObject({ code: 'INVALID_POINT_TABLE' });
  });

  it('rejects duplicate versions and stale expectedRevision', async () => {
    const harness = createMutationHarness();
    await expect(
      harness.service.createDraft(
        { version: '2026-04-03', displayName: '重复', pointLimit: 9, entries: [] },
        'admin-1'
      )
    ).rejects.toMatchObject({ code: 'POINT_TABLE_CONFLICT' });
    const draft = await harness.service.createDraft(
      { version: 'next', displayName: '下一版', pointLimit: 9, entries: [] },
      'admin-1'
    );
    await expect(
      harness.service.updateTable(
        draft.id,
        {
          version: 'next',
          displayName: '过期写入',
          pointLimit: 9,
          entries: [],
          expectedRevision: 2,
        },
        'admin-1'
      )
    ).rejects.toMatchObject({ code: 'POINT_TABLE_REVISION_CONFLICT' });
  });

  it('edits active and retired tables while preserving the single active invariant', async () => {
    const harness = createMutationHarness();
    const active = await harness.service.updateTable(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      {
        version: 'active-edited',
        displayName: '当前表修订',
        pointLimit: 10,
        entries: [
          { baseCardCode: 'PL!N-pb1-011', points: 2 },
          { baseCardCode: 'LL-bp2-001', points: 5 },
        ],
        effectiveDateTime: '2026-04-03T00:00:01',
        expectedRevision: 1,
      },
      'admin-1'
    );
    expect(active).toMatchObject({
      lifecycle: 'ACTIVE',
      version: 'active-edited',
      effectiveFrom: '2026-04-02T16:00:01.000Z',
      revision: 2,
      entries: [
        { baseCardCode: 'LL-bp2-001', points: 5 },
        { baseCardCode: 'PL!N-pb1-011', points: 2 },
      ],
    });

    const draft = await harness.service.createDraft(
      { version: 'retired-edit', displayName: '待废弃', pointLimit: 9, entries: [] },
      'admin-1'
    );
    await expect(
      harness.service.updateTable(
        draft.id,
        {
          version: 'retired-edit',
          displayName: '草稿不能预设生效时间',
          pointLimit: 9,
          entries: [],
          effectiveDateTime: '2026-08-08T00:00:00',
          expectedRevision: 1,
        },
        'admin-1'
      )
    ).rejects.toMatchObject({ code: 'POINT_TABLE_DRAFT_EFFECTIVE_TIME_FORBIDDEN' });
    const discarded = await harness.service.discardTable(
      draft.id,
      { expectedRevision: 1 },
      'admin-1'
    );
    const retired = await harness.service.updateTable(
      draft.id,
      {
        version: 'retired-edited',
        displayName: '已废弃表修订',
        pointLimit: 8,
        entries: [{ baseCardCode: 'PL!N-pb1-011', points: 1 }],
        effectiveDateTime: '2026-08-08T01:02:03',
        expectedRevision: discarded.revision,
      },
      'admin-1'
    );
    expect(retired).toMatchObject({
      lifecycle: 'RETIRED',
      retirementReason: 'MANUALLY_DISCARDED',
      version: 'retired-edited',
      effectiveFrom: '2026-08-07T17:02:03.000Z',
      revision: 3,
    });
    expect(harness.tables.filter((table) => table.lifecycle === 'ACTIVE')).toHaveLength(1);
  });

  it('rejects moving an active table effective time into the future', async () => {
    const harness = createMutationHarness();

    await expect(
      harness.service.updateTable(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        {
          version: 'active-future',
          displayName: '当前表',
          pointLimit: 9,
          entries: [{ baseCardCode: 'PL!N-pb1-011', points: 1 }],
          effectiveDateTime: '2026-08-06T08:00:01',
          expectedRevision: 1,
        },
        'admin-1'
      )
    ).rejects.toMatchObject({
      code: 'POINT_TABLE_ACTIVE_EFFECTIVE_TIME_IN_FUTURE',
      statusCode: 409,
    });
    expect(harness.tables[0]).toMatchObject({
      lifecycle: 'ACTIVE',
      version: '2026-04-03',
      revision: 1,
    });
  });

  it('revalidates a locked draft against the current published card pool before publishing', async () => {
    const harness = createMutationHarness();
    const draft = await harness.service.createDraft(
      {
        version: 'withdrawn-card',
        displayName: '含已撤回卡牌',
        pointLimit: 9,
        entries: [{ baseCardCode: 'PL!N-pb1-011', points: 2 }],
      },
      'admin-1'
    );
    harness.setPublishedCardCodes(['LL-bp2-001-R+']);

    await expect(
      harness.service.publish(
        draft.id,
        {
          mode: 'IMMEDIATE',
          expectedRevision: 1,
          expectedActiveTableId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        'admin-1'
      )
    ).rejects.toMatchObject({ code: 'INVALID_POINT_TABLE' });
    expect(harness.tables.find((table) => table.id === draft.id)).toMatchObject({
      lifecycle: 'DRAFT',
      revision: 1,
    });
  });

  it('allows a scheduled publication to be edited and records cancellation separately from replacement', async () => {
    const harness = createMutationHarness();
    const draft = await harness.service.createDraft(
      { version: 'next', displayName: '下一版', pointLimit: 9, entries: [] },
      'admin-1'
    );
    const scheduled = await harness.service.publish(
      draft.id,
      {
        mode: 'SCHEDULED',
        effectiveDateTime: '2026-08-08T00:00:00',
        expectedRevision: 1,
        expectedActiveTableId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      'admin-1'
    );
    expect(scheduled).toMatchObject({ lifecycle: 'SCHEDULED', revision: 2 });
    const edited = await harness.service.updateTable(
      draft.id,
      {
        version: 'next-edited',
        displayName: '修改后的排期',
        pointLimit: 10,
        entries: [{ baseCardCode: 'LL-bp2-001', points: 5 }],
        effectiveDateTime: '2026-08-09T12:34:56',
        expectedRevision: 2,
      },
      'admin-1'
    );
    expect(edited).toMatchObject({
      lifecycle: 'SCHEDULED',
      version: 'next-edited',
      pointLimit: 10,
      effectiveFrom: '2026-08-09T04:34:56.000Z',
      revision: 3,
    });
    const cancelled = await harness.service.cancelSchedule(draft.id, 3, 'admin-1');
    expect(cancelled).toMatchObject({
      lifecycle: 'RETIRED',
      retirementReason: 'SCHEDULE_CANCELLED',
      revision: 4,
    });
  });

  it('rejects immediate publication while another schedule exists', async () => {
    const harness = createMutationHarness();
    const first = await harness.service.createDraft(
      { version: 'scheduled', displayName: '排期', pointLimit: 9, entries: [] },
      'admin-1'
    );
    await harness.service.publish(
      first.id,
      {
        mode: 'SCHEDULED',
        effectiveDateTime: '2026-08-08T00:00:00',
        expectedRevision: 1,
        expectedActiveTableId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      'admin-1'
    );
    const second = await harness.service.createDraft(
      { version: 'immediate', displayName: '立即', pointLimit: 9, entries: [] },
      'admin-1'
    );
    await expect(
      harness.service.publish(
        second.id,
        {
          mode: 'IMMEDIATE',
          expectedRevision: 1,
          expectedActiveTableId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        'admin-1'
      )
    ).rejects.toMatchObject({ code: 'POINT_TABLE_SCHEDULE_EXISTS' });
  });

  it('requires a new diff preview if the active table changed before publish', async () => {
    const harness = createMutationHarness();
    const draft = await harness.service.createDraft(
      { version: 'next', displayName: '下一版', pointLimit: 9, entries: [] },
      'admin-1'
    );

    await expect(
      harness.service.publish(
        draft.id,
        {
          mode: 'IMMEDIATE',
          expectedRevision: 1,
          expectedActiveTableId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        },
        'admin-1'
      )
    ).rejects.toMatchObject({ code: 'POINT_TABLE_ACTIVE_CHANGED', statusCode: 409 });
    expect(harness.tables.find((table) => table.id === draft.id)?.lifecycle).toBe('DRAFT');
  });

  it('commits due schedule activation before rejecting a stale boundary publish', async () => {
    const harness = createMutationHarness();
    const scheduled = await harness.service.createDraft(
      { version: 'scheduled', displayName: '已排期', pointLimit: 9, entries: [] },
      'admin-1'
    );
    await harness.service.publish(
      scheduled.id,
      {
        mode: 'SCHEDULED',
        effectiveDateTime: '2026-08-08T00:00:00',
        expectedRevision: 1,
        expectedActiveTableId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      'admin-1'
    );
    const staleDraft = await harness.service.createDraft(
      { version: 'stale-draft', displayName: '过期预览草稿', pointLimit: 9, entries: [] },
      'admin-2'
    );
    harness.setNow(new Date('2026-08-07T16:00:00.000Z'));

    await expect(
      harness.service.publish(
        staleDraft.id,
        {
          mode: 'IMMEDIATE',
          expectedRevision: 1,
          expectedActiveTableId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        'admin-2'
      )
    ).rejects.toMatchObject({ code: 'POINT_TABLE_ACTIVE_CHANGED', statusCode: 409 });

    expect(harness.tables.find((table) => table.id === scheduled.id)?.lifecycle).toBe('ACTIVE');
    expect(harness.tables.find((table) => table.id === staleDraft.id)?.lifecycle).toBe('DRAFT');
    expect(harness.audits.map((audit) => audit.action)).toContain('SCHEDULE_ACTIVATED');
    expect(harness.operations.at(-1)).toBe('COMMIT');
    expect(harness.operations).not.toContain('ROLLBACK');
  });

  it('cannot cancel a scheduled table at or after its effective instant', async () => {
    const harness = createMutationHarness();
    const draft = await harness.service.createDraft(
      { version: 'next', displayName: '下一版', pointLimit: 9, entries: [] },
      'admin-1'
    );
    await harness.service.publish(
      draft.id,
      {
        mode: 'SCHEDULED',
        effectiveDateTime: '2026-08-08T00:00:00',
        expectedRevision: 1,
        expectedActiveTableId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      'admin-1'
    );
    harness.setNow(new Date('2026-08-07T16:00:00.000Z'));

    await expect(harness.service.cancelSchedule(draft.id, 2, 'admin-1')).rejects.toMatchObject({
      code: 'POINT_TABLE_NOT_SCHEDULED',
      statusCode: 409,
    });
    expect(harness.tables.find((table) => table.id === draft.id)?.lifecycle).toBe('ACTIVE');
    expect(harness.audits.map((audit) => audit.action)).toContain('SCHEDULE_ACTIVATED');
    expect(harness.audits.map((audit) => audit.action)).not.toContain('SCHEDULE_CANCELLED');
    expect(harness.operations.at(-1)).toBe('COMMIT');
    expect(harness.operations).not.toContain('ROLLBACK');
  });

  it('activates a scheduled table in the same transaction when its edited time is current or past', async () => {
    const harness = createMutationHarness();
    const scheduled = await harness.service.createDraft(
      { version: 'scheduled', displayName: '已排期', pointLimit: 9, entries: [] },
      'admin-1'
    );
    await harness.service.publish(
      scheduled.id,
      {
        mode: 'SCHEDULED',
        effectiveDateTime: '2026-08-08T00:00:00',
        expectedRevision: 1,
        expectedActiveTableId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      'admin-1'
    );

    const activated = await harness.service.updateTable(
      scheduled.id,
      {
        version: 'scheduled-edited',
        displayName: '立即切换',
        pointLimit: 10,
        entries: [{ baseCardCode: 'LL-bp2-001', points: 5 }],
        effectiveDateTime: '2026-08-06T08:00:00',
        expectedRevision: 2,
      },
      'admin-1'
    );

    expect(activated).toMatchObject({
      lifecycle: 'ACTIVE',
      version: 'scheduled-edited',
      revision: 4,
      effectiveFrom: '2026-08-06T00:00:00.000Z',
    });
    expect(harness.tables.filter((table) => table.lifecycle === 'ACTIVE')).toHaveLength(1);
    expect(harness.tables[0]).toMatchObject({
      lifecycle: 'RETIRED',
      retirement_reason: 'REPLACED',
    });
  });

  it('atomically replaces an active table when the administrator discards it', async () => {
    const harness = createMutationHarness();
    const replacement = await harness.service.createDraft(
      {
        version: 'replacement',
        displayName: '替代表',
        pointLimit: 9,
        entries: [{ baseCardCode: 'PL!N-pb1-011', points: 2 }],
      },
      'admin-1'
    );

    await expect(
      harness.service.discardTable(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        { expectedRevision: 1 },
        'admin-1'
      )
    ).rejects.toMatchObject({ code: 'POINT_TABLE_REPLACEMENT_REQUIRED' });

    const discarded = await harness.service.discardTable(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      {
        expectedRevision: 1,
        replacementTableId: replacement.id,
        replacementExpectedRevision: 1,
      },
      'admin-1'
    );

    expect(discarded).toMatchObject({
      lifecycle: 'RETIRED',
      retirementReason: 'MANUALLY_DISCARDED',
      revision: 2,
    });
    expect(harness.tables.find((table) => table.id === replacement.id)).toMatchObject({
      lifecycle: 'ACTIVE',
      retirement_reason: null,
      revision: 2,
    });
    expect(harness.tables.filter((table) => table.lifecycle === 'ACTIVE')).toHaveLength(1);
    expect(harness.audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining(['MANUALLY_DISCARDED', 'ACTIVATED_AS_REPLACEMENT'])
    );
  });

  it('soft-discards a draft and physically deletes it only after retirement', async () => {
    const harness = createMutationHarness();
    const draft = await harness.service.createDraft(
      { version: 'temporary', displayName: '临时表', pointLimit: 9, entries: [] },
      'admin-1'
    );

    await expect(harness.service.deleteTable(draft.id, 1)).rejects.toMatchObject({
      code: 'POINT_TABLE_DELETE_REQUIRES_RETIRED',
    });
    const discarded = await harness.service.discardTable(
      draft.id,
      { expectedRevision: 1 },
      'admin-1'
    );
    expect(discarded).toMatchObject({
      lifecycle: 'RETIRED',
      retirementReason: 'MANUALLY_DISCARDED',
      revision: 2,
    });
    await expect(harness.service.deleteTable(draft.id, 2)).resolves.toEqual({
      id: draft.id,
      deleted: true,
    });
    expect(harness.tables.some((table) => table.id === draft.id)).toBe(false);
    expect(harness.tables.filter((table) => table.lifecycle === 'ACTIVE')).toHaveLength(1);
  });
});
