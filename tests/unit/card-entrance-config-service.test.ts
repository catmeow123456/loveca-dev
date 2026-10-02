import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/server/db/pool.js', () => ({ pool: { query: mocks.query } }));
import { CardEntranceConfigService } from '../../src/server/services/card-entrance-config-service';
beforeEach(() => {
  mocks.query.mockReset();
});
it('defaults open without a singleton row and persists only the entrance field', async () => {
  const service = new CardEntranceConfigService();
  mocks.query.mockResolvedValueOnce({ rows: [] });
  expect(await service.getConfig()).toEqual({ enabled: true });
  mocks.query.mockResolvedValueOnce({ rows: [{ card_entrance_enabled: false }] });
  expect(await service.updateConfig({ enabled: false }, 'admin')).toEqual({ enabled: false });
  expect(mocks.query).toHaveBeenLastCalledWith(
    expect.stringContaining('card_entrance_enabled = EXCLUDED.card_entrance_enabled'),
    [false, 'admin']
  );
  expect(await service.isEnabled()).toBe(false);
  expect(mocks.query).toHaveBeenCalledTimes(2);
});
it('rejects nonboolean writes and does not treat DB failure as enabled', async () => {
  const service = new CardEntranceConfigService();
  await expect(service.updateConfig({ enabled: 'false' } as never, 'admin')).rejects.toThrow();
  expect(mocks.query).not.toHaveBeenCalled();
  mocks.query.mockRejectedValue(new Error('offline'));
  expect(await service.isEnabled()).toBe(false);
  await expect(service.getConfig()).rejects.toThrow('offline');
});
it('a late pre-save read cannot reopen the disabled switch', async () => {
  const service = new CardEntranceConfigService();
  let resolve!: (value: unknown) => void;
  mocks.query.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    })
  );
  const old = service.isEnabled();
  mocks.query.mockResolvedValueOnce({ rows: [{ card_entrance_enabled: false }] });
  await service.updateConfig({ enabled: false }, 'admin');
  resolve({ rows: [{ card_entrance_enabled: true }] });
  expect(await old).toBe(false);
});
