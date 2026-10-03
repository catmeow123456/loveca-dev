import { describe, expect, it } from 'vitest';
import { AiSelfPlayBudget } from '../../src/server/ai-battle/self-play';
import { AiBattleBilling } from '../../src/server/ai-battle/billing';

const billing = () =>
  new AiBattleBilling(
    'glm-5.3',
    {
      save: async () => {},
      read: async () => null,
      readOwned: async () => null,
    },
    () => {}
  );
const usage = {
  inputTokens: 1_000_000,
  implicitCachedTokens: 0,
  explicitCachedTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
};

describe('shared self-play request budget', () => {
  it('accumulates both seats and preceding rounds, refusing a request before it exceeds the CNY reserve', async () => {
    const budget = new AiSelfPlayBudget('20', 100, {
      estimatedCny: '3',
      attempts: 5,
      admittedRequests: 5,
      unreportedAttempts: 0,
    });
    const first = billing(),
      second = billing();
    for (const value of [first, second]) {
      budget.register(value);
      await value.initialize('game');
    }
    expect(budget.admit('{}', first, 4096)).toBeNull();
    await (await first.begin('FIRST:1')).finish(usage);
    expect(budget.admit('{}', second, 4096)).toBeNull();
    await (await second.begin('SECOND:1')).finish(usage);
    expect(budget.summary()).toMatchObject({
      estimatedCny: '19.00000000',
      attempts: 7,
      admittedRequests: 7,
    });
    expect(budget.admit('x'.repeat(200_000), first, 4096)).toBe('EXPERIMENT_CNY_LIMIT');
    expect(budget.summary().admittedRequests).toBe(7);
  });
  it('counts every admitted HTTP request, including a second request in one decision', () => {
    const budget = new AiSelfPlayBudget('200', 2);
    const value = billing();
    budget.register(value);
    expect(budget.admit('{}', value, 4096)).toBeNull();
    expect(budget.admit('{}', value, 4096)).toBeNull();
    expect(budget.admit('{}', value, 4096)).toBe('EXPERIMENT_REQUEST_LIMIT');
  });
  it('extends a later request cap while retaining preceding attempts and fees', async () => {
    const budget = new AiSelfPlayBudget('200', 361, {
      estimatedCny: '60',
      attempts: 359,
      admittedRequests: 359,
      unreportedAttempts: 0,
    });
    const value = billing();
    budget.register(value);
    await value.initialize('game');
    expect(budget.admit('{}', value, 4096)).toBeNull();
    await (await value.begin('FIRST:1')).finish(usage);
    expect(budget.summary()).toMatchObject({
      admittedRequests: 360,
      attempts: 360,
      estimatedCny: '68.00000000',
    });
    expect(budget.admit('{}', value, 4096)).toBeNull();
    expect(budget.admit('{}', value, 4096)).toBe('EXPERIMENT_REQUEST_LIMIT');
  });
  it('carries an explicit unknown-usage reserve across rounds and stops on a new unreported attempt', async () => {
    const budget = new AiSelfPlayBudget('200', 100, {
      estimatedCny: '12.43158800',
      reservedUnknownCny: '2.00000000',
      reservedUnknownAttempts: 1,
      attempts: 45,
      unreportedAttempts: 1,
      admittedRequests: 45,
    });
    const value = billing();
    budget.register(value);
    await value.initialize('game');
    expect(budget.admit('{}', value, 4096)).toBeNull();
    await (await value.begin('FIRST:1')).finish(usage);
    expect(budget.summary()).toMatchObject({
      knownEstimatedCny: '18.43158800',
      estimatedCny: '20.43158800',
      reservedUnknownAttempts: 1,
    });
    await (await value.begin('FIRST:2')).finish(null);
    expect(budget.admit('{}', value, 4096)).toBe('EXPERIMENT_USAGE_UNKNOWN');
  });
  it('stops on unknown usage instead of silently treating it as zero', async () => {
    const budget = new AiSelfPlayBudget('200', 100);
    const value = billing();
    budget.register(value);
    await value.initialize('game');
    await (await value.begin('FIRST:1')).finish(null);
    expect(budget.admit('{}', value, 4096)).toBe('EXPERIMENT_USAGE_UNKNOWN');
    expect(budget.summary().unreportedAttempts).toBe(1);
  });
});
