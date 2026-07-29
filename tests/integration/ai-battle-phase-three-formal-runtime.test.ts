import { describe, expect, it } from 'vitest';
import {
  buildAiDecisionContract,
  materializeAiDecisionCommand,
} from '../../src/application/ai-decisions';
import { GameCommandType } from '../../src/application/game-commands';
import type { Seat } from '../../src/online';
import { buildAiObservation } from '../../src/server/ai-battle/ai-observation';
import {
  loadCertifiedAiDeckFromRegistry,
  type LoadedCertifiedAiDeck,
} from '../../src/server/ai-battle/certified-deck-loader';
import type { MachineDecisionTimerHandle } from '../../src/server/ai-battle/machine-decision-scheduler';
import {
  AI_BATTLE_PHASE_ZERO_DECKS,
  AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX,
  type AiBattlePhaseZeroDeckKey,
} from '../../src/server/ai-battle/phase-zero-baseline';
import type { ServerDeadlineTimerHandle } from '../../src/server/ai-battle/server-deadline-owner';
import { selectExplainableDecision } from '../../src/server/ai-battle/explainable-decision-policy';
import { buildAiStrategyContext } from '../../src/server/ai-battle/strategy-context';
import { createAiSelectedHistoryTracker } from '../../src/server/ai-battle/strategy-history';
import {
  AiBattlePhaseThreeService,
  AiBattlePhaseThreeServiceError,
} from '../../src/server/services/ai-battle-phase-three-service';
import {
  OnlineMatchService,
  type OnlineMatchState,
} from '../../src/server/services/online-match-service';
import type {
  AppendMatchRecordFrameInput,
  AppendMatchRecordFrameResult,
  BeginMatchRecordInput,
  BeginMatchRecordResult,
  MatchRecordCursor,
  MatchRecorderService,
  RecordCheckpointResult,
  RecordInitialCheckpointInput,
  SealMatchRecordInput,
  SealMatchRecordResult,
} from '../../src/server/services/match-recorder-service';
import { GameEndReason } from '../../src/shared/types/enums';
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
      const entry = [...jobs.entries()].find(([, job]) => !job.fired && !job.cancelled);
      if (!entry) return null;
      const [id, job] = entry;
      job.fired = true;
      onAdvance?.(job.delayMs);
      job.callback();
      return { id, ...job };
    },
    pendingCount: () => [...jobs.values()].filter((job) => !job.fired && !job.cancelled).length,
  };
}

function createRecorderHarness() {
  const beginInputs: BeginMatchRecordInput[] = [];
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
    beginMatch(input: BeginMatchRecordInput): Promise<BeginMatchRecordResult> {
      beginInputs.push(input);
      return Promise.resolve({
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
      });
    },
    recordInitialCheckpoint(input: RecordInitialCheckpointInput): Promise<RecordCheckpointResult> {
      return Promise.resolve({
        matchId: input.matchId,
        timelineSeq: 1,
        checkpointSeq: 1,
        payloadHash: 'sha256:initial',
      });
    },
    markPartial(): Promise<void> {
      return Promise.resolve();
    },
    sealMatch(input: SealMatchRecordInput): Promise<SealMatchRecordResult> {
      return Promise.resolve({
        matchId: input.matchId,
        timelineSeq: frames.length + 2,
        status: input.status,
        completeness: input.completeness ?? 'FULL',
      });
    },
    getRecordCursor(matchId: string): Promise<MatchRecordCursor> {
      return Promise.resolve({
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
      });
    },
    appendMatchRecordFrame(
      input: AppendMatchRecordFrameInput
    ): Promise<AppendMatchRecordFrameResult> {
      frames.push(input);
      return Promise.resolve({
        matchId: input.matchId,
        timelineSeq: frames.length + 1,
        checkpointSeq: input.writeAuthorityCheckpoint === false ? null : frames.length + 1,
        payloadHash: input.writeAuthorityCheckpoint === false ? null : 'sha256:frame',
      });
    },
  };
  return { recorder, beginInputs, frames };
}

