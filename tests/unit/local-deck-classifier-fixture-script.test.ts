import { describe, expect, it } from 'vitest';
import {
  allocateWeightedDeckKeys,
  assertLocalTestDatabaseUrl,
  buildFixtureMatchPlans,
  buildPlayerPairSchedule,
  parseLocalDeckClassifierFixtureOptions,
} from '../../scripts/seed-local-deck-classifier-fixtures.js';

describe('local deck classifier fixture script', () => {
  it('默认 dry-run，并要求 apply 显式确认', () => {
    expect(
      parseLocalDeckClassifierFixtureOptions(['--season-key=test-ranked-v4-growth'])
    ).toMatchObject({
      mode: 'dry-run',
      yes: false,
      matchCount: 50,
      runKey: 'classifier-pie-v1',
    });
    expect(() =>
      parseLocalDeckClassifierFixtureOptions(['--season-key=test-ranked-v4-growth', '--apply'])
    ).toThrow('--apply 必须同时提供 --yes');
  });

  it('拒绝远程和非测试库连接', () => {
    expect(() =>
      assertLocalTestDatabaseUrl('postgres://loveca:secret@db.example.com:5432/loveca')
    ).toThrow('只允许连接 localhost');
    expect(() =>
      assertLocalTestDatabaseUrl('postgres://loveca:secret@127.0.0.1:5432/production')
    ).toThrow('只允许连接本地 loveca');
    expect(() =>
      assertLocalTestDatabaseUrl('postgres://loveca:wrong@127.0.0.1:5432/loveca')
    ).toThrow('固定测试凭据');
  });

  it('50 场轮换三名玩家且每场双方不同', () => {
    const pairs = buildPlayerPairSchedule(50);
    expect(pairs).toHaveLength(50);
    expect(pairs.every((pair) => pair.firstPlayerIndex !== pair.secondPlayerIndex)).toBe(true);
    const counts = [0, 0, 0];
    for (const pair of pairs) {
      counts[pair.firstPlayerIndex] += 1;
      counts[pair.secondPlayerIndex] += 1;
    }
    expect(counts).toEqual([33, 34, 33]);
  });

  it('按权重分配固定长度并生成可重放的 50 场计划', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'unknown', 'ambiguous'];
    const first = allocateWeightedDeckKeys(34, keys, [59, 18, 12, 0, 0, 0, 5, 6], 'seed');
    const second = allocateWeightedDeckKeys(34, keys, [59, 18, 12, 0, 0, 0, 5, 6], 'seed');
    expect(first).toHaveLength(34);
    expect(first).toEqual(second);
    expect(first).toContain('unknown');
    expect(first).toContain('ambiguous');

    const plans = buildFixtureMatchPlans({
      matchCount: 50,
      runKey: 'classifier-pie-v1',
      deckKeys: keys,
    });
    expect(plans).toHaveLength(50);
    expect(new Set(plans.map((plan) => plan.matchId)).size).toBe(50);
    expect(plans.some((plan) => plan.firstDeckKey === 'unknown')).toBe(true);
    expect(plans.some((plan) => plan.secondDeckKey === 'ambiguous')).toBe(true);
  });
});
