import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn() }));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { connect: mocks.connect, query: mocks.query },
}));

import type { CardSyncEngine } from '../../src/server/services/card-sync-engine';
import {
  CardSyncService,
  CardSyncServiceError,
  sanitizeDiagnostic,
} from '../../src/server/services/card-sync-service';

const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const PREVIEW_ID = '11111111-1111-4111-8111-111111111111';

function engine(): CardSyncEngine {
  return {
    getConfigurationStatus: () => ({ configured: true, missing: [] }),
    preview: vi.fn(),
    apply: vi.fn(),
  };
}

function previewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PREVIEW_ID,
    kind: 'PREVIEW',
    status: 'SUCCEEDED',
    actor_user_id: ACTOR_ID,
    request_id: 'preview-request',
    idempotency_key: 'preview-idempotency',
    preview_run_id: null,
    source_collection: 'loveca',
    source_hash: 'a'.repeat(64),
    source_summary: { counts: { source: 1, existing: 0, candidates: 1, blocked: 0 } },
    result_summary: null,
    error_code: null,
    error_message: null,
    preview_expires_at: new Date('2026-08-22T10:15:00.000Z'),
    started_at: new Date('2026-08-22T10:00:00.000Z'),
    finished_at: new Date('2026-08-22T10:00:01.000Z'),
    created_at: new Date('2026-08-22T10:00:00.000Z'),
    updated_at: new Date('2026-08-22T10:00:01.000Z'),
    ...overrides,
  };
}

