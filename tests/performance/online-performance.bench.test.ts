import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createMulliganCommand } from '../../src/application/game-commands';
import type { DeckConfig } from '../../src/application/game-service';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import { CardType, HeartColor } from '../../src/shared/types/enums';
import type { OnlineMatchSnapshot } from '../../src/online';

const RUN_PERF = process.env.RUN_PERF === '1';
const describePerf = RUN_PERF ? describe : describe.skip;

const SAMPLE_COUNT = Number(process.env.PERF_SAMPLES ?? 250);
const WARMUP_COUNT = Number(process.env.PERF_WARMUP ?? 25);

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

function createRuntimeDeck(prefix: string): DeckConfig {
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

function createOnlineMatch(): {
  matchService: OnlineMatchService;
  matchId: string;
} {
  const matchService = new OnlineMatchService();
  const match = matchService.createMatch({
    roomCode: 'PERF01',
    first: {
      userId: 'u1',
      displayName: 'Alpha',
      deck: createRuntimeDeck('A'),
    },
    second: {
      userId: 'u2',
      displayName: 'Beta',
      deck: createRuntimeDeck('B'),
    },
  });

  return { matchService, matchId: match.matchId };
}

function measure(label: string, sample: () => void): BenchmarkStats {
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

interface BenchmarkStats {
  readonly label: string;
  readonly samples: number;
  readonly minMs: string;
  readonly avgMs: string;
  readonly p50Ms: string;
  readonly p95Ms: string;
  readonly maxMs: string;
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

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

describePerf('online match performance benchmark', () => {
  it('measures formal online JSON-native snapshot and command response hot paths', () => {
    const { matchService, matchId } = createOnlineMatch();
    const firstSnapshot = matchService.getMatchSnapshot(matchId, 'u1') as OnlineMatchSnapshot;
    expect(firstSnapshot.playerViewState.objects).toBeTruthy();

    const snapshotEnvelope = { data: firstSnapshot, error: null };
    const snapshotJson = JSON.stringify(snapshotEnvelope);
    const snapshotBytes = Buffer.byteLength(snapshotJson, 'utf8');
    const objectCount = Object.keys(firstSnapshot.playerViewState.objects).length;
    const zoneCount = Object.keys(firstSnapshot.playerViewState.table.zones).length;

    const commandResult = matchService.executeCommand(
      matchId,
      'u1',
      createMulliganCommand('client-player-id-is-ignored', [])
    );
    expect(commandResult?.success).toBe(true);
    expect(commandResult?.snapshot).toBeTruthy();

    const afterCommandSeq = commandResult?.snapshot?.seq ?? firstSnapshot.seq;
    const unchangedStats = measure('snapshot unchanged short-circuit', () => {
      const response = matchService.getMatchSnapshot(matchId, 'u1', {
        sinceSeq: afterCommandSeq,
      });
      if (!response || !('modified' in response)) {
        throw new Error('Expected unchanged snapshot response');
      }
    });

    const fullSnapshotStats = measure('snapshot full projection', () => {
      const response = matchService.getMatchSnapshot(matchId, 'u1') as OnlineMatchSnapshot;
      if (!response.playerViewState) {
        throw new Error('Expected full snapshot response');
      }
    });

    const snapshotResponseRoundTripStats = measure('snapshot response JSON round-trip', () => {
      JSON.parse(JSON.stringify(snapshotEnvelope)) as unknown;
    });

    const commandResponseEnvelope = { data: commandResult, error: null };
    const commandResponseBytes = byteLength(commandResponseEnvelope);
    const commandResponseRoundTripStats = measure('command response JSON round-trip', () => {
      JSON.parse(JSON.stringify(commandResponseEnvelope)) as unknown;
    });

    console.log('\nOnline performance benchmark');
    console.table({
      config: {
        samples: SAMPLE_COUNT,
        warmup: WARMUP_COUNT,
        objects: objectCount,
        zones: zoneCount,
        snapshotBytes,
        commandResponseBytes,
      },
    });
    console.table([
      unchangedStats,
      fullSnapshotStats,
      snapshotResponseRoundTripStats,
      commandResponseRoundTripStats,
    ]);
  });
});
