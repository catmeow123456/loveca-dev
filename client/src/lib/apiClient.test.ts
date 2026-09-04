import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, setAccessToken } from './apiClient';

describe('apiClient', () => {
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

  it('reports byte progress for multipart uploads', async () => {
    const xhr = new FakeUploadRequest({
      status: 201,
      response: { data: { uploaded: true }, error: null },
    });
    vi.stubGlobal(
      'XMLHttpRequest',
      class {
        constructor() {
          return xhr;
        }
      }
    );
    setAccessToken('upload-token');
    const progress: Array<{ loaded: number; total: number | null; percent: number | null }> = [];

    const response = await apiClient.upload<{ uploaded: true }>('/api/upload', new FormData(), {
      onProgress: (nextProgress) => progress.push(nextProgress),
    });

    expect(response).toMatchObject({ data: { uploaded: true }, error: null, status: 201 });
    expect(progress).toEqual([{ loaded: 5, total: 10, percent: 50 }]);
    expect(xhr.requestHeaders).toMatchObject({ Authorization: 'Bearer upload-token' });
    expect(xhr.withCredentials).toBe(true);
  });

  it('does not send a multipart upload that was already cancelled', async () => {
    const xhr = new FakeUploadRequest({
      status: 201,
      response: { data: { uploaded: true }, error: null },
    });
    vi.stubGlobal(
      'XMLHttpRequest',
      class {
        constructor() {
          return xhr;
        }
      }
    );
    const controller = new AbortController();
    controller.abort();

    const response = await apiClient.upload('/api/upload', new FormData(), {
      signal: controller.signal,
    });

    expect(response).toMatchObject({ data: null, error: { code: 'ABORTED' } });
    expect(xhr.sendCount).toBe(0);
  });
});

type FakeEventListener = (event: {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}) => void;

class FakeUploadEventTarget {
  private readonly listeners = new Map<string, FakeEventListener[]>();

  addEventListener(name: string, listener: FakeEventListener): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  emit(name: string, event = { lengthComputable: false, loaded: 0, total: 0 }): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

class FakeUploadRequest extends FakeUploadEventTarget {
  readonly upload = new FakeUploadEventTarget();
  readonly requestHeaders: Record<string, string> = {};
  readonly status: number;
  readonly responseText: string;
  withCredentials = false;
  timeout = 0;
  sendCount = 0;

  constructor(input: { readonly status: number; readonly response: unknown }) {
    super();
    this.status = input.status;
    this.responseText = JSON.stringify(input.response);
  }

  open(): void {}

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders[name] = value;
  }

  getResponseHeader(name: string): string | null {
    return name.toLowerCase() === 'content-type' ? 'application/json' : null;
  }

  send(): void {
    this.sendCount += 1;
    this.upload.emit('progress', { lengthComputable: true, loaded: 5, total: 10 });
    this.emit('load');
  }

  abort(): void {
    this.emit('abort');
  }
}