describe('CardSyncService', () => {
  beforeEach(() => {
    mocks.connect.mockReset();
    mocks.query.mockReset();
  });

  it('rejects an expired preview before inserting an apply task', async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn((text: string) => {
        queries.push(text);
        if (text.includes('SELECT * FROM card_sync_runs')) {
          return Promise.resolve({
            rows: [previewRow({ preview_expires_at: new Date('2026-08-22T10:01:00Z') })],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(client);
    const service = new CardSyncService(engine());

    await expect(
      service.enqueueApply({
        actorUserId: ACTOR_ID,
        requestId: 'apply-request',
        idempotencyKey: 'apply-idempotency',
        previewRunId: PREVIEW_ID,
        cardCodes: ['CARD-1'],
        now: new Date('2026-08-22T10:02:00Z'),
      })
    ).rejects.toMatchObject<CardSyncServiceError>({ code: 'PREVIEW_EXPIRED', statusCode: 409 });
    expect(queries.some((text) => text.includes('INSERT INTO card_sync_runs'))).toBe(false);
    expect(queries).toContain('ROLLBACK');
  });

  it('returns the original task when an apply idempotency key is retried', async () => {
    const applyId = '22222222-2222-4222-8222-222222222222';
    const existingApply = previewRow({
      id: applyId,
      kind: 'APPLY',
      status: 'QUEUED',
      request_id: 'apply-request',
      idempotency_key: 'apply-idempotency',
      preview_run_id: PREVIEW_ID,
      source_summary: {
        counts: { source: 1, existing: 0, candidates: 1, blocked: 0 },
        previewCandidateCardCodes: ['CARD-1'],
        selectedCardCodes: ['CARD-1'],
      },
      preview_expires_at: null,
      started_at: null,
      finished_at: null,
    });
    const client = {
      query: vi.fn((text: string) => {
        if (text.includes('SELECT * FROM card_sync_runs') && text.includes('FOR SHARE')) {
          return Promise.resolve({ rows: [previewRow()] });
        }
        if (text.includes('FROM card_sync_run_items') && text.includes("kind = 'CANDIDATE'")) {
          return Promise.resolve({
            rows: [{ card_code: 'CARD-1', summary: { name: '测试卡' }, ordinal: 0 }],
          });
        }
        if (text.includes('INSERT INTO card_sync_runs')) return Promise.resolve({ rows: [] });
        if (text.includes("kind = 'APPLY' AND idempotency_key")) {
          return Promise.resolve({ rows: [existingApply] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(client);
    mocks.query.mockImplementation((text: string) => {
      if (text.includes('FROM card_sync_runs')) return Promise.resolve({ rows: [existingApply] });
      return Promise.resolve({ rows: [] });
    });
    const service = new CardSyncService(engine());

    const result = await service.enqueueApply({
      actorUserId: ACTOR_ID,
      requestId: 'apply-request-retry',
      idempotencyKey: 'apply-idempotency',
      previewRunId: PREVIEW_ID,
      cardCodes: ['CARD-1'],
      now: new Date('2026-08-22T10:02:00Z'),
    });

    expect(result.id).toBe(applyId);
    expect(
      client.query.mock.calls.filter(([text]) =>
        String(text).includes('INSERT INTO card_sync_run_items')
      )
    ).toHaveLength(0);
  });

  it('rejects reuse of an apply idempotency key with a different selection', async () => {
    const applyId = '22222222-2222-4222-8222-222222222222';
    const existingApply = previewRow({
      id: applyId,
      kind: 'APPLY',
      status: 'QUEUED',
      request_id: 'apply-request',
      idempotency_key: 'apply-idempotency',
      preview_run_id: PREVIEW_ID,
      source_summary: {
        counts: { source: 2, existing: 0, candidates: 2, blocked: 0 },
        previewCandidateCardCodes: ['CARD-1', 'CARD-2'],
        selectedCardCodes: ['CARD-1'],
      },
      preview_expires_at: null,
      started_at: null,
      finished_at: null,
    });
    const client = {
      query: vi.fn((text: string) => {
        if (text.includes('SELECT * FROM card_sync_runs') && text.includes('FOR SHARE')) {
          return Promise.resolve({ rows: [previewRow()] });
        }
        if (text.includes('FROM card_sync_run_items') && text.includes("kind = 'CANDIDATE'")) {
          return Promise.resolve({
            rows: [
              { card_code: 'CARD-1', summary: { name: '第一张' }, ordinal: 0 },
              { card_code: 'CARD-2', summary: { name: '第二张' }, ordinal: 1 },
            ],
          });
        }
        if (text.includes('INSERT INTO card_sync_runs')) return Promise.resolve({ rows: [] });
        if (text.includes("kind = 'APPLY' AND idempotency_key")) {
          return Promise.resolve({ rows: [existingApply] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(client);
    const service = new CardSyncService(engine());

    await expect(
      service.enqueueApply({
        actorUserId: ACTOR_ID,
        requestId: 'apply-request-retry',
        idempotencyKey: 'apply-idempotency',
        previewRunId: PREVIEW_ID,
        cardCodes: ['CARD-2'],
        now: new Date('2026-08-22T10:02:00Z'),
      })
    ).rejects.toMatchObject<CardSyncServiceError>({
      code: 'IDEMPOTENCY_CONFLICT',
      statusCode: 409,
    });
  });

  it('enqueues only the selected preview candidates while retaining the full preview set', async () => {
    const applyId = '22222222-2222-4222-8222-222222222222';
    const client = {
      query: vi.fn((text: string) => {
        if (text.includes('SELECT * FROM card_sync_runs') && text.includes('FOR SHARE')) {
          return Promise.resolve({
            rows: [
              previewRow({
                source_summary: {
                  counts: { source: 2, existing: 0, candidates: 2, blocked: 0 },
                },
              }),
            ],
          });
        }
        if (text.includes('FROM card_sync_run_items') && text.includes("kind = 'CANDIDATE'")) {
          return Promise.resolve({
            rows: [
              { card_code: 'CARD-1', summary: { name: '第一张' }, ordinal: 0 },
              { card_code: 'CARD-2', summary: { name: '第二张' }, ordinal: 1 },
            ],
          });
        }
        if (text.includes('INSERT INTO card_sync_runs')) {
          return Promise.resolve({ rows: [{ id: applyId }] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(client);
    const applyRow = previewRow({
      id: applyId,
      kind: 'APPLY',
      status: 'QUEUED',
      preview_run_id: PREVIEW_ID,
      preview_expires_at: null,
    });
    mocks.query.mockImplementation((text: string) => {
      if (text.includes('FROM card_sync_runs')) return Promise.resolve({ rows: [applyRow] });
      return Promise.resolve({ rows: [] });
    });
    const service = new CardSyncService(engine());

    await service.enqueueApply({
      actorUserId: ACTOR_ID,
      requestId: 'apply-request-subset',
      idempotencyKey: 'apply-idempotency-subset',
      previewRunId: PREVIEW_ID,
      cardCodes: ['CARD-2'],
      now: new Date('2026-08-22T10:02:00Z'),
    });

    const runInsert = client.query.mock.calls.find(([text]) =>
      String(text).includes('INSERT INTO card_sync_runs')
    );
    expect(runInsert?.[1]?.[5]).toEqual(
      expect.objectContaining({
        previewCandidateCardCodes: ['CARD-1', 'CARD-2'],
        selectedCardCodes: ['CARD-2'],
      })
    );
    const itemInserts = client.query.mock.calls.filter(([text]) =>
      String(text).includes('INSERT INTO card_sync_run_items')
    );
    expect(itemInserts).toHaveLength(1);
    expect(itemInserts[0]?.[1]?.[2]).toBe('CARD-2');
  });

  it('rejects card codes outside the selected preview', async () => {
    const client = {
      query: vi.fn((text: string) => {
        if (text.includes('SELECT * FROM card_sync_runs')) {
          return Promise.resolve({ rows: [previewRow()] });
        }
        if (text.includes('FROM card_sync_run_items')) {
          return Promise.resolve({
            rows: [{ card_code: 'CARD-1', summary: { name: '测试卡' }, ordinal: 0 }],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(client);
    const service = new CardSyncService(engine());

    await expect(
      service.enqueueApply({
        actorUserId: ACTOR_ID,
        requestId: 'apply-request-invalid-selection',
        idempotencyKey: 'apply-idempotency-invalid-selection',
        previewRunId: PREVIEW_ID,
        cardCodes: ['CARD-NOT-IN-PREVIEW'],
        now: new Date('2026-08-22T10:02:00Z'),
      })
    ).rejects.toMatchObject<CardSyncServiceError>({ code: 'SELECTION_INVALID', statusCode: 409 });
    expect(
      client.query.mock.calls.some(([text]) => String(text).includes('INSERT INTO card_sync_runs'))
    ).toBe(false);
  });

  it('maps the active-apply unique violation to an operator-safe conflict', async () => {
    const client = {
      query: vi.fn((text: string) => {
        if (text.includes('SELECT * FROM card_sync_runs')) {
          return Promise.resolve({ rows: [previewRow()] });
        }
        if (text.includes('FROM card_sync_run_items')) {
          return Promise.resolve({ rows: [{ card_code: 'CARD-1', summary: {}, ordinal: 0 }] });
        }
        if (text.includes('INSERT INTO card_sync_runs')) {
          return Promise.reject(
            Object.assign(new Error('duplicate key uq_card_sync_runs_active_apply'), {
              code: '23505',
            })
          );
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(client);
    const service = new CardSyncService(engine());

    await expect(
      service.enqueueApply({
        actorUserId: ACTOR_ID,
        requestId: 'apply-request',
        idempotencyKey: 'apply-idempotency-new',
        previewRunId: PREVIEW_ID,
        cardCodes: ['CARD-1'],
        now: new Date('2026-08-22T10:02:00Z'),
      })
    ).rejects.toMatchObject<CardSyncServiceError>({ code: 'ACTIVE_RUN_EXISTS', statusCode: 409 });
  });

  it('redacts addresses and credential-shaped diagnostics before persistence', () => {
    expect(sanitizeDiagnostic('https://example.test/file?token=abc SecretKey=very-secret')).toBe(
      '[已脱敏地址] SecretKey=[已脱敏]'
    );
  });
  it('enqueues review-only selections with explicit confirmation and persists the override context', async () => {
    const query = vi.fn((sql: string) => {
      if (sql.includes('FOR SHARE')) return Promise.resolve({ rows: [previewRow()] });
      if (sql.includes("kind = 'CANDIDATE'")) return Promise.resolve({ rows: [] });
      if (sql.includes("kind = 'BLOCKED'"))
        return Promise.resolve({
          rows: [{ card_code: 'BAD', summary: { sourceKey: 'row:5', name: '原始名称' } }],
        });
      if (sql.includes('INSERT INTO card_sync_runs'))
        return Promise.resolve({ rows: [{ id: 'apply' }] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    mocks.connect.mockResolvedValue({ query, release: vi.fn() });
    const service = new CardSyncService(engine());
    vi.spyOn(service, 'getRun').mockResolvedValue({ id: 'apply' } as never);
    const forceImports = [
      { sourceKey: 'row:5', cardCode: 'MY-CARD', name: '确认名称', cardType: 'LIVE' as const },
    ];
    const request = {
      actorUserId: ACTOR_ID,
      requestId: 'req',
      idempotencyKey: 'key',
      previewRunId: PREVIEW_ID,
      cardCodes: [],
      forceImports,
      now: new Date('2026-08-22T10:02:00Z'),
    };
    await expect(service.enqueueApply(request)).rejects.toMatchObject({
      code: 'SELECTION_INVALID',
    });
    await expect(service.enqueueApply({ ...request, forceImport: true })).resolves.toMatchObject({
      id: 'apply',
    });
    const context = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO card_sync_runs'));
    expect(context).toBeDefined();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO card_sync_runs'),
      expect.arrayContaining([
        expect.objectContaining({
          forceImport: true,
          forceImports,
          selectedCardCodes: ['MY-CARD'],
        }),
      ])
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO card_sync_run_items'),
      expect.arrayContaining(['MY-CARD', expect.objectContaining({ name: '确认名称' })])
    );
  });

  it('returns a running preview before a slow image scan finishes', async () => {
    const mockEngine = engine();
    let finish!: (value: Awaited<ReturnType<CardSyncEngine['preview']>>) => void;
    vi.spyOn(mockEngine, 'preview').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    mocks.query.mockResolvedValue({ rows: [{ id: PREVIEW_ID }] });
    const transaction = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(transaction);
    const service = new CardSyncService(mockEngine);
    vi.spyOn(service, 'getRun').mockResolvedValue({ id: PREVIEW_ID, status: 'RUNNING' } as never);
    await expect(
      service.createPreview({
        actorUserId: ACTOR_ID,
        requestId: 'req',
        idempotencyKey: 'preview-key',
        imageCheck: 'LINK',
      })
    ).resolves.toMatchObject({ status: 'RUNNING' });
    expect(transaction.query).not.toHaveBeenCalled();
    finish({
      sourceHash: 'a'.repeat(64),
      generatedAt: new Date().toISOString(),
      counts: { source: 200, existing: 200, candidates: 0, blocked: 0 },
      candidates: [],
      blocked: [],
    });
    await vi.waitFor(() => expect(transaction.query).toHaveBeenCalledWith('COMMIT'));
  });
});
