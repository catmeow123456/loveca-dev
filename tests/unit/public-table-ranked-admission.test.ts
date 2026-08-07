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

vi.mock('../../src/server/services/deck-point-table-service.js', () => ({
  deckPointTableService: {
    getCurrentRules: vi.fn(() =>
      Promise.resolve({
        version: 'test-point-table',
        pointLimit: 9,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        entries: {},
      })
    ),
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

  it('reclaims an expired CREATING_ROOM lease and resumes bootstrap', async () => {
    const now = new Date('2026-07-30T12:00:00.000Z').getTime();
    const leaseUntil = new Date(now + 30_000);
    const createPublicTableRoom = vi.fn(async () => ({
      roomCode: 'ABC234',
      roomGeneration: 'room-generation',
    }));
    const roomService = {
      createPublicTableRoom,
      discardPublicTableRoom: vi.fn(),
      getRoomIdentityForPublicTableReservation: vi.fn(() => null),
    };
    mocks.loadProfile.mockImplementation(async (userId: string) => ({
      userId,
      displayName: userId,
    }));
    mocks.poolQuery.mockImplementation(async (text: string) => {
      if (text.includes('reservation.bootstrap_lease_until')) {
        return {
          rows: [
            {
              state: 'CREATING_ROOM',
              bootstrap_lease_until: leaseUntil,
              queue_kind: 'CASUAL',
              season_id: null,
              first_ticket_id: 'ticket-1',
              second_ticket_id: 'ticket-2',
              first_user_id: 'user-1',
              second_user_id: 'user-2',
              first_deck_id: 'deck-1',
              second_deck_id: 'deck-2',
              first_deck_name: '卡组一',
              second_deck_name: '卡组二',
              first_runtime_deck: { mainDeck: [], energyDeck: [] },
              second_runtime_deck: { mainDeck: [], energyDeck: [] },
              first_locked_at: new Date(now),
              second_locked_at: new Date(now),
              first_point_table_version: 'before-rollover',
              second_point_table_version: 'before-rollover',
              first_point_total: 0,
              second_point_total: 0,
              first_point_limit: 9,
              second_point_limit: 9,
            },
          ],
        };
      }
      return { rows: [] };
    });
    mocks.clientQuery.mockImplementation(async (text: string) => {
      if (text.includes("WHERE state = 'CREATING_ROOM'") && text.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              id: 'reservation-1',
              first_ticket_id: 'ticket-1',
              second_ticket_id: 'ticket-2',
              bootstrap_attempt_count: 1,
            },
          ],
        };
      }
      if (text.includes('RETURNING bootstrap_lease_until')) {
        return { rows: [{ bootstrap_lease_until: leaseUntil }], rowCount: 1 };
      }
      if (text.includes("SET state = 'MATCHED'") && text.includes('bootstrap_lease_until = $4')) {
        return { rows: [{ id: 'reservation-1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const service = new PublicTableService({
      now: () => now,
      roomService: roomService as never,
    });

    await expect(service.cleanupExpiredState()).resolves.toMatchObject({
      recoveredCreatingReservations: 1,
    });
    expect(createPublicTableRoom).toHaveBeenCalledTimes(1);
    expect(createPublicTableRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        first: expect.objectContaining({
          pointValidation: {
            pointTableVersion: 'test-point-table',
            pointTotal: 0,
            pointLimit: 9,
          },
        }),
        second: expect.objectContaining({
          pointValidation: {
            pointTableVersion: 'test-point-table',
            pointTotal: 0,
            pointLimit: 9,
          },
        }),
      })
    );
    expect(
      mocks.poolQuery.mock.calls.some(([text]) =>
        String(text).includes('SET point_table_version = updated.point_table_version')
      )
    ).toBe(true);
    expect(
      mocks.clientQuery.mock.calls.some(([text]) =>
        String(text).includes('bootstrap_attempt_count = bootstrap_attempt_count + 1')
      )
    ).toBe(true);
  });

  it('releases an exhausted bootstrap reservation and restores both no-fault tickets', async () => {
    const now = new Date('2026-07-30T12:00:00.000Z').getTime();
    mocks.clientQuery.mockImplementation(async (text: string) => {
      if (text.includes("WHERE state = 'CREATING_ROOM'") && text.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              id: 'reservation-1',
              first_ticket_id: 'ticket-1',
              second_ticket_id: 'ticket-2',
              bootstrap_attempt_count: 3,
            },
          ],
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const createPublicTableRoom = vi.fn();
    const service = new PublicTableService({
      now: () => now,
      roomService: {
        createPublicTableRoom,
        getRoomIdentityForPublicTableReservation: vi.fn(() => null),
      } as never,
    });

    await expect(service.cleanupExpiredState()).resolves.toMatchObject({
      releasedReservations: 1,
      recoveredCreatingReservations: 0,
    });
    expect(createPublicTableRoom).not.toHaveBeenCalled();
    expect(
      mocks.clientQuery.mock.calls.filter(([text]) =>
        String(text).includes("heartbeat_at > $2 THEN 'WAITING'")
      )
    ).toHaveLength(2);
  });

  it('公共候场 bootstrap 遇新PT表超限时释放预约且不创建房间', async () => {
    const now = new Date('2026-08-07T16:00:00.000Z').getTime();
    const leaseUntil = new Date(now + 30_000);
    const createPublicTableRoom = vi.fn();
    mocks.loadProfile.mockImplementation(async (userId: string) => ({
      userId,
      displayName: userId,
    }));
    mocks.poolQuery.mockImplementation(async (text: string) => {
      if (text.includes('reservation.bootstrap_lease_until')) {
        return {
          rows: [
            {
              state: 'CREATING_ROOM',
              bootstrap_lease_until: leaseUntil,
              queue_kind: 'CASUAL',
              season_id: null,
              first_ticket_id: '11111111-1111-4111-8111-111111111111',
              second_ticket_id: '22222222-2222-4222-8222-222222222222',
              first_user_id: 'user-1',
              second_user_id: 'user-2',
              first_deck_id: 'deck-1',
              second_deck_id: 'deck-2',
              first_deck_name: '卡组一',
              second_deck_name: '卡组二',
              first_runtime_deck: {
                mainDeck: [{ cardCode: 'LL-bp2-001-R' }],
                energyDeck: [],
              },
              second_runtime_deck: { mainDeck: [], energyDeck: [] },
              first_locked_at: new Date(now - 1_000),
              second_locked_at: new Date(now - 1_000),
              first_point_table_version: 'before-rollover',
              second_point_table_version: 'before-rollover',
              first_point_total: 0,
              second_point_total: 0,
              first_point_limit: 9,
              second_point_limit: 9,
            },
          ],
        };
      }
      return { rows: [], rowCount: text.includes('released_reservation') ? 1 : 0 };
    });
    mocks.clientQuery.mockImplementation(async (text: string) => {
      if (text.includes("WHERE state = 'CREATING_ROOM'") && text.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              id: 'reservation-1',
              first_ticket_id: '11111111-1111-4111-8111-111111111111',
              second_ticket_id: '22222222-2222-4222-8222-222222222222',
              bootstrap_attempt_count: 1,
            },
          ],
        };
      }
      if (text.includes('RETURNING bootstrap_lease_until')) {
        return { rows: [{ bootstrap_lease_until: leaseUntil }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const service = new PublicTableService({
      now: () => now,
      getCurrentPointTableRules: () =>
        Promise.resolve({
          version: 'after-rollover',
          pointLimit: 9,
          effectiveFrom: '2026-08-07T16:00:00.000Z',
          entries: { 'LL-bp2-001': 10 },
        }),
      roomService: {
        createPublicTableRoom,
        discardPublicTableRoom: vi.fn(),
        getRoomIdentityForPublicTableReservation: vi.fn(() => null),
      } as never,
    });

    await expect(service.cleanupExpiredState()).resolves.toMatchObject({
      recoveredCreatingReservations: 0,
    });
    expect(createPublicTableRoom).not.toHaveBeenCalled();
    expect(
      mocks.poolQuery.mock.calls.some(([text]) =>
        String(text).includes("failure_reason = 'POINT_TABLE_CHANGED'")
      )
    ).toBe(true);
  });
});
