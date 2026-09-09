import { describe, expect, it, vi } from 'vitest';
import {
  DashScopeAiBattleClient,
  readAiModelConfig,
} from '../../src/server/ai-battle/model-client';
import { AiBattleTraceStore } from '../../src/server/ai-battle/trace-store';
import type { AiFrozenKnowledge } from '../../src/server/ai-battle/presets';
import type { AiDecisionInput } from '../../src/server/ai-battle/protocol';
import { redactAiText, serializeAiEvidence } from '../../src/server/ai-battle/redaction';
import { fromTransport } from '../../src/online/serde';

const KEY = 'test-api-key-never-export';
const config = () =>
  readAiModelConfig({
    AI_BATTLE_BASE_URL: 'https://workspace.example/compatible-mode/v1',
    AI_BATTLE_MODEL: 'test-qwen',
    AI_BATTLE_API_KEY: KEY,
  });
const context = { matchId: 'm', taskId: '1', revision: 2, windowKey: 'MAIN', attempt: 0 };
const input: AiDecisionInput = {
  purpose: 'MAIN',
  state: {
    table: { zones: {} } as AiDecisionInput['state']['table'],
    objects: {},
    turn: 1,
    phase: 'MAIN_PHASE',
    subPhase: 'NONE',
    selfSeat: 'SECOND',
    selfResources: {
      handCards: [],
      handLiveCount: 0,
      stageMembers: [],
      stageHeartCounts: {},
      stageHeartTotal: 0,
      activeMemberBladeTotal: 0,
      activeEnergyCount: 0,
      successfulLiveCount: 0,
    },
    firstSeat: 'FIRST',
    activeSeat: 'SECOND',
  },
  space: { kind: 'ACTION', candidates: [{ ref: 'a1', description: '完成主要阶段' }] },
  responseSchema: { type: 'object' },
};
const response = (
  text = '{"selection":{"kind":"ACTION","actionRef":"a1"}}',
  finishReason = 'stop'
) =>
  new Response(
    JSON.stringify({
      id: 'request-1',
      choices: [{ message: { content: text }, finish_reason: finishReason }],
    }),
    { status: 200 }
  );
function fixture(fetcher: typeof globalThis.fetch) {
  const knowledge = Object.fromEntries(
    ['rules', 'tutorial', 'handbook', 'ownDeck'].map((id) => [
      id,
      {
        id,
        title: id,
        source: `assets/${id}`,
        sha256: 'frozen-hash',
        content: `frozen ${id}`,
      },
    ])
  ) as unknown as AiFrozenKnowledge;
  const store = new AiBattleTraceStore();
  const mutableConfig = { ...config() };
  const client = new DashScopeAiBattleClient(mutableConfig, knowledge, store, fetcher);
  store.open('m', [
    knowledge.rules,
    knowledge.tutorial,
    knowledge.handbook,
    knowledge.ownDeck,
    client.configurationMaterial,
  ]);
  store.begin('m', { id: '1', revision: 2, windowKey: 'MAIN', purpose: 'MAIN', seat: 'SECOND' });
  return { client, store, mutableConfig, knowledge };
}

