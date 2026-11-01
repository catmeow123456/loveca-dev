import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiClient, getAccessToken, setAccessToken } from './apiClient';
import { formatCatalogDiagnostics } from './appPerformance';

const json = (data: unknown = { cards: ['fixture'] }, status = 200) =>
  new Response(
    JSON.stringify({ data, error: status >= 400 ? { code: 'FORBIDDEN', message: '拒绝' } : null }),
    { status, headers: { 'content-type': 'application/json', 'x-request-id': 'request-123' } }
  );

function slowBody(_url: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve({
    status: 200,
    ok: true,
    headers: new Headers({ 'content-type': 'application/json', 'x-request-id': 'request-slow' }),
    text: () =>
      new Promise<string>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true }
        );
      }),
  } as Response);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    location: { origin: 'http://localhost', protocol: 'http:' },
    dispatchEvent: vi.fn(),
  });
});
afterEach(() => {
  setAccessToken(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('uses revalidation without credentials and does not refresh auth on public errors', async () => {
  setAccessToken('private-token');
  const fetcher = vi.fn().mockResolvedValue(json(null, 403));
  vi.stubGlobal('fetch', fetcher);
  await apiClient.getPublishedCards();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    credentials: 'omit',
    cache: 'no-cache',
    headers: {},
  });
  expect(getAccessToken()).toBe('private-token');
});

it('retries a slow body once, preserving request ID and the timeout diagnostic', async () => {
  const fetcher = vi.fn().mockImplementationOnce(slowBody).mockResolvedValueOnce(json());
  vi.stubGlobal('fetch', fetcher);
  const pending = apiClient.getPublishedCards();
  await vi.advanceTimersByTimeAsync(15_600);
  expect((await pending).error).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(formatCatalogDiagnostics()).attempts).toMatchObject([
    { outcome: 'TIMEOUT', phase: 'body', requestId: 'request-slow', elapsedMs: 15_000 },
    { outcome: 'SUCCESS', requestId: 'request-123' },
  ]);
  expect(vi.getTimerCount()).toBe(0);
});

it('stops after two slow bodies within the total budget', async () => {
  const fetcher = vi.fn(slowBody);
  vi.stubGlobal('fetch', fetcher);
  const pending = apiClient.getPublishedCards();
  await vi.advanceTimersByTimeAsync(31_000);
  expect(await pending).toMatchObject({
    data: null,
    requestId: 'request-slow',
    error: { code: 'TIMEOUT' },
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not start a retry if the total deadline has elapsed during a suspended wait', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
  const pending = apiClient.getPublishedCards();
  await vi.advanceTimersByTimeAsync(1);
  vi.setSystemTime(Date.now() + 40_000);
  await vi.advanceTimersByTimeAsync(600);
  expect(await pending).toMatchObject({ error: { code: 'TIMEOUT' } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['headers', 'body'])(
  'retries an interrupted %s transfer without adding another retry layer',
  async (phase) => {
    const fetcher = vi.fn();
    if (phase === 'headers') fetcher.mockRejectedValueOnce(new TypeError('network'));
    else
      fetcher.mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.reject(new TypeError('connection reset')),
      });
    fetcher.mockResolvedValueOnce(json());
    vi.stubGlobal('fetch', fetcher);
    const pending = apiClient.getPublishedCards();
    await vi.advanceTimersByTimeAsync(600);
    expect((await pending).error).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  }
);

it.each(['not-json', '<html>bad gateway</html>', 'null'])(
  'does not retry malformed content: %s',
  async (body) => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(body, {
        headers: { 'content-type': body.startsWith('<') ? 'text/html' : 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetcher);
    expect(await apiClient.getPublishedCards()).toMatchObject({
      error: { code: 'INVALID_RESPONSE' },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
);

it.each(['body', 'backoff'])('cancels during %s without another attempt', async (phase) => {
  const fetcher =
    phase === 'body' ? vi.fn(slowBody) : vi.fn().mockRejectedValue(new TypeError('network'));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const pending = apiClient.getPublishedCards({ signal: controller.signal });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  expect(await pending).toMatchObject({ error: { code: 'ABORTED' } });
  await vi.advanceTimersByTimeAsync(31_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('allows a manual cache reload and never includes tokens or navigation URLs in diagnostics', async () => {
  setAccessToken('private-token');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json()));
  await apiClient.getPublishedCards({ reload: true });
  expect(vi.mocked(fetch).mock.calls[0][1]?.cache).toBe('reload');
  const diagnostics = formatCatalogDiagnostics();
  expect(diagnostics).not.toContain('private-token');
  expect(diagnostics).not.toContain('http');
});

it('does not retry a timeout after receiving permission-error headers', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const response = await slowBody(url, init);
      return { ...response, status: 403, ok: false } as Response;
    })
  );
  const pending = apiClient.getPublishedCards();
  await vi.advanceTimersByTimeAsync(31_000);
  expect(await pending).toMatchObject({ data: null, status: 403 });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not accept a public error status as successful data even with a success-shaped envelope', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { cards: ['fixture'] }, error: null }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        })
      )
  );
  expect(await apiClient.getPublishedCards()).toMatchObject({
    data: null,
    error: { code: 'HTTP_ERROR' },
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps ordinary GET timeout and write-request retry policies unchanged', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    )
  );
  const pending = apiClient.get('/api/config');
  await vi.advanceTimersByTimeAsync(31_000);
  expect(await pending).toMatchObject({ error: { code: 'TIMEOUT' } });
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
  expect(await apiClient.post('/api/example-command', {})).toMatchObject({
    error: { code: 'NETWORK_ERROR' },
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
