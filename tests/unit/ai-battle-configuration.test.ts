import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setup, decision } from '../helpers/ai-battle-fixture';
import { createMemoryAiBilling } from '../helpers/ai-battle-billing';
import { AiBattleBilling } from '../../src/server/ai-battle/billing';
import { AiBattleTraceStore } from '../../src/server/ai-battle/trace-store';
import { AiEffectExtractionServiceError } from '../../src/server/services/ai-effect-extraction-service';
import {
  createPlatformAiBattleClient,
  readAiModelConfig,
} from '../../src/server/ai-battle/configuration';

const platform = vi.hoisted(() => ({ read: vi.fn(), validate: vi.fn() }));
vi.mock('../../src/server/services/ai-effect-extraction-service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/server/services/ai-effect-extraction-service')>();
  return {
    ...actual,
    aiEffectExtractionService: {
      getUpstreamConfiguration: platform.read,
      validateOutboundUrl: platform.validate,
    },
  };
});

const knowledge = Object.fromEntries(
  ['rules', 'tutorial', 'handbook', 'ownDeck'].map((id) => [
    id,
    { id, title: id, source: 'test', sha256: 'hash', content: id },
  ])
) as Parameters<typeof createPlatformAiBattleClient>[0];
const input = () => decision(setup().session).input;
const context = { matchId: 'm', taskId: '1', revision: 1, windowKey: 'main', attempt: 0 };
const response = () =>
  new Response(
    JSON.stringify({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 8,
        prompt_tokens_details: { cached_tokens: 20 },
      },
      choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
    })
  );

beforeEach(() => {
  platform.read
    .mockReset()
    .mockResolvedValue({ baseUrl: 'https://api.example.com/v1', apiKey: 'platform-secret' });
  platform.validate.mockReset().mockResolvedValue(new URL('https://api.example.com/v1'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function createClient() {
  const store = new AiBattleTraceStore();
  const billing = new AiBattleBilling(
    'qwen3.8-flash',
    createMemoryAiBilling().persistence,
    () => undefined
  );
  const client = await createPlatformAiBattleClient(knowledge, store, 'qwen3.8-flash', billing);
  store.open('m', [
    knowledge.rules,
    knowledge.tutorial,
    knowledge.handbook,
    knowledge.ownDeck,
    client.configurationMaterial,
  ]);
  store.begin('m', { id: '1', revision: 1, windowKey: 'main', seat: 'FIRST', purpose: 'MAIN' });
  await billing.initialize('m');
  return { client, store, billing };
}

describe('platform AI battle configuration', () => {
  it('sends the platform URL/key with the selected battle model and freezes them for an existing game', async () => {
    vi.stubEnv('AI_BATTLE_BASE_URL', 'https://legacy.example/v1');
    vi.stubEnv('AI_BATTLE_API_KEY', 'legacy-secret');
    const fetcher = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response()));
    vi.stubGlobal('fetch', fetcher);
    const first = await createClient();
    platform.read.mockResolvedValue({
      baseUrl: 'https://api.example.com/next/v1',
      apiKey: 'changed-secret',
    });
    const next = await createClient();
    await first.client.decide(input(), new AbortController().signal, context);
    await next.client.decide(input(), new AbortController().signal, context);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.com/v1/chat/completions',
      'https://api.example.com/next/v1/chat/completions',
    ]);
    expect(
      fetcher.mock.calls.map(([, init]) => new Headers(init?.headers).get('Authorization'))
    ).toEqual(['Bearer platform-secret', 'Bearer changed-secret']);
    for (const [, init] of fetcher.mock.calls) {
      expect(typeof init?.body).toBe('string');
      expect(JSON.parse(init?.body as string)).toMatchObject({ model: 'qwen3.8-flash' });
    }
    expect(first.billing.view().reportedAttempts).toBe(1);
    expect(platform.validate).toHaveBeenCalledWith('https://api.example.com/v1/chat/completions');
    expect(JSON.stringify(first.store.export('m'))).not.toContain('platform-secret');
    expect(JSON.stringify(next.store.export('m'))).not.toContain('changed-secret');
  });

  it('fails closed when the platform configuration cannot load instead of using old environment credentials', async () => {
    vi.stubEnv('AI_BATTLE_BASE_URL', 'https://legacy.example/v1');
    vi.stubEnv('AI_BATTLE_API_KEY', 'legacy-secret');
    platform.read.mockRejectedValue(
      new AiEffectExtractionServiceError(
        'AI_EFFECT_CONFIG_KEY_REQUIRED',
        '平台 AI 配置没有可用的 API Key',
        503
      )
    );
    await expect(readAiModelConfig('qwen3.8-flash')).rejects.toMatchObject({
      code: 'AI_MODEL_CONFIG_INVALID',
      statusCode: 503,
    });
  });

  it('rechecks a frozen endpoint before every request and does not count a blocked request as a billable attempt', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response()));
    vi.stubGlobal('fetch', fetcher);
    const f = await createClient();
    await f.client.decide(input(), new AbortController().signal, context);
    platform.validate.mockRejectedValue(new Error('private address'));
    expect(await f.client.decide(input(), new AbortController().signal, context)).toMatchObject({
      kind: 'ADAPTER_ERROR',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(f.billing.view()).toMatchObject({ attempts: 1, reportedAttempts: 1 });
  });

  it('classifies a host-resolution failure as a retryable service fault, not a permanent adapter fault', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response()));
    vi.stubGlobal('fetch', fetcher);
    const f = await createClient();
    platform.validate.mockRejectedValue(
      new AiEffectExtractionServiceError(
        'AI_EFFECT_HOST_RESOLUTION_FAILED',
        '无法解析 AI 上游主机',
        422
      )
    );
    expect(await f.client.decide(input(), new AbortController().signal, context)).toMatchObject({
      kind: 'SERVICE_ERROR',
      retryable: true,
    });
    // Policy rejections still fail closed.
    platform.validate.mockRejectedValue(
      new AiEffectExtractionServiceError(
        'AI_EFFECT_HOST_NOT_ALLOWED',
        '该 AI 上游主机不在部署白名单中',
        422
      )
    );
    expect(await f.client.decide(input(), new AbortController().signal, context)).toMatchObject({
      kind: 'ADAPTER_ERROR',
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(f.billing.view()).toMatchObject({ attempts: 0, reportedAttempts: 0 });
  });
});