async function waitForMachineCallback(service: OnlineMatchService, matchId: string): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (!service.serialExecutor.hasPendingOperations(matchId)) return;
    await Promise.resolve();
  }
  throw new Error(`${matchId} machine callback did not settle`);
}

describe('AI battle Phase 3 formal SYSTEM runtime', () => {
  it('binds an unloginable identity, blocks forged SYSTEM commands, and records strategy atomically', async () => {
    const recorderHarness = createRecorderHarness();
    const timers = createManualTimers();
    let matchSequence = 0;
    const matchService = new OnlineMatchService({
      recorder: recorderHarness.recorder,
      idGenerator: () => `phase-three-match-${++matchSequence}`,
      now: () => 1_000,
      machineDecisionSchedulingEnabled: true,
      machineDecisionRuntimeEpoch: 'phase-three-decision',
      machineDecisionIdGenerator: () => `lease-${matchSequence}`,
      machineDecisionSchedulerRuntimeEpoch: 'phase-three-scheduler',
      machineDecisionSchedulerIdGenerator: () => `schedule-${matchSequence}`,
      machineDecisionScheduleTimer: timers.scheduleTimer,
      machineDecisionCancelTimer: timers.cancelTimer,
    });
    const certifiedDeck = await loadCertifiedAiDeckFromRegistry(
      'MUSE_STARTER',
      aiBattleAuthoritativeCardRegistry
    );
    const entry = new AiBattlePhaseThreeService({
      matchService,
      idGenerator: () => 'controlled-entry',
      now: () => 1_000,
      loadUserProfile: (userId) => Promise.resolve({ userId, displayName: '内部测试员' }),
      loadCertifiedDeck: () => Promise.resolve(certifiedDeck),
    });

    const battle = await entry.createBattle({
      humanUserId: 'human-user',
      humanDeckKey: 'MUSE_STARTER',
      aiDeckKey: 'MUSE_STARTER',
      aiSeat: 'FIRST',
    });
    const match = matchService.getMatch(battle.matchId)!;
    const system = match.participants.FIRST;

    expect(battle.snapshot.playerViewState.match.participants.FIRST).toMatchObject({
      name: 'Loveca AI',
      participantKind: 'SYSTEM',
    });
    expect(battle.snapshot.playerViewState.match.undo).toMatchObject({
      policy: 'NONE',
      canUndoNow: false,
    });
    expect(battle.snapshot.playerViewState.match.manualOperation).toMatchObject({
      mode: 'RULES',
      canSwitchNow: false,
      disabledReason: 'AI 对战固定使用规则模式',
    });
    const systemMainDeck = battle.snapshot.playerViewState.table.zones.FIRST_MAIN_DECK;
    expect(systemMainDeck.count).toBeGreaterThan(0);
    expect(systemMainDeck.objectIds).toBeUndefined();
    expect(recorderHarness.beginInputs[0].participants.FIRST).toMatchObject({
      participantKind: 'SYSTEM',
      systemIdentitySnapshot: {
        loginAllowed: false,
        deckKey: 'MUSE_STARTER',
        deckContentHash: AI_BATTLE_PHASE_ZERO_DECKS.MUSE_STARTER.contentHash,
        phaseZeroBaselineVersion: 'ai-battle.phase-zero/v1',
        decisionContractVersion: 'ai-battle.decision-contract/v1',
        commandAdapterVersion: 'ai-battle.decision-command-adapter/v1',
      },
    });
    expect(
      recorderHarness.beginInputs[0].participants.FIRST.systemIdentitySnapshot
        ?.phaseZeroCertificationVersions.rulesEngineVersion
    ).toBe('3.8.4');
    expect(recorderHarness.beginInputs[0].deckSnapshots.FIRST.source).toBe('AI_CERTIFIED_DECK');
    expect(battle.pregame).toMatchObject({
      rpsResolution: 'SERVER_DETERMINISTIC',
      humanGesture: 'SCISSORS',
      systemGesture: 'ROCK',
      rpsWinnerSeat: 'FIRST',
      turnOrderChoice: 'SYSTEM_FIRST',
      systemSeat: 'FIRST',
    });
    expect(matchService.getMatchChatMessages(match.matchId, 'human-user')?.messages).toContainEqual(
      expect.objectContaining({
        messageType: 'SYSTEM_NOTICE',
        noticeCode: 'AI_MATCH_READY',
      })
    );

    await expect(
      matchService.executeCommand(match.matchId, system.userId, {
        type: GameCommandType.MULLIGAN,
        playerId: system.playerId,
        cardIdsToMulligan: [],
        timestamp: 1_000,
      })
    ).resolves.toMatchObject({
      success: false,
      error: 'SYSTEM 参赛者只能通过服务端内部授权边界提交命令',
    });
    await expect(
      matchService.acquireMachineDecisionLease({
        matchId: match.matchId,
        systemUserId: 'human-user',
        ownerId: 'forged-worker',
      })
    ).resolves.toMatchObject({ ok: false, reason: 'INVALID_STATE' });

    expect(timers.fireNext()).not.toBeNull();
    await waitForMachineCallback(matchService, match.matchId);
    const strategyFrame = recorderHarness.frames.find((frame) =>
      frame.decisionRecords?.some((record) => record.decisionType === 'AI_STRATEGY_SUBMITTED')
    );
    expect(strategyFrame).toMatchObject({ frameType: 'COMMAND_ACCEPTED' });
    const strategyRecord = strategyFrame?.decisionRecords?.find(
      (record) => record.decisionType === 'AI_STRATEGY_SUBMITTED'
    )?.strategyRecord;
    expect(strategyRecord).toMatchObject({
      decisionAudit: {
        seat: 'FIRST',
        policyVersion: 'ai-battle.explainable-policy/v1',
        decisionContractVersion: 'ai-battle.decision-contract/v1',
        commandAdapterVersion: 'ai-battle.decision-command-adapter/v1',
      },
      execution: { status: 'ACCEPTED' },
    });
    expect(strategyRecord?.decisionAudit).not.toHaveProperty('context');
    expect(strategyRecord?.decisionAudit).not.toHaveProperty('playerName');
    const serializedStrategyRecord = JSON.stringify(strategyRecord);
    expect(serializedStrategyRecord).not.toContain(match.matchId);
    expect(serializedStrategyRecord).not.toContain(system.playerId);
    expect(serializedStrategyRecord).not.toContain(match.participants.SECOND.playerId);
    for (const player of match.session.state!.players) {
      for (const hiddenCardId of [...player.hand.cardIds, ...player.mainDeck.cardIds]) {
        expect(serializedStrategyRecord).not.toContain(hiddenCardId);
      }
    }
  });

  it('resumes on refresh, rejects undo/free mode, auto-accepts restart, and treats leave as surrender', async () => {
    const certifiedDeck = await loadCertifiedAiDeckFromRegistry(
      'MUSE_STARTER',
      aiBattleAuthoritativeCardRegistry
    );
    let matchSequence = 0;
    const matchService = new OnlineMatchService({
      recorder: null,
      idGenerator: () => `lifecycle-match-${++matchSequence}`,
      now: () => 2_000,
    });
    const entry = new AiBattlePhaseThreeService({
      matchService,
      idGenerator: () => `entry-${matchSequence}`,
      now: () => 2_000,
      loadUserProfile: (userId) => Promise.resolve({ userId, displayName: '测试员' }),
      loadCertifiedDeck: () => Promise.resolve(certifiedDeck),
    });
    const created = await entry.createBattle({
      humanUserId: 'human-lifecycle',
      humanDeckKey: 'MUSE_STARTER',
      aiDeckKey: 'MUSE_STARTER',
      aiSeat: 'SECOND',
    });
    const refreshed = await entry.refreshBattle(created.matchId, 'human-lifecycle');
    expect(refreshed?.matchId).toBe(created.matchId);
    expect(refreshed?.snapshot.seq).toBe(created.snapshot.seq);
    expect(refreshed?.pregame).toMatchObject({
      rpsWinnerSeat: 'SECOND',
      turnOrderChoice: 'SYSTEM_SECOND',
      firstSeat: 'FIRST',
      systemSeat: 'SECOND',
    });

    const match = matchService.getMatch(created.matchId)!;
    const human = match.participants.FIRST;
    await expect(
      matchService.createUndoRequest(created.matchId, human.userId, {
        expectedRevision: match.remoteRevision,
        undoEntryId: 'forged-entry',
      })
    ).resolves.toMatchObject({ success: false, error: '当前对局不支持请求撤销' });
    await expect(
      matchService.changeManualOperationMode(created.matchId, human.userId, {
        targetMode: 'FREE',
        expectedRevision: match.remoteRevision,
      })
    ).resolves.toMatchObject({
      success: false,
      error: 'AI 对战固定使用规则模式，不能切换自由模式',
    });

    const restarted = await entry.restartBattle(created.matchId, human.userId);
    expect(restarted.matchId).not.toBe(created.matchId);
    expect(matchService.getMatch(created.matchId)).toBeNull();
    const restartedMatch = matchService.getMatch(restarted.matchId)!;
    const retainedSession = restartedMatch.session;
    await entry.leaveBattle(restarted.matchId, human.userId);
    expect(retainedSession.state?.endInfo?.reason).toBe(GameEndReason.OPPONENT_SURRENDER);
    expect(matchService.getMatch(restarted.matchId)).toBeNull();
    await expect(entry.refreshBattle(restarted.matchId, human.userId)).resolves.toBeNull();
  });

  it('serializes concurrent create requests per human and leaves exactly one controlled match', async () => {
    const certifiedDeck = await loadCertifiedAiDeckFromRegistry(
      'MUSE_STARTER',
      aiBattleAuthoritativeCardRegistry
    );
    const matchService = new OnlineMatchService({ recorder: null });
    const entry = new AiBattlePhaseThreeService({
      matchService,
      loadUserProfile: (userId) => Promise.resolve({ userId, displayName: '并发测试员' }),
      loadCertifiedDeck: () => Promise.resolve(certifiedDeck),
    });
    const input = {
      humanUserId: 'human-concurrent',
      humanDeckKey: 'MUSE_STARTER',
      aiDeckKey: 'MUSE_STARTER',
      aiSeat: 'FIRST',
    } as const;

    const results = await Promise.allSettled([
      entry.createBattle(input),
      entry.createBattle(input),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    expect(rejected?.reason).toBeInstanceOf(AiBattlePhaseThreeServiceError);
    expect((rejected?.reason as AiBattlePhaseThreeServiceError).code).toBe(
      'AI_BATTLE_ALREADY_ACTIVE'
    );
  });

  it('completes all eight certified matchup/turn-order units through the real online runtime', async () => {
    const deckCache = new Map<AiBattlePhaseZeroDeckKey, LoadedCertifiedAiDeck>();
    for (const deckKey of Object.keys(AI_BATTLE_PHASE_ZERO_DECKS) as AiBattlePhaseZeroDeckKey[]) {
      deckCache.set(
        deckKey,
        await loadCertifiedAiDeckFromRegistry(deckKey, aiBattleAuthoritativeCardRegistry)
      );
    }

    for (const scenario of AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX) {
      let now = 10_000;
      const machineTimers = createManualTimers((delayMs) => {
        now += Math.max(1, delayMs);
      });
      const deadlineTimers = createManualTimers((delayMs) => {
        now += Math.max(1, delayMs);
      });
      const recorderHarness = createRecorderHarness();
      const matchService = new OnlineMatchService({
        recorder: recorderHarness.recorder,
        idGenerator: () => `phase-three-${scenario.scenarioId}`,
        now: () => now,
        machineDecisionSchedulingEnabled: true,
        machineDecisionRuntimeEpoch: `decision-${scenario.scenarioId}`,
        machineDecisionIdGenerator: () => `lease-${now}`,
        machineDecisionSchedulerRuntimeEpoch: `scheduler-${scenario.scenarioId}`,
        machineDecisionSchedulerIdGenerator: () => `schedule-${now}`,
        machineDecisionScheduleTimer: machineTimers.scheduleTimer,
        machineDecisionCancelTimer: machineTimers.cancelTimer,
        deadlineScheduleTimer: deadlineTimers.scheduleTimer,
        deadlineCancelTimer: deadlineTimers.cancelTimer,
      });
      const entry = new AiBattlePhaseThreeService({
        matchService,
        idGenerator: () => scenario.scenarioId,
        now: () => now,
        loadUserProfile: (userId) => Promise.resolve({ userId, displayName: 'Phase 3 真人席位' }),
        loadCertifiedDeck: (deckKey) => Promise.resolve(deckCache.get(deckKey)!),
      });
      const battle = await entry.createBattle({
        humanUserId: `human-${scenario.scenarioId}`,
        humanDeckKey: scenario.playerDeckKey,
        aiDeckKey: scenario.aiDeckKey,
        aiSeat: scenario.aiTurnOrder,
      });
      const match = matchService.getMatch(battle.matchId)!;
      await driveHumanAndSystemToTerminal({
        matchService,
        match,
        humanSeat: battle.humanSeat,
        humanDeckKey: scenario.playerDeckKey,
        machineTimers,
        deadlineTimers,
        now: () => now,
        advanceNow: () => {
          now += 1;
        },
      });
      expect(match.session.state?.isEnded, scenario.scenarioId).toBe(true);
      expect(
        [
          GameEndReason.VICTORY_CONDITION,
          GameEndReason.DRAW,
          GameEndReason.CARD_EFFECT,
          GameEndReason.INFINITE_LOOP,
        ],
        scenario.scenarioId
      ).toContain(match.session.state?.endInfo?.reason);
      expect(match.machineLiveness, scenario.scenarioId).toMatchObject({
        strategyMode: 'PRIMARY',
        degradedAt: null,
        conservativeDecisionCount: 0,
        terminalReason: null,
      });
      const strategyRecords = recorderHarness.frames.flatMap(
        (frame) =>
          frame.decisionRecords
            ?.filter((record) => record.decisionType === 'AI_STRATEGY_SUBMITTED')
            .map((record) => record.strategyRecord)
            .filter((record) => record !== undefined) ?? []
      );
      expect(strategyRecords.length, scenario.scenarioId).toBeGreaterThan(0);
      expect(
        strategyRecords.every((record) => record.execution.status === 'ACCEPTED'),
        scenario.scenarioId
      ).toBe(true);
      expect(
        matchService
          .getMatchChatMessages(match.matchId, `human-${scenario.scenarioId}`)
          ?.messages.some(
            (message) =>
              'noticeCode' in message &&
              ['AI_FALLBACK_ENABLED', 'AI_LIVENESS_CONCEDE', 'AI_MACHINE_FAILURE'].includes(
                message.noticeCode
              )
          ),
        scenario.scenarioId
      ).toBe(false);
    }
  }, 120_000);
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

    const state = input.match.session.state!;
    const contract = buildAiDecisionContract(
      state,
      human.playerId,
      input.match.remoteRevision,
      input.now()
    );
    if (!contract.ok) {
      await Promise.resolve();
      if (input.machineTimers.pendingCount() === 0 && input.deadlineTimers.pendingCount() === 0) {
        throw new Error(`${input.match.matchId} stalled: ${contract.reason}:${contract.detail}`);
      }
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
    if (!result?.success) {
      throw new Error(`${input.match.matchId} USER command rejected: ${result?.error}`);
    }
    history.recordAcceptedDecision(observation, selected);
    input.advanceNow();
  }
  throw new Error(`${input.match.matchId} exceeded 5,000 decisions`);
}
