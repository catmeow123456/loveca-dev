import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  connect: vi.fn(),
  loadDeck: vi.fn(),
  loadProfile: vi.fn(),
  getRestriction: vi.fn(),
  acquireParticipation: vi.fn(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: mocks.poolQuery,
    connect: mocks.connect,
  },
}));

vi.mock('../../src/server/services/online-room-service.js', () => ({
  loadOwnedDeckForOnlineMatch: mocks.loadDeck,
  loadUserProfileForOnlineMatch: mocks.loadProfile,
  onlineRoomService: {},
}));

vi.mock('../../src/server/services/site-announcement-service.js', () => ({
  siteAnnouncementService: {
    getGameplayRestriction: mocks.getRestriction,
  },
}));

vi.mock('../../src/server/services/gameplay-participation-service.js', () => ({
  acquirePublicQueueParticipation: mocks.acquireParticipation,
  releasePublicQueueParticipation: vi.fn(),
}));

vi.mock('../../src/server/services/public-table-telemetry.js', () => ({
  logPublicTableLifecycleEvent: vi.fn(),
}));

import {
  PublicTableService,
  type MatchmakingQueueContext,
} from '../../src/server/services/public-table-service';

const RANKED_CONTEXT: MatchmakingQueueContext = {
  queueKind: 'RANKED',
  participationKind: 'RANKED_QUEUE',
  environmentId: 'ranked-environment',
  seasonId: '11111111-1111-4111-8111-111111111111',
};

describe('PublicTableService ranked admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.poolQuery.mockResolvedValue({ rows: [] });
    mocks.connect.mockResolvedValue({
      query: mocks.clientQuery,
      release: vi.fn(),
    });
    mocks.getRestriction.mockResolvedValue(null);
    mocks.loadDeck.mockResolvedValue({
      deckId: '22222222-2222-4222-8222-222222222222',
      deckName: '排位测试卡组',
      runtimeDeck: { mainDeck: [], energyDeck: [] },
    });
    mocks.loadProfile.mockResolvedValue({ id: 'user-1' });
    mocks.acquireParticipation.mockResolvedValue(true);
  });

  it('rejects a join if admission closes before the ticket transaction', async () => {
    mocks.clientQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM ranked_seasons')) {
        return {
          rows: [
            {
              lifecycle: 'ACTIVE',
              queue_admission: 'PAUSED',
              competitive_environment_id: RANKED_CONTEXT.environmentId,
              platform_time_zone: 'Asia/Shanghai',
              open_windows: [{ weekdays: [4], startMinute: 0, endMinute: 1440 }],
              starts_at: new Date('2026-07-01T00:00:00.000Z'),
              scheduled_ends_at: new Date('2026-08-01T00:00:00.000Z'),
            },
          ],
        };
      }
      return { rows: [] };
    });
    const service = new PublicTableService({
      now: () => new Date('2026-07-30T12:00:00.000Z').getTime(),
    });

    await expect(
      service.join(
        '33333333-3333-4333-8333-333333333333',
        '22222222-2222-4222-8222-222222222222',
        'DIRECT',
        RANKED_CONTEXT
      )
    ).rejects.toMatchObject({
      code: 'RANKED_QUEUE_CLOSED',
      statusCode: 409,
    });
    expect(
      mocks.clientQuery.mock.calls.some(([text]) =>
        String(text).includes('INSERT INTO public_table_tickets')
      )
    ).toBe(false);
  });

  it('does not reserve waiting players after ranked admission closes', async () => {
    mocks.clientQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM ranked_seasons')) {
        return {
          rows: [
            {
              lifecycle: 'FINALIZING',
              queue_admission: 'PAUSED',
              competitive_environment_id: RANKED_CONTEXT.environmentId,
              platform_time_zone: 'Asia/Shanghai',
              open_windows: [{ weekdays: [4], startMinute: 0, endMinute: 1440 }],
              starts_at: new Date('2026-07-01T00:00:00.000Z'),
              scheduled_ends_at: new Date('2026-08-01T00:00:00.000Z'),
            },
          ],
        };
      }
      return { rows: [] };
    });
    const service = new PublicTableService({
      now: () => new Date('2026-07-30T12:00:00.000Z').getTime(),
    });

    await service.tryMatch(RANKED_CONTEXT);

    expect(
      mocks.clientQuery.mock.calls.some(([text]) =>
        String(text).includes('FROM public_table_tickets')
      )
    ).toBe(false);
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT');
  });
});
