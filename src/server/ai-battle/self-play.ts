import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Seat } from '../../online/types.js';
import type { AiMatchBilling } from '../../online/ai-battle-billing-types.js';
import { OnlineMatchService } from '../services/online-match-service.js';
import { AiBattleDriver, type AiBattleModelClient } from './driver.js';
import { AiBattleBilling } from './billing.js';
import { LocalAiArchive } from './local-archive.js';
import { AiBattleTraceStore } from './trace-store.js';
import type { AiFrozenKnowledge, AiFrozenPreset } from './presets.js';
import type { AiBattleModel } from '../../online/ai-battle-model-registry.js';

const seats = ['FIRST', 'SECOND'] as const;
const cnyUnits = (amount: string) => {
  if (!/^\d+(\.\d{1,8})?$/.test(amount)) throw new Error('Invalid CNY amount');
  const [integer, fraction = ''] = amount.split('.');
  return BigInt(integer) * 100_000_000n + BigInt(fraction.padEnd(8, '0'));
};
const cnyText = (units: bigint) =>
  `${units / 100_000_000n}.${String(units % 100_000_000n).padStart(8, '0')}`;

interface PreviousSelfPlayUsage {
  readonly estimatedCny: string;
  readonly reservedUnknownCny?: string;
  readonly reservedUnknownAttempts?: number;
  readonly attempts: number;
  readonly unreportedAttempts: number;
  readonly admittedRequests: number;
}

/** Shared across seats and rounds; request admission also covers LIVE query continuations. */
export class AiSelfPlayBudget {
  private readonly billings = new Set<AiBattleBilling>();
  private admittedRequests = 0;
  constructor(
    readonly maxCny: string,
    readonly maxRequests: number,
    private readonly previous: PreviousSelfPlayUsage = {
      estimatedCny: '0',
      attempts: 0,
      unreportedAttempts: 0,
      admittedRequests: 0,
    }
  ) {
    if (cnyUnits(maxCny) <= 0n || !Number.isSafeInteger(maxRequests) || maxRequests < 1)
      throw new Error('Self-play requires a positive total CNY and request budget');
    cnyUnits(previous.estimatedCny);
    if (
      cnyUnits(previous.reservedUnknownCny ?? '0') > cnyUnits(previous.estimatedCny) ||
      (previous.reservedUnknownAttempts ?? 0) > previous.unreportedAttempts ||
      previous.unreportedAttempts > previous.attempts
    )
      throw new Error('Invalid unknown usage reservation');
    if (
      [
        previous.attempts,
        previous.unreportedAttempts,
        previous.admittedRequests,
        previous.reservedUnknownAttempts ?? 0,
      ].some((value) => !Number.isSafeInteger(value) || value < 0)
    )
      throw new Error('Invalid previous experiment usage');
    this.admittedRequests = previous.admittedRequests;
  }
  register(billing: AiBattleBilling): void {
    this.billings.add(billing);
  }
  summary() {
    const bills = [...this.billings].map((billing) => billing.view());
    const known = bills.reduce(
      (total, bill) => total + cnyUnits(bill.estimatedCny ?? '0'),
      cnyUnits(this.previous.estimatedCny) - cnyUnits(this.previous.reservedUnknownCny ?? '0')
    );
    return {
      maxCny: this.maxCny,
      maxRequests: this.maxRequests,
      admittedRequests: this.admittedRequests,
      attempts: bills.reduce((total, bill) => total + bill.attempts, this.previous.attempts),
      unreportedAttempts: bills.reduce(
        (total, bill) => total + bill.unreportedAttempts,
        this.previous.unreportedAttempts
      ),
      knownEstimatedCny: cnyText(known),
      reservedUnknownCny: this.previous.reservedUnknownCny ?? '0',
      reservedUnknownAttempts: this.previous.reservedUnknownAttempts ?? 0,
      estimatedCny: cnyText(known + cnyUnits(this.previous.reservedUnknownCny ?? '0')),
    };
  }
  admit(body: string, billing: AiBattleBilling, maxOutputTokens: number): string | null {
    if (
      !this.billings.has(billing) ||
      !Number.isSafeInteger(maxOutputTokens) ||
      maxOutputTokens < 1
    )
      throw new Error('Request budget requires a registered billing and positive output cap');
    const summary = this.summary();
    if (summary.unreportedAttempts > summary.reservedUnknownAttempts)
      return 'EXPERIMENT_USAGE_UNKNOWN';
    if (this.admittedRequests >= this.maxRequests) return 'EXPERIMENT_REQUEST_LIMIT';
    const prices = billing.view().prices;
    if (!prices) return 'EXPERIMENT_REQUIRES_API_PRICING';
    // Reserve a conservative request estimate using UTF-8 bytes as the input token bound,
    // full uncached input price, and the explicit output cap. Actual usage remains authoritative.
    const reserve =
      BigInt(Buffer.byteLength(body)) * BigInt(prices.inputTokens) +
      BigInt(maxOutputTokens) * BigInt(prices.outputTokens);
    if (cnyUnits(summary.estimatedCny) + reserve > cnyUnits(this.maxCny))
      return 'EXPERIMENT_CNY_LIMIT';
    this.admittedRequests++;
    return null;
  }
}

