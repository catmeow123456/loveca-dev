import { afterEach, describe, expect, it, vi } from 'vitest';

const poolMocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn() }));

vi.mock('../../src/server/db/pool.js', () => ({ pool: poolMocks }));

import { DeckClassificationWorker } from '../../src/server/services/deck-classification-worker';
import {
  buildDeckClassifierSnapshot,
  hashDeckClassifierSnapshot,
} from '../../src/server/services/deck-classifier-release';

function releaseSnapshot() {
  return buildDeckClassifierSnapshot({
    releaseVersion: 2,
    archetypes: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        archetype_key: 'test',
        name: '测试卡组',
        group_name: '测试',
        description: '',
        sort_order: 1,
      },
    ],
    templates: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        archetype_id: '11111111-1111-4111-8111-111111111111',
        cards: [
          ...Array.from({ length: 48 }, (_, index) => ({
            baseCardCode: `M-${index + 1}`,
            cardType: 'MEMBER' as const,
            count: 1,
          })),
          ...Array.from({ length: 12 }, (_, index) => ({
            baseCardCode: `L-${index + 1}`,
            cardType: 'LIVE' as const,
            count: 1,
          })),
        ],
      },
    ],
    rules: [],
  });
}

function client(handler: (sql: string, values?: readonly unknown[]) => unknown) {
  return {
    query: vi.fn((sql: string, values?: readonly unknown[]) =>
      Promise.resolve(handler(sql, values))
    ),
    release: vi.fn(),
  };
}

function recoverClient() {
  return client((sql) => ({ rows: sql.includes('SELECT id, release_id') ? [] : [] }));
}

function claimClient(snapshot: ReturnType<typeof releaseSnapshot>, configHash: string) {
  return client((sql) => {
    if (sql.includes('SELECT run.id, run.release_id')) {
      return {
        rows: [
          {
            id: 'run-1',
            release_id: 'release-new',
            release_status: 'BUILDING',
            trigger: 'RELEASE_PUBLISHED',
            scope_season_id: null,
            snapshot_json: snapshot,
            config_hash: configHash,
          },
        ],
      };
    }
    if (sql.includes("SET status = 'RUNNING'")) return { rows: [{ id: 'run-1' }] };
    return { rows: [] };
  });
}

describe('DeckClassificationWorker', () => {
  afterEach(() => vi.clearAllMocks());

  it('atomically supersedes the old release only after a complete build succeeds', async () => {
    const snapshot = releaseSnapshot();
    const recover = recoverClient();
    const claim = claimClient(snapshot, hashDeckClassifierSnapshot(snapshot));
    const persist = client((sql) => {
      if (sql.startsWith('SELECT status')) return { rows: [{ status: 'RUNNING' }] };
      if (sql.includes("SET status = 'ACTIVE'")) return { rows: [{ id: 'release-new' }] };
      return { rows: [] };
    });
    poolMocks.connect
      .mockResolvedValueOnce(recover)
      .mockResolvedValueOnce(claim)
      .mockResolvedValueOnce(persist);
    poolMocks.query.mockResolvedValue({ rows: [] });

    await expect(new DeckClassificationWorker().runOnce()).resolves.toBe(true);

    const sql = persist.query.mock.calls.map(([text]) => String(text));
    const supersedeIndex = sql.findIndex((text) => text.includes("SET status = 'SUPERSEDED'"));
    const activateIndex = sql.findIndex((text) => text.includes("SET status = 'ACTIVE'"));
    expect(supersedeIndex).toBeGreaterThan(-1);
    expect(activateIndex).toBeGreaterThan(supersedeIndex);
    expect(sql.some((text) => text.includes("SET status = 'SUCCEEDED'"))).toBe(true);
    expect(persist.query.mock.calls).toContainEqual([
      expect.stringContaining('excluded_count = $8'),
      ['run-1', 0, 0, 0, 0, 0, 0, 0, 0],
    ]);
  });

  it('marks a tampered build failed without superseding the serving release', async () => {
    const snapshot = releaseSnapshot();
    const recover = recoverClient();
    const claim = claimClient(snapshot, `sha256:${'0'.repeat(64)}`);
    const fail = client(() => ({ rows: [] }));
    poolMocks.connect
      .mockResolvedValueOnce(recover)
      .mockResolvedValueOnce(claim)
      .mockResolvedValueOnce(fail);

    await expect(new DeckClassificationWorker().runOnce()).resolves.toBe(true);

    const sql = fail.query.mock.calls.map(([text]) => String(text)).join('\n');
    expect(sql).toContain("SET status = 'FAILED'");
    expect(sql).not.toContain("SET status = 'SUPERSEDED'");
    expect(sql).not.toContain("SET status = 'ACTIVE'");
  });

  it('requeues the same automatic catch-up key only when its prior run failed', async () => {
    const recover = recoverClient();
    const noClaim = client((sql) => ({
      rows: sql.includes('SELECT run.id, run.release_id') ? [] : [],
    }));
    const queue = client((sql) => {
      if (sql.includes('max(observation.observed_at)')) {
        return {
          rows: [
            {
              release_id: 'release-active',
              missing_count: 2,
              latest_observed_at: '2026-08-23T00:00:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO deck_classification_runs')) return { rows: [{ id: 'run-2' }] };
      return { rows: [] };
    });
    poolMocks.connect
      .mockResolvedValueOnce(recover)
      .mockResolvedValueOnce(noClaim)
      .mockResolvedValueOnce(queue);

    await expect(new DeckClassificationWorker().runOnce()).resolves.toBe(true);

    const insertSql = String(
      queue.query.mock.calls.find(([text]) => String(text).includes('INSERT INTO'))?.[0]
    );
    expect(insertSql).toContain("WHERE deck_classification_runs.status = 'FAILED'");
    expect(insertSql).toContain('excluded_count = 0');
  });
});
