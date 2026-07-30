import { describe, expect, it } from 'vitest';
import {
  buildAiDecisionContract,
  materializeAiDecisionCommand,
} from '../../src/application/ai-decisions';
import type { Seat } from '../../src/online';
import { buildAiObservation } from '../../src/server/ai-battle/ai-observation';
import { loadCertifiedAiDeckFromRegistry } from '../../src/server/ai-battle/certified-deck-loader';
import { selectExplainableDecision } from '../../src/server/ai-battle/explainable-decision-policy';
import { createAiModelInvocationRuntime } from '../../src/server/ai-battle/model-governance';
import {
  AI_MODEL_ID,
  AI_MODEL_PROVIDER_PROFILE_VERSION,
  type AiModelProvider,
  type AiModelProviderResult,
} from '../../src/server/ai-battle/model-provider';
import type { MachineDecisionTimerHandle } from '../../src/server/ai-battle/machine-decision-scheduler';
import { AI_MODEL_DECISION_OUTPUT_SCHEMA_VERSION } from '../../src/server/ai-battle/model-protocol';
import {
  AI_BATTLE_PHASE_ZERO_DECKS,
  type AiBattlePhaseZeroDeckKey,
} from '../../src/server/ai-battle/phase-zero-baseline';
import type { ServerDeadlineTimerHandle } from '../../src/server/ai-battle/server-deadline-owner';
import { buildAiStrategyContext } from '../../src/server/ai-battle/strategy-context';
import { createAiSelectedHistoryTracker } from '../../src/server/ai-battle/strategy-history';
import { AiBattlePhaseThreeService } from '../../src/server/services/ai-battle-phase-three-service';
import {
  OnlineMatchService,
  type OnlineMatchState,
} from '../../src/server/services/online-match-service';
import type {
  AppendMatchRecordFrameInput,
  MatchRecorderService,
} from '../../src/server/services/match-recorder-service';
import { aiBattleAuthoritativeCardRegistry } from '../helpers/ai-battle-phase-zero-decks';

interface ManualTimerHandle extends MachineDecisionTimerHandle, ServerDeadlineTimerHandle {
  readonly id: number;
}

function createManualTimers(onAdvance?: (delayMs: number) => void) {
  let sequence = 0;
  const jobs = new Map<
    number,
    {
      readonly callback: () => void;
      readonly delayMs: number;
      cancelled: boolean;
      fired: boolean;
    }
  >();
  return {
    scheduleTimer: (callback: () => void, delayMs: number): ManualTimerHandle => {
      const id = ++sequence;
      jobs.set(id, { callback, delayMs, cancelled: false, fired: false });
      return { id };
    },
    cancelTimer: (handle: MachineDecisionTimerHandle | ServerDeadlineTimerHandle) => {
      const job = jobs.get((handle as ManualTimerHandle).id);
      if (job) job.cancelled = true;
    },
    fireNext: () => {
      const job = [...jobs.values()].find((candidate) => !candidate.fired && !candidate.cancelled);
      if (!job) return false;
      job.fired = true;
      onAdvance?.(job.delayMs);
      job.callback();
      return true;
    },
    pendingCount: () => [...jobs.values()].filter((job) => !job.fired && !job.cancelled).length,
  };
}

