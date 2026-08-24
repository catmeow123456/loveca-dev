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
      now: new Date('2026-08-22T10:02:00Z'),
    });

    expect(result.id).toBe(applyId);
    expect(
      client.query.mock.calls.filter(([text]) =>
        String(text).includes('INSERT INTO card_sync_run_items')
      )
    ).toHaveLength(0);
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
        now: new Date('2026-08-22T10:02:00Z'),
      })
    ).rejects.toMatchObject<CardSyncServiceError>({ code: 'ACTIVE_RUN_EXISTS', statusCode: 409 });
  });

  it('redacts addresses and credential-shaped diagnostics before persistence', () => {
    expect(sanitizeDiagnostic('https://example.test/file?token=abc SecretKey=very-secret')).toBe(
      '[已脱敏地址] SecretKey=[已脱敏]'
    );
  });
});
