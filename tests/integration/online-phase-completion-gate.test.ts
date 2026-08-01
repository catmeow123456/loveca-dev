import { describe, expect, it, vi } from 'vitest';
import {
  createConfirmStepCommand,
  createEndPhaseCommand,
  createSetLiveCardCommand,
  createUnsetLiveCardCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import type { DeckConfig } from '../../src/application/game-service';
import {
  createHeartIcon,
  createHeartRequirement,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import type { MatchOriginKind } from '../../src/online/replay-types';
import type { ViewCommandHint } from '../../src/online/types';
import type { MatchRecorderService } from '../../src/server/services/match-recorder-service';
import {
  OnlineMatchService,
  type OnlineMatchState,
} from '../../src/server/services/online-match-service';
import { CardType, GamePhase, HeartColor, SubPhase } from '../../src/shared/types/enums';

const FIRST_USER_ID = 'phase-gate-first-user';
const SECOND_USER_ID = 'phase-gate-second-user';
const GATE_ERROR = '阶段开始 3 秒后才能确认完成';

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
  return {
    mainDeck: [
      ...Array.from({ length: 48 }, (_, index) => createMember(`${prefix}-member-${index}`)),
      ...Array.from({ length: 12 }, (_, index) => createLive(`${prefix}-live-${index}`)),
    ],
    energyDeck: Array.from({ length: 12 }, (_, index) => createEnergy(`${prefix}-energy-${index}`)),
  };
}

async function createMatch(
  service: OnlineMatchService,
  options: {
    readonly matchMode?: 'ONLINE' | 'SOLITAIRE';
    readonly originKind?: MatchOriginKind;
  } = {}
): Promise<OnlineMatchState> {
  return service.createMatch({
    roomCode: `gate-${options.originKind ?? 'room'}`,
    matchMode: options.matchMode ?? 'ONLINE',
    originKind: options.originKind ?? 'ONLINE_ROOM',
    originLabel: options.originKind ?? '普通联机房间',
    first: {
      userId: FIRST_USER_ID,
      displayName: '先攻玩家',
      deck: createDeck('first'),
    },
    second: {
      userId: SECOND_USER_ID,
      displayName: '后攻玩家',
      deck: createDeck('second'),
    },
  });
}

function forceWindow(
  match: OnlineMatchState,
  phase: GamePhase,
  subPhase: SubPhase,
  actingSeat: 'FIRST' | 'SECOND' = 'FIRST'
): void {
  const state = match.session.state;
  if (!state) throw new Error('missing game state');
  const mutable = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    firstPlayerIndex: number;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
    pendingAbilities: unknown[];
    activeEffect: unknown;
  };
  mutable.currentPhase = phase;
  mutable.currentSubPhase = subPhase;
  mutable.firstPlayerIndex = 0;
  mutable.activePlayerIndex = actingSeat === 'FIRST' ? 0 : 1;
  mutable.waitingPlayerId = null;
  mutable.pendingAbilities = [];
  mutable.activeEffect = null;
}

function setManualOperationMode(match: OnlineMatchState, mode: 'RULES' | 'FREE'): void {
  const state = match.session.state as unknown as { manualOperationMode: 'RULES' | 'FREE' };
  state.manualOperationMode = mode;
}

async function readHint(
  service: OnlineMatchService,
  match: OnlineMatchState,
  userId: string,
  command: GameCommandType
): Promise<ViewCommandHint | undefined> {
  const snapshot = await service.getMatchSnapshot(match.matchId, userId);
  if (!snapshot || !('playerViewState' in snapshot)) {
    throw new Error('missing full snapshot');
  }
  return snapshot.playerViewState.permissions.availableCommands.find(
    (candidate) => candidate.command === command
  );
}

