import { describe, expect, it } from 'vitest';
import type { AnyCardData } from '@game/domain/entities/card';
import type { DeckArchetypeEnvironmentEntryView } from '@game/online/deck-classifier-types';
import { CardType } from '@game/shared/types/enums';
import { buildRankedDeckChartSeries, type DeckEnvironmentRateKey } from './rankedDeckChartSeries';

describe('buildRankedDeckChartSeries', () => {
  it('独立展示不超过 12 个的全部正值分类并保留卡图裁切与颜色回退', () => {
    const entries = [
      createEntry(0, {
        playerEqualUsageRate: 0.5,
        representativeCardCode: 'LIVE-001',
        representativeImageFilename: 'cards/live-source.png',
      }),
      createEntry(1, {
        playerEqualUsageRate: 0.3,
        representativeCardCode: 'MEMBER-001',
        representativeImageFilename: 'member-source.webp',
      }),
      createEntry(2, { playerEqualUsageRate: 0.2, color: '#123456' }),
    ];
    const cardDataRegistry = new Map<string, AnyCardData>([
      [
        'LIVE-001',
        {
          cardCode: 'LIVE-001',
          name: 'LIVE 代表卡',
          cardType: CardType.LIVE,
          score: 1,
          requirements: { colorRequirements: new Map(), totalRequired: 0 },
        },
      ],
      [
        'MEMBER-001',
        {
          cardCode: 'MEMBER-001',
          name: '成员代表卡',
          cardType: CardType.MEMBER,
          cost: 1,
          blade: 1,
          hearts: [],
        },
      ],
    ]);

    const series = buildRankedDeckChartSeries(entries, 'playerEqualUsageRate', cardDataRegistry);

    expect(series).toHaveLength(3);
    expect(series.find((item) => item.id === 'visual:other-recognized')).toBeUndefined();
    expect(series[0]).toMatchObject({
      imageUrl: '/images/medium/live-source.webp',
      imageCrop: 'live',
    });
    expect(series[1]).toMatchObject({
      imageUrl: '/images/medium/member-source.webp',
      imageCrop: 'portrait',
    });
    expect(series[2]).toEqual({
      id: 'archetype-2',
      label: '分类 2',
      value: 0.2,
      color: '#123456',
    });
  });

  it('第 12 个后的 remainder 不超过整图 15% 时停在 12 个', () => {
    const entries = createMetricEntries([...Array<number>(12).fill(10), 1, 1]);

    const series = buildRankedDeckChartSeries(entries, 'playerEqualUsageRate', new Map());

    expect(recognizedItems(series)).toHaveLength(12);
    expect(otherRecognizedItem(series)?.value).toBe(2);
  });

  it('remainder 超过 15% 时逐项扩展并在第 14 个后达到目标即停止', () => {
    const entries = createMetricEntries([...Array<number>(12).fill(6), 5, 4, 3, 3, 3, 3]);

    const series = buildRankedDeckChartSeries(entries, 'playerEqualUsageRate', new Map());

    expect(recognizedItems(series)).toHaveLength(14);
    expect(recognizedItems(series).at(-1)?.id).toBe('archetype-13');
    expect(otherRecognizedItem(series)?.value).toBe(12);
  });

  it('展示 16 个后 remainder 仍超过 15% 时严格封顶并保留聚合项', () => {
    const entries = createMetricEntries(Array<number>(20).fill(1));

    const series = buildRankedDeckChartSeries(entries, 'playerEqualUsageRate', new Map());

    expect(recognizedItems(series)).toHaveLength(16);
    expect(otherRecognizedItem(series)?.value).toBe(4);
  });

  it('系统扇区参与整图分母但不占分类名额，并按原有顺序追加', () => {
    const entries = [
      ...createMetricEntries(Array<number>(20).fill(1)),
      createEntry(100, {
        archetypeId: 'system:unknown',
        name: '其他／未识别',
        classificationStatus: 'UNKNOWN',
        sortOrder: 102,
        playerEqualUsageRate: 30,
      }),
      createEntry(101, {
        archetypeId: 'system:ambiguous',
        name: '分类冲突／待复核',
        classificationStatus: 'AMBIGUOUS',
        sortOrder: 101,
        playerEqualUsageRate: 10,
      }),
    ];

    const series = buildRankedDeckChartSeries(entries, 'playerEqualUsageRate', new Map());

    expect(recognizedItems(series)).toHaveLength(12);
    expect(otherRecognizedItem(series)?.value).toBe(8);
    expect(series.slice(-2).map((item) => item.id)).toEqual(['system:ambiguous', 'system:unknown']);
  });

  it('零值、负数和非有限值不消耗独立展示名额', () => {
    const entries = [
      createEntry(100, { archetypeId: 'invalid-zero', playerEqualUsageRate: 0, sortOrder: 0 }),
      createEntry(101, {
        archetypeId: 'invalid-negative',
        playerEqualUsageRate: -1,
        sortOrder: 1,
      }),
      createEntry(102, {
        archetypeId: 'invalid-nan',
        playerEqualUsageRate: Number.NaN,
        sortOrder: 2,
      }),
      createEntry(103, {
        archetypeId: 'invalid-infinity',
        playerEqualUsageRate: Number.POSITIVE_INFINITY,
        sortOrder: 3,
      }),
      ...createMetricEntries(Array<number>(13).fill(1)),
    ];

    const series = buildRankedDeckChartSeries(entries, 'playerEqualUsageRate', new Map());

    expect(recognizedItems(series)).toHaveLength(12);
    expect(otherRecognizedItem(series)?.value).toBe(1);
    expect(series.some((item) => item.id.startsWith('invalid-'))).toBe(false);
  });

  it('针对不同 metric 独立排序和选择可见分类', () => {
    const entries = Array.from({ length: 13 }, (_, index) =>
      createEntry(index, {
        playerEqualUsageRate: 13 - index,
        matchEqualUsageRate: index + 1,
      })
    );

    const playerEqual = buildRankedDeckChartSeries(entries, 'playerEqualUsageRate', new Map());
    const matchEqual = buildRankedDeckChartSeries(entries, 'matchEqualUsageRate', new Map());

    expect(recognizedItems(playerEqual).map((item) => item.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `archetype-${index}`)
    );
    expect(recognizedItems(matchEqual).map((item) => item.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `archetype-${12 - index}`)
    );
    expect(otherRecognizedItem(playerEqual)?.value).toBe(1);
    expect(otherRecognizedItem(matchEqual)?.value).toBe(1);
  });

  it('其他已识别卡组精确汇总全部未独立展示分类', () => {
    const entries = createMetricEntries([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);

    const series = buildRankedDeckChartSeries(entries, 'playerEqualUsageRate', new Map());

    expect(recognizedItems(series)).toHaveLength(12);
    expect(otherRecognizedItem(series)?.value).toBe(10);
    expect(series.reduce((sum, item) => sum + item.value, 0)).toBe(136);
  });
});

function createMetricEntries(
  values: readonly number[],
  metric: DeckEnvironmentRateKey = 'playerEqualUsageRate'
): DeckArchetypeEnvironmentEntryView[] {
  return values.map((value, index) => createEntry(index, { [metric]: value }));
}

function createEntry(
  index: number,
  overrides: Partial<DeckArchetypeEnvironmentEntryView> = {}
): DeckArchetypeEnvironmentEntryView {
  return {
    archetypeId: `archetype-${index}`,
    archetypeKey: `key-${index}`,
    name: `分类 ${index}`,
    groupName: '测试分类',
    color: `#${String(index).padStart(6, '0')}`,
    representativeCardCode: null,
    representativeImageFilename: null,
    sortOrder: index,
    classificationStatus: 'CLASSIFIED',
    appearanceCount: 0,
    winnerCount: 0,
    playerCount: 0,
    playerEqualUsageRate: 0,
    matchEqualUsageRate: 0,
    playerEqualWinnerRate: 0,
    matchEqualWinnerRate: 0,
    winRate: null,
    nonMirrorAppearanceCount: 0,
    nonMirrorWinRate: null,
    mirrorAppearanceCount: 0,
    topRankedPlayerEqualUsageRate: 0,
    ...overrides,
  };
}

function recognizedItems(series: ReturnType<typeof buildRankedDeckChartSeries>) {
  return series.filter((item) => item.id.startsWith('archetype-'));
}

function otherRecognizedItem(series: ReturnType<typeof buildRankedDeckChartSeries>) {
  return series.find((item) => item.id === 'visual:other-recognized');
}
