import { describe, expect, it, vi } from 'vitest';
import {
  createDrawCardToHandCommand,
  createMulliganCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import type { DeckConfig } from '../../src/application/game-service';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  CardType,
  GameEndReason,
  GamePhase,
  HeartColor,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';
import {
  OnlineRoomService,
  OnlineRoomServiceError,
} from '../../src/server/services/online-room-service';
import {
  OnlineMatchService,
  type OnlineMatchState,
} from '../../src/server/services/online-match-service';
import type { MatchRecorderService } from '../../src/server/services/match-recorder-service';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

function createTestMemberCard(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createTestLiveCard(cardCode: string, name: string): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
  };
}

function createTestEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: `能量 ${cardCode}`,
    cardType: CardType.ENERGY,
  };
}

function createRuntimeDeck(prefix: string): DeckConfig {
  const mainDeck = [];
  const energyDeck = [];

  for (let i = 0; i < 48; i += 1) {
    mainDeck.push(createTestMemberCard(`${prefix}-MEM-${i}`, `${prefix} 成员 ${i}`));
  }

  for (let i = 0; i < 12; i += 1) {
    mainDeck.push(createTestLiveCard(`${prefix}-LIVE-${i}`, `${prefix} Live ${i}`));
    energyDeck.push(createTestEnergyCard(`${prefix}-ENE-${i}`));
  }

  return { mainDeck, energyDeck };
}

function expectJsonRoundTrip<T>(value: T): T {
  assertNoTransportOnlyValues(value);
  const encoded = JSON.stringify(value);
  if (typeof encoded !== 'string') {
    throw new Error('正式联机响应不能序列化为 JSON 对象');
  }
  return JSON.parse(encoded) as T;
}

function assertNoTransportOnlyValues(value: unknown, path = 'value'): void {
  if (
    value instanceof Map ||
    value instanceof Set ||
    value instanceof Date ||
    typeof value === 'bigint' ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    throw new Error(`正式联机响应包含非 JSON-native 值: ${path}`);
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoTransportOnlyValues(entry, `${path}[${index}]`));
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    assertNoTransportOnlyValues(entry, `${path}.${key}`);
  }
}

function createInMemoryMatchService(): OnlineMatchService {
  return new OnlineMatchService({ recorder: null });
}

function forceMainPhaseForFirst(match: OnlineMatchState): void {
  const state = match.session.state as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };

  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.NONE;
  state.activePlayerIndex = 0;
  state.waitingPlayerId = null;
}

type TestRecorder = Pick<
  MatchRecorderService,
  | 'beginMatch'
  | 'recordInitialCheckpoint'
  | 'markPartial'
  | 'sealMatch'
  | 'getRecordCursor'
  | 'appendMatchRecordFrame'
>;

function createTestRecorder(overrides: Partial<TestRecorder> = {}): TestRecorder {
  return {
    beginMatch: vi.fn(async () => ({
      matchId: 'test-match',
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
    })),
    recordInitialCheckpoint: vi.fn(async () => ({
      matchId: 'test-match',
      timelineSeq: 1,
      checkpointSeq: 1,
      payloadHash: 'sha256:test',
    })),
    markPartial: vi.fn(async () => undefined),
    sealMatch: vi.fn(async (input) => ({
      matchId: input.matchId,
      timelineSeq: 2,
      status: input.status,
      completeness: input.completeness ?? (input.status === 'COMPLETED' ? 'FULL' : 'PARTIAL'),
    })),
    getRecordCursor: vi.fn(async (matchId) => ({
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
    })),
    appendMatchRecordFrame: vi.fn(async (input) => ({
      matchId: input.matchId,
      timelineSeq: 2,
      checkpointSeq: input.writeAuthorityCheckpoint === false ? null : 2,
      payloadHash: input.writeAuthorityCheckpoint === false ? null : 'sha256:test',
    })),
    ...overrides,
  };
}

