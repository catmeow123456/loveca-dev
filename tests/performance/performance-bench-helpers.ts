import { performance } from 'node:perf_hooks';
import type { DeckConfig } from '../../src/application/game-service';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { CardType, HeartColor } from '../../src/shared/types/enums';

export const RUN_PERF = process.env.RUN_PERF === '1';
export const SAMPLE_COUNT = Number(process.env.PERF_SAMPLES ?? 250);
export const WARMUP_COUNT = Number(process.env.PERF_WARMUP ?? 25);

export interface BenchmarkStats {
  readonly label: string;
  readonly samples: number;
  readonly minMs: string;
  readonly avgMs: string;
  readonly p50Ms: string;
  readonly p95Ms: string;
  readonly maxMs: string;
}

export function measure(label: string, sample: () => void): BenchmarkStats {
  for (let i = 0; i < WARMUP_COUNT; i += 1) {
    sample();
  }

  const samples: number[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const startedAt = performance.now();
    sample();
    samples.push(performance.now() - startedAt);
  }

  return summarize(label, samples);
}

export async function measureAsync(
  label: string,
  sample: () => Promise<void>
): Promise<BenchmarkStats> {
  for (let i = 0; i < WARMUP_COUNT; i += 1) {
    await sample();
  }

  const samples: number[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const startedAt = performance.now();
    await sample();
    samples.push(performance.now() - startedAt);
  }

  return summarize(label, samples);
}

export function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function createRuntimeDeck(prefix: string): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  const energyDeck: AnyCardData[] = [];

  for (let i = 0; i < 48; i += 1) {
    mainDeck.push(createMemberCard(`${prefix}-MEM-${i}`));
  }

  for (let i = 0; i < 12; i += 1) {
    mainDeck.push(createLiveCard(`${prefix}-LIVE-${i}`));
    energyDeck.push(createEnergyCard(`${prefix}-ENE-${i}`));
  }

  return { mainDeck, energyDeck };
}

function createMemberCard(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: `成员 ${cardCode}`,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: `Live ${cardCode}`,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: `能量 ${cardCode}`,
    cardType: CardType.ENERGY,
  };
}

function summarize(label: string, samples: readonly number[]): BenchmarkStats {
  const sorted = [...samples].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    label,
    samples: sorted.length,
    minMs: formatMs(sorted[0] ?? 0),
    avgMs: formatMs(total / Math.max(sorted.length, 1)),
    p50Ms: formatMs(percentile(sorted, 0.5)),
    p95Ms: formatMs(percentile(sorted, 0.95)),
    maxMs: formatMs(sorted.at(-1) ?? 0),
  };
}

function percentile(sortedSamples: readonly number[], quantile: number): number {
  if (sortedSamples.length === 0) {
    return 0;
  }

  const index = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil(sortedSamples.length * quantile) - 1)
  );
  return sortedSamples[index] ?? 0;
}

function formatMs(value: number): string {
  return value.toFixed(3);
}