function createRecorderHarness() {
  const frames: AppendMatchRecordFrameInput[] = [];
  const recorder: Pick<
    MatchRecorderService,
    | 'beginMatch'
    | 'recordInitialCheckpoint'
    | 'markPartial'
    | 'sealMatch'
    | 'getRecordCursor'
    | 'appendMatchRecordFrame'
  > = {
    beginMatch: (input) =>
      Promise.resolve({
        matchId: input.matchId,
        status: 'IN_PROGRESS',
        completeness: 'FULL',
        turnCount: 0,
        lastTimelineSeq: 0,
        lastCheckpointSeq: 0,
        lastPublicSeq: 0,
        lastPrivateSeqBySeat: { FIRST: 0, SECOND: 0 },
        lastAuditSeq: 0,
        lastCommandSeq: 0,
        lastGameEventSeq: 0,
        recordSchemaVersion: 1,
      }),
    recordInitialCheckpoint: (input) =>
      Promise.resolve({
        matchId: input.matchId,
        timelineSeq: 1,
        checkpointSeq: 1,
        payloadHash: 'sha256:initial',
      }),
    markPartial: () => Promise.resolve(),
    sealMatch: (input) =>
      Promise.resolve({
        matchId: input.matchId,
        timelineSeq: frames.length + 2,
        status: input.status,
        completeness: input.completeness ?? 'FULL',
      }),
    getRecordCursor: (matchId) =>
      Promise.resolve({
        matchId,
        status: 'IN_PROGRESS',
        completeness: 'FULL',
        turnCount: 0,
        lastTimelineSeq: frames.length + 1,
        lastCheckpointSeq: 1,
        lastPublicSeq: 0,
        lastPrivateSeqBySeat: { FIRST: 0, SECOND: 0 },
        lastAuditSeq: 0,
        lastCommandSeq: 0,
        lastGameEventSeq: 0,
      }),
    appendMatchRecordFrame: (input) => {
      frames.push(input);
      return Promise.resolve({
        matchId: input.matchId,
        timelineSeq: frames.length + 1,
        checkpointSeq: input.writeAuthorityCheckpoint === false ? null : frames.length + 1,
        payloadHash: input.writeAuthorityCheckpoint === false ? null : 'sha256:frame',
      });
    },
  };
  return { frames, recorder };
}

function createExplainableFakeProvider(onInvoke?: () => void): AiModelProvider {
  return {
    providerId: 'ALIBABA_DASHSCOPE',
    profileVersion: AI_MODEL_PROVIDER_PROFILE_VERSION,
    modelId: AI_MODEL_ID,
    invoke(request): Promise<AiModelProviderResult> {
      onInvoke?.();
      const userPayload = JSON.parse(request.userMessage) as {
        readonly strategyContext: Parameters<typeof selectExplainableDecision>[0];
      };
      const selected = selectExplainableDecision(userPayload.strategyContext);
      if (!selected.ok) {
        return Promise.resolve({ ok: false, code: 'INVALID_RESPONSE', retryable: false });
      }
      return Promise.resolve({
        ok: true,
        rawOutput: JSON.stringify({
          schemaVersion: AI_MODEL_DECISION_OUTPUT_SCHEMA_VERSION,
          selection: selected.selection,
          summary: selected.summary,
        }),
        usage: { inputTokens: 800, outputTokens: 60, totalTokens: 860 },
        providerRequestId: 'fake-provider-request-id',
        finishReason: 'stop',
      });
    },
  };
}

async function createBattleHarness(input: {
  readonly provider: AiModelProvider;
  readonly recorder?: ReturnType<typeof createRecorderHarness>['recorder'] | null;
}) {
  let now = 10_000;
  const machineTimers = createManualTimers((delayMs) => {
    now += Math.max(2_000, delayMs);
  });
  const deadlineTimers = createManualTimers((delayMs) => {
    now += Math.max(2_000, delayMs);
  });
  const matchService = new OnlineMatchService({
    recorder: input.recorder ?? null,
    idGenerator: () => 'phase-four-match',
    now: () => now,
    machineDecisionSchedulingEnabled: true,
    machineDecisionRuntimeEpoch: 'phase-four-decision',
    machineDecisionIdGenerator: () => `lease-${String(now)}`,
    machineDecisionSchedulerRuntimeEpoch: 'phase-four-scheduler',
    machineDecisionSchedulerIdGenerator: () => `schedule-${String(now)}`,
    machineDecisionScheduleTimer: machineTimers.scheduleTimer,
    machineDecisionCancelTimer: machineTimers.cancelTimer,
    deadlineScheduleTimer: deadlineTimers.scheduleTimer,
    deadlineCancelTimer: deadlineTimers.cancelTimer,
    aiDebugTraceEnabled: true,
    modelInvocationRuntime: createAiModelInvocationRuntime({
      provider: input.provider,
      now: () => now,
    }),
  });
  const deck = await loadCertifiedAiDeckFromRegistry(
    'MUSE_STARTER',
    aiBattleAuthoritativeCardRegistry
  );
  const entry = new AiBattlePhaseThreeService({
    matchService,
    idGenerator: () => 'phase-four-entry',
    now: () => now,
    loadUserProfile: (userId) => Promise.resolve({ userId, displayName: 'Phase 4 玩家' }),
    loadCertifiedDeck: () => Promise.resolve(deck),
  });
  const battle = await entry.createBattle({
    humanUserId: 'phase-four-human',
    humanDeckKey: 'MUSE_STARTER',
    aiDeckKey: 'MUSE_STARTER',
    aiSeat: 'FIRST',
  });
  return {
    battle,
    matchService,
    match: matchService.getMatch(battle.matchId)!,
    machineTimers,
    deadlineTimers,
    now: () => now,
    advanceNow: () => {
      now += 2_000;
    },
  };
}