describe('AI model HTTP boundary', () => {
  it('uses only dedicated configuration, excludes URL credentials and validates behavior parameters', () => {
    expect(() => readAiModelConfig({ DASHSCOPE_API_KEY: KEY })).toThrow('AI 对战专用');
    for (const url of [
      'http://workspace.example/compatible-mode/v1',
      'https://user:pass@workspace.example/compatible-mode/v1',
      'https://workspace.example/compatible-mode/v1?key=x',
      'https://workspace.example/v1',
    ]) {
      expect(() =>
        readAiModelConfig({
          AI_BATTLE_BASE_URL: url,
          AI_BATTLE_MODEL: 'test',
          AI_BATTLE_API_KEY: KEY,
        })
      ).toThrow();
    }
    expect(config()).toMatchObject({
      endpoint: 'https://workspace.example/compatible-mode/v1/chat/completions',
      temperature: 0.2,
      maxTokens: 2048,
    });
  });

  it('captures the transmitted body and frozen sources/configuration, without authorization or prior responses', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response());
    const { client, store, mutableConfig, knowledge } = fixture(fetcher);
    mutableConfig.model = 'changed-model';
    Object.assign(knowledge.handbook, { content: 'new handbook' });
    const signal = new AbortController().signal;
    expect(await client.decide(input, signal, context)).toMatchObject({
      kind: 'RESPONSE',
      truncated: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetcher.mock.calls[0]!;
    expect(endpoint).toBe(config().endpoint);
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { Authorization: `Bearer ${KEY}` },
    });
    const body = JSON.parse(init!.body as string) as {
      model: string;
      messages: { role: string; content: string }[];
      response_format: unknown;
      enable_thinking: boolean;
    };
    expect(body.model).toBe('test-qwen');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.enable_thinking).toBe(false);
    expect(body.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'user',
      'user',
      'user',
      'user',
    ]);
    expect(body.messages[3]!.content).toContain('frozen handbook');
    expect(body.messages.at(-1)!.content).toContain(JSON.stringify(input));
    const bundle = store.export('m')!;
    const requestEvent = bundle.decisions[0]!.events.find((event) => event.stage === 'REQUEST')!;
    const evidence = JSON.parse(
      bundle.materials.find((item) => item.id === requestEvent.materialId)!.content!
    ) as { body: string };
    expect(evidence.body).toBe(init!.body);
    expect(JSON.stringify(bundle)).not.toContain(KEY);
    expect(JSON.stringify(bundle)).not.toContain('new handbook');
    expect(bundle.decisions[0]!.pendingAttempts).toEqual([]);
  });

  it.each([
    [401, false],
    [400, false],
    [429, true],
    [503, true],
  ])('classifies HTTP %s without retrying inside the client', async (status, retryable) => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(`bad credential: ${KEY}`, { status }));
    const { client, store } = fixture(fetcher);
    expect(await client.decide(input, new AbortController().signal, context)).toEqual({
      kind: 'SERVICE_ERROR',
      message: `Model HTTP ${status}`,
      retryable,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const bundle = JSON.stringify(store.export('m'));
    expect(bundle).not.toContain(KEY);
    expect(bundle).toContain('[REDACTED]');
    expect(bundle).toContain('rawBody');
  });

  it('keeps invalid/empty model output and upstream length truncation distinct from service-envelope failure', async () => {
    for (const [reply, expected] of [
      [response('not-json'), { kind: 'RESPONSE', text: 'not-json', truncated: false }],
      [response(''), { kind: 'RESPONSE', text: '', truncated: false }],
      [response('{"selection":{}}', 'length'), { kind: 'RESPONSE', truncated: true }],
      [new Response('not an envelope'), { kind: 'SERVICE_ERROR', retryable: false }],
    ] as const) {
      const { client } = fixture(vi.fn<typeof globalThis.fetch>().mockResolvedValue(reply));
      expect(await client.decide(input, new AbortController().signal, context)).toMatchObject(
        expected
      );
    }
  });

  it('bounds streaming HTTP bytes independently of Content-Length and records the discarded suffix', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('中'.repeat(200_000)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { client, store } = fixture(
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(stream, { headers: { 'Content-Length': '1' } }))
    );
    expect(await client.decide(input, new AbortController().signal, context)).toMatchObject({
      kind: 'SERVICE_ERROR',
      retryable: false,
    });
    expect(cancelled).toBe(true);
    const bundle = store.export('m')!;
    expect(bundle.materials.every((item) => item.retainedBytes <= 256 * 1024)).toBe(true);
    // The response material can itself exceed the evidence item limit; its truncation is explicit.
    expect(bundle.incompleteMaterialIds.length).toBeGreaterThan(0);
    const metadata = bundle.materials.find((item) => item.title === 'RESPONSE')!;
    expect(metadata.status).toBe('COMPLETE');
    expect(JSON.parse(metadata.content!)).toMatchObject({ bodyReadLimitExceeded: true });
  });

  it('redacts a credential cut off by the HTTP byte limit and reports that boundary separately', async () => {
    const body = 'x'.repeat(256 * 1024 - 8) + KEY + 'suffix';
    const { client, store } = fixture(
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body))
    );
    await client.decide(input, new AbortController().signal, context);
    const bundle = store.export('m')!;
    const metadata = bundle.materials.find((item) => item.title === 'RESPONSE')!;
    expect(JSON.parse(metadata.content!)).toMatchObject({
      bodyReadLimitExceeded: true,
      trailingCredentialRedacted: true,
    });
    expect(JSON.stringify(bundle)).not.toContain(KEY.slice(0, 8));
  });

  it('does not change request messages or parameters on the allowed service retry', async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('retry later', { status: 503 }))
      .mockResolvedValueOnce(response());
    const { client, store } = fixture(fetcher);
    await client.decide(input, new AbortController().signal, context);
    await client.decide(input, new AbortController().signal, { ...context, attempt: 1 });
    expect(fetcher.mock.calls[0]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body);
    expect(
      store.export('m')!.decisions[0]!.events.filter((event) => event.stage === 'REQUEST')
    ).toHaveLength(2);
  });

  it('rejects oversized fixed knowledge before registering or requesting a model', () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    const { store, knowledge } = fixture(fetcher);
    const large = {
      ...knowledge,
      handbook: { ...knowledge.handbook, content: 'x'.repeat(300_000) },
    };
    expect(() => new DashScopeAiBattleClient(config(), large, store, fetcher)).toThrow('固定知识');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('records a response arriving after cancellation on the original attempt, even after session end', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn<typeof globalThis.fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { client, store } = fixture(fetcher);
    const controller = new AbortController();
    const pending = client.decide(input, controller.signal, context);
    controller.abort();
    store.end('m');
    const revision = store.list('m')!.revision;
    finish(response('late selection'));
    await pending;
    const bundle = store.export('m')!;
    expect(bundle.revision).toBeGreaterThan(revision);
    expect(bundle.decisions[0]!.pendingAttempts).toEqual([]);
    const raw = bundle.materials.find((item) => item.title === 'RESPONSE_BODY')!.content!;
    expect(raw).toContain('late selection');
    const metadata = bundle.materials.find((item) => item.title === 'RESPONSE')!.content!;
    expect(JSON.parse(metadata)).toMatchObject({ attempt: 0, cancelled: true });
  });

  it('does not dispatch a cancelled task or an oversized context', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    const { client, store } = fixture(fetcher);
    const controller = new AbortController();
    controller.abort();
    await client.decide(input, controller.signal, context);
    const largeInput = { ...input, effect: { effectText: 'x'.repeat(600_000), stepText: '' } };
    expect(await client.decide(largeInput, new AbortController().signal, context)).toMatchObject({
      kind: 'ADAPTER_ERROR',
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.export('m')!.decisions[0]!.events.map((event) => event.stage)).toEqual([
      'ASSEMBLY_FAILED',
    ]);
  });

  it('keeps diagnostic capture faults from causing a repeated request', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response());
    const { client, store } = fixture(fetcher);
    vi.spyOn(store, 'append').mockImplementation(() => {
      throw new Error('capture failed');
    });
    expect(await client.decide(input, new AbortController().signal, context)).toMatchObject({
      kind: 'RESPONSE',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.list('m')!.captureFailures).toBe(3);
  });

  it('redacts credential fields, free text and known key encodings while retaining harmless model parameters', () => {
    const serialized = serializeAiEvidence({
      Authorization: 'Bearer key',
      api_key: 'key',
      max_tokens: 2048,
      raw: 'Authorization: Bearer private-key\nAPI_KEY=other-key',
    });
    expect(serialized.text).not.toContain('private-key');
    expect(serialized.text).not.toContain('other-key');
    expect(JSON.parse(serialized.text)).toMatchObject({
      Authorization: '[REDACTED]',
      api_key: '[REDACTED]',
      max_tokens: 2048,
    });
    expect(redactAiText('secret/a secret%2Fa', ['secret/a'])).toEqual({
      text: '[REDACTED] [REDACTED]',
      count: 2,
    });
    const command = { judgmentResults: new Map([['live-object', true]]) };
    expect(fromTransport(JSON.parse(serializeAiEvidence(command).text))).toEqual(command);
  });
});
