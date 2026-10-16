import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CasualTableCurrentView } from '../../src/online/casual-table-types';
const client = vi.hoisted(() => ({ getCasualCurrent: vi.fn(), casualWrite: vi.fn() }));
vi.mock('@/lib/casualTableClient', () => client);
import { useCasualTableStore as store } from '../../client/src/store/casualTableStore';
const idle: CasualTableCurrentView = { table: null, otherParticipation: null };
const other: CasualTableCurrentView = {
  table: null,
  otherParticipation: {
    kind: 'RANKED_QUEUE',
    destination: 'ranked',
    roomGeneration: null,
    matchId: null,
  },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  store.getState().setUser(null);
  vi.resetAllMocks();
});
describe('casual coordinator', () => {
  it('coalesces reads and resets the private view on account changes', async () => {
    client.getCasualCurrent.mockResolvedValue(other);
    store.getState().setUser('a');
    await Promise.all([store.getState().refresh(), store.getState().refresh()]);
    expect(client.getCasualCurrent).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toEqual(other);
    store.getState().setUser('b');
    expect(store.getState()).toMatchObject({ status: null, hydrated: false });
  });
  it('rejects a late read even after logout and login as the same account', async () => {
    const old = deferred<CasualTableCurrentView>();
    client.getCasualCurrent.mockReturnValueOnce(old.promise).mockResolvedValue(idle);
    store.getState().setUser('a');
    const pending = store.getState().refresh();
    store.getState().setUser(null);
    store.getState().setUser('a');
    await store.getState().refresh();
    old.resolve(other);
    await pending;
    expect(store.getState().status).toEqual(idle);
  });
  it('does not let a pre-mutation read overwrite its authoritative result', async () => {
    const old = deferred<CasualTableCurrentView>();
    client.getCasualCurrent.mockReturnValueOnce(old.promise).mockResolvedValue(other);
    client.casualWrite.mockResolvedValue({});
    store.getState().setUser('a');
    const pending = store.getState().refresh();
    await store.getState().mutate('find', {});
    old.resolve(idle);
    await pending;
    expect(store.getState().status).toEqual(other);
  });
  it('serializes writes and refreshes committed state after an ambiguous failure', async () => {
    const write = deferred<void>();
    client.casualWrite
      .mockReturnValueOnce(write.promise)
      .mockRejectedValueOnce(new Error('response lost'));
    client.getCasualCurrent.mockResolvedValue(other);
    store.getState().setUser('a');
    const pending = store.getState().mutate('find', {});
    const refresh = store.getState().refresh();
    await expect(store.getState().mutate('cancel', {})).rejects.toThrow('上一项操作');
    expect(client.getCasualCurrent).not.toHaveBeenCalled();
    write.resolve();
    await Promise.all([pending, refresh]);
    await expect(store.getState().mutate('cancel', {})).rejects.toThrow('response lost');
    expect(store.getState()).toMatchObject({ status: other, busy: false, error: 'response lost' });
  });
  it('ignores a mutation from the previous user', async () => {
    const write = deferred<void>();
    client.casualWrite.mockReturnValue(write.promise);
    store.getState().setUser('a');
    const pending = store.getState().mutate('find', {});
    store.getState().setUser('b');
    write.resolve();
    await pending;
    expect(client.getCasualCurrent).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ status: null, busy: false, hydrated: false });
  });
});