describe('OnlineRoomService', () => {
  it('应完成正式房间准备流程并在接受提议后生成联机对局', async () => {
    const matchService = createInMemoryMatchService();
    const service = new OnlineRoomService({
      matchService,
      loadUserProfile: async (userId) => ({
        userId,
        displayName: userId === 'u1' ? 'Alpha' : 'Beta',
      }),
      loadOwnedDeck: async (userId, deckId) => ({
        deckId,
        deckName: `${userId}-${deckId}`,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    const created = await service.createRoom('room9', 'u1');
    expect(created.roomCode).toBe('ROOM9');
    expect(created.currentUserRole).toBe('HOST');

    const joined = await service.joinRoom('ROOM9', 'u2');
    expect(joined.members).toHaveLength(2);
    expect(joined.currentUserRole).toBe('GUEST');

    await service.lockDeck('ROOM9', 'u1', 'deck-a');
    await service.lockDeck('ROOM9', 'u2', 'deck-b');

    const proposed = await service.proposeTurnOrder('ROOM9', 'u1', 'HOST_SECOND');
    expect(proposed.status).toBe('READY');
    expect(proposed.turnOrderProposal?.proposal).toBe('HOST_SECOND');

    const started = await service.respondTurnOrder('ROOM9', 'u2', true);
    expect(started.status).toBe('IN_GAME');
    expect(started.matchId).toBeTruthy();
    expect(started.currentUserSeat).toBe('FIRST');

    const snapshot = await matchService.getMatchSnapshot(started.matchId!, 'u2');
    expect(snapshot?.seat).toBe('FIRST');
    expect(snapshot?.playerViewState.match.viewerSeat).toBe('FIRST');
    expect('publicEvents' in snapshot!).toBe(false);
    expect('privateEvents' in snapshot!).toBe(false);
    expect('snapshots' in snapshot!).toBe(false);
    const snapshotRoundTrip = expectJsonRoundTrip(snapshot!);
    expect(snapshotRoundTrip.matchId).toBe(started.matchId);
    expect(snapshotRoundTrip.seat).toBe('FIRST');
    expect(snapshotRoundTrip.playerViewState.match.viewerSeat).toBe('FIRST');

    const unchangedSnapshot = await matchService.getMatchSnapshot(started.matchId!, 'u2', {
      sinceSeq: snapshot!.seq,
    });
    expect(unchangedSnapshot).toEqual({
      matchId: started.matchId,
      seq: snapshot!.seq,
      modified: false,
    });
    expect(expectJsonRoundTrip(unchangedSnapshot)).toEqual({
      matchId: started.matchId,
      seq: snapshot!.seq,
      modified: false,
    });

    const commandResult = await matchService.executeCommand(
      started.matchId!,
      'u2',
      createMulliganCommand('ignored-client-player-id', [])
    );
    expect(commandResult?.success).toBe(true);
    expect(commandResult?.snapshot).toBeTruthy();
    expect('publicEvents' in commandResult!.snapshot!).toBe(false);
    expect('privateEvents' in commandResult!.snapshot!).toBe(false);
    expect('snapshots' in commandResult!.snapshot!).toBe(false);
    const commandRoundTrip = expectJsonRoundTrip(commandResult!);
    expect(commandRoundTrip.success).toBe(true);
    expect(commandRoundTrip.snapshot?.matchId).toBe(started.matchId);
    expect(commandRoundTrip.snapshot?.playerViewState.match.viewerSeat).toBe('FIRST');
  });

  it('重开请求应在对手同意后封存旧对局并创建新对局', async () => {
    let now = 4_000_000;
    const recorder = createTestRecorder();
    const matchService = new OnlineMatchService({ now: () => now, recorder });
    const service = new OnlineRoomService({
      now: () => now,
      matchService,
      loadUserProfile: async (userId) => ({
        userId,
        displayName: userId === 'u1' ? 'Alpha' : 'Beta',
      }),
      loadOwnedDeck: async (userId, deckId) => ({
        deckId,
        deckName: `${userId}-${deckId}`,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('again1', 'u1');
    await service.joinRoom('again1', 'u2');
    await service.lockDeck('again1', 'u1', 'deck-a');
    await service.lockDeck('again1', 'u2', 'deck-b');
    await service.proposeTurnOrder('again1', 'u1', 'HOST_FIRST');
    const started = await service.respondTurnOrder('again1', 'u2', true);
    const previousMatchId = started.matchId!;

    now += 1_000;
    const requested = await service.requestRestart('again1', 'u1');
    expect(requested.restartRequest).toMatchObject({
      requesterUserId: 'u1',
      responderUserId: 'u2',
      matchId: previousMatchId,
    });

    now += 1_000;
    const restarted = await service.acceptRestartRequest(
      'again1',
      'u2',
      requested.restartRequest!.requestId
    );

    expect(restarted.status).toBe('IN_GAME');
    expect(restarted.restartRequest).toBeNull();
    expect(restarted.matchId).toBeTruthy();
    expect(restarted.matchId).not.toBe(previousMatchId);
    expect(restarted.currentUserSeat).toBe('SECOND');
    expect(matchService.getMatch(previousMatchId)).toBeNull();
    expect(matchService.getMatch(restarted.matchId!)).not.toBeNull();
    expect(recorder.sealMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: previousMatchId,
        status: 'INTERRUPTED',
        completeness: 'PARTIAL',
        endReason: 'ROOM_RESTART_ACCEPTED',
      })
    );

    const snapshot = await matchService.getMatchSnapshot(restarted.matchId!, 'u2');
    expect(snapshot?.matchId).toBe(restarted.matchId);
    expect(snapshot?.seat).toBe('SECOND');
  });

  it('recorder 启动失败时不应进入 IN_GAME 或创建运行中 match', async () => {
    const recorder = createTestRecorder({
      beginMatch: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    });
    const matchService = new OnlineMatchService({ recorder });
    const service = new OnlineRoomService({
      matchService,
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('recfail', 'u1');
    await service.joinRoom('recfail', 'u2');
    await service.lockDeck('recfail', 'u1', 'deck-a');
    await service.lockDeck('recfail', 'u2', 'deck-b');
    await service.proposeTurnOrder('recfail', 'u1', 'HOST_FIRST');

    let startError: unknown;
    try {
      await service.respondTurnOrder('recfail', 'u2', true);
    } catch (error) {
      startError = error;
    }

    expect(startError).toMatchObject({
      code: 'ONLINE_MATCH_RECORD_BEGIN_FAILED',
      message: '无法开始对局：历史对局记录服务暂时不可用，请稍后重试',
      statusCode: 503,
    });
    expect(startError).not.toMatchObject({
      message: expect.stringContaining('database unavailable'),
    });

    const room = await service.getRoomIfPresent('recfail');
    expect(room?.status).toBe('READY');
    expect(room?.matchId).toBeNull();
    expect(recorder.recordInitialCheckpoint).not.toHaveBeenCalled();
  });

  it('命令处理后应追加 recorder 时间线与 authority checkpoint', async () => {
    let now = 5_500_000;
    const recorder = createTestRecorder();
    const matchService = new OnlineMatchService({ now: () => now, recorder });
    const match = await matchService.createMatch({
      roomCode: 'APP01',
      startedAt: now,
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

    now += 1_000;
    const commandResult = await matchService.executeCommand(
      match.matchId,
      'u1',
      createMulliganCommand('ignored-client-player-id', [])
    );

    expect(commandResult?.success).toBe(true);
    expect(recorder.getRecordCursor).toHaveBeenCalledWith(match.matchId);
    expect(recorder.appendMatchRecordFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: match.matchId,
        frameType: 'COMMAND_ACCEPTED',
        writeAuthorityCheckpoint: true,
        relatedCommandSeq: 1,
        latestPrivateSeqBySeat: expect.objectContaining({
          FIRST: expect.any(Number),
          SECOND: expect.any(Number),
        }),
      })
    );
  });

  it('普通高频命令追加 recorder 时间线时应跳过逐帧 authority checkpoint', async () => {
    let now = 5_600_000;
    const recorder = createTestRecorder();
    const matchService = new OnlineMatchService({ now: () => now, recorder });
    const match = await matchService.createMatch({
      roomCode: 'APP02',
      startedAt: now,
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
    forceMainPhaseForFirst(match);

    now += 1_000;
    const commandResult = await matchService.executeCommand(
      match.matchId,
      'u1',
      createDrawCardToHandCommand('ignored-client-player-id')
    );

    expect(commandResult?.success).toBe(true);
    expect(recorder.getRecordCursor).toHaveBeenCalledWith(match.matchId);
    expect(recorder.appendMatchRecordFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: match.matchId,
        frameType: 'COMMAND_ACCEPTED',
        authorityState: null,
        writeAuthorityCheckpoint: false,
        relatedCommandSeq: expect.any(Number),
        stateSummary: expect.objectContaining({
          phase: GamePhase.MAIN_PHASE,
          subPhase: SubPhase.NONE,
        }),
      })
    );
  });

  it('正式联机撤销请求被对手接受后应回滚最近一步并清除 pending', async () => {
    let now = 5_800_000;
    const matchService = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await matchService.createMatch({
      roomCode: 'UNDO01',
      startedAt: now,
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
    forceMainPhaseForFirst(match);

    const initialHandCount = match.session.state!.players[0].hand.cardIds.length;
    const initialDeckCount = match.session.state!.players[0].mainDeck.cardIds.length;
    const commandResult = await matchService.executeCommand(
      match.matchId,
      'u1',
      createDrawCardToHandCommand('ignored-client-player-id')
    );
    expect(commandResult?.success).toBe(true);
    expect(match.session.state?.players[0].hand.cardIds).toHaveLength(initialHandCount + 1);
    expect(match.session.state?.players[0].mainDeck.cardIds).toHaveLength(initialDeckCount - 1);

    const undoView = commandResult?.snapshot?.playerViewState.match.undo;
    expect(undoView).toMatchObject({
      policy: 'REMOTE_REQUEST',
      canUndoNow: true,
      disabledReason: null,
    });
    expect(undoView?.entry?.label).toBe('DRAW_CARD_TO_HAND');

    now += 1_000;
    const requestResult = await matchService.createUndoRequest(match.matchId, 'u1', {
      expectedRevision: commandResult!.snapshot!.seq,
      undoEntryId: undoView!.entry!.undoEntryId,
      idempotencyKey: 'request-accept',
    });
    expect(requestResult?.success).toBe(true);
    const pendingRequest = requestResult?.snapshot?.playerViewState.match.undo?.pendingRequest;
    expect(pendingRequest).toMatchObject({
      requesterSeat: 'FIRST',
      targetUndoEntryId: undoView!.entry!.undoEntryId,
      summary: 'DRAW_CARD_TO_HAND',
    });

    const repeatedRequest = await matchService.createUndoRequest(match.matchId, 'u1', {
      expectedRevision: commandResult!.snapshot!.seq,
      undoEntryId: undoView!.entry!.undoEntryId,
      idempotencyKey: 'request-accept',
    });
    expect(repeatedRequest?.success).toBe(true);
    expect(repeatedRequest?.snapshot?.seq).toBe(requestResult?.snapshot?.seq);
    expect(repeatedRequest?.snapshot?.playerViewState.match.undo?.pendingRequest?.requestId).toBe(
      pendingRequest?.requestId
    );

    const opponentSnapshot = await matchService.getMatchSnapshot(match.matchId, 'u2');
    expect(opponentSnapshot?.playerViewState.match.undo?.pendingRequest?.requestId).toBe(
      pendingRequest?.requestId
    );

    now += 1_000;
    const acceptResult = await matchService.acceptUndoRequest(
      match.matchId,
      'u2',
      pendingRequest!.requestId,
      {
        expectedRevision: requestResult!.snapshot!.seq,
        idempotencyKey: 'accept-request',
      }
    );

    expect(acceptResult?.success).toBe(true);
    expect(acceptResult?.snapshot?.seq).toBeGreaterThan(requestResult!.snapshot!.seq);
    expect(acceptResult?.snapshot?.playerViewState.match.undo?.pendingRequest).toBeNull();
    expect(match.session.state?.players[0].hand.cardIds).toHaveLength(initialHandCount);
    expect(match.session.state?.players[0].mainDeck.cardIds).toHaveLength(initialDeckCount);

    const repeatedAccept = await matchService.acceptUndoRequest(
      match.matchId,
      'u2',
      pendingRequest!.requestId,
      {
        expectedRevision: requestResult!.snapshot!.seq,
        idempotencyKey: 'accept-request',
      }
    );
    expect(repeatedAccept?.success).toBe(true);
    expect(repeatedAccept?.snapshot?.seq).toBe(acceptResult?.snapshot?.seq);
  });

  it('正式联机接受撤销时应先回滚权威状态再写入 accepted frame', async () => {
    let now = 5_850_000;
    let match: OnlineMatchState | null = null;
    let initialHandCount = 0;
    let initialDeckCount = 0;
    let acceptedFrameObserved = false;
    const recorder = createTestRecorder({
      appendMatchRecordFrame: vi.fn(async (input) => {
        if (input.frameType === 'UNDO_ACCEPTED') {
          acceptedFrameObserved = true;
          expect(match?.pendingUndoRequest).toBeNull();
          expect(match?.session.state?.players[0].hand.cardIds).toHaveLength(initialHandCount);
          expect(match?.session.state?.players[0].mainDeck.cardIds).toHaveLength(initialDeckCount);
        }
        return {
          matchId: input.matchId,
          timelineSeq: 2,
          checkpointSeq: input.writeAuthorityCheckpoint === false ? null : 2,
          payloadHash: input.writeAuthorityCheckpoint === false ? null : 'sha256:test',
        };
      }),
    });
    const matchService = new OnlineMatchService({ now: () => now, recorder });
    match = await matchService.createMatch({
      roomCode: 'UNDO05',
      startedAt: now,
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
    forceMainPhaseForFirst(match);

    initialHandCount = match.session.state!.players[0].hand.cardIds.length;
    initialDeckCount = match.session.state!.players[0].mainDeck.cardIds.length;
    const commandResult = await matchService.executeCommand(
      match.matchId,
      'u1',
      createDrawCardToHandCommand('ignored-client-player-id')
    );
    expect(commandResult?.success).toBe(true);
    expect(match.session.state?.players[0].hand.cardIds).toHaveLength(initialHandCount + 1);
    const undoEntry = commandResult?.snapshot?.playerViewState.match.undo?.entry;
    expect(undoEntry).toBeTruthy();

    now += 1_000;
    const requestResult = await matchService.createUndoRequest(match.matchId, 'u1', {
      expectedRevision: commandResult!.snapshot!.seq,
      undoEntryId: undoEntry!.undoEntryId,
      idempotencyKey: 'request-order',
    });
    const requestId = requestResult?.snapshot?.playerViewState.match.undo?.pendingRequest?.requestId;
    expect(requestResult?.success).toBe(true);
    expect(requestId).toBeTruthy();

    now += 1_000;
    const acceptResult = await matchService.acceptUndoRequest(match.matchId, 'u2', requestId!, {
      expectedRevision: requestResult!.snapshot!.seq,
      idempotencyKey: 'accept-order',
    });

    expect(acceptResult?.success).toBe(true);
    expect(acceptedFrameObserved).toBe(true);
    expect(match.session.state?.players[0].hand.cardIds).toHaveLength(initialHandCount);
    expect(match.session.state?.players[0].mainDeck.cardIds).toHaveLength(initialDeckCount);
  });

  it('正式联机成员从手牌登场后应允许对手同意撤销', async () => {
    let now = 5_875_000;
    const matchService = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await matchService.createMatch({
      roomCode: 'UNDO06',
      startedAt: now,
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
    forceMainPhaseForFirst(match);

    const firstPlayer = match.session.state!.players[0];
    const memberCardId = firstPlayer.hand.cardIds.find(
      (cardId) => match.session.state!.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    expect(memberCardId).toBeTruthy();
    expect(firstPlayer.memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    const initialHandCardIds = [...firstPlayer.hand.cardIds];

    const commandResult = await matchService.executeCommand(
      match.matchId,
      'u1',
      createPlayMemberToSlotCommand(
        'ignored-client-player-id',
        memberCardId!,
        SlotPosition.CENTER,
        { freePlay: true }
      )
    );
    expect(commandResult?.success).toBe(true);
    expect(match.session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      memberCardId
    );
    expect(match.session.state?.players[0].hand.cardIds).not.toContain(memberCardId);

    const undoView = commandResult?.snapshot?.playerViewState.match.undo;
    expect(undoView).toMatchObject({
      policy: 'REMOTE_REQUEST',
      canUndoNow: true,
      disabledReason: null,
    });
    expect(undoView?.entry).toMatchObject({
      label: 'PLAY_MEMBER_TO_SLOT',
      hasHumanOpponentReveal: true,
    });

    now += 1_000;
    const requestResult = await matchService.createUndoRequest(match.matchId, 'u1', {
      expectedRevision: commandResult!.snapshot!.seq,
      undoEntryId: undoView!.entry!.undoEntryId,
      idempotencyKey: 'request-member-play',
    });
    expect(requestResult?.success).toBe(true);
    const requestId = requestResult?.snapshot?.playerViewState.match.undo?.pendingRequest?.requestId;
    expect(requestId).toBeTruthy();

    now += 1_000;
    const acceptResult = await matchService.acceptUndoRequest(match.matchId, 'u2', requestId!, {
      expectedRevision: requestResult!.snapshot!.seq,
      idempotencyKey: 'accept-member-play',
    });

    expect(acceptResult?.success).toBe(true);
    expect(match.session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(match.session.state?.players[0].hand.cardIds).toEqual(initialHandCardIds);
  });

  it('正式联机没有连续授权时不允许直接撤销绕过对手', async () => {
    let now = 5_890_000;
    const matchService = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await matchService.createMatch({
      roomCode: 'UNDO07',
      startedAt: now,
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
    forceMainPhaseForFirst(match);

    const initialHandCount = match.session.state!.players[0].hand.cardIds.length;
    const commandResult = await matchService.executeCommand(
      match.matchId,
      'u1',
      createDrawCardToHandCommand('ignored-client-player-id')
    );
    expect(commandResult?.success).toBe(true);
    const undoEntry = commandResult?.snapshot?.playerViewState.match.undo?.entry;
    expect(undoEntry).toBeTruthy();

    now += 1_000;
    const directUndoResult = await matchService.undoLatest(match.matchId, 'u1', {
      expectedRevision: commandResult!.snapshot!.seq,
      undoEntryId: undoEntry!.undoEntryId,
      idempotencyKey: 'direct-without-grant',
    });

    expect(directUndoResult).toMatchObject({
      success: false,
      error: '正式联机需要对手同意后才能撤销',
    });
    expect(match.session.state?.players[0].hand.cardIds).toHaveLength(initialHandCount + 1);
  });

  it('正式联机对手可授权同一操作窗口连续撤销', async () => {
    let now = 5_895_000;
    const matchService = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await matchService.createMatch({
      roomCode: 'UNDO08',
      startedAt: now,
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
    forceMainPhaseForFirst(match);

    const initialHandCount = match.session.state!.players[0].hand.cardIds.length;
    const initialDeckCount = match.session.state!.players[0].mainDeck.cardIds.length;
    const firstDraw = await matchService.executeCommand(
      match.matchId,
      'u1',
      createDrawCardToHandCommand('ignored-client-player-id')
    );
    expect(firstDraw?.success).toBe(true);
    const firstUndoEntry = firstDraw?.snapshot?.playerViewState.match.undo?.entry;
    expect(firstUndoEntry).toBeTruthy();

    now += 500;
    const secondDraw = await matchService.executeCommand(
      match.matchId,
      'u1',
      createDrawCardToHandCommand('ignored-client-player-id')
    );
    expect(secondDraw?.success).toBe(true);
    const secondUndoEntry = secondDraw?.snapshot?.playerViewState.match.undo?.entry;
    expect(secondUndoEntry).toBeTruthy();
    expect(secondUndoEntry?.boundaryKey).toBe(firstUndoEntry?.boundaryKey);
    expect(match.session.state?.players[0].hand.cardIds).toHaveLength(initialHandCount + 2);
    expect(match.session.state?.players[0].mainDeck.cardIds).toHaveLength(initialDeckCount - 2);

    now += 500;
    const requestResult = await matchService.createUndoRequest(match.matchId, 'u1', {
      expectedRevision: secondDraw!.snapshot!.seq,
      undoEntryId: secondUndoEntry!.undoEntryId,
      idempotencyKey: 'request-continuous',
    });
    expect(requestResult?.success).toBe(true);
    const requestId = requestResult?.snapshot?.playerViewState.match.undo?.pendingRequest?.requestId;
    expect(requestId).toBeTruthy();

    now += 500;
    const acceptResult = await matchService.acceptUndoRequest(match.matchId, 'u2', requestId!, {
      expectedRevision: requestResult!.snapshot!.seq,
      idempotencyKey: 'accept-continuous',
      grantContinuous: true,
    });
    expect(acceptResult?.success).toBe(true);
    expect(match.session.state?.players[0].hand.cardIds).toHaveLength(initialHandCount + 1);
    expect(match.session.state?.players[0].mainDeck.cardIds).toHaveLength(initialDeckCount - 1);

    const requesterSnapshot = await matchService.getMatchSnapshot(match.matchId, 'u1');
    const continuousUndoView = requesterSnapshot?.playerViewState.match.undo;
    expect(continuousUndoView?.grant).toMatchObject({
      requesterSeat: 'FIRST',
      grantorSeat: 'SECOND',
      boundaryKey: firstUndoEntry?.boundaryKey,
    });
    expect(continuousUndoView).toMatchObject({
      canUndoNow: true,
      disabledReason: null,
    });
    expect(continuousUndoView?.entry?.undoEntryId).toBe(firstUndoEntry?.undoEntryId);

    now += 500;
    const directUndoResult = await matchService.undoLatest(match.matchId, 'u1', {
      expectedRevision: requesterSnapshot!.seq,
      undoEntryId: continuousUndoView!.entry!.undoEntryId,
      idempotencyKey: 'direct-with-continuous-grant',
    });

    expect(directUndoResult?.success).toBe(true);
    expect(match.session.state?.players[0].hand.cardIds).toHaveLength(initialHandCount);
    expect(match.session.state?.players[0].mainDeck.cardIds).toHaveLength(initialDeckCount);
    expect(directUndoResult?.snapshot?.playerViewState.match.undo?.grant).toBeNull();
  });

  it('正式联机撤销请求被拒绝后应只清除 pending 并保留原动作', async () => {
    let now = 5_900_000;
    const matchService = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await matchService.createMatch({
      roomCode: 'UNDO02',
      startedAt: now,
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
    forceMainPhaseForFirst(match);

    const initialHandCount = match.session.state!.players[0].hand.cardIds.length;
    const initialDeckCount = match.session.state!.players[0].mainDeck.cardIds.length;
    const commandResult = await matchService.executeCommand(
      match.matchId,
      'u1',
      createDrawCardToHandCommand('ignored-client-player-id')
    );
    const undoEntry = commandResult?.snapshot?.playerViewState.match.undo?.entry;
    expect(commandResult?.success).toBe(true);
    expect(undoEntry).toBeTruthy();

    now += 1_000;
    const requestResult = await matchService.createUndoRequest(match.matchId, 'u1', {
      expectedRevision: commandResult!.snapshot!.seq,
      undoEntryId: undoEntry!.undoEntryId,
      idempotencyKey: 'request-reject',
    });
    const requestId = requestResult?.snapshot?.playerViewState.match.undo?.pendingRequest?.requestId;
    expect(requestResult?.success).toBe(true);
    expect(requestId).toBeTruthy();

    now += 1_000;
    const rejectResult = await matchService.rejectUndoRequest(match.matchId, 'u2', requestId!, {
      expectedRevision: requestResult!.snapshot!.seq,
      idempotencyKey: 'reject-request',
    });

    expect(rejectResult?.success).toBe(true);
    expect(rejectResult?.snapshot?.playerViewState.match.undo?.pendingRequest).toBeNull();
    expect(match.session.state?.players[0].hand.cardIds).toHaveLength(initialHandCount + 1);
    expect(match.session.state?.players[0].mainDeck.cardIds).toHaveLength(initialDeckCount - 1);
    expect(rejectResult?.snapshot?.playerViewState.match.undo?.canUndoNow).toBe(false);
    expect(rejectResult?.snapshot?.playerViewState.match.undo?.disabledReason).toBe(
      '只能撤销自己最近一次操作'
    );

    const repeatedReject = await matchService.rejectUndoRequest(match.matchId, 'u2', requestId!, {
      expectedRevision: requestResult!.snapshot!.seq,
      idempotencyKey: 'reject-request',
    });
    expect(repeatedReject?.success).toBe(true);
    expect(repeatedReject?.snapshot?.seq).toBe(rejectResult?.snapshot?.seq);
  });

  it('正式联机撤销请求超时后下一次 snapshot 轮询应清除 pending 并递增 revision', async () => {
    let now = 6_000_000;
    const matchService = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await matchService.createMatch({
      roomCode: 'UNDO03',
      startedAt: now,
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
    forceMainPhaseForFirst(match);

    const commandResult = await matchService.executeCommand(
      match.matchId,
      'u1',
      createDrawCardToHandCommand('ignored-client-player-id')
    );
    const undoEntry = commandResult?.snapshot?.playerViewState.match.undo?.entry;
    expect(commandResult?.success).toBe(true);
    expect(undoEntry).toBeTruthy();

    now += 1_000;
    const requestResult = await matchService.createUndoRequest(match.matchId, 'u1', {
      expectedRevision: commandResult!.snapshot!.seq,
      undoEntryId: undoEntry!.undoEntryId,
      idempotencyKey: 'request-expire',
    });
    expect(requestResult?.success).toBe(true);
    expect(requestResult?.snapshot?.playerViewState.match.undo?.pendingRequest).toBeTruthy();

    now += 61_000;
    const expiredSnapshot = await matchService.getMatchSnapshot(match.matchId, 'u1', {
      sinceSeq: requestResult!.snapshot!.seq,
    });

    expect(expiredSnapshot).toBeTruthy();
    expect('modified' in expiredSnapshot!).toBe(false);
    if (!expiredSnapshot || 'modified' in expiredSnapshot) {
      throw new Error('Expected full snapshot after undo request expiration');
    }
    expect(expiredSnapshot.seq).toBeGreaterThan(requestResult!.snapshot!.seq);
    expect(expiredSnapshot.playerViewState.match.undo?.pendingRequest).toBeNull();
    expect(expiredSnapshot.playerViewState.match.undo?.canUndoNow).toBe(true);
  });

  it('正式联机请求式撤销应拒绝包含随机或洗切处理的最近一步', async () => {
    let now = 6_100_000;
    const matchService = new OnlineMatchService({ now: () => now, recorder: null });
    const match = await matchService.createMatch({
      roomCode: 'UNDO04',
      startedAt: now,
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
    forceMainPhaseForFirst(match);

    const firstPlayer = match.session.state!.players[0] as unknown as {
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
    };
    const refreshCardIds = [...firstPlayer.mainDeck.cardIds.slice(0, 3)];
    firstPlayer.mainDeck.cardIds = [];
    firstPlayer.waitingRoom.cardIds = refreshCardIds;

    const commandResult = await matchService.executeCommand(
      match.matchId,
      'u1',
      createDrawCardToHandCommand('ignored-client-player-id')
    );
    expect(commandResult?.success).toBe(true);
    const undoView = commandResult?.snapshot?.playerViewState.match.undo;
    expect(undoView?.entry?.hasRandomOrShuffle).toBe(true);
    expect(undoView?.canUndoNow).toBe(false);
    expect(undoView?.disabledReason).toBe('该操作包含随机或洗切处理，暂不支持远程撤销');

    now += 1_000;
    const requestResult = await matchService.createUndoRequest(match.matchId, 'u1', {
      expectedRevision: commandResult!.snapshot!.seq,
      undoEntryId: undoView!.entry!.undoEntryId,
      idempotencyKey: 'request-random',
    });

    expect(requestResult).toMatchObject({
      success: false,
      error: '该操作包含随机或洗切处理，暂不支持远程撤销',
    });
    expect(match.pendingUndoRequest).toBeNull();
  });

  it('命令 append 失败时不阻断对局，但会标记记录为 PARTIAL', async () => {
    let now = 5_600_000;
    const recorder = createTestRecorder({
      appendMatchRecordFrame: vi.fn(async () => {
        throw new Error('append failed');
      }),
    });
    const matchService = new OnlineMatchService({ now: () => now, recorder });
    const match = await matchService.createMatch({
      roomCode: 'APP02',
      startedAt: now,
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

    now += 1_000;
    const commandResult = await matchService.executeCommand(
      match.matchId,
      'u1',
      createMulliganCommand('ignored-client-player-id', [])
    );

    expect(commandResult?.success).toBe(true);
    expect(matchService.getMatch(match.matchId)).not.toBeNull();
    expect(recorder.markPartial).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: match.matchId,
        completeness: 'PARTIAL',
        partialReason: 'command_accepted append failed',
        recorderError: 'append failed',
      })
    );
  });

  it('非当前玩家推进阶段被服务层拒绝时应追加 rejected timeline', async () => {
    let now = 5_700_000;
    const recorder = createTestRecorder();
    const matchService = new OnlineMatchService({ now: () => now, recorder });
    const match = await matchService.createMatch({
      roomCode: 'APP03',
      startedAt: now,
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
    const nonActiveUserId = match.session.isActivePlayer(match.participants.FIRST.playerId)
      ? 'u2'
      : 'u1';

    now += 1_000;
    const firstResult = await matchService.advancePhase(match.matchId, nonActiveUserId);
    now += 1_000;
    const secondResult = await matchService.advancePhase(match.matchId, nonActiveUserId);

    expect(firstResult?.success).toBe(false);
    expect(secondResult?.success).toBe(false);
    const appendCalls = vi.mocked(recorder.appendMatchRecordFrame).mock.calls.map(([input]) => input);
    expect(appendCalls).toHaveLength(2);
    appendCalls.forEach((input) => {
      expect(input).toMatchObject({
        matchId: match.matchId,
        frameType: 'COMMAND_REJECTED',
        summary: '服务层拒绝阶段推进：当前不是该玩家的推进时机',
        writeAuthorityCheckpoint: false,
      });
    });
    expect(appendCalls[0]?.dedupeKey).toMatch(/^service-rejected:advance-phase:/);
    expect(appendCalls[1]?.dedupeKey).toMatch(/^service-rejected:advance-phase:/);
    expect(appendCalls[1]?.dedupeKey).not.toBe(appendCalls[0]?.dedupeKey);
  });

  it('对局房间销毁前应先封存运行中 match 为 INTERRUPTED/PARTIAL', async () => {
    let now = 6_000_000;
    const recorder = createTestRecorder();
    const matchService = new OnlineMatchService({ now: () => now, recorder });
    const service = new OnlineRoomService({
      now: () => now,
      matchService,
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('seal1', 'u1');
    await service.joinRoom('seal1', 'u2');
    await service.lockDeck('seal1', 'u1', 'deck-a');
    await service.lockDeck('seal1', 'u2', 'deck-b');
    await service.proposeTurnOrder('seal1', 'u1', 'HOST_FIRST');
    const started = await service.respondTurnOrder('seal1', 'u2', true);
    await service.leaveRoom('seal1', 'u1');
    await service.leaveRoom('seal1', 'u2');

    now += 61_000;

    await expect(service.getRoomIfPresent('seal1')).resolves.toBeNull();
    expect(matchService.getMatch(started.matchId!)).toBeNull();
    expect(recorder.sealMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: started.matchId,
        status: 'INTERRUPTED',
        completeness: 'PARTIAL',
        endReason: 'ROOM_DESTROYED_ALL_ABSENT',
      })
    );
  });

  it('封存失败时应保留运行中 match 和房间以便后续重试', async () => {
    let now = 7_000_000;
    const recorder = createTestRecorder({
      sealMatch: vi.fn(async () => {
        throw new Error('seal failed');
      }),
    });
    const matchService = new OnlineMatchService({ now: () => now, recorder });
    const service = new OnlineRoomService({
      now: () => now,
      matchService,
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('sealx', 'u1');
    await service.joinRoom('sealx', 'u2');
    await service.lockDeck('sealx', 'u1', 'deck-a');
    await service.lockDeck('sealx', 'u2', 'deck-b');
    await service.proposeTurnOrder('sealx', 'u1', 'HOST_FIRST');
    const started = await service.respondTurnOrder('sealx', 'u2', true);
    await service.leaveRoom('sealx', 'u1');
    await service.leaveRoom('sealx', 'u2');

    now += 61_000;

    const room = await service.getRoomIfPresent('sealx');
    expect(room?.status).toBe('IN_GAME');
    expect(matchService.getMatch(started.matchId!)).not.toBeNull();
    expect(recorder.markPartial).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: started.matchId,
        status: 'INTERRUPTED',
        completeness: 'INCOMPLETE',
        partialReason: 'interrupted seal failed',
      })
    );
  });

  it('GAME_END match 删除时应封存为 COMPLETED/FULL 并记录胜者座位', async () => {
    let now = 8_000_000;
    const recorder = createTestRecorder();
    const matchService = new OnlineMatchService({ now: () => now, recorder });
    const match = await matchService.createMatch({
      roomCode: 'END01',
      startedAt: now,
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
    const state = match.session.state as {
      currentPhase: GamePhase;
      endInfo: {
        reason: GameEndReason;
        winnerId: string | null;
        loserId: string | null;
        isDraw: boolean;
        endTimestamp: number;
        finalTurnCount: number;
      };
      isEnded: boolean;
      turnCount: number;
    };
    state.currentPhase = GamePhase.GAME_END;
    state.isEnded = true;
    state.endInfo = {
      reason: GameEndReason.VICTORY_CONDITION,
      winnerId: match.participants.FIRST.playerId,
      loserId: match.participants.SECOND.playerId,
      isDraw: false,
      endTimestamp: now + 5_000,
      finalTurnCount: state.turnCount,
    };

    const deleted = await matchService.deleteMatch(match.matchId, {
      reason: 'TEST_DELETE',
      now: now + 6_000,
    });

    expect(deleted).toBe(true);
    expect(matchService.getMatch(match.matchId)).toBeNull();
    expect(recorder.sealMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: match.matchId,
        status: 'COMPLETED',
        completeness: 'FULL',
        winnerSeat: 'FIRST',
        endReason: GameEndReason.VICTORY_CONDITION,
        endedAt: now + 5_000,
      })
    );
  });

  it('同一用户重复加入同一房间时应复用原成员槽位', async () => {
    const service = new OnlineRoomService({
      matchService: createInMemoryMatchService(),
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('same1', 'u1');
    await service.joinRoom('same1', 'u2');
    const rejoined = await service.joinRoom('same1', 'u2');

    expect(rejoined.members).toHaveLength(2);
    expect(rejoined.currentUserRole).toBe('GUEST');
  });

  it('准备阶段房主离开后应把房主身份转移给剩余玩家', async () => {
    const service = new OnlineRoomService({
      matchService: createInMemoryMatchService(),
      loadUserProfile: (userId) => Promise.resolve({ userId, displayName: userId }),
      loadOwnedDeck: (_userId, deckId) =>
        Promise.resolve({
          deckId,
          deckName: deckId,
          runtimeDeck: createRuntimeDeck(deckId),
        }),
    });

    await service.createRoom('host2', 'u1');
    await service.joinRoom('host2', 'u2');

    const result = await service.leaveRoom('host2', 'u1');
    expect(result.room?.ownerUserId).toBe('u2');
    expect(result.room?.members[0]?.role).toBe('HOST');
  });

  it('对局内离开后应保留房间并允许同一用户恢复为 ACTIVE', async () => {
    const matchService = createInMemoryMatchService();
    const service = new OnlineRoomService({
      matchService,
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('rest1', 'u1');
    await service.joinRoom('rest1', 'u2');
    await service.lockDeck('rest1', 'u1', 'deck-a');
    await service.lockDeck('rest1', 'u2', 'deck-b');
    await service.proposeTurnOrder('rest1', 'u1', 'HOST_FIRST');
    const started = await service.respondTurnOrder('rest1', 'u2', true);

    const left = await service.leaveRoom('rest1', 'u2');
    expect(left.room?.status).toBe('IN_GAME');
    expect(left.room?.currentUserPresence).toBe('LEFT');

    const commandResult = await matchService.executeCommand(
      started.matchId!,
      'u1',
      createMulliganCommand('ignored-client-player-id', [])
    );
    expect(commandResult?.success).toBe(true);

    const restored = await service.getRoomView('rest1', 'u2');
    expect(restored.status).toBe('IN_GAME');
    expect(restored.currentUserPresence).toBe('ACTIVE');
    const restoredSnapshot = await matchService.getMatchSnapshot(started.matchId!, 'u2');
    expect(restoredSnapshot?.seat).toBe('SECOND');
    expect(restoredSnapshot?.seq).toBe(commandResult?.snapshot?.seq);
    expect(restoredSnapshot?.playerViewState.match.seq).toBe(commandResult?.snapshot?.seq);
  });

  it('双方都关闭后准备阶段房间应在宽限期后释放', async () => {
    let now = 1_000_000;
    const service = new OnlineRoomService({
      now: () => now,
      matchService: createInMemoryMatchService(),
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('stale1', 'u1');
    await service.joinRoom('stale1', 'u2');

    now += 61_000;

    await expect(service.getRoomIfPresent('stale1')).resolves.toBeNull();

    const recreated = await service.createRoom('stale1', 'u3');
    expect(recreated.currentUserId).toBe('u3');
    expect(recreated.members).toHaveLength(1);
  });

  it('双方都失联后对局房间和 match 应在宽限期后一起销毁', async () => {
    let now = 2_000_000;
    const matchService = createInMemoryMatchService();
    const service = new OnlineRoomService({
      now: () => now,
      matchService,
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('gone1', 'u1');
    await service.joinRoom('gone1', 'u2');
    await service.lockDeck('gone1', 'u1', 'deck-a');
    await service.lockDeck('gone1', 'u2', 'deck-b');
    await service.proposeTurnOrder('gone1', 'u1', 'HOST_FIRST');
    const started = await service.respondTurnOrder('gone1', 'u2', true);

    now += 61_000;

    await expect(service.getRoomIfPresent('gone1')).resolves.toBeNull();
    expect(matchService.getMatch(started.matchId!)).toBeNull();
  });

  it('对局请求刷新成员活跃时间后不应因房间轮询停滞销毁房间', async () => {
    let now = 3_000_000;
    const matchService = createInMemoryMatchService();
    const service = new OnlineRoomService({
      now: () => now,
      matchService,
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('live1', 'u1');
    await service.joinRoom('live1', 'u2');
    await service.lockDeck('live1', 'u1', 'deck-a');
    await service.lockDeck('live1', 'u2', 'deck-b');
    await service.proposeTurnOrder('live1', 'u1', 'HOST_FIRST');
    const started = await service.respondTurnOrder('live1', 'u2', true);

    now += 61_000;
    await service.touchInGameMemberByMatch(started.matchId!, 'u1');

    const room = await service.getRoomIfPresent('live1');
    expect(room?.status).toBe('IN_GAME');
    expect(room?.members.find((member) => member.userId === 'u1')?.presence).toBe('ACTIVE');
    expect(matchService.getMatch(started.matchId!)).not.toBeNull();
  });

  it('对局中断超过宽限期后成员房间轮询先恢复时不应销毁 match', async () => {
    let now = 4_000_000;
    const matchService = createInMemoryMatchService();
    const service = new OnlineRoomService({
      now: () => now,
      matchService,
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('race1', 'u1');
    await service.joinRoom('race1', 'u2');
    await service.lockDeck('race1', 'u1', 'deck-a');
    await service.lockDeck('race1', 'u2', 'deck-b');
    await service.proposeTurnOrder('race1', 'u1', 'HOST_FIRST');
    const started = await service.respondTurnOrder('race1', 'u2', true);

    now += 61_000;

    const restored = await service.getRoomView('race1', 'u1');
    expect(restored.status).toBe('IN_GAME');
    expect(restored.currentUserPresence).toBe('ACTIVE');
    expect(matchService.getMatch(started.matchId!)).not.toBeNull();
  });

  it('非成员创建已占用房间号时应返回冲突错误', async () => {
    const service = new OnlineRoomService({
      matchService: createInMemoryMatchService(),
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('conf1', 'u1');

    await expect(service.createRoom('conf1', 'u3')).rejects.toMatchObject<OnlineRoomServiceError>({
      code: 'ONLINE_ROOM_EXISTS',
      statusCode: 409,
    });
  });

  it('管理员房间摘要应返回活跃房间与对局元数据且不暴露卡组内容', async () => {
    let now = 5_000_000;
    const matchService = createInMemoryMatchService();
    const service = new OnlineRoomService({
      now: () => now,
      matchService,
      loadUserProfile: (userId) => Promise.resolve({ userId, displayName: userId }),
      loadOwnedDeck: (_userId, deckId) =>
        Promise.resolve({
          deckId,
          deckName: deckId,
          runtimeDeck: createRuntimeDeck(deckId),
        }),
    });

    await service.createRoom('prep1', 'u1');
    await service.joinRoom('prep1', 'u2');

    await service.createRoom('ready1', 'u3');
    await service.joinRoom('ready1', 'u4');
    await service.lockDeck('ready1', 'u3', 'deck-c');
    await service.lockDeck('ready1', 'u4', 'deck-d');
    await service.proposeTurnOrder('ready1', 'u3', 'HOST_FIRST');

    await service.createRoom('game1', 'u5');
    await service.joinRoom('game1', 'u6');
    await service.lockDeck('game1', 'u5', 'deck-e');
    await service.lockDeck('game1', 'u6', 'deck-f');
    await service.proposeTurnOrder('game1', 'u5', 'HOST_SECOND');
    const started = await service.respondTurnOrder('game1', 'u6', true);

    now += 12_000;

    const summaries = await service.listAdminRoomSummaries();
    expect(summaries.map((room) => room.roomCode).sort()).toEqual(['GAME1', 'PREP1', 'READY1']);

    const gameSummary = summaries.find((room) => room.roomCode === 'GAME1');
    expect(gameSummary?.status).toBe('IN_GAME');
    expect(gameSummary?.matchId).toBe(started.matchId);
    expect(gameSummary?.match?.startedAt).toBe(5_000_000);
    expect(gameSummary?.match?.durationMs).toBe(12_000);
    expect(gameSummary?.members.map((member) => member.seat).sort()).toEqual(['FIRST', 'SECOND']);

    const serialized = JSON.stringify(gameSummary);
    expect(serialized).toContain('deck-e');
    expect(serialized).not.toContain('mainDeck');
    expect(serialized).not.toContain('energyDeck');
    expect(serialized).not.toContain('resolvedDeckConfig');
  });
});
