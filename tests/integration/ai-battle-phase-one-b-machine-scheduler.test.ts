import { describe, expect, it, vi } from 'vitest';
import { buildAiDecisionContract } from '../../src/application/ai-decisions/decision-contract';
import { GameCommandType } from '../../src/application/game-commands';
import type { DeckConfig } from '../../src/application/game-service';
import {
  createHeartIcon,
  createHeartRequirement,
  type AnyCardData,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import type { MachineDecisionTimerHandle } from '../../src/server/ai-battle/machine-decision-scheduler';
import {
  createMachineLivenessState,
  recordMachineLivenessDecision,
} from '../../src/server/ai-battle/rule-progress';
import { createAiSystemParticipantBinding } from '../../src/server/ai-battle/system-participant';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import { CardType, GameEndReason, GamePhase, HeartColor } from '../../src/shared/types/enums';
import { loadAiBattlePhaseZeroRuntimeDeck } from '../helpers/ai-battle-phase-zero-decks';

interface ManualTimerHandle extends MachineDecisionTimerHandle {
  readonly id: number;
}

const FORMAL_SYSTEM_BINDING = createAiSystemParticipantBinding('MUSE_STARTER');

function createFormalSystemPlayer() {
  return {
    userId: FORMAL_SYSTEM_BINDING.userId,
    displayName: '机器',
    deck: loadAiBattlePhaseZeroRuntimeDeck('MUSE_STARTER'),
    deckSource: 'AI_CERTIFIED_DECK' as const,
    participantKind: 'SYSTEM' as const,
    systemParticipantBinding: FORMAL_SYSTEM_BINDING,
  };
}

function createManualTimers() {
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
    cancelTimer: (handle: MachineDecisionTimerHandle) => {
      const job = jobs.get((handle as ManualTimerHandle).id);
      if (job) job.cancelled = true;
    },
    fireNext: (options: { readonly evenIfCancelled?: boolean } = {}) => {
      const entry = [...jobs.entries()].find(([, job]) => !job.fired);
      if (!entry) return null;
      const [id, job] = entry;
      job.fired = true;
      if (!job.cancelled || options.evenIfCancelled) job.callback();
      return { id, ...job };
    },
    pendingCount: () => [...jobs.values()].filter((job) => !job.fired && !job.cancelled).length,
    count: () => sequence,
  };
}

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createDeck(prefix: string): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  const energyDeck: AnyCardData[] = [];
  for (let index = 0; index < 48; index += 1) {
    mainDeck.push(createMember(`${prefix}-MEMBER-${index}`));
  }
  for (let index = 0; index < 12; index += 1) {
    mainDeck.push(createLive(`${prefix}-LIVE-${index}`));
    energyDeck.push(createEnergy(`${prefix}-ENERGY-${index}`));
  }
  return { mainDeck, energyDeck };
}

async function waitForScheduleToSettle(
  service: OnlineMatchService,
  matchId: string,
  previousRegistrationId: string
): Promise<void> {
  await vi.waitFor(() => {
    const current = service.machineDecisionScheduler.getCurrent(matchId);
    expect(current?.registrationId ?? null).not.toBe(previousRegistrationId);
  });
}

async function drainMachineSchedule(
  service: OnlineMatchService,
  timers: ReturnType<typeof createManualTimers>,
  matchId: string,
  maximumTurns = 32
): Promise<number> {
  let turns = 0;
  while (timers.pendingCount() > 0 && turns < maximumTurns) {
    const registration = service.machineDecisionScheduler.getCurrent(matchId);
    const fired = timers.fireNext();
    if (!fired || !registration) break;
    turns += 1;
    await waitForScheduleToSettle(service, matchId, registration.registrationId);
  }
  return turns;
}