async function waitForMachineCallback(service: OnlineMatchService, matchId: string): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (!service.serialExecutor.hasPendingOperations(matchId)) {
      await Promise.resolve();
      if (!service.serialExecutor.hasPendingOperations(matchId)) return;
    }
    await Promise.resolve();
  }
  throw new Error(`${matchId} machine callback did not settle`);
}

describe('AI battle Phase 4 formal model runtime', () => {
  it('waits for the provider outside the match lock and atomically records sanitized model facts', async () => {
    let releaseProvider: ((result: AiModelProviderResult) => void) | undefined;
    let providerStarted = false;
    const provider: AiModelProvider = {
      providerId: 'ALIBABA_DASHSCOPE',
      profileVersion: AI_MODEL_PROVIDER_PROFILE_VERSION,
      modelId: AI_MODEL_ID,
      invoke: () =>
        new Promise<AiModelProviderResult>((resolve) => {
          providerStarted = true;
          releaseProvider = resolve;
        }),
    };
    const recorderHarness = createRecorderHarness();
    const harness = await createBattleHarness({
      provider,
      recorder: recorderHarness.recorder,
    });
    const revisionBefore = harness.match.remoteRevision;
    expect(harness.machineTimers.fireNext()).toBe(true);
    for (let attempt = 0; attempt < 20 && !providerStarted; attempt += 1) {
      await Promise.resolve();
    }
    expect(providerStarted).toBe(true);

    let acquiredWhileProviderPending = false;
    await harness.matchService.serialExecutor.runExclusive(harness.match.matchId, () => {
      acquiredWhileProviderPending = true;
    });
    expect(acquiredWhileProviderPending).toBe(true);

    releaseProvider?.({
      ok: true,
      rawOutput: JSON.stringify({
        schemaVersion: AI_MODEL_DECISION_OUTPUT_SCHEMA_VERSION,
        selection: { kind: 'MULLIGAN', candidateIds: [] },
        summary: 'Keep one LIVE and improve the opening curve.',
      }),
      usage: { inputTokens: 900, outputTokens: 50, totalTokens: 950 },
      providerRequestId: 'must-only-appear-as-hash',
      finishReason: 'stop',
    });
    await waitForAuthorityRevision(harness.matchService, harness.match, revisionBefore + 1);

    const record = recorderHarness.frames
      .flatMap((frame) => frame.decisionRecords ?? [])
      .find((item) => item.decisionType === 'AI_STRATEGY_SUBMITTED')?.strategyRecord;
    expect(record).toMatchObject({
      decisionAudit: {
        policyVersion: 'ai-battle.model-decision-policy/v1',
        reasonCode: 'MODEL_STRUCTURED_SELECTION',
      },
      modelInvocation: {
        finalOutcome: 'MODEL_SELECTION',
        attempts: [
          {
            outcome: 'SUCCESS',
          },
        ],
      },
      execution: { status: 'ACCEPTED' },
    });
    expect(record?.modelInvocation?.attempts[0]?.providerRequestIdSha256).toMatch(
      /^sha256:[a-f0-9]{64}$/
    );
    expect(JSON.stringify(record)).not.toContain('must-only-appear-as-hash');
    expect(JSON.stringify(record)).not.toContain('phase-four-match');

    const debugTrace = await harness.matchService.getAiBattleDebugTrace(
      harness.match.matchId,
      'phase-four-human'
    );
    expect(debugTrace).toMatchObject({
      enabled: true,
      entries: [
        {
          stage: 'STARTED',
          decisionKind: 'MULLIGAN',
          source: 'MODEL',
        },
        {
          stage: 'COMPLETED',
          decisionKind: 'MULLIGAN',
          source: 'MODEL',
          summary: 'Keep one LIVE and improve the opening curve.',
          selection: { kind: 'MULLIGAN', selectedCount: 0, label: '换牌 0 张' },
          model: {
            modelId: AI_MODEL_ID,
            attemptCount: 1,
            inputTokens: 900,
            outputTokens: 50,
          },
          executionStatus: 'ACCEPTED',
        },
      ],
    });
    expect(JSON.stringify(debugTrace)).not.toContain('must-only-appear-as-hash');
  });

  it('repairs once, emits one deduplicated notice, and switches the whole match to fallback', async () => {
    let calls = 0;
    const provider: AiModelProvider = {
      providerId: 'ALIBABA_DASHSCOPE',
      profileVersion: AI_MODEL_PROVIDER_PROFILE_VERSION,
      modelId: AI_MODEL_ID,
      invoke: () => {
        calls += 1;
        return Promise.resolve({
          ok: true,
          rawOutput: calls === 1 ? 'not-json' : '{"still":"not-the-contract"}',
          usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
          providerRequestId: `request-${String(calls)}`,
          finishReason: 'stop',
        });
      },
    };
    const recorderHarness = createRecorderHarness();
    const harness = await createBattleHarness({
      provider,
      recorder: recorderHarness.recorder,
    });
    const revisionBefore = harness.match.remoteRevision;
    expect(harness.machineTimers.fireNext()).toBe(true);
    await waitForAuthorityRevision(harness.matchService, harness.match, revisionBefore + 1);

    expect(calls).toBe(2);
    expect(harness.match.machineLiveness).toMatchObject({
      strategyMode: 'CONSERVATIVE_FALLBACK',
      conservativeDecisionCount: 1,
    });
    const notices =
      harness.matchService
        .getMatchChatMessages(harness.match.matchId, 'phase-four-human')
        ?.messages.filter(
          (message) => 'noticeCode' in message && message.noticeCode === 'AI_FALLBACK_ENABLED'
        ) ?? [];
    expect(notices).toHaveLength(1);
    expect(notices[0]?.text).toContain('本局接下来会只做稳妥操作');
    const record = recorderHarness.frames
      .flatMap((frame) => frame.decisionRecords ?? [])
      .find((item) => item.decisionType === 'AI_STRATEGY_SUBMITTED')?.strategyRecord;
    expect(record?.modelInvocation).toMatchObject({
      finalOutcome: 'CONSERVATIVE_FALLBACK',
      attempts: [{ outcome: 'INVALID_JSON' }, { outcome: 'INVALID_SCHEMA' }],
    });
    expect(JSON.stringify(record)).not.toContain('not-json');
  });

  it('keeps the whole match in fallback when the original lease expires before submission', async () => {
    let calls = 0;
    let releaseFirst: ((result: AiModelProviderResult) => void) | undefined;
    const provider: AiModelProvider = {
      providerId: 'ALIBABA_DASHSCOPE',
      profileVersion: AI_MODEL_PROVIDER_PROFILE_VERSION,
      modelId: AI_MODEL_ID,
      invoke: () => {
        calls += 1;
        if (calls === 1) {
          return new Promise<AiModelProviderResult>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return Promise.resolve({
          ok: true,
          rawOutput: '{"still":"not-the-contract"}',
          usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
          providerRequestId: `request-${String(calls)}`,
          finishReason: 'stop',
        });
      },
    };
    const harness = await createBattleHarness({ provider });
    expect(harness.machineTimers.fireNext()).toBe(true);
    for (let attempt = 0; attempt < 20 && !releaseFirst; attempt += 1) {
      await Promise.resolve();
    }
    expect(releaseFirst).toBeTypeOf('function');

    await harness.matchService.machineDecisionCoordinator.invalidateMatch(harness.match.matchId);
    releaseFirst?.({
      ok: true,
      rawOutput: 'not-json',
      usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
      providerRequestId: 'request-1',
      finishReason: 'stop',
    });
    await waitForMachineCallback(harness.matchService, harness.match.matchId);
    expect(calls).toBe(2);
    for (
      let attempt = 0;
      attempt < 2_000 && harness.machineTimers.pendingCount() === 0;
      attempt += 1
    ) {
      await Promise.resolve();
    }

    const revisionBeforeFallback = harness.match.remoteRevision;
    expect(harness.machineTimers.fireNext()).toBe(true);
    await waitForAuthorityRevision(harness.matchService, harness.match, revisionBeforeFallback + 1);

    expect(calls).toBe(2);
    expect(harness.match.machineLiveness).toMatchObject({
      strategyMode: 'CONSERVATIVE_FALLBACK',
      conservativeDecisionCount: 1,
    });
  });

  it('completes a real dual-end match with model-selected heuristic windows', async () => {
    let modelCalls = 0;
    const harness = await createBattleHarness({
      provider: createExplainableFakeProvider(() => {
        modelCalls += 1;
      }),
    });
    await driveHumanAndSystemToTerminal({
      ...harness,
      humanSeat: harness.battle.humanSeat,
      humanDeckKey: 'MUSE_STARTER',
    });

    expect(harness.match.session.state?.isEnded).toBe(true);
    expect(modelCalls).toBeGreaterThan(0);
    expect(harness.match.machineLiveness).toMatchObject({
      strategyMode: 'PRIMARY',
      degradedAt: null,
      conservativeDecisionCount: 0,
      terminalReason: null,
    });
  }, 30_000);
});

async function driveHumanAndSystemToTerminal(input: {
  readonly matchService: OnlineMatchService;
  readonly match: OnlineMatchState;
  readonly humanSeat: Seat;
  readonly humanDeckKey: AiBattlePhaseZeroDeckKey;
  readonly machineTimers: ReturnType<typeof createManualTimers>;
  readonly deadlineTimers: ReturnType<typeof createManualTimers>;
  readonly now: () => number;
  readonly advanceNow: () => void;
}): Promise<void> {
  const human = input.match.participants[input.humanSeat];
  const history = createAiSelectedHistoryTracker(input.humanSeat);
  for (let decisionCount = 0; decisionCount < 5_000; decisionCount += 1) {
    if (input.match.session.state?.isEnded) return;
    if (input.deadlineTimers.pendingCount() > 0) {
      input.deadlineTimers.fireNext();
      await waitForMachineCallback(input.matchService, input.match.matchId);
      continue;
    }
    if (input.machineTimers.pendingCount() > 0) {
      input.machineTimers.fireNext();
      await waitForMachineCallback(input.matchService, input.match.matchId);
      continue;
    }

    const contract = buildAiDecisionContract(
      input.match.session.state!,
      human.playerId,
      input.match.remoteRevision,
      input.now()
    );
    if (!contract.ok) {
      await Promise.resolve();
      continue;
    }
    const view = input.match.session.getPlayerViewState(human.playerId, {
      seqOverride: input.match.remoteRevision,
    })!;
    const observation = buildAiObservation(view, contract.handle.contract);
    const context = buildAiStrategyContext({
      observation,
      deckKey: input.humanDeckKey,
      deckContentHash: AI_BATTLE_PHASE_ZERO_DECKS[input.humanDeckKey].contentHash,
      selectedHistory: history.observe(observation),
    });
    const selected = selectExplainableDecision(context);
    if (!selected.ok) throw new Error(selected.detail);
    const command = materializeAiDecisionCommand(contract.handle, selected.selection, input.now());
    if (!command.ok) throw new Error(command.error);
    const result = await input.matchService.executeCommand(
      input.match.matchId,
      human.userId,
      command.command
    );
    if (!result?.success) throw new Error(result?.error ?? 'USER command rejected');
    history.recordAcceptedDecision(observation, selected);
    input.advanceNow();
  }
  throw new Error(`${input.match.matchId} exceeded 5,000 decisions`);
}

async function waitForAuthorityRevision(
  service: OnlineMatchService,
  match: OnlineMatchState,
  minimumRevision: number
): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (match.remoteRevision >= minimumRevision) {
      await waitForMachineCallback(service, match.matchId);
      return;
    }
    await Promise.resolve();
  }
  throw new Error(`${match.matchId} authority revision did not reach ${String(minimumRevision)}`);
}
