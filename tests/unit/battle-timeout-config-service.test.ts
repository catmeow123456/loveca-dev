import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: mocks.query },
}));

import {
  BattleTimeoutConfigService,
  BattleTimeoutConfigServiceError,
} from '../../src/server/services/battle-timeout-config-service';
import type { AdminBattleTimeoutSettings } from '../../src/online/room-lifecycle-policy';

const DEFAULT_SETTINGS: AdminBattleTimeoutSettings = {
  battleTimeouts: {
    playerActionTimeoutSeconds: 180,
    reconnectGracePeriodSeconds: 60,
    doubleDisconnectNoContestWindowSeconds: 5,
  },
  roomLifecycle: {
    roomDestroyAfterAllAbsentSeconds: 60,
    casualHeartbeatGraceSeconds: 45,
    casualConfirmationTtlSeconds: 60,
  },
};

describe('BattleTimeoutConfigService', () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it('returns platform defaults when the singleton row does not exist', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await expect(new BattleTimeoutConfigService().getConfig()).resolves.toEqual({
      playerActionTimeoutSeconds: 180,
      reconnectGracePeriodSeconds: 60,
      doubleDisconnectNoContestWindowSeconds: 5,
    });
  });

  it('returns lifecycle defaults when the singleton row does not exist', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await expect(new BattleTimeoutConfigService().getRoomLifecycleTimeoutConfig()).resolves.toEqual(
      {
        roomDestroyAfterAllAbsentSeconds: 60,
        casualHeartbeatGraceSeconds: 45,
        casualConfirmationTtlSeconds: 60,
      }
    );
  });

  it('maps the singleton row into combined settings', async () => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          player_action_timeout_seconds: 240,
          reconnect_grace_period_seconds: 90,
          double_disconnect_no_contest_window_seconds: 8,
          room_destroy_after_all_absent_seconds: 120,
          casual_heartbeat_grace_seconds: 90,
          casual_confirmation_ttl_seconds: 45,
        },
      ],
    });

    await expect(new BattleTimeoutConfigService().getSettings()).resolves.toEqual({
      battleTimeouts: {
        playerActionTimeoutSeconds: 240,
        reconnectGracePeriodSeconds: 90,
        doubleDisconnectNoContestWindowSeconds: 8,
      },
      roomLifecycle: {
        roomDestroyAfterAllAbsentSeconds: 120,
        casualHeartbeatGraceSeconds: 90,
        casualConfirmationTtlSeconds: 45,
      },
    });
  });

  it('updates all six fields in the singleton row', async () => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          player_action_timeout_seconds: 240,
          reconnect_grace_period_seconds: 90,
          double_disconnect_no_contest_window_seconds: 10,
          room_destroy_after_all_absent_seconds: 120,
          casual_heartbeat_grace_seconds: 90,
          casual_confirmation_ttl_seconds: 45,
        },
      ],
    });

    const result = await new BattleTimeoutConfigService().updateConfig(
      {
        battleTimeouts: {
          playerActionTimeoutSeconds: 240,
          reconnectGracePeriodSeconds: 90,
          doubleDisconnectNoContestWindowSeconds: 10,
        },
        roomLifecycle: {
          roomDestroyAfterAllAbsentSeconds: 120,
          casualHeartbeatGraceSeconds: 90,
          casualConfirmationTtlSeconds: 45,
        },
      },
      'admin-1'
    );

    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (id)'), [
      240,
      90,
      10,
      120,
      90,
      45,
      'admin-1',
    ]);
    expect(result).toEqual({
      battleTimeouts: {
        playerActionTimeoutSeconds: 240,
        reconnectGracePeriodSeconds: 90,
        doubleDisconnectNoContestWindowSeconds: 10,
      },
      roomLifecycle: {
        roomDestroyAfterAllAbsentSeconds: 120,
        casualHeartbeatGraceSeconds: 90,
        casualConfirmationTtlSeconds: 45,
      },
    });
  });

  it.each([
    { playerActionTimeoutSeconds: 59, reconnectGracePeriodSeconds: 60 },
    { playerActionTimeoutSeconds: 180, reconnectGracePeriodSeconds: 301 },
  ])('rejects an out-of-range battle config before querying', async (battleTimeouts) => {
    await expect(
      new BattleTimeoutConfigService().updateConfig(
        { ...DEFAULT_SETTINGS, battleTimeouts },
        'admin-1'
      )
    ).rejects.toBeInstanceOf(BattleTimeoutConfigServiceError);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each([
    { doubleDisconnectNoContestWindowSeconds: 1 },
    { doubleDisconnectNoContestWindowSeconds: 31 },
    { roomDestroyAfterAllAbsentSeconds: 29 },
    { roomDestroyAfterAllAbsentSeconds: 601 },
    { casualHeartbeatGraceSeconds: 44 },
    { casualHeartbeatGraceSeconds: 301 },
    { casualConfirmationTtlSeconds: 29 },
    { casualConfirmationTtlSeconds: 301 },
  ])('rejects an out-of-range timeout setting before querying', async (overrides) => {
    const battleTimeouts =
      'doubleDisconnectNoContestWindowSeconds' in overrides
        ? { ...DEFAULT_SETTINGS.battleTimeouts, ...overrides }
        : DEFAULT_SETTINGS.battleTimeouts;
    const roomLifecycle =
      'doubleDisconnectNoContestWindowSeconds' in overrides
        ? DEFAULT_SETTINGS.roomLifecycle
        : { ...DEFAULT_SETTINGS.roomLifecycle, ...overrides };

    await expect(
      new BattleTimeoutConfigService().updateConfig(
        { battleTimeouts, roomLifecycle },
        'admin-1'
      )
    ).rejects.toBeInstanceOf(BattleTimeoutConfigServiceError);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
