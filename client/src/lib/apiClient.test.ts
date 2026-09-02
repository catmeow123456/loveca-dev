import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, setAccessToken } from './apiClient';

describe('apiClient cancellation', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      location: { protocol: 'http:', origin: 'http://localhost' },
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    setAccessToken(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports an external abort without retrying a safe GET', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const responsePromise = apiClient.get('/api/battle/match-records/test/replay', {
      signal: controller.signal,
    });
    controller.abort();

    await expect(responsePromise).resolves.toMatchObject({
      data: null,
      error: { code: 'ABORTED' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the external signal active while parsing the response body', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const response = {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true }
            );
          }),
      } as Response;
      return Promise.resolve(response);
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const responsePromise = apiClient.get('/api/battle/match-records/test/replay', {
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    await expect(responsePromise).resolves.toMatchObject({
      data: null,
      error: { code: 'ABORTED' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not start the delayed GET retry after cancellation', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('connection reset'));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const responsePromise = apiClient.get('/api/battle/match-records/test/replay', {
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    await expect(responsePromise).resolves.toMatchObject({
      data: null,
      error: { code: 'ABORTED' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not replay an aborted request after a shared token refresh', async () => {
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: null, error: { code: 'UNAUTHORIZED' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockReturnValueOnce(refreshResponse);
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const responsePromise = apiClient.get('/api/battle/match-records/test/replay', {
      signal: controller.signal,
    });
    while (fetchMock.mock.calls.length < 2) {
      await Promise.resolve();
    }
    controller.abort();

    await expect(responsePromise).resolves.toMatchObject({
      data: null,
      error: { code: 'ABORTED' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolveRefresh(
      new Response(JSON.stringify({ data: { accessToken: 'refreshed-token' }, error: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