export interface AiSelfPlaySeat {
  readonly preset: AiFrozenPreset;
  readonly knowledge: AiFrozenKnowledge;
  readonly model: AiBattleModel;
  readonly createModel: (
    traces: AiBattleTraceStore,
    billing: AiBattleBilling
  ) => Promise<AiBattleModelClient>;
}

export interface AiSelfPlayOptions {
  readonly FIRST: AiSelfPlaySeat;
  readonly SECOND: AiSelfPlaySeat;
  readonly directory: string;
  readonly budget: AiSelfPlayBudget;
  readonly matches?: OnlineMatchService;
  readonly signal?: AbortSignal;
  readonly maxDurationMs?: number;
  readonly maxCommands?: number;
  readonly progress?: (value: {
    matchId: string;
    turn: number;
    commandCount: number;
    budget: ReturnType<AiSelfPlayBudget['summary']>;
  }) => void;
}

/** Local headless evaluation. No account decks, HTTP endpoints or database records are written. */
export async function runAiSelfPlay(options: AiSelfPlayOptions) {
  const matches = options.matches ?? new OnlineMatchService({ recorder: null });
  const driver = new AiBattleDriver(matches);
  const traces = { FIRST: new AiBattleTraceStore(), SECOND: new AiBattleTraceStore() };
  const archives: Partial<Record<Seat, LocalAiArchive>> = {};
  const exports: Partial<Record<Seat, string>> = {};
  const models: Partial<Record<Seat, AiBattleModelClient>> = {};
  const billings: Partial<Record<Seat, AiBattleBilling>> = {};
  const startedAt = Date.now();
  const maxDurationMs = options.maxDurationMs ?? 30 * 60_000;
  const maxCommands = options.maxCommands ?? 2000;
  if (
    !Number.isSafeInteger(maxDurationMs) ||
    maxDurationMs < 1 ||
    !Number.isSafeInteger(maxCommands) ||
    maxCommands < 1
  )
    throw new Error('Invalid self-play limits');
  let matchId: string | undefined;
  let stopReason: string | null = null;
  let endedAt = startedAt;
  let final: {
    naturalEnd: boolean;
    winnerSeat: Seat | null;
    endReason: string | null;
    turn: number;
    commandCount: number;
  } = { naturalEnd: false, winnerSeat: null, endReason: null, turn: 0, commandCount: 0 };
  try {
    for (const seat of seats) {
      const billing = new AiBattleBilling(
        options[seat].model,
        { save: async () => {}, read: async () => null, readOwned: async () => null },
        (id, value, decisionId, delta) => traces[seat].updateBilling(id, value, decisionId, delta)
      );
      billings[seat] = billing;
      options.budget.register(billing);
      const model = await options[seat].createModel(traces[seat], billing);
      const requests = new Set<Promise<Awaited<ReturnType<AiBattleModelClient['decide']>>>>();
      let disposal: Promise<void> | undefined;
      // Infrastructure failures stop an experiment rather than spending on retries or a fallback.
      models[seat] = {
        configurationMaterial: model.configurationMaterial,
        requestTimeoutMs: model.requestTimeoutMs,
        stopOnTimeout: true,
        dispose: () =>
          (disposal ??= (async () => {
            await model.dispose?.();
            await Promise.allSettled([...requests]);
          })()),
        decide: async (...args) => {
          if (options.signal?.aborted)
            return { kind: 'ADAPTER_ERROR', message: 'EXPERIMENT_CANCELLED' };
          if (Object.values(archives).some((archive) => archive.status().state === 'FAILED'))
            return { kind: 'ADAPTER_ERROR', message: 'EXPERIMENT_EVIDENCE_FAILED' };
          const request = model.decide(...args);
          requests.add(request);
          let outcome;
          try {
            outcome = await request;
          } finally {
            requests.delete(request);
          }
          return outcome.kind === 'SERVICE_ERROR'
            ? { kind: 'ADAPTER_ERROR', message: `EXPERIMENT_PROVIDER_FAILURE: ${outcome.message}` }
            : outcome;
        },
      };
    }
    if (options.signal?.aborted) throw new Error('EXPERIMENT_CANCELLED');
    const ownerUserId = `local:self-play:${randomUUID()}`;
    const participant = (seat: Seat) => ({
      userId: `system:ai-battle:${randomUUID()}`,
      displayName: `AI ${seat}`,
      participantKind: 'SYSTEM' as const,
      ownerUserId,
      deck: options[seat].preset.deck,
      deckName: options[seat].preset.name,
      deckSource: 'PUBLISHED_CARDS_SNAPSHOT' as const,
      pointValidation: options[seat].preset.pointValidation,
    });
    const match = await matches.createMatch({
      roomCode: `AI-${randomUUID()}`,
      originKind: 'AI_DEBUG',
      originLabel: 'AI 自对弈',
      matchMode: 'ONLINE',
      automationGameMode: 'DEBUG',
      first: participant('FIRST'),
      second: participant('SECOND'),
    });
    matchId = match.matchId;
    for (const seat of seats) {
      archives[seat] = await LocalAiArchive.create(
        { directory: join(options.directory, seat), frontendOrigin: 'http://localhost' },
        matchId
      );
      const knowledge = options[seat].knowledge;
      if (
        !traces[seat].open(
          matchId,
          [
            knowledge.rules,
            knowledge.tutorial,
            knowledge.handbook,
            knowledge.ownDeck,
            ...(models[seat]!.configurationMaterial ? [models[seat]!.configurationMaterial!] : []),
          ],
          archives[seat]
        )
      )
        throw new Error('EXPERIMENT_TRACE_OPEN_FAILED');
      await billings[seat]!.initialize(matchId);
    }
    await driver.startSelfPlay(matchId, models as Record<Seat, AiBattleModelClient>, {
      FIRST: traces.FIRST.bind(matchId),
      SECOND: traces.SECOND.bind(matchId),
    });
    let lastProgress = 0;
    while (true) {
      const state = match.session.state!;
      const commandCount = match.session.getRuntimeStats().currentCommandSeq;
      const status = matches.getAiBattleStatus(matchId);
      if (state.isEnded) break;
      stopReason = options.signal?.aborted
        ? 'EXPERIMENT_CANCELLED'
        : Date.now() - startedAt >= maxDurationMs
          ? 'EXPERIMENT_TIME_LIMIT'
          : commandCount >= maxCommands
            ? 'EXPERIMENT_COMMAND_LIMIT'
            : (status?.stoppedReason ?? null);
      if (stopReason) break;
      if (Date.now() - lastProgress >= 15_000) {
        options.progress?.({
          matchId,
          turn: state.turnCount,
          commandCount,
          budget: options.budget.summary(),
        });
        lastProgress = Date.now();
      }
      await delay(100);
    }
    const state = match.session.state!;
    final = {
      naturalEnd: state.isEnded,
      winnerSeat:
        seats.find((seat) => match.participants[seat].playerId === state.endInfo?.winnerId) ?? null,
      endReason: state.endInfo?.reason ?? null,
      turn: state.turnCount,
      commandCount: match.session.getRuntimeStats().currentCommandSeq,
    };
  } catch (error) {
    stopReason = error instanceof Error ? error.message : 'EXPERIMENT_FAILED';
  } finally {
    if (matchId) await matches.stopAiBattle(matchId, stopReason ?? 'EXPERIMENT_FINISHED');
    await driver.stop(matchId ?? '');
    // Also dispose clients created before registration or after a failed driver startup.
    for (const model of Object.values(models)) await model.dispose?.();
    endedAt = Date.now();
    const match = matchId ? matches.getMatch(matchId) : null;
    if (matchId && match)
      for (const seat of seats) {
        const snapshot = await matches.getMatchSnapshot(matchId, match.participants[seat].userId);
        const identity = {
          id: `${seat}:final`,
          revision: match.remoteRevision,
          windowKey: 'EXPERIMENT_FINAL',
          seat,
          purpose: final.naturalEnd ? 'ENDED' : 'STOPPED',
        };
        traces[seat].begin(matchId, identity);
        traces[seat].append(
          matchId,
          identity.id,
          'SAMPLE',
          {
            identity,
            queryKind: identity.purpose,
            view: snapshot?.playerViewState ?? null,
            input: null,
          },
          { status: identity.purpose }
        );
        traces[seat].append(matchId, identity.id, 'EXPERIMENT_RESULT', { ...final, stopReason });
      }
    if (matchId) for (const seat of seats) traces[seat].end(matchId, endedAt);
    if (matchId)
      await matches.deleteMatch(matchId, { reason: stopReason ?? 'EXPERIMENT_FINISHED' });
    for (const archive of Object.values(archives)) await archive.close();
    for (const seat of seats) {
      const archive = archives[seat];
      if (!archive) continue;
      const snapshot = await archive.snapshot();
      const exportPath = `${archive.path}.export.jsonl`;
      await pipeline(
        Readable.from(
          (async function* () {
            yield snapshot.manifest;
            if (snapshot.stream) yield* snapshot.stream;
          })()
        ),
        createWriteStream(exportPath, { flags: 'wx', mode: 0o600 })
      );
      exports[seat] = exportPath;
    }
  }
  return {
    format: 'loveca-ai-self-play-v1' as const,
    matchId: matchId ?? null,
    startedAt,
    endedAt,
    ...final,
    stopReason,
    budget: options.budget.summary(),
    seats: Object.fromEntries(
      seats.map((seat) => [
        seat,
        {
          model: options[seat].model,
          presetId: options[seat].preset.id,
          sourceHashes: Object.values(options[seat].knowledge).map(({ id, sha256 }) => ({
            id,
            sha256,
          })),
          billing: billings[seat]?.view() ?? null,
          archive: archives[seat]?.path ?? null,
          exportPath: exports[seat] ?? null,
          archiveStatus: archives[seat]?.status() ?? null,
        },
      ])
    ) as Record<
      Seat,
      {
        model: AiBattleModel;
        presetId: string;
        sourceHashes: { id: string; sha256: string }[];
        billing: AiMatchBilling | null;
        archive: string | null;
        exportPath: string | null;
        archiveStatus: ReturnType<LocalAiArchive['status']> | null;
      }
    >,
  };
}