describe('AI battle Phase 1B automatic machine scheduler', () => {
  it('rejects ONLINE SYSTEM seats outside a certified AI_BATTLE binding', async () => {
    const service = new OnlineMatchService({
      recorder: null,
      idGenerator: () => 'invalid-system-boundary-match',
    });
    const systemWithoutBinding = {
      userId: FORMAL_SYSTEM_BINDING.userId,
      displayName: '机器',
      deck: loadAiBattlePhaseZeroRuntimeDeck('MUSE_STARTER'),
      deckSource: 'AI_CERTIFIED_DECK' as const,
      participantKind: 'SYSTEM' as const,
    };
    const human = {
      userId: 'human-user',
      displayName: '玩家',
      deck: createDeck('USER'),
      participantKind: 'USER' as const,
    };

    await expect(
      service.createMatch({
        roomCode: 'INVALID-SYSTEM',
        originKind: 'ONLINE_ROOM',
        first: systemWithoutBinding,
        second: human,
      })
    ).rejects.toMatchObject({ code: 'ONLINE_MATCH_INVALID_SYSTEM_BINDING' });
    await expect(
      service.createMatch({
        roomCode: 'TAMPERED-SYSTEM',
        originKind: 'AI_BATTLE',
        first: {
          ...systemWithoutBinding,
          systemParticipantBinding: {
            ...FORMAL_SYSTEM_BINDING,
            deckContentHash: 'sha256:tampered',
          },
        },
        second: human,
      })
    ).rejects.toMatchObject({ code: 'ONLINE_MATCH_INVALID_SYSTEM_BINDING' });
  });

  it('continues adjacent SYSTEM windows and stops when the USER seat must act', async () => {
    const timers = createManualTimers();
    let idSequence = 0;
    const service = new OnlineMatchService({
      recorder: null,
      idGenerator: () => 'machine-scheduler-match',
      now: () => 1_000,
      machineDecisionSchedulingEnabled: true,
      machineDecisionRuntimeEpoch: 'decision-runtime',
      machineDecisionIdGenerator: () => `lease-${++idSequence}`,
      machineDecisionSchedulerRuntimeEpoch: 'scheduler-runtime',
      machineDecisionSchedulerIdGenerator: () => `schedule-${++idSequence}`,
      machineDecisionScheduleTimer: timers.scheduleTimer,
      machineDecisionCancelTimer: timers.cancelTimer,
    });
    const match = await service.createMatch({
      roomCode: 'AI-SCHEDULER',
      originKind: 'AI_BATTLE',
      first: createFormalSystemPlayer(),
      second: {
        userId: 'human-user',
        displayName: '玩家',
        deck: createDeck('USER'),
        participantKind: 'USER',
      },
    });

    expect(await drainMachineSchedule(service, timers, match.matchId)).toBe(2);
    expect(match.session.state?.mulliganCompletedPlayers).toContain(
      match.participants.FIRST.playerId
    );
    expect(match.session.state?.currentPhase).toBe(GamePhase.MULLIGAN_PHASE);

    await expect(
      service.executeCommand(match.matchId, 'human-user', {
        type: GameCommandType.MULLIGAN,
        playerId: 'untrusted-player-id',
        cardIdsToMulligan: [],
        timestamp: 1_000,
      })
    ).resolves.toMatchObject({ success: true });

    const turns = await drainMachineSchedule(service, timers, match.matchId);
    expect(turns).toBeGreaterThan(2);
    expect(turns).toBeLessThan(32);
    expect(match.session.state?.currentPhase).not.toBe(GamePhase.MULLIGAN_PHASE);
    const userDecision = buildAiDecisionContract(
      match.session.state!,
      match.participants.SECOND.playerId,
      match.remoteRevision,
      1_000
    );
    const systemDecision = buildAiDecisionContract(
      match.session.state!,
      match.participants.FIRST.playerId,
      match.remoteRevision,
      1_000
    );
    expect(userDecision.ok).toBe(true);
    expect(systemDecision).toMatchObject({ ok: false, reason: 'NO_DECISION' });
    expect(service.machineDecisionScheduler.getCurrent(match.matchId)).toBeNull();
    expect(timers.pendingCount()).toBe(0);
  });

  it('does not let a cancelled scheduled turn act after a USER terminal command', async () => {
    const timers = createManualTimers();
    const service = new OnlineMatchService({
      recorder: null,
      idGenerator: () => 'machine-race-match',
      now: () => 1_000,
      machineDecisionSchedulingEnabled: true,
      machineDecisionRuntimeEpoch: 'decision-runtime',
      machineDecisionIdGenerator: () => 'lease',
      machineDecisionSchedulerRuntimeEpoch: 'scheduler-runtime',
      machineDecisionSchedulerIdGenerator: () => 'schedule',
      machineDecisionScheduleTimer: timers.scheduleTimer,
      machineDecisionCancelTimer: timers.cancelTimer,
    });
    const match = await service.createMatch({
      roomCode: 'AI-RACE',
      originKind: 'AI_BATTLE',
      first: {
        userId: 'human-user',
        displayName: '玩家',
        deck: createDeck('USER'),
        participantKind: 'USER',
      },
      second: createFormalSystemPlayer(),
    });
    await drainMachineSchedule(service, timers, match.matchId);
    await service.executeCommand(match.matchId, 'human-user', {
      type: GameCommandType.MULLIGAN,
      playerId: 'untrusted-player-id',
      cardIdsToMulligan: [],
      timestamp: 1_000,
    });
    const revisionBeforeSurrender = match.remoteRevision;
    await service.executeCommand(match.matchId, 'human-user', {
      type: GameCommandType.SURRENDER,
      playerId: 'untrusted-player-id',
      timestamp: 1_000,
    });

    timers.fireNext({ evenIfCancelled: true });
    await Promise.resolve();

    expect(match.remoteRevision).toBe(revisionBeforeSurrender + 1);
    expect(match.session.state?.isEnded).toBe(true);
    expect(match.session.state?.mulliganCompletedPlayers).not.toContain(
      match.participants.SECOND.playerId
    );
    expect(service.machineDecisionScheduler.getCurrent(match.matchId)).toBeNull();
  });

  it('never attaches tactical machine scheduling to SOLITAIRE matches', async () => {
    const timers = createManualTimers();
    const service = new OnlineMatchService({
      recorder: null,
      idGenerator: () => 'solitaire-boundary-match',
      now: () => 1_000,
      machineDecisionSchedulingEnabled: true,
      machineDecisionScheduleTimer: timers.scheduleTimer,
      machineDecisionCancelTimer: timers.cancelTimer,
    });
    const match = await service.createMatch({
      roomCode: 'SOLITAIRE',
      matchMode: 'SOLITAIRE',
      automationGameMode: 'SOLITAIRE',
      originKind: 'SOLITAIRE',
      first: {
        userId: 'human-user',
        displayName: '玩家',
        deck: createDeck('USER'),
        participantKind: 'USER',
      },
      second: {
        userId: 'system-user',
        displayName: '对墙打对手',
        deck: createDeck('SYSTEM'),
        participantKind: 'SYSTEM',
      },
    });

    expect(service.machineDecisionScheduler.getCurrent(match.matchId)).toBeNull();
    expect(timers.count()).toBe(0);
  });

  it('ends the match explicitly when a SYSTEM decision window is unsupported', async () => {
    const timers = createManualTimers();
    const service = new OnlineMatchService({
      recorder: null,
      idGenerator: () => 'machine-blocked-match',
      now: () => 1_000,
      machineDecisionSchedulingEnabled: true,
      machineDecisionRuntimeEpoch: 'blocked-decision-runtime',
      machineDecisionSchedulerRuntimeEpoch: 'blocked-scheduler-runtime',
      machineDecisionScheduleTimer: timers.scheduleTimer,
      machineDecisionCancelTimer: timers.cancelTimer,
    });
    const match = await service.createMatch({
      roomCode: 'AI-BLOCKED',
      originKind: 'AI_BATTLE',
      first: createFormalSystemPlayer(),
      second: {
        userId: 'human-user',
        displayName: '玩家',
        deck: createDeck('USER'),
        participantKind: 'USER',
      },
    });
    Object.assign(match.session.state!, { pendingChoice: {} });

    await drainMachineSchedule(service, timers, match.matchId);

    expect(match.session.state?.endInfo).toMatchObject({
      reason: GameEndReason.SYSTEM_MACHINE_FAILURE,
      winnerId: match.participants.SECOND.playerId,
      loserId: match.participants.FIRST.playerId,
    });
    expect(service.machineDecisionScheduler.getCurrent(match.matchId)).toBeNull();
    expect(service.getMatchChatMessages(match.matchId, 'human-user')?.messages).toEqual([
      expect.objectContaining({
        messageType: 'SYSTEM_NOTICE',
        noticeCode: 'AI_MATCH_READY',
      }),
      expect.objectContaining({
        messageType: 'SYSTEM_NOTICE',
        noticeCode: 'AI_MACHINE_FAILURE',
      }),
    ]);
  });

  it('rescans a restored controlled ONLINE match without reusing old runtime work', async () => {
    const source = new OnlineMatchService({
      recorder: null,
      idGenerator: () => 'restored-machine-match',
      now: () => 1_000,
    });
    const match = await source.createMatch({
      roomCode: 'RESTORE-AI',
      originKind: 'AI_BATTLE',
      first: createFormalSystemPlayer(),
      second: {
        userId: 'human-user',
        displayName: '玩家',
        deck: createDeck('USER'),
        participantKind: 'USER',
      },
    });
    const timers = createManualTimers();
    const restoredService = new OnlineMatchService({
      recorder: null,
      now: () => 1_000,
      machineDecisionSchedulingEnabled: true,
      machineDecisionRuntimeEpoch: 'restored-decision-runtime',
      machineDecisionSchedulerRuntimeEpoch: 'restored-scheduler-runtime',
      machineDecisionScheduleTimer: timers.scheduleTimer,
      machineDecisionCancelTimer: timers.cancelTimer,
    });

    await restoredService.restoreMatch(match);
    expect(restoredService.machineDecisionScheduler.getCurrent(match.matchId)).toMatchObject({
      runtimeEpoch: 'restored-scheduler-runtime',
    });
    await drainMachineSchedule(restoredService, timers, match.matchId);

    expect(match.session.state?.mulliganCompletedPlayers).toContain(
      match.participants.FIRST.playerId
    );
    expect(restoredService.machineDecisionScheduler.getCurrent(match.matchId)).toBeNull();
  });

  it('does not apply conservative fallback bounds to the formal primary strategy', async () => {
    const timers = createManualTimers();
    const service = new OnlineMatchService({
      recorder: null,
      idGenerator: () => 'liveness-terminal-match',
      now: () => 1_000,
      machineDecisionSchedulingEnabled: true,
      machineDecisionRuntimeEpoch: 'terminal-decision-runtime',
      machineDecisionSchedulerRuntimeEpoch: 'terminal-scheduler-runtime',
      machineDecisionScheduleTimer: timers.scheduleTimer,
      machineDecisionCancelTimer: timers.cancelTimer,
      machineLivenessLimits: {
        maxAiTurnsWithoutRuleProgress: 99,
        maxConservativeDecisions: 1,
        maxDegradedDurationMs: 99_000,
        maxDecisionsWithoutAuthorityProgress: 99,
      },
    });
    const match = await service.createMatch({
      roomCode: 'AI-TERMINAL',
      originKind: 'AI_BATTLE',
      first: createFormalSystemPlayer(),
      second: {
        userId: 'human-user',
        displayName: '玩家',
        deck: createDeck('USER'),
        participantKind: 'USER',
      },
    });

    await drainMachineSchedule(service, timers, match.matchId);

    expect(match.session.state?.isEnded).toBe(false);
    expect(match.machineLiveness).toMatchObject({
      strategyMode: 'PRIMARY',
      degradedAt: null,
      conservativeDecisionCount: 0,
      terminalReason: null,
    });
    expect(service.machineDecisionScheduler.getCurrent(match.matchId)).toBeNull();
    const chat = service.getMatchChatMessages(match.matchId, 'human-user');
    expect(chat?.messages).toEqual([
      expect.objectContaining({
        messageType: 'SYSTEM_NOTICE',
        noticeCode: 'AI_MATCH_READY',
      }),
    ]);
  });

  it('concedes with a distinct SYSTEM terminal reason when fallback reaches a frozen bound', async () => {
    const timers = createManualTimers();
    const service = new OnlineMatchService({
      recorder: null,
      idGenerator: () => 'fallback-liveness-terminal-match',
      now: () => 1_000,
      machineDecisionSchedulingEnabled: true,
      machineDecisionRuntimeEpoch: 'fallback-terminal-decision-runtime',
      machineDecisionSchedulerRuntimeEpoch: 'fallback-terminal-scheduler-runtime',
      machineDecisionScheduleTimer: timers.scheduleTimer,
      machineDecisionCancelTimer: timers.cancelTimer,
    });
    const match = await service.createMatch({
      roomCode: 'AI-FALLBACK-TERMINAL',
      originKind: 'AI_BATTLE',
      first: createFormalSystemPlayer(),
      second: {
        userId: 'human-user',
        displayName: '玩家',
        deck: createDeck('USER'),
        participantKind: 'USER',
      },
    });
    const game = match.session.state!;
    const liveness = recordMachineLivenessDecision({
      previous: createMachineLivenessState(game, 1_000, 'CONSERVATIVE_FALLBACK'),
      before: game,
      after: game,
      systemPlayerId: match.participants.FIRST.playerId,
      now: 1_001,
      strategyMode: 'CONSERVATIVE_FALLBACK',
      limits: {
        maxAiTurnsWithoutRuleProgress: 99,
        maxConservativeDecisions: 1,
        maxDegradedDurationMs: 99_000,
        maxDecisionsWithoutAuthorityProgress: 99,
      },
    });
    expect(liveness.terminalReason).toBe('CONSERVATIVE_DECISION_LIMIT');
    match.machineLiveness = liveness.state;

    await drainMachineSchedule(service, timers, match.matchId);

    expect(match.session.state?.endInfo).toMatchObject({
      reason: GameEndReason.SYSTEM_LIVENESS_CONCEDE,
      winnerId: match.participants.SECOND.playerId,
      loserId: match.participants.FIRST.playerId,
    });
    expect(
      service
        .getMatchChatMessages(match.matchId, 'human-user')
        ?.messages.some(
          (message) =>
            message.messageType === 'SYSTEM_NOTICE' && message.noticeCode === 'AI_LIVENESS_CONCEDE'
        )
    ).toBe(true);
  });

  it('rejects a forged SYSTEM concession from a USER participant', async () => {
    const service = new OnlineMatchService({
      recorder: null,
      idGenerator: () => 'forged-system-terminal-match',
      now: () => 1_000,
    });
    const match = await service.createMatch({
      roomCode: 'AI-FORGE',
      originKind: 'AI_BATTLE',
      first: {
        userId: 'human-user',
        displayName: '玩家',
        deck: createDeck('USER'),
        participantKind: 'USER',
      },
      second: createFormalSystemPlayer(),
    });

    const result = await service.executeCommand(match.matchId, 'human-user', {
      type: GameCommandType.SYSTEM_CONCEDE,
      playerId: match.participants.SECOND.playerId,
      reason: 'CONSERVATIVE_DECISION_LIMIT',
      timestamp: 1_000,
    });

    expect(result).toMatchObject({
      success: false,
      error: 'SYSTEM 认输只能由 SYSTEM 参赛者执行',
    });
    expect(match.session.state?.isEnded).toBe(false);
  });
});
