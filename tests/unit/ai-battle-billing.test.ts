import { describe, expect, it, vi } from 'vitest';
import {
  AiBattleBilling,
  calculateAiCost,
  createAiBillingRecord,
  parseAiTokenUsage,
  projectAiBilling,
} from '../../src/server/ai-battle/billing';
import { AiBattleTraceStore, AI_TRACE_LIMITS } from '../../src/server/ai-battle/trace-store';
import { createMemoryAiBilling } from '../helpers/ai-battle-billing';
import {
  API_AI_BATTLE_MODELS,
  API_MODEL_METADATA,
} from '../../src/online/ai-battle-model-registry';

const rawUsage = {
  prompt_tokens: 47205,
  completion_tokens: 81,
  prompt_tokens_details: { cached_tokens: 17408 },
};
const usage = parseAiTokenUsage(rawUsage, 'qwen3.8-max')!;

describe('AI Beijing token accounting', () => {
  it('uses disjoint input buckets and exact prices for the Qwen models', () => {
    const max = createAiBillingRecord('qwen3.8-max');
    const flash = createAiBillingRecord('qwen3.8-flash');
    expect(usage).toEqual({
      inputTokens: 29797,
      implicitCachedTokens: 17408,
      explicitCachedTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 81,
    });
    expect(calculateAiCost(usage, max.prices)).toBe('0.38659200');
    expect(calculateAiCost(usage, flash.prices)).toBe('0.02579710');
    expect(max.pricingDate).toBe('2026-09-11');
    expect(flash.pricingDate).toBe('2026-09-11');
    const explicit = parseAiTokenUsage(
      {
        prompt_tokens: 1600,
        completion_tokens: 100,
        prompt_tokens_details: {
          cached_tokens: 1200,
          cache_creation_input_tokens: 300,
          cache_type: 'ephemeral',
        },
        completion_tokens_details: { reasoning_tokens: 50 },
        total_tokens: 1700,
      },
      'qwen3.8-max'
    )!;
    expect(calculateAiCost(explicit, max.prices)).toBe('0.01050000');
    // Flash creation is 1.25 CNY/1M, not 0.8 * 125%.
    expect(calculateAiCost(explicit, flash.prices)).toBe('0.00084500');
  });

  it.each([
    ['glm-5.3', '2026-09-18'],
    ['glm-5.2', '2026-09-14'],
  ] as const)(
    'prices %s input, implicit cache and output using its own dated snapshot',
    (model, pricingDate) => {
      const record = createAiBillingRecord(model);
      expect(record).toMatchObject({
        model,
        pricingDate,
        prices: { inputTokens: 800, implicitCachedTokens: 200, outputTokens: 2800 },
      });
      expect(parseAiTokenUsage(rawUsage, model)).toEqual(usage);
      expect(calculateAiCost(usage, record.prices)).toBe('0.27546000');
    }
  );

  it('prices DeepSeek ordinary input, implicit cache and output at the Beijing peak rates', () => {
    const record = createAiBillingRecord('deepseek-v4.1-flash');
    expect(record).toMatchObject({
      model: 'deepseek-v4.1-flash',
      pricingDate: '2026-09-14',
      prices: { inputTokens: 200, implicitCachedTokens: 20, outputTokens: 800 },
    });
    expect(parseAiTokenUsage(rawUsage, 'deepseek-v4.1-flash')).toEqual(usage);
    expect(calculateAiCost(usage, record.prices)).toBe('0.06372360');
  });

  it.each(
    API_AI_BATTLE_MODELS.filter((id) => API_MODEL_METADATA[id].cacheBilling === 'implicit-only')
  )('leaves unsupported %s explicit-cache usage unknown instead of charging zero', (model) => {
    const explicit = {
      prompt_tokens: 1600,
      completion_tokens: 100,
      prompt_tokens_details: {
        cached_tokens: 1200,
        cache_creation_input_tokens: 300,
        cache_type: 'ephemeral',
      },
    };
    expect(parseAiTokenUsage(explicit, model)).toBeNull();
    expect(parseAiTokenUsage(explicit, 'qwen3.8-max')).not.toBeNull();
    expect(parseAiTokenUsage(explicit, 'qwen3.8-flash')).not.toBeNull();
  });

  it.each([
    undefined,
    {},
    { ...rawUsage, completion_tokens: -1 },
    { ...rawUsage, completion_tokens: 1.5 },
    { ...rawUsage, prompt_tokens_details: {} },
    { ...rawUsage, prompt_tokens_details: { cached_tokens: 48000 } },
    { ...rawUsage, prompt_tokens_details: { cached_tokens: 0, cache_creation_input_tokens: 4 } },
    { ...rawUsage, prompt_tokens_details: { cached_tokens: 0, cache_type: 'ephemeral' } },
    {
      ...rawUsage,
      prompt_tokens_details: {
        cached_tokens: 17408,
        cache_creation_input_tokens: 47000,
        cache_type: 'ephemeral',
      },
    },
    { input_tokens: 47205, output_tokens: 81, cache_read_input_tokens: 17408 },
  ])('leaves missing, contradictory and other-protocol usage unknown: %j', (value) => {
    expect(parseAiTokenUsage(value, 'qwen3.8-max')).toBeNull();
  });

  it('accumulates tiny costs before rounding and keeps the game price snapshot', async () => {
    const memory = createMemoryAiBilling();
    const billing = new AiBattleBilling('qwen3.8-flash', memory.persistence, () => {});
    await billing.initialize('m');
    const tiny = parseAiTokenUsage(
      {
        prompt_tokens: 1,
        completion_tokens: 1,
        prompt_tokens_details: { cached_tokens: 0 },
      },
      'qwen3.8-flash'
    )!;
    for (let i = 0; i < 20; i++) await (await billing.begin(String(i))).finish(tiny);
    expect(billing.view()).toMatchObject({
      attempts: 20,
      reportedAttempts: 20,
      estimatedCny: '0.00007000',
    });
    const persisted = memory.records.get('m')!;
    expect(projectAiBilling(persisted)).toMatchObject({
      estimatedCny: '0.00007000',
      model: 'qwen3.8-flash',
    });
    expect(
      projectAiBilling({ ...persisted, prices: { ...persisted.prices, outputTokens: 1000 } })
        .estimatedCny
    ).toBe('0.00021600');
  });

  it('exposes unconfirmed usage when the upstream omits prompt_tokens_details', async () => {
    // OpenAI-compatible upstreams without cache details never parse; the attempt still costs.
    const unparseable = { prompt_tokens: 47205, completion_tokens: 81 };
    expect(parseAiTokenUsage(unparseable, 'qwen3.8-max')).toBeNull();
    const memory = createMemoryAiBilling();
    const traces = new AiBattleTraceStore();
    traces.open('m', []);
    traces.begin('m', { id: '1', revision: 1, windowKey: 'MAIN', purpose: 'MAIN', seat: 'FIRST' });
    const billing = new AiBattleBilling(
      'qwen3.8-max',
      memory.persistence,
      (id, view, decision, delta) => traces.updateBilling(id, view, decision, delta)
    );
    await billing.initialize('m');
    const attempt = await billing.begin('1');
    await attempt.finish(parseAiTokenUsage(unparseable, 'qwen3.8-max'));
    expect(billing.view()).toMatchObject({
      attempts: 1,
      reportedAttempts: 0,
      unreportedAttempts: 1,
      pendingAttempts: 0,
      estimatedCny: '0.00000000',
      saveFailed: false,
    });
    expect(traces.list('m')!.decisions[0]!.decisionBilling).toMatchObject({
      attempts: 1,
      reportedAttempts: 0,
      unreportedAttempts: 1,
    });
    // The derived counter is projection-only: never written into the persisted jsonb record.
    const persisted = memory.records.get('m')!;
    expect(persisted).not.toHaveProperty('unreportedAttempts');
    expect(projectAiBilling(persisted)).toMatchObject({
      attempts: 1,
      reportedAttempts: 0,
      unreportedAttempts: 1,
    });
    // A later confirmed attempt clears the gap without restating the unknown usage as zero.
    await (await billing.begin('1')).finish(usage);
    expect(billing.view()).toMatchObject({
      attempts: 2,
      reportedAttempts: 1,
      unreportedAttempts: 1,
      estimatedCny: '0.38659200',
    });
  });

  it('counts retries, unknown transport and late responses even after decision eviction and end', async () => {
    const memory = createMemoryAiBilling();
    const traces = new AiBattleTraceStore({ ...AI_TRACE_LIMITS, decisions: 1 });
    traces.open('m', []);
    traces.begin('m', { id: '1', revision: 1, windowKey: 'MAIN', purpose: 'MAIN', seat: 'FIRST' });
    const billing = new AiBattleBilling(
      'qwen3.8-max',
      memory.persistence,
      (id, view, decision, delta) => traces.updateBilling(id, view, decision, delta)
    );
    await billing.initialize('m');
    const first = await billing.begin('1');
    first.interrupt();
    const retry = await billing.begin('1');
    await retry.finish(usage);
    expect(traces.list('m')!.decisions[0]!.decisionBilling).toMatchObject({
      attempts: 2,
      reportedAttempts: 1,
      pendingAttempts: 0,
      estimatedCny: '0.38659200',
    });
    traces.append('m', '1', 'ACCEPTED', {}, { status: 'ACCEPTED' });
    traces.begin('m', {
      id: '2',
      revision: 2,
      windowKey: 'WAIT',
      purpose: 'WAITING_FOR_PLAYER',
      seat: 'FIRST',
    });
    expect(traces.list('m')!.evictedDecisions).toBe(1);
    traces.end('m');
    const revision = traces.list('m')!.revision;
    await first.finish(usage);
    await first.finish(usage); // Duplicate completion callback is idempotent.
    expect(traces.list('m')!.revision).toBeGreaterThan(revision);
    expect(traces.list('m')!.decisions.map((d) => d.id)).toEqual(['2']);
    expect(traces.export('m')!.matchBilling).toMatchObject({
      attempts: 2,
      reportedAttempts: 2,
      estimatedCny: '0.77318400',
      pendingAttempts: 0,
    });
    const missing = await billing.begin('2');
    await missing.finish(null);
    expect(projectAiBilling(memory.records.get('m')!)).toMatchObject({
      attempts: 3,
      reportedAttempts: 2,
      estimatedCny: '0.77318400',
    });
  });

  it('removes unsent attempts and retries persistence without losing returned usage', async () => {
    const memory = createMemoryAiBilling();
    const billing = new AiBattleBilling('qwen3.8-max', memory.persistence, () => {});
    await billing.initialize('m');
    const cancelled = await billing.begin('1');
    await cancelled.cancelBeforeSend();
    await cancelled.finish(usage);
    expect(billing.view()).toMatchObject({ attempts: 0, pendingAttempts: 0, reportedAttempts: 0 });
    const pending = await billing.begin('2');
    const save = vi
      .spyOn(memory.persistence, 'save')
      .mockRejectedValue(new Error('database offline'));
    await pending.finish(usage);
    expect(billing.view()).toMatchObject({ estimatedCny: '0.38659200', saveFailed: true });
    await expect(billing.begin('3')).rejects.toThrow('停止新请求');
    expect(billing.view().attempts).toBe(1);
    save.mockRestore();
    await billing.flush();
    expect(projectAiBilling(memory.records.get('m')!)).toMatchObject({
      attempts: 1,
      reportedAttempts: 1,
      estimatedCny: '0.38659200',
    });
    expect(billing.view().saveFailed).toBe(false);
  });

  it('does not lose a newer concurrent response when an earlier snapshot is being written', async () => {
    const memory = createMemoryAiBilling();
    const billing = new AiBattleBilling('qwen3.8-max', memory.persistence, () => {});
    await billing.initialize('m');
    const a = await billing.begin('1');
    const b = await billing.begin('2');
    await Promise.all([a.finish(usage), b.finish(usage)]);
    expect(projectAiBilling(memory.records.get('m')!)).toMatchObject({
      attempts: 2,
      reportedAttempts: 2,
      estimatedCny: '0.77318400',
    });
  });
});