function putLiveCardInFirstPlayerHand(match: OnlineMatchState): string {
  const state = match.session.state;
  if (!state) throw new Error('missing game state');
  const player = state.players[0];
  const cardId = [...state.cardRegistry.values()].find(
    (card) => card.ownerId === player.id && card.data.cardType === CardType.LIVE
  )?.instanceId;
  if (!cardId) throw new Error('missing live card');
  player.mainDeck.cardIds = player.mainDeck.cardIds.filter((candidate) => candidate !== cardId);
  player.hand.cardIds = [
    ...player.hand.cardIds.filter((candidate) => candidate !== cardId),
    cardId,
  ];
  return cardId;
}

describe('online phase completion gate', () => {
  it.each(['RULES', 'FREE'] as const)(
    '主要阶段在 %s 模式下 2999ms 拒绝、3000ms 允许，重复提交不会二次推进',
    async (manualOperationMode) => {
      let now = 10_000;
      const service = new OnlineMatchService({ now: () => now, recorder: null });
      const match = await createMatch(service);
      forceWindow(match, GamePhase.MAIN_PHASE, SubPhase.NONE);
      setManualOperationMode(match, manualOperationMode);

      const initialRevision = match.remoteRevision;
      const hint = await readHint(service, match, FIRST_USER_ID, GameCommandType.END_PHASE);
      expect(hint).toMatchObject({
        enabled: false,
        reason: GATE_ERROR,
        availability: {
          kind: 'TIME_GATE',
          availableAfterMs: 3_000,
        },
      });
      expect(hint?.availability?.windowKey).toContain('phase:MAIN_PHASE');
      expect(hint?.availability?.windowKey).toContain('subPhase:NONE');
      expect(hint?.availability?.windowKey).toContain('actingSeat:FIRST');

      now += 2_999;
      const early = await service.executeCommand(
        match.matchId,
        FIRST_USER_ID,
        createEndPhaseCommand('client-player-id-is-not-authoritative')
      );
      expect(early).toEqual({ success: false, error: GATE_ERROR });
      expect(match.remoteRevision).toBe(initialRevision);
      expect(match.session.state?.currentPhase).toBe(GamePhase.MAIN_PHASE);

      now += 1;
      const [accepted, duplicate] = await Promise.all([
        service.executeCommand(match.matchId, FIRST_USER_ID, createEndPhaseCommand('ignored')),
        service.executeCommand(
          match.matchId,
          FIRST_USER_ID,
          createEndPhaseCommand('ignored-again')
        ),
      ]);
      expect(accepted?.success).toBe(true);
      expect(duplicate?.success).toBe(false);
      expect(match.session.state?.players[match.session.state.activePlayerIndex]?.id).toBe(
        match.participants.SECOND.playerId
      );
      expect(match.remoteRevision).toBe(initialRevision + 1);
    }
  );

  it('Live 放置先后攻子阶段各自起计时，旧门禁不能解锁后攻', async () => {
    let now = 20_000;
    const service = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await createMatch(service);
    forceWindow(match, GamePhase.LIVE_SET_PHASE, SubPhase.LIVE_SET_FIRST_PLAYER);

    const firstHint = await readHint(service, match, FIRST_USER_ID, GameCommandType.CONFIRM_STEP);
    expect(firstHint?.availability?.availableAfterMs).toBe(3_000);
    now += 3_000;
    const firstAccepted = await service.executeCommand(
      match.matchId,
      FIRST_USER_ID,
      createConfirmStepCommand('ignored', SubPhase.LIVE_SET_FIRST_PLAYER)
    );
    expect(firstAccepted?.success).toBe(true);
    expect(match.session.state?.currentSubPhase).toBe(SubPhase.LIVE_SET_SECOND_PLAYER);

    const secondHint = await readHint(service, match, SECOND_USER_ID, GameCommandType.CONFIRM_STEP);
    expect(secondHint).toMatchObject({
      enabled: false,
      availability: { kind: 'TIME_GATE', availableAfterMs: 3_000 },
    });
    expect(secondHint?.availability?.windowKey).not.toBe(firstHint?.availability?.windowKey);
    expect(secondHint?.availability?.windowKey).toContain('actingSeat:SECOND');

    const secondEarly = await service.executeCommand(
      match.matchId,
      SECOND_USER_ID,
      createConfirmStepCommand('ignored', SubPhase.LIVE_SET_SECOND_PLAYER)
    );
    expect(secondEarly).toEqual({ success: false, error: GATE_ERROR });

    now += 3_000;
    const secondAccepted = await service.executeCommand(
      match.matchId,
      SECOND_USER_ID,
      createConfirmStepCommand('ignored', SubPhase.LIVE_SET_SECOND_PLAYER)
    );
    expect(secondAccepted?.success).toBe(true);
    expect(match.session.state?.currentSubPhase).not.toBe(SubPhase.LIVE_SET_SECOND_PLAYER);
  });

  it('阶段内放置/撤回 Live 与重新获取 snapshot 都不重置门禁', async () => {
    let now = 30_000;
    const service = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await createMatch(service);
    forceWindow(match, GamePhase.LIVE_SET_PHASE, SubPhase.LIVE_SET_FIRST_PLAYER);
    const liveCardId = putLiveCardInFirstPlayerHand(match);

    const initialHint = await readHint(service, match, FIRST_USER_ID, GameCommandType.CONFIRM_STEP);
    const initialWindowKey = initialHint?.availability?.windowKey;
    const unchangedPoll = await service.getMatchSnapshot(match.matchId, FIRST_USER_ID, {
      sinceSeq: match.remoteRevision,
    });
    expect(unchangedPoll).toMatchObject({ modified: false, seq: match.remoteRevision });

    now += 1_000;
    const setLive = await service.executeCommand(
      match.matchId,
      FIRST_USER_ID,
      createSetLiveCardCommand('ignored', liveCardId)
    );
    expect(setLive?.success).toBe(true);
    const afterOperationHint = await readHint(
      service,
      match,
      FIRST_USER_ID,
      GameCommandType.CONFIRM_STEP
    );
    expect(afterOperationHint?.availability).toMatchObject({
      windowKey: initialWindowKey,
      availableAfterMs: 2_000,
    });

    now += 500;
    const unsetLive = await service.executeCommand(
      match.matchId,
      FIRST_USER_ID,
      createUnsetLiveCardCommand('ignored', liveCardId)
    );
    expect(unsetLive?.success).toBe(true);
    const afterUnsetHint = await readHint(
      service,
      match,
      FIRST_USER_ID,
      GameCommandType.CONFIRM_STEP
    );
    expect(afterUnsetHint?.availability).toMatchObject({
      windowKey: initialWindowKey,
      availableAfterMs: 1_500,
    });

    now += 1_499;
    const reconnectHint = await readHint(
      service,
      match,
      FIRST_USER_ID,
      GameCommandType.CONFIRM_STEP
    );
    expect(reconnectHint?.availability).toMatchObject({
      windowKey: initialWindowKey,
      availableAfterMs: 1,
    });
    const early = await service.executeCommand(
      match.matchId,
      FIRST_USER_ID,
      createConfirmStepCommand('ignored', SubPhase.LIVE_SET_FIRST_PLAYER)
    );
    expect(early?.error).toBe(GATE_ERROR);

    now += 1;
    const accepted = await service.executeCommand(
      match.matchId,
      FIRST_USER_ID,
      createConfirmStepCommand('ignored', SubPhase.LIVE_SET_FIRST_PLAYER)
    );
    expect(accepted?.success).toBe(true);
  });

  it('离开后重新进入相同回合/阶段/座位也会建立新代际门禁', async () => {
    let now = 40_000;
    const service = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await createMatch(service);
    forceWindow(match, GamePhase.MAIN_PHASE, SubPhase.NONE);
    const firstHint = await readHint(service, match, FIRST_USER_ID, GameCommandType.END_PHASE);

    now += 3_000;
    forceWindow(match, GamePhase.DRAW_PHASE, SubPhase.NONE);
    await service.getMatchSnapshot(match.matchId, FIRST_USER_ID);
    now += 100;
    forceWindow(match, GamePhase.MAIN_PHASE, SubPhase.NONE);
    const reenteredHint = await readHint(service, match, FIRST_USER_ID, GameCommandType.END_PHASE);
    expect(reenteredHint?.availability?.windowKey).not.toBe(firstHint?.availability?.windowKey);
    expect(reenteredHint?.availability?.availableAfterMs).toBe(3_000);

    now += 2_999;
    const early = await service.executeCommand(
      match.matchId,
      FIRST_USER_ID,
      createEndPhaseCommand('ignored')
    );
    expect(early?.error).toBe(GATE_ERROR);
    now += 1;
    const accepted = await service.executeCommand(
      match.matchId,
      FIRST_USER_ID,
      createEndPhaseCommand('ignored')
    );
    expect(accepted?.success).toBe(true);
  });

  it('运行态恢复缺少旧门禁时保守重等 3 秒', async () => {
    let now = 50_000;
    const originalService = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await createMatch(originalService);
    forceWindow(match, GamePhase.MAIN_PHASE, SubPhase.NONE);
    const oldHint = await readHint(
      originalService,
      match,
      FIRST_USER_ID,
      GameCommandType.END_PHASE
    );
    now += 1_000;
    delete match.phaseCompletionGateRuntime;

    const restoredService = new OnlineMatchService({ now: () => now, recorder: null });
    await restoredService.restoreMatch(match);
    const restoredHint = await readHint(
      restoredService,
      match,
      FIRST_USER_ID,
      GameCommandType.END_PHASE
    );
    expect(restoredHint?.availability?.availableAfterMs).toBe(3_000);
    expect(restoredHint?.availability?.windowKey).not.toBe(oldHint?.availability?.windowKey);

    now += 2_999;
    const early = await restoredService.executeCommand(
      match.matchId,
      FIRST_USER_ID,
      createEndPhaseCommand('ignored')
    );
    expect(early?.error).toBe(GATE_ERROR);
  });

  it.each(['ONLINE_ROOM', 'PUBLIC_TABLE', 'RANKED'] as const)(
    '%s 来源都经过统一 ONLINE 门禁',
    async (originKind) => {
      let now = 60_000;
      const service = new OnlineMatchService({ now: () => now, recorder: null });
      const match = await createMatch(service, { originKind });
      expect(match.matchMode).toBe('ONLINE');
      forceWindow(match, GamePhase.MAIN_PHASE, SubPhase.NONE);
      await readHint(service, match, FIRST_USER_ID, GameCommandType.END_PHASE);
      const result = await service.advancePhase(match.matchId, FIRST_USER_ID);
      expect(result).toEqual({ success: false, error: GATE_ERROR });
    }
  );

  it('SOLITAIRE、ACTIVE_PHASE 与其他 CONFIRM_STEP 窗口不会被该门禁误拦截', async () => {
    let now = 70_000;
    const solitaireService = new OnlineMatchService({ now: () => now, recorder: null });
    const solitaire = await createMatch(solitaireService, {
      matchMode: 'SOLITAIRE',
      originKind: 'SOLITAIRE',
    });
    forceWindow(solitaire, GamePhase.MAIN_PHASE, SubPhase.NONE);
    const solitaireResult = await solitaireService.executeCommand(
      solitaire.matchId,
      FIRST_USER_ID,
      createEndPhaseCommand('ignored')
    );
    expect(solitaireResult?.success).toBe(true);

    const onlineService = new OnlineMatchService({ now: () => now, recorder: null });
    const online = await createMatch(onlineService);
    forceWindow(online, GamePhase.ACTIVE_PHASE, SubPhase.NONE);
    const activePhaseEnd = await onlineService.executeCommand(
      online.matchId,
      FIRST_USER_ID,
      createEndPhaseCommand('ignored')
    );
    expect(activePhaseEnd?.error).not.toBe(GATE_ERROR);

    forceWindow(online, GamePhase.LIVE_SET_PHASE, SubPhase.LIVE_SET_FIRST_DRAW);
    const otherConfirmHint = await readHint(
      onlineService,
      online,
      FIRST_USER_ID,
      GameCommandType.CONFIRM_STEP
    );
    expect(otherConfirmHint?.availability).toBeUndefined();
    const otherConfirm = await onlineService.executeCommand(
      online.matchId,
      FIRST_USER_ID,
      createConfirmStepCommand('ignored', SubPhase.LIVE_SET_FIRST_DRAW)
    );
    expect(otherConfirm?.error).not.toBe(GATE_ERROR);
  });

  it('提前拒绝仍写入现有 COMMAND_REJECTED recorder 边界', async () => {
    let now = 80_000;
    const appendMatchRecordFrame = vi.fn<MatchRecorderService['appendMatchRecordFrame']>(() =>
      Promise.resolve({
        matchId: 'recorded-match',
        timelineSeq: 2,
        checkpointSeq: null,
        payloadHash: null,
      })
    );
    const recorder: Pick<
      MatchRecorderService,
      | 'beginMatch'
      | 'recordInitialCheckpoint'
      | 'markPartial'
      | 'sealMatch'
      | 'getRecordCursor'
      | 'appendMatchRecordFrame'
    > = {
      beginMatch: vi.fn<MatchRecorderService['beginMatch']>((input) =>
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
        })
      ),
      recordInitialCheckpoint: vi.fn<MatchRecorderService['recordInitialCheckpoint']>((input) =>
        Promise.resolve({
          matchId: input.matchId,
          timelineSeq: 1,
          checkpointSeq: 1,
          payloadHash: 'sha256:test',
        })
      ),
      markPartial: vi.fn<MatchRecorderService['markPartial']>(() => Promise.resolve()),
      sealMatch: vi.fn<MatchRecorderService['sealMatch']>((input) =>
        Promise.resolve({
          matchId: input.matchId,
          timelineSeq: 3,
          status: input.status,
          completeness: input.completeness ?? (input.status === 'COMPLETED' ? 'FULL' : 'PARTIAL'),
        })
      ),
      getRecordCursor: vi.fn<MatchRecorderService['getRecordCursor']>((matchId) =>
        Promise.resolve({
          matchId,
          status: 'IN_PROGRESS',
          completeness: 'FULL',
          turnCount: 0,
          lastTimelineSeq: 1,
          lastCheckpointSeq: 1,
          lastPublicSeq: 0,
          lastPrivateSeqBySeat: { FIRST: 0, SECOND: 0 },
          lastAuditSeq: 0,
          lastCommandSeq: 0,
          lastGameEventSeq: 0,
        })
      ),
      appendMatchRecordFrame,
    };
    const service = new OnlineMatchService({ now: () => now, recorder });
    const match = await createMatch(service);
    forceWindow(match, GamePhase.MAIN_PHASE, SubPhase.NONE);

    const rejected = await service.executeCommand(
      match.matchId,
      FIRST_USER_ID,
      createEndPhaseCommand('ignored')
    );
    expect(rejected?.error).toBe(GATE_ERROR);
    expect(appendMatchRecordFrame).toHaveBeenCalledTimes(1);
    const recordedInput = appendMatchRecordFrame.mock.calls[0]?.[0];
    expect(recordedInput?.frameType).toBe('COMMAND_REJECTED');
    expect(recordedInput?.summary).toContain(GATE_ERROR);
    expect(recordedInput?.writeAuthorityCheckpoint).toBe(false);
  });
});
