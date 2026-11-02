import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { RequestOptions } from 'node:https';

interface ProbeResponse {
  statusCode: number;
  headers: Record<string, string>;
  resume: () => void;
  on: () => void;
}
const mocks = vi.hoisted(() => ({
  request:
    vi.fn<
      (url: URL, options: RequestOptions, callback: (response: ProbeResponse) => void) => unknown
    >(),
  lookup: vi.fn(),
}));
vi.mock('node:https', async (original) => ({
  ...(await original<typeof import('node:https')>()),
  request: mocks.request,
}));
vi.mock('node:dns/promises', async (original) => ({
  ...(await original<typeof import('node:dns/promises')>()),
  lookup: mocks.lookup,
}));
import {
  inspectImageLink,
  inspectCandidateImage,
  type CloudBaseApp,
} from '../../src/scripts/sync-cards-cloudbase-new';

describe('preview image transport', () => {
  const app = {} as CloudBaseApp;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  });

  function respond(statusCode: number, headers: Record<string, string>) {
    const response = { statusCode, headers, resume: vi.fn(), on: vi.fn() };
    mocks.request.mockImplementation((_url, _options, callback) => ({
      on: vi.fn(),
      end: () => callback(response),
    }));
    return response;
  }

  it('uses only HEAD, with a deadline and pinned DNS, without reading or decoding an image body', async () => {
    const response = respond(200, { 'content-type': 'image/png', 'content-length': '500000' });
    await inspectImageLink(app, 'https://images.example.test/card.png');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const options = mocks.request.mock.calls[0][1];
    expect(options.method).toBe('HEAD');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const lookupResult = vi.fn();
    options.lookup!('images.example.test', { family: 4 }, lookupResult);
    expect(lookupResult).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    expect(response.on).not.toHaveBeenCalled();
  });

  it('reports unsupported HEAD without silently falling back to a full download', async () => {
    respond(405, {});
    await expect(inspectImageLink(app, 'https://images.example.test/card.png')).rejects.toThrow(
      '405'
    );
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][1].method).toBe('HEAD');
  });

  it('rejects HTML placeholders during the light check', async () => {
    respond(200, { 'content-type': 'text/html' });
    await expect(inspectImageLink(app, 'https://images.example.test/card.png')).rejects.toThrow(
      'non-image'
    );
  });

  it('fully decodes images only when requested and rejects an invalid body', async () => {
    const png = await sharp({ create: { width: 32, height: 64, channels: 3, background: 'white' } })
      .png()
      .toBuffer();
    await expect(inspectCandidateImage(app, 'image', () => Promise.resolve(png))).resolves.toEqual({
      width: 32,
      height: 64,
    });
    await expect(
      inspectCandidateImage(app, 'image', () => Promise.resolve(Buffer.from('not an image')))
    ).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
