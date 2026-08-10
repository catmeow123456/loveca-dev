import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../src/server/db/pool';
import { GameplayParticipationService } from '../../src/server/services/gameplay-participation-service';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

describe('GameplayParticipationService', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('重开时应以单条 SQL 原子恢复全部玩家占用且允许幂等重试', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ restored_count: 2 }],
      rowCount: 1,
    } as never);
    const service = new GameplayParticipationService();
    const userIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];

    await expect(
      service.restoreOnlineRoom(
        userIds,
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444'
      )
    ).resolves.toBe(2);
    expect(vi.mocked(pool.query)).toHaveBeenCalledWith(
      expect.stringMatching(
        /WITH eligible AS MATERIALIZED[\s\S]*kind = 'ONLINE_MATCH'[\s\S]*kind = 'ONLINE_ROOM'[\s\S]*cardinality\(\$1::uuid\[\]\)/
      ),
      [userIds, '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444']
    );
  });

  it('空玩家列表不应访问数据库', async () => {
    const service = new GameplayParticipationService();

    await expect(service.restoreOnlineRoom([], 'room-generation', 'match-id')).resolves.toBe(0);
    expect(vi.mocked(pool.query)).not.toHaveBeenCalled();
  });
});
