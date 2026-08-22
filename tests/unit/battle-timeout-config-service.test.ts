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

describe('BattleTimeoutConfigService', () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it('returns platform defaults when the singleton row does not exist', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await expect(new BattleTimeoutConfigService().getConfig()).resolves.toEqual({
      playerActionTimeoutSeconds: 180,
      reconnectGracePeriodSeconds: 60,
    });
  });

  it('updates both global fields in the singleton row', async () => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          player_action_timeout_seconds: 240,
          reconnect_grace_period_seconds: 90,
        },
      ],
    });

    const result = await new BattleTimeoutConfigService().updateConfig(
      {
        playerActionTimeoutSeconds: 240,
        reconnectGracePeriodSeconds: 90,
      },
      'admin-1'
    );

    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (id)'), [
      240,
      90,
      'admin-1',
    ]);
    expect(result).toEqual({
      playerActionTimeoutSeconds: 240,
      reconnectGracePeriodSeconds: 90,
    });
  });

  it.each([
    { playerActionTimeoutSeconds: 59, reconnectGracePeriodSeconds: 60 },
    { playerActionTimeoutSeconds: 180, reconnectGracePeriodSeconds: 301 },
  ])('rejects an out-of-range config before querying', async (input) => {
    await expect(
      new BattleTimeoutConfigService().updateConfig(input, 'admin-1')
    ).rejects.toBeInstanceOf(BattleTimeoutConfigServiceError);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
