import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { connect: mocks.connect },
}));

import {
  PlatformOperationsServiceError,
  REPLAY_RETENTION_CONFIRMATION,
  platformOperationsService,
} from '../../src/server/services/platform-operations-service';

describe('platformOperationsService', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('previews the same ten-day retention policy used by the maintenance script', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT record.match_id,')) {
        return {
          rows: [
            {
              match_id: 'old-match',
              replay_rows: 12,
              checkpoint_rows: 4,
              event_rows: 7,
              decision_rows: 1,
            },
          ],
        };
      }
      if (sql.includes('JOIN ranked_matches AS ranked_match')) return { rows: [{ count: 0 }] };
      if (sql.startsWith('SELECT count(*) FROM match_records')) return { rows: [{ count: 1 }] };
      throw new Error(`unexpected query: ${sql}`);
    });

    const report = await platformOperationsService.previewReplayRetention(
      new Date('2026-08-20T00:00:00.000Z')
    );

    expect(report).toMatchObject({
      retentionDays: 10,
      cutoff: '2026-08-10T00:00:00.000Z',
      candidateMatchCount: 1,
      replayRows: 12,
      blockedRankedMatchCount: 0,
      metadataRowsUpdated: 0,
    });
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('rejects an incorrect confirmation before acquiring a database connection', async () => {
    await expect(
      platformOperationsService.applyReplayRetention('清理', 'admin-1')
    ).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    } satisfies Partial<PlatformOperationsServiceError>);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('blocks deletion when a ranked candidate lacks both long-term deck observations', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT record.match_id,')) return { rows: [] };
      if (sql.includes('JOIN ranked_matches AS ranked_match')) return { rows: [{ count: 2 }] };
      throw new Error(`unexpected query: ${sql}`);
    });

    await expect(
      platformOperationsService.applyReplayRetention(
        REPLAY_RETENTION_CONFIRMATION,
        'admin-1',
        new Date('2026-08-20T00:00:00.000Z')
      )
    ).rejects.toMatchObject({
      code: 'RANKED_OBSERVATION_BLOCKED',
      message: '有 2 局排位对局缺少完整卡组观察，不能清理',
    });
    expect(mocks.query.mock.calls.flat().join('\n')).not.toContain('DELETE FROM');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('purges eligible records in locked batches and releases the client', async () => {
    let purgedBatch = false;
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT record.match_id,')) return { rows: [] };
      if (sql.includes('JOIN ranked_matches AS ranked_match')) return { rows: [{ count: 0 }] };
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes('WITH selected')) {
        if (purgedBatch) return { rows: [{ count: 0 }] };
        purgedBatch = true;
        return { rows: [{ count: 3 }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const report = await platformOperationsService.applyReplayRetention(
      REPLAY_RETENTION_CONFIRMATION,
      'admin-1',
      new Date('2026-08-20T00:00:00.000Z')
    );

    expect(report.metadataRowsUpdated).toBe(3);
    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes('FOR UPDATE OF record SKIP LOCKED'))).toBe(true);
    expect(statements.some((sql) => sql.includes('DELETE FROM match_decision_records'))).toBe(true);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"adminUserId":"admin-1"'));
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('does not expose internal report failures to the client', async () => {
    mocks.query.mockRejectedValue(new Error('relation private_internal_table does not exist'));

    await expect(platformOperationsService.generateRankedVolatilityReport()).rejects.toMatchObject({
      code: 'REPORT_UNAVAILABLE',
      message: '生成赛季报告失败，请稍后重试',
    } satisfies Partial<PlatformOperationsServiceError>);
    expect(console.error).toHaveBeenCalledWith(
      '[PlatformOperations] Ranked volatility report failed:',
      expect.any(Error)
    );
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
