import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { performance } from 'node:perf_hooks';
import { EventEmitter } from 'node:events';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), release: vi.fn() }));
vi.mock('../../src/server/db/pool.js', () => ({
  pool: { connect: mocks.connect, totalCount: 20, idleCount: 0, waitingCount: 3 },
}));
import { connectWithDiagnostics, queryWithDiagnostics } from '../../src/server/db/diagnostics';
import { attachRequestContext } from '../../src/server/middleware/request-context';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue(
    Object.assign(new EventEmitter(), { query: mocks.query, release: mocks.release })
  );
  mocks.query.mockResolvedValue({ rows: [{ value: 1 }] });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function withinRequest<T>(id: string, action: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    attachRequestContext(
      { header: () => id } as unknown as Request,
      { setHeader: vi.fn() } as unknown as Response,
      () => {
        void action().then(resolve, reject);
      }
    );
  });
}

describe('startup database diagnostics', () => {
  it('handles a connection error during a query without leaking or returning the broken client', async () => {
    const client = Object.assign(new EventEmitter(), {
      query: mocks.query,
      release: mocks.release,
    });
    const error = new Error('connection lost');
    mocks.connect.mockResolvedValue(client);
    mocks.query.mockImplementation(() => {
      globalThis.queueMicrotask(() => client.emit('error', error));
      return new Promise(() => {});
    });
    await expect(queryWithDiagnostics('startup-config', 'SELECT 1', [])).rejects.toBe(error);
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(error);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('keeps successful reads quiet and always returns the connection', async () => {
    await expect(queryWithDiagnostics('startup-config', 'SELECT 1', [])).resolves.toEqual({
      rows: [{ value: 1 }],
    });
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('distinguishes connection acquisition failure, preserves the error and excludes sensitive text', async () => {
    const error = new Error('secret connection string');
    mocks.connect.mockRejectedValue(error);
    await expect(
      withinRequest('request-acquire', () => connectWithDiagnostics('auth-refresh'))
    ).rejects.toBe(error);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    const record: unknown = JSON.parse(String(vi.mocked(console.warn).mock.calls[0][0]));
    expect(record).toMatchObject({
      requestId: 'request-acquire',
      phase: 'acquire',
      outcome: 'error',
      databasePool: { total: 20, idle: 0, waiting: 3 },
    });
    expect(JSON.stringify(record)).not.toContain('secret');
  });

  it('logs query failure separately, returns the connection, and excludes SQL and arguments', async () => {
    const error = new Error('secret query error');
    mocks.query.mockRejectedValue(error);
    await expect(
      withinRequest('request-query', () =>
        queryWithDiagnostics('startup-config', 'secret SQL', ['secret argument'])
      )
    ).rejects.toBe(error);
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(console.warn).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledWith(error);
    const record: unknown = JSON.parse(String(vi.mocked(console.warn).mock.calls[0][0]));
    expect(record).toMatchObject({ requestId: 'request-query', phase: 'query', outcome: 'error' });
    expect(JSON.stringify(record)).not.toContain('secret');
  });

  it('records slow acquisition and execution as separate phases', async () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1100)
      .mockReturnValueOnce(1100)
      .mockReturnValueOnce(2400);
    await queryWithDiagnostics('startup-config', 'SELECT 1', []);
    const records = vi
      .mocked(console.warn)
      .mock.calls.map(([line]): unknown => JSON.parse(String(line)));
    expect(records).toMatchObject([
      { phase: 'acquire', outcome: 'slow', elapsedMs: 1100 },
      { phase: 'query', outcome: 'slow', elapsedMs: 1300 },
    ]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
