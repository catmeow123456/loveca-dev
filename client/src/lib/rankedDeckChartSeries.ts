import type { DonutChartItem } from '@/components/charts/DonutChart';
import { resolveCardImagePath } from '@/lib/imageService';
import type { AnyCardData } from '@game/domain/entities/card';
import type { DeckArchetypeEnvironmentEntryView } from '@game/online/deck-classifier-types';

export type DeckEnvironmentRateKey =
  | 'playerEqualUsageRate'
  | 'playerEqualWinnerRate'
  | 'matchEqualUsageRate'
  | 'matchEqualWinnerRate'
  | 'topRankedPlayerEqualUsageRate';

const MIN_VISIBLE_DECK_ARCHETYPES = 12;
const MAX_VISIBLE_DECK_ARCHETYPES = 16;
const MAX_OTHER_RECOGNIZED_SHARE = 0.15;
const FLOATING_POINT_TOLERANCE = 1e-12;

export function buildRankedDeckChartSeries(
  entries: readonly DeckArchetypeEnvironmentEntryView[],
  metric: DeckEnvironmentRateKey,
  cardDataRegistry: ReadonlyMap<string, AnyCardData>
): DonutChartItem[] {
  const classified = entries
    .filter(
      (entry) => entry.classificationStatus === 'CLASSIFIED' && isFinitePositive(entry[metric])
    )
    .sort((left, right) => right[metric] - left[metric] || left.sortOrder - right.sortOrder);
  const special = entries
    .filter(
      (entry) => entry.classificationStatus !== 'CLASSIFIED' && isFinitePositive(entry[metric])
    )
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const chartTotal = [...classified, ...special].reduce((sum, entry) => sum + entry[metric], 0);
  const maximumVisibleCount = Math.min(MAX_VISIBLE_DECK_ARCHETYPES, classified.length);
  let visibleCount = Math.min(MIN_VISIBLE_DECK_ARCHETYPES, classified.length);
  let remainder = sumMetric(classified.slice(visibleCount), metric);

  while (
    visibleCount < maximumVisibleCount &&
    remainder / chartTotal > MAX_OTHER_RECOGNIZED_SHARE + FLOATING_POINT_TOLERANCE
  ) {
    visibleCount += 1;
    remainder = sumMetric(classified.slice(visibleCount), metric);
  }

  const series: DonutChartItem[] = classified.slice(0, visibleCount).map((entry) => ({
    id: entry.archetypeId,
    label: entry.name,
    value: entry[metric],
    color: entry.color,
    ...(entry.representativeCardCode
      ? {
          imageUrl: resolveCardImagePath(
            {
              cardCode: entry.representativeCardCode,
              imageFilename: entry.representativeImageFilename,
            },
            'medium'
          ),
          imageCrop:
            cardDataRegistry.get(entry.representativeCardCode)?.cardType === 'LIVE'
              ? 'live'
              : 'portrait',
        }
      : {}),
  }));

  if (remainder > 0) {
    series.push({
      id: 'visual:other-recognized',
      label: '其他已识别卡组',
      value: remainder,
      color: '#CBD5E1',
    });
  }

  series.push(
    ...special.map((entry) => ({
      id: entry.archetypeId,
      label: entry.name,
      value: entry[metric],
      color: entry.color,
    }))
  );
  return series;
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function sumMetric(
  entries: readonly DeckArchetypeEnvironmentEntryView[],
  metric: DeckEnvironmentRateKey
): number {
  return entries.reduce((sum, entry) => sum + entry[metric], 0);
}
