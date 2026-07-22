/**
 * Heart 与 Live 判定系统单元测试
 * 测试 HeartPool 类和 LiveResolver
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HeartColor, CardType, BladeHeartEffect } from '../../src/shared/types/enums';
import {
  HeartPool,
  calculateHeartDeficit,
  createEmptyHeartCounts,
  createHeartCountsFromIcons,
  checkMultipleLiveRequirements,
} from '../../src/domain/value-objects/heart';
import { LiveResolver } from '../../src/domain/rules/live-resolver';
import {
  applyHeartRequirementModifiers,
  reduceGenericHeartRequirement,
} from '../../src/domain/rules/live-requirement-modifiers';
import type {
  HeartIcon,
  HeartRequirement,
  MemberCardData,
  LiveCardData,
} from '../../src/domain/entities/card';

// ============================================
// 测试辅助函数
// ============================================

function createHeartRequirement(
  colorReqs: Record<string, number>,
  totalRequired?: number
): HeartRequirement {
  const colorMap = new Map<HeartColor, number>();
  let computed = 0;

  for (const [color, count] of Object.entries(colorReqs)) {
    colorMap.set(color as HeartColor, count);
    computed += count;
  }

  return {
    colorRequirements: colorMap,
    totalRequired: totalRequired ?? computed,
  };
}

function createMockMemberData(
  hearts: HeartIcon[],
  blade: number = 1,
  cost: number = 1
): MemberCardData {
  return {
    cardCode: 'TEST-001',
    name: 'Test Member',
    cardType: CardType.MEMBER,
    cost,
    blade,
    hearts,
  };
}

function createMockLiveData(score: number, requirements: HeartRequirement): LiveCardData {
  return {
    cardCode: 'LIVE-001',
    name: 'Test Live',
    cardType: CardType.LIVE,
    score,
    requirements,
  };
}

// ============================================
// HeartPool 测试
// ============================================

describe('HeartPool', () => {
  describe('创建与基本操作', () => {
    it('应该创建空的 HeartPool', () => {
      const pool = HeartPool.empty();
      expect(pool.getTotalCount()).toBe(0);
      expect(pool.getRainbowCount()).toBe(0);
    });

    it('应该从 HeartIcon 数组创建 HeartPool', () => {
      const icons: HeartIcon[] = [
        { color: HeartColor.PINK, count: 2 },
        { color: HeartColor.RED, count: 1 },
      ];

      const pool = HeartPool.fromHeartIcons(icons);

      expect(pool.getColorCount(HeartColor.PINK)).toBe(2);
      expect(pool.getColorCount(HeartColor.RED)).toBe(1);
      expect(pool.getTotalCount()).toBe(3);
    });

    it('应该正确计算包含 Rainbow Heart 的总数', () => {
      const counts = new Map<HeartColor, number>([
        [HeartColor.PINK, 2],
        [HeartColor.RAINBOW, 1],
      ]);

      const pool = new HeartPool(counts);

      expect(pool.getTotalCount()).toBe(3);
      expect(pool.getRainbowCount()).toBe(1);
      expect(pool.getNonRainbowTotalCount()).toBe(2);
    });

    it('应该正确合并两个 HeartPool', () => {
      const pool1 = HeartPool.fromHeartIcons([{ color: HeartColor.PINK, count: 2 }]);
      const pool2 = HeartPool.fromHeartIcons([
        { color: HeartColor.PINK, count: 1 },
        { color: HeartColor.RED, count: 3 },
      ]);

      const merged = pool1.merge(pool2);

      expect(merged.getColorCount(HeartColor.PINK)).toBe(3);
      expect(merged.getColorCount(HeartColor.RED)).toBe(3);
      expect(merged.getTotalCount()).toBe(6);
    });

    it('应该正确添加 Heart', () => {
      const pool = HeartPool.empty();
      const newPool = pool.add(HeartColor.PINK, 2);

      expect(newPool.getColorCount(HeartColor.PINK)).toBe(2);
      expect(pool.getColorCount(HeartColor.PINK)).toBe(0); // 原 pool 不变
    });
  });

  describe('Heart 需求判定', () => {
    it('应该满足简单的颜色需求', () => {
      const pool = HeartPool.fromHeartIcons([
        { color: HeartColor.PINK, count: 3 },
        { color: HeartColor.RED, count: 2 },
      ]);

      const requirement = createHeartRequirement({
        [HeartColor.PINK]: 2,
        [HeartColor.RED]: 1,
      });

      expect(pool.canSatisfy(requirement)).toBe(true);
    });

    it('应该在颜色不足时返回 false', () => {
      const pool = HeartPool.fromHeartIcons([{ color: HeartColor.PINK, count: 1 }]);

      const requirement = createHeartRequirement({
        [HeartColor.PINK]: 2,
      });

      expect(pool.canSatisfy(requirement)).toBe(false);
    });

    it('应该用 Rainbow Heart 填补颜色缺口', () => {
      const counts = new Map<HeartColor, number>([
        [HeartColor.PINK, 1],
        [HeartColor.RAINBOW, 2],
      ]);

      const pool = new HeartPool(counts);

      const requirement = createHeartRequirement({
        [HeartColor.PINK]: 2,
        [HeartColor.RED]: 1,
      });

      expect(pool.canSatisfy(requirement)).toBe(true);
    });

    it('灰色 Heart 只能满足无色总数需求，不能填补指定颜色缺口', () => {
      const grayOnlyPool = HeartPool.fromHeartIcons([{ color: HeartColor.GRAY, count: 2 }]);
      const redAndGenericRequirement = createHeartRequirement(
        { [HeartColor.RED]: 1, [HeartColor.RAINBOW]: 2 },
        3
      );

      expect(grayOnlyPool.canSatisfy(redAndGenericRequirement)).toBe(false);

      const poolWithRequiredRed = HeartPool.fromHeartIcons([
        { color: HeartColor.RED, count: 1 },
        { color: HeartColor.GRAY, count: 2 },
      ]);
      expect(poolWithRequiredRed.canSatisfy(redAndGenericRequirement)).toBe(true);
      expect(poolWithRequiredRed.consume(redAndGenericRequirement)?.getTotalCount()).toBe(0);
    });

    it('应该在 Rainbow Heart 不足时返回 false', () => {
      const counts = new Map<HeartColor, number>([
        [HeartColor.PINK, 1],
        [HeartColor.RAINBOW, 1],
      ]);

      const pool = new HeartPool(counts);

      const requirement = createHeartRequirement({
        [HeartColor.PINK]: 2,
        [HeartColor.RED]: 2,
      });

      expect(pool.canSatisfy(requirement)).toBe(false);
    });

    it('应该检查总数需求', () => {
      const pool = HeartPool.fromHeartIcons([{ color: HeartColor.PINK, count: 2 }]);

      // 颜色满足但总数不足
      const requirement = createHeartRequirement(
        { [HeartColor.PINK]: 1 },
        5 // 总数需求为 5
      );

      expect(pool.canSatisfy(requirement)).toBe(false);
    });

    it('需求中的 Rainbow/ALL 应作为任意 Heart 总数需求处理', () => {
      const pool = HeartPool.fromHeartIcons([
        { color: HeartColor.PINK, count: 1 },
        { color: HeartColor.YELLOW, count: 1 },
        { color: HeartColor.BLUE, count: 3 },
      ]);

      const requirement = createHeartRequirement({
        [HeartColor.PINK]: 1,
        [HeartColor.YELLOW]: 1,
        [HeartColor.RAINBOW]: 3,
      });

      expect(pool.canSatisfy(requirement)).toBe(true);
      const consumed = pool.consume(requirement);
      expect(consumed).not.toBeNull();
      expect(consumed!.getTotalCount()).toBe(0);
    });

    it('需求输入中的 GRAY 也应规范为泛用总数，允许任意 Heart 满足', () => {
      const pool = HeartPool.fromHeartIcons([
        { color: HeartColor.PINK, count: 1 },
        { color: HeartColor.BLUE, count: 1 },
      ]);
      const requirement = createHeartRequirement({ [HeartColor.GRAY]: 2 });

      expect(pool.canSatisfy(requirement)).toBe(true);
    });

    it('缺口计算应先用 Rainbow 补彩色，再报告彩色与泛用缺口', () => {
      const pool = HeartPool.fromHeartIcons([
        { color: HeartColor.RED, count: 1 },
        { color: HeartColor.BLUE, count: 1 },
        { color: HeartColor.RAINBOW, count: 1 },
        { color: HeartColor.GRAY, count: 1 },
      ]);
      const requirement = createHeartRequirement({ [HeartColor.RED]: 3 }, 6);

      expect([...calculateHeartDeficit(pool, requirement).entries()]).toEqual([
        [HeartColor.RED, 1],
        [HeartColor.RAINBOW, 1],
      ]);
    });
  });

  describe('Heart 消耗', () => {
    it('应该正确消耗 Heart 并返回新的 HeartPool', () => {
      const pool = HeartPool.fromHeartIcons([
        { color: HeartColor.PINK, count: 3 },
        { color: HeartColor.RED, count: 2 },
      ]);

      const requirement = createHeartRequirement({
        [HeartColor.PINK]: 2,
        [HeartColor.RED]: 1,
      });

      const newPool = pool.consume(requirement);

      expect(newPool).not.toBeNull();
      expect(newPool!.getColorCount(HeartColor.PINK)).toBe(1);
      expect(newPool!.getColorCount(HeartColor.RED)).toBe(1);
    });

    it('应该在无法满足时返回 null', () => {
      const pool = HeartPool.fromHeartIcons([{ color: HeartColor.PINK, count: 1 }]);

      const requirement = createHeartRequirement({
        [HeartColor.PINK]: 5,
      });

      const newPool = pool.consume(requirement);

      expect(newPool).toBeNull();
    });

    it('应该正确消耗 Rainbow Heart', () => {
      const counts = new Map<HeartColor, number>([
        [HeartColor.PINK, 1],
        [HeartColor.RAINBOW, 2],
      ]);

      const pool = new HeartPool(counts);

      const requirement = createHeartRequirement({
        [HeartColor.PINK]: 2,
        [HeartColor.RED]: 1,
      });

      const newPool = pool.consume(requirement);

      expect(newPool).not.toBeNull();
      expect(newPool!.getRainbowCount()).toBe(0); // 2 个 Rainbow 都被用掉
    });
  });

  describe('多 Live 卡判定', () => {
    it('应该按顺序判定多张 Live 卡', () => {
      const pool = HeartPool.fromHeartIcons([
        { color: HeartColor.PINK, count: 5 },
        { color: HeartColor.RED, count: 3 },
      ]);

      const requirements = [
        createHeartRequirement({ [HeartColor.PINK]: 2 }),
        createHeartRequirement({ [HeartColor.RED]: 2 }),
        createHeartRequirement({ [HeartColor.PINK]: 2 }),
      ];

      const { results, remainingPool } = checkMultipleLiveRequirements(pool, requirements);

      expect(results).toEqual([true, true, true]);
      expect(remainingPool.getColorCount(HeartColor.PINK)).toBe(1);
      expect(remainingPool.getColorCount(HeartColor.RED)).toBe(1);
    });

    it('应该在 Heart 不足时部分失败', () => {
      const pool = HeartPool.fromHeartIcons([{ color: HeartColor.PINK, count: 3 }]);

      const requirements = [
        createHeartRequirement({ [HeartColor.PINK]: 2 }),
        createHeartRequirement({ [HeartColor.PINK]: 3 }), // 只剩 1 个，不够
      ];

      const { results } = checkMultipleLiveRequirements(pool, requirements);

      expect(results).toEqual([true, false]);
    });
  });
});

// ============================================
// LiveResolver 测试
// ============================================

describe('LiveResolver', () => {
  let resolver: LiveResolver;

  beforeEach(() => {
    resolver = new LiveResolver();
  });

  describe('收集成员 Heart', () => {
    it('应该正确收集所有成员的 Heart', () => {
      const members: MemberCardData[] = [
        createMockMemberData([{ color: HeartColor.PINK, count: 2 }]),
        createMockMemberData([
          { color: HeartColor.PINK, count: 1 },
          { color: HeartColor.RED, count: 1 },
        ]),
      ];

      const pool = resolver.collectMemberHearts(members);

      expect(pool.getColorCount(HeartColor.PINK)).toBe(3);
      expect(pool.getColorCount(HeartColor.RED)).toBe(1);
    });
  });

  describe('计算光棒数', () => {
    it('应该正确计算总光棒数', () => {
      const members: MemberCardData[] = [
        createMockMemberData([], 2),
        createMockMemberData([], 3),
        createMockMemberData([], 1),
      ];

      const totalBlade = resolver.calculateTotalBlade(members);

      expect(totalBlade).toBe(6);
    });
  });

  describe('Cheer 效果处理', () => {
    it('应该正确处理抽卡效果', () => {
      const revealedCards = [
        {
          cardId: 'card-1',
          bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
        },
        {
          cardId: 'card-2',
          bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
        },
      ];

      const result = resolver.processCheer(revealedCards);

      expect(result.drawCount).toBe(2);
      expect(result.revealedCardIds).toEqual(['card-1', 'card-2']);
    });

    it('应该正确处理加心效果', () => {
      const revealedCards = [
        {
          cardId: 'card-1',
          bladeHearts: [
            { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PINK },
            { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PINK },
          ],
        },
      ];

      const result = resolver.processCheer(revealedCards);

      expect(result.bonusHearts.getColorCount(HeartColor.PINK)).toBe(2);
    });

    it('应该正确处理 ALL 加心效果', () => {
      const revealedCards = [
        {
          cardId: 'aokuharuka',
          bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }],
        },
      ];

      const result = resolver.processCheer(revealedCards);

      expect(result.bonusHearts.getColorCount(HeartColor.RAINBOW)).toBe(1);
      expect(result.bonusHearts.getRainbowCount()).toBe(1);
    });

    it('应该把 double 判心的两个灰色 Heart 都加入判定池', () => {
      const result = resolver.processCheer([
        {
          cardId: 'double-colorless-live',
          bladeHearts: [
            { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY },
            { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY },
          ],
        },
      ]);

      expect(result.bonusHearts.getColorCount(HeartColor.GRAY)).toBe(2);
      expect(result.bonusHearts.getRainbowCount()).toBe(0);
    });
  });

  describe('Live 判定', () => {
    it('double 的两个灰色 Heart 能补足总数并令 LIVE 成功，但不能补彩色需求', () => {
      const doubleGrayBladeHearts = [
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY },
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY },
      ] as const;
      const genericLive = createMockLiveData(
        8,
        createHeartRequirement({ [HeartColor.RED]: 1, [HeartColor.RAINBOW]: 2 }, 3)
      );

      const success = resolver.performLive(
        'player-1',
        [createMockMemberData([{ color: HeartColor.RED, count: 1 }])],
        [{ cardId: 'generic-live', data: genericLive }],
        [{ cardId: 'double-cheer', bladeHearts: doubleGrayBladeHearts }]
      );
      expect(success.liveJudgments[0]?.isSuccess).toBe(true);
      expect(success.totalScore).toBe(8);

      const failure = resolver.performLive(
        'player-1',
        [],
        [{ cardId: 'colored-live', data: genericLive }],
        [{ cardId: 'double-cheer', bladeHearts: doubleGrayBladeHearts }]
      );
      expect(failure.liveJudgments[0]?.isSuccess).toBe(false);
      expect(failure.totalScore).toBe(0);
    });

    it('应该正确判定单张 Live 卡成功', () => {
      const pool = HeartPool.fromHeartIcons([{ color: HeartColor.PINK, count: 3 }]);

      const liveData = createMockLiveData(10, createHeartRequirement({ [HeartColor.PINK]: 2 }));

      const judgment = resolver.judgeSingleLive('live-1', liveData, pool);

      expect(judgment.isSuccess).toBe(true);
      expect(judgment.heartAllocation).not.toBeNull();
    });

    it('应该正确判定单张 Live 卡失败', () => {
      const pool = HeartPool.fromHeartIcons([{ color: HeartColor.PINK, count: 1 }]);

      const liveData = createMockLiveData(10, createHeartRequirement({ [HeartColor.PINK]: 5 }));

      const judgment = resolver.judgeSingleLive('live-1', liveData, pool);

      expect(judgment.isSuccess).toBe(false);
      expect(judgment.heartAllocation).toBeNull();
    });

    it('应该将 Live 需求中的 ALL 心视为任意颜色并计入分数', () => {
      const liveData = createMockLiveData(
        2,
        createHeartRequirement({
          [HeartColor.PINK]: 1,
          [HeartColor.YELLOW]: 1,
          [HeartColor.RAINBOW]: 3,
        })
      );
      const activeMembers: MemberCardData[] = [
        createMockMemberData([
          { color: HeartColor.PINK, count: 1 },
          { color: HeartColor.YELLOW, count: 1 },
          { color: HeartColor.BLUE, count: 3 },
        ]),
      ];

      const result = resolver.performLive(
        'p1',
        activeMembers,
        [{ cardId: 'live-1', data: liveData }],
        []
      );

      expect(result.liveJudgments[0]?.isSuccess).toBe(true);
      expect(result.totalScore).toBe(2);
    });

    it('减少必要 Heart 应减少泛用需求，即使数据只用 totalRequired 表示 ALL 心', () => {
      const requirement = createHeartRequirement(
        {
          [HeartColor.PINK]: 2,
          [HeartColor.YELLOW]: 2,
          [HeartColor.PURPLE]: 2,
        },
        12
      );

      const adjusted = reduceGenericHeartRequirement(requirement, 2);

      expect(adjusted.totalRequired).toBe(10);
      expect(adjusted.colorRequirements.get(HeartColor.PINK)).toBe(2);
      expect(adjusted.colorRequirements.get(HeartColor.YELLOW)).toBe(2);
      expect(adjusted.colorRequirements.get(HeartColor.PURPLE)).toBe(2);
      expect(adjusted.colorRequirements.get(HeartColor.RAINBOW)).toBe(4);
      expect(
        HeartPool.fromHeartIcons([
          { color: HeartColor.PINK, count: 5 },
          { color: HeartColor.YELLOW, count: 2 },
          { color: HeartColor.PURPLE, count: 3 },
        ]).canSatisfy(adjusted)
      ).toBe(true);
    });

    it('必要 Heart 修正应支持指定颜色减少', () => {
      const requirement = createHeartRequirement({
        [HeartColor.PINK]: 3,
        [HeartColor.YELLOW]: 2,
        [HeartColor.RAINBOW]: 1,
      });

      const adjusted = applyHeartRequirementModifiers(requirement, [
        { color: HeartColor.PINK, countDelta: -2 },
      ]);

      expect(adjusted.colorRequirements.get(HeartColor.PINK)).toBe(1);
      expect(adjusted.colorRequirements.get(HeartColor.YELLOW)).toBe(2);
      expect(adjusted.colorRequirements.get(HeartColor.RAINBOW)).toBe(1);
      expect(adjusted.totalRequired).toBe(4);
    });

    it('必要 Heart 修正应支持指定颜色与 ALL 需求增加', () => {
      const requirement = createHeartRequirement({
        [HeartColor.PINK]: 1,
        [HeartColor.RAINBOW]: 2,
      });

      const adjusted = applyHeartRequirementModifiers(requirement, [
        { color: HeartColor.BLUE, countDelta: 1 },
        { color: HeartColor.RAINBOW, countDelta: 2 },
      ]);

      expect(adjusted.colorRequirements.get(HeartColor.PINK)).toBe(1);
      expect(adjusted.colorRequirements.get(HeartColor.BLUE)).toBe(1);
      expect(adjusted.colorRequirements.get(HeartColor.RAINBOW)).toBe(4);
      expect(adjusted.totalRequired).toBe(6);
    });

    it('多张 Live 中任意一张失败时，整轮 Live 应全部失败且不计分', () => {
      const activeMembers: MemberCardData[] = [
        createMockMemberData([
          { color: HeartColor.PINK, count: 1 },
          { color: HeartColor.YELLOW, count: 1 },
          { color: HeartColor.BLUE, count: 3 },
        ]),
      ];
      const liveCards = [
        {
          cardId: 'live-failed',
          data: createMockLiveData(1, createHeartRequirement({ [HeartColor.PINK]: 2 })),
        },
        {
          cardId: 'live-raw-success',
          data: createMockLiveData(
            2,
            createHeartRequirement({
              [HeartColor.PINK]: 1,
              [HeartColor.YELLOW]: 1,
              [HeartColor.RAINBOW]: 3,
            })
          ),
        },
      ];

      const result = resolver.performLive('p1', activeMembers, liveCards, []);

      expect(result.liveJudgments.map((judgment) => judgment.isSuccess)).toEqual([false, false]);
      expect(result.allFailed).toBe(true);
      expect(result.totalScore).toBe(0);
    });

    it('应该正确判定多张 Live 卡', () => {
      const pool = HeartPool.fromHeartIcons([{ color: HeartColor.PINK, count: 5 }]);

      const liveCards = [
        {
          cardId: 'live-1',
          data: createMockLiveData(10, createHeartRequirement({ [HeartColor.PINK]: 2 })),
        },
        {
          cardId: 'live-2',
          data: createMockLiveData(15, createHeartRequirement({ [HeartColor.PINK]: 2 })),
        },
      ];

      const { judgments } = resolver.judgeMultipleLives(liveCards, pool);

      expect(judgments[0].isSuccess).toBe(true);
      expect(judgments[1].isSuccess).toBe(true);
    });

    it('多张 Live 应合并需求判定，避免泛用 Heart 顺序消耗导致误失败', () => {
      const pool = HeartPool.fromHeartIcons([
        { color: HeartColor.PINK, count: 6 },
        { color: HeartColor.YELLOW, count: 3 },
        { color: HeartColor.PURPLE, count: 6 },
      ]);

      const liveCards = [
        {
          cardId: 'bokuima',
          data: createMockLiveData(
            4,
            createHeartRequirement({
              [HeartColor.PINK]: 2,
              [HeartColor.YELLOW]: 2,
              [HeartColor.PURPLE]: 2,
              [HeartColor.RAINBOW]: 6,
            })
          ),
        },
        {
          cardId: 'start-dash',
          data: createMockLiveData(
            2,
            createHeartRequirement({
              [HeartColor.PINK]: 1,
              [HeartColor.YELLOW]: 1,
              [HeartColor.PURPLE]: 1,
            })
          ),
        },
      ];

      const { judgments, remainingPool } = resolver.judgeMultipleLives(liveCards, pool);

      expect(judgments.map((judgment) => judgment.isSuccess)).toEqual([true, true]);
      expect(remainingPool.getTotalCount()).toBe(0);
    });

    it('Live 成功后返回剩余 Heart plain data，RAINBOW 不计为指定绿色', () => {
      const liveData = createMockLiveData(
        2,
        createHeartRequirement({
          [HeartColor.GREEN]: 1,
          [HeartColor.RAINBOW]: 1,
        })
      );
      const activeMembers: MemberCardData[] = [
        createMockMemberData([
          { color: HeartColor.GREEN, count: 2 },
          { color: HeartColor.RAINBOW, count: 1 },
        ]),
      ];

      const result = resolver.performLive(
        'p1',
        activeMembers,
        [{ cardId: 'live-1', data: liveData }],
        []
      );

      expect(result.liveJudgments[0]?.isSuccess).toBe(true);
      expect(result.liveJudgmentHearts).toEqual([
        { color: HeartColor.GREEN, count: 2 },
        { color: HeartColor.RAINBOW, count: 1 },
      ]);
      expect(result.remainingHearts).toEqual([{ color: HeartColor.RAINBOW, count: 1 }]);
      expect(result.remainingHearts.filter((heart) => heart.color === HeartColor.GREEN)).toEqual(
        []
      );
    });
  });

  describe('Live 胜负判定', () => {
    it('应该正确判定分数高者获胜', () => {
      const firstResult = {
        playerId: 'player-1',
        cheerResult: {
          revealedCardIds: [],
          bladeHearts: [],
          drawCount: 0,
          bonusHearts: HeartPool.empty(),
        },
        totalHeartPool: HeartPool.empty(),
        liveJudgments: [],
        allFailed: false,
        totalScore: 20,
        bonusScore: 0,
        remainingHearts: [],
      };

      const secondResult = {
        playerId: 'player-2',
        cheerResult: {
          revealedCardIds: [],
          bladeHearts: [],
          drawCount: 0,
          bonusHearts: HeartPool.empty(),
        },
        totalHeartPool: HeartPool.empty(),
        liveJudgments: [],
        allFailed: false,
        totalScore: 15,
        bonusScore: 0,
        remainingHearts: [],
      };

      const judgment = resolver.judgeLiveResult(firstResult, secondResult);

      expect(judgment.winnerIds).toEqual(['player-1']);
      expect(judgment.firstPlayerScore).toBe(20);
      expect(judgment.secondPlayerScore).toBe(15);
    });

    it('应该正确判定分数相同双方获胜', () => {
      const firstResult = {
        playerId: 'player-1',
        cheerResult: {
          revealedCardIds: [],
          bladeHearts: [],
          drawCount: 0,
          bonusHearts: HeartPool.empty(),
        },
        totalHeartPool: HeartPool.empty(),
        liveJudgments: [],
        allFailed: false,
        totalScore: 20,
        bonusScore: 0,
        remainingHearts: [],
      };

      const secondResult = {
        playerId: 'player-2',
        cheerResult: {
          revealedCardIds: [],
          bladeHearts: [],
          drawCount: 0,
          bonusHearts: HeartPool.empty(),
        },
        totalHeartPool: HeartPool.empty(),
        liveJudgments: [],
        allFailed: false,
        totalScore: 20,
        bonusScore: 0,
        remainingHearts: [],
      };

      const judgment = resolver.judgeLiveResult(firstResult, secondResult);

      expect(judgment.winnerIds).toContain('player-1');
      expect(judgment.winnerIds).toContain('player-2');
      expect(judgment.winnerIds.length).toBe(2);
    });

    it('应该正确处理双方都无 Live 卡的情况', () => {
      const firstResult = {
        playerId: 'player-1',
        cheerResult: {
          revealedCardIds: [],
          bladeHearts: [],
          drawCount: 0,
          bonusHearts: HeartPool.empty(),
        },
        totalHeartPool: HeartPool.empty(),
        liveJudgments: [],
        allFailed: true,
        totalScore: 0,
        bonusScore: 0,
        remainingHearts: [],
      };

      const secondResult = {
        playerId: 'player-2',
        cheerResult: {
          revealedCardIds: [],
          bladeHearts: [],
          drawCount: 0,
          bonusHearts: HeartPool.empty(),
        },
        totalHeartPool: HeartPool.empty(),
        liveJudgments: [],
        allFailed: true,
        totalScore: 0,
        bonusScore: 0,
        remainingHearts: [],
      };

      const judgment = resolver.judgeLiveResult(firstResult, secondResult);

      expect(judgment.winnerIds.length).toBe(0);
    });

    it('应该正确处理一方无 Live 卡的情况', () => {
      const firstResult = {
        playerId: 'player-1',
        cheerResult: {
          revealedCardIds: [],
          bladeHearts: [],
          drawCount: 0,
          bonusHearts: HeartPool.empty(),
        },
        totalHeartPool: HeartPool.empty(),
        liveJudgments: [],
        allFailed: false,
        totalScore: 10,
        bonusScore: 0,
        remainingHearts: [],
      };

      const secondResult = {
        playerId: 'player-2',
        cheerResult: {
          revealedCardIds: [],
          bladeHearts: [],
          drawCount: 0,
          bonusHearts: HeartPool.empty(),
        },
        totalHeartPool: HeartPool.empty(),
        liveJudgments: [],
        allFailed: true,
        totalScore: 0,
        bonusScore: 0,
        remainingHearts: [],
      };

      const judgment = resolver.judgeLiveResult(firstResult, secondResult);

      expect(judgment.winnerIds).toEqual(['player-1']);
    });
  });
});
