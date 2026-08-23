import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), poolQuery: vi.fn() }));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { connect: mocks.connect, query: mocks.poolQuery },
}));

import {
  CardSyncPreviewStaleError,
  type CardSyncEngine,
} from '../../src/server/services/card-sync-engine';
import {
  CardSyncWorker,
  countResults,
  recoverInterruptedApplyRuns,
} from '../../src/server/services/card-sync-worker';

describe('CardSyncWorker', () => {
  beforeEach(() => {
    mocks.connect.mockReset();
    mocks.poolQuery.mockReset();
    mocks.poolQuery.mockResolvedValue({ rows: [{ id: 'current-run' }], rowCount: 1 });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('persists a partial result when only some candidate cards succeed', async () => {
    const queries: Array<{ text: string; params: unknown[] | undefined }> = [];
    const client = {
      query: vi.fn((text: string, params?: unknown[]) => {
        queries.push({ text, params });
        if (text.includes('SELECT id, actor_user_id')) {
          return Promise.resolve({
            rows: [
              {
                id: 'run-1',
                actor_user_id: 'actor-1',
                request_id: 'request-1',
                source_hash: 'a'.repeat(64),
                lease_generation: 0,
              },
            ],
          });
        }
        if (text.includes('SELECT card_code')) {
          return Promise.resolve({ rows: [{ card_code: 'CARD-1' }, { card_code: 'CARD-2' }] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(client);
    const apply = vi.fn<CardSyncEngine['apply']>().mockResolvedValue({
      sourceHash: 'a'.repeat(64),
      items: [
        { cardCode: 'CARD-1', result: 'SUCCEEDED', message: null },
        { cardCode: 'CARD-2', result: 'FAILED', message: '卡图下载失败' },
      ],
    });
    const engine: CardSyncEngine = {
      getConfigurationStatus: () => ({ configured: true, missing: [] }),
      preview: vi.fn(),
      apply,
    };

    expect(await new CardSyncWorker(engine).runOnce()).toBe(true);
    const applyInput = apply.mock.calls[0]?.[0];
    expect(applyInput).toBeDefined();
    expect(applyInput).toMatchObject({
      runId: 'run-1',
      actorUserId: 'actor-1',
      requestId: 'request-1',
      expectedSourceHash: 'a'.repeat(64),
      expectedCandidateCardCodes: ['CARD-1', 'CARD-2'],
    });
    expect(typeof applyInput?.execution.token).toBe('string');
    expect(applyInput?.execution.generation).toBe(1);
    expect(applyInput?.execution.signal).toBeInstanceOf(AbortSignal);
    expect(typeof applyInput?.execution.assertCurrent).toBe('function');
    const finalUpdate = queries.find((query) => query.text.includes('result_summary = $3'));
    expect(finalUpdate?.params?.[1]).toBe('PARTIAL');
    expect(finalUpdate?.params?.[2]).toEqual({ succeeded: 1, skipped: 0, failed: 1 });
    expect(finalUpdate?.text).toContain('lease_token = $4');
    expect(finalUpdate?.text).toContain('lease_generation = $5');
  });

  it('counts skipped cards as completed without hiding failures', () => {
    expect(
      countResults([
        { cardCode: 'CARD-1', result: 'SUCCEEDED', message: null },
        { cardCode: 'CARD-2', result: 'SKIPPED', message: null },
        { cardCode: 'CARD-3', result: 'FAILED', message: '失败' },
      ])
    ).toEqual({ succeeded: 1, skipped: 1, failed: 1 });
  });

  it('fails the claimed task when the engine detects a stale preview', async () => {
    const queries: Array<{ text: string; params: unknown[] | undefined }> = [];
    const client = {
      query: vi.fn((text: string, params?: unknown[]) => {
        queries.push({ text, params });
        if (text.includes('SELECT id, actor_user_id')) {
          return Promise.resolve({
            rows: [
              {
                id: 'run-stale',
                actor_user_id: 'actor-1',
                request_id: 'request-stale',
                source_hash: 'b'.repeat(64),
                lease_generation: 0,
              },
            ],
          });
        }
        if (text.includes('SELECT card_code')) {
          return Promise.resolve({ rows: [{ card_code: 'CARD-1' }] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(client);
    const engine: CardSyncEngine = {
      getConfigurationStatus: () => ({ configured: true, missing: [] }),
      preview: vi.fn(),
      apply: vi.fn().mockRejectedValue(new CardSyncPreviewStaleError()),
    };

    expect(await new CardSyncWorker(engine).runOnce()).toBe(true);
    const failedRunUpdate = queries.find((query) => query.text.includes("status = 'FAILED'"));
    expect(failedRunUpdate?.params?.[1]).toBe('PREVIEW_STALE');
    expect(failedRunUpdate?.params?.[2]).toContain('请重新检查');
  });

  it('closes an interrupted running task on worker startup so future syncs are not locked', async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn((text: string) => {
        queries.push(text);
        if (text.includes('SELECT id') && text.includes("status = 'RUNNING'")) {
          return Promise.resolve({ rows: [{ id: 'run-interrupted' }] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(client);

    await expect(recoverInterruptedApplyRuns()).resolves.toBe(1);
    expect(
      queries.some(
        (query) => query.includes('lease_expires_at <= NOW()') && query.includes('FOR UPDATE')
      )
    ).toBe(true);
    expect(queries.some((query) => query.includes("error_code = 'WORKER_INTERRUPTED'"))).toBe(true);
    expect(queries.some((query) => query.includes('lease_generation = lease_generation + 1'))).toBe(
      true
    );
    expect(
      queries.some(
        (query) =>
          query.includes('UPDATE card_sync_run_items') && query.includes("result = 'FAILED'")
      )
    ).toBe(true);
    expect(queries).toContain('COMMIT');
  });

  it('does not persist item or run results after the claimed lease is fenced', async () => {
    const queries: Array<{ text: string; params: unknown[] | undefined }> = [];
    let leaseRenewals = 0;
    const client = {
      query: vi.fn((text: string, params?: unknown[]) => {
        queries.push({ text, params });
        if (text.includes('SELECT id, actor_user_id')) {
          return Promise.resolve({
            rows: [
              {
                id: 'run-fenced',
                actor_user_id: 'actor-1',
                request_id: 'request-fenced',
                source_hash: 'c'.repeat(64),
                lease_generation: 4,
              },
            ],
          });
        }
        if (text.includes('SELECT card_code')) {
          return Promise.resolve({ rows: [{ card_code: 'CARD-1' }] });
        }
        if (text.includes('SET lease_expires_at')) {
          leaseRenewals += 1;
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(client);
    const engine: CardSyncEngine = {
      getConfigurationStatus: () => ({ configured: true, missing: [] }),
      preview: vi.fn(),
      apply: vi.fn().mockResolvedValue({
        sourceHash: 'c'.repeat(64),
        items: [{ cardCode: 'CARD-1', result: 'SUCCEEDED', message: null }],
      }),
    };

    await expect(new CardSyncWorker(engine).runOnce()).resolves.toBe(true);

    expect(leaseRenewals).toBeGreaterThanOrEqual(2);
    expect(
      queries.some(
        ({ text }) =>
          text.includes('UPDATE card_sync_run_items') && text.includes('SET result = $3')
      )
    ).toBe(false);
    expect(
      queries.some(
        ({ text }) => text.includes('result_summary = $3') && text.includes("status = 'RUNNING'")
      )
    ).toBe(false);
  });
});
