import { describe, expect, it, vi } from 'vitest';
import {
  createDrawCardToHandCommand,
  createMulliganCommand,
  createPlayMemberToSlotCommand,
  createSetLiveCardCommand,
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

function createInMemoryMatchService(
  deps: ConstructorParameters<typeof OnlineMatchService>[0] = {}
): OnlineMatchService {
  return new OnlineMatchService({ recorder: null, ...deps });
}

async function startRoomThroughOpening(
  service: OnlineRoomService,
  roomCode: string,
  hostUserId: string,
  guestUserId: string,
  firstUserId: string
) {
  if (firstUserId !== hostUserId && firstUserId !== guestUserId) {
    throw new Error('firstUserId must be one of the room members');
  }
  const secondUserId = firstUserId === hostUserId ? guestUserId : hostUserId;
  await service.markReadyToStart(roomCode, hostUserId);
  await service.markReadyToStart(roomCode, guestUserId);
  await service.submitOpeningRps(roomCode, firstUserId, 'ROCK');
  await service.submitOpeningRps(roomCode, secondUserId, 'SCISSORS');
  return service.chooseOpeningTurnOrder(roomCode, firstUserId, 'SELF_FIRST');
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
  it('应完成正式房间开局流程并生成联机对局', async () => {
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

    const started = await startRoomThroughOpening(service, 'ROOM9', 'u1', 'u2', 'u2');
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
      currentPublicSeq: snapshot!.currentPublicSeq,
      modified: false,
    });
    expect(expectJsonRoundTrip(unchangedSnapshot)).toEqual({
      matchId: started.matchId,
      seq: snapshot!.seq,
      currentPublicSeq: snapshot!.currentPublicSeq,
      modified: false,
    });

    const publicLog = await matchService.getMatchPublicEvents(started.matchId!, 'u2', {
      afterSeq: 0,
    });
    expect(publicLog?.matchId).toBe(started.matchId);
    expect(publicLog?.currentPublicSeq).toBeGreaterThan(0);
    expect(publicLog?.publicEvents.length).toBeGreaterThan(0);
    expect('privateEvents' in publicLog!).toBe(false);

    const publicLogDelta = await matchService.getMatchPublicEvents(started.matchId!, 'u2', {
      afterSeq: publicLog!.currentPublicSeq,
    });
    expect(publicLogDelta).toEqual({
      matchId: started.matchId,
      currentPublicSeq: publicLog!.currentPublicSeq,
      publicEvents: [],
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

  it('房间号观战只读复用对应玩家投影并计入房间观战者', async () => {
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

    await service.createRoom('spec1', 'u1');
    await service.joinRoom('spec1', 'u2');
    await service.lockDeck('spec1', 'u1', 'deck-a');
    await service.lockDeck('spec1', 'u2', 'deck-b');
    const started = await startRoomThroughOpening(service, 'spec1', 'u1', 'u2', 'u2');
    expect(started.currentUserSeat).toBe('FIRST');

    const link = await service.createRoomCodeSpectatorLink('spec1', 'FIRST');
    expect(link).toMatchObject({
      matchId: started.matchId,
      viewType: 'PLAYER',
      viewerSeat: 'FIRST',
      authorizedViewerSeats: ['FIRST', 'SECOND'],
    });
    expect(link.path).toContain('/online/spectate/');

    const adminLink = await matchService.createAdminPlayerViewSpectatorLink(
      started.matchId!,
      'SECOND'
    );
    expect(adminLink).toMatchObject({
      matchId: started.matchId,
      viewType: 'PLAYER',
      viewerSeat: 'SECOND',
      authorizedViewerSeats: ['FIRST', 'SECOND'],
    });

    const adminJoined = await matchService.joinSpectatorLink(adminLink!.token, {
      displayName: '管理员',
    });
    expect(adminJoined.session).toMatchObject({
      displayName: '管理员',
      viewType: 'PLAYER',
      viewerSeat: 'SECOND',
      authorizedViewerSeats: ['FIRST', 'SECOND'],
      viewVersion: 1,
    });
    expect(adminJoined.snapshot.seat).toBe('SECOND');
    expect(adminJoined.snapshot.playerViewState.match.viewerSeat).toBe('SECOND');
    expect(adminJoined.snapshot.playerViewState.permissions.availableCommands).toEqual([]);

    const adminSwitched = await matchService.switchSpectatorView(
      adminLink!.token,
      adminJoined.session.sessionId,
      'FIRST'
    );
    expect(adminSwitched.session).toMatchObject({ viewerSeat: 'FIRST', viewVersion: 2 });
    expect(adminSwitched.snapshot).toMatchObject({
      seat: 'FIRST',
      spectatorView: {
        currentViewerSeat: 'FIRST',
        authorizedViewerSeats: ['FIRST', 'SECOND'],
        viewVersion: 2,
      },
    });

    const roomAfterAdminJoin = await service.getRoomView('spec1', 'u1');
    expect(roomAfterAdminJoin.spectatorPresence.total).toBe(0);
    expect(roomAfterAdminJoin.spectatorPresence.viewers).toEqual([]);

    const joined = await matchService.joinSpectatorLink(link.token, {
      displayName: '旁观者',
    });
    expect(joined.session).toMatchObject({
      displayName: '旁观者',
      viewType: 'PLAYER',
      viewerSeat: 'FIRST',
    });
    expect(joined.snapshot.seat).toBe('FIRST');
    expect(joined.snapshot.playerViewState.match.viewerSeat).toBe('FIRST');
    expect(joined.snapshot.playerViewState.match.undo?.policy).toBe('NONE');
    expect(joined.snapshot.playerViewState.match.undo?.canUndoNow).toBe(false);
    expect(joined.snapshot.playerViewState.permissions.availableCommands).toEqual([]);
    await expect(matchService.getSpectatorSnapshot(link.token, null)).rejects.toMatchObject({
      code: 'ONLINE_SPECTATOR_SESSION_REQUIRED',
    });
    await expect(
      matchService.getSpectatorSnapshot(link.token, adminJoined.session.sessionId)
    ).rejects.toMatchObject({ code: 'ONLINE_SPECTATOR_SESSION_INVALID' });

    const firstHandObjectId = joined.snapshot.playerViewState.table.zones.FIRST_HAND.objectIds?.[0];
    expect(firstHandObjectId).toBeTruthy();
    expect(joined.snapshot.playerViewState.objects[firstHandObjectId!]?.surface).toBe('FRONT');
    expect(joined.snapshot.playerViewState.table.zones.SECOND_HAND.objectIds).toBeUndefined();

    const unchangedSnapshot = await matchService.getSpectatorSnapshot(
      link.token,
      joined.session.sessionId,
      {
        sinceSeq: joined.snapshot.seq,
        sinceViewVersion: joined.session.viewVersion,
      }
    );
    expect(unchangedSnapshot).toEqual({
      matchId: started.matchId,
      seq: joined.snapshot.seq,
      currentPublicSeq: joined.snapshot.currentPublicSeq,
      modified: false,
      spectatorView: joined.snapshot.spectatorView,
    });

    const publicLog = await matchService.getSpectatorPublicEvents(
      link.token,
      joined.session.sessionId,
      {
        afterSeq: 0,
      }
    );
    expect(publicLog.matchId).toBe(started.matchId);
    expect(publicLog.publicEvents.length).toBeGreaterThan(0);

    const roomForPlayer = await service.getRoomView('spec1', 'u1');
    expect(roomForPlayer.spectatorPresence.total).toBe(1);
    expect(roomForPlayer.spectatorPresence.viewers[0]).toMatchObject({
      displayName: '旁观者',
      viewType: 'PLAYER',
      viewerSeat: 'FIRST',
    });
    expect(roomForPlayer.members.map((member) => member.userId)).toEqual(['u1', 'u2']);
  });

  it('房间号观战默认开启，并在双方关闭后撤销会话', async () => {
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

    await service.createRoom('watch1', 'u1');
    await service.joinRoom('watch1', 'u2');
    await service.lockDeck('watch1', 'u1', 'deck-a');
    await service.lockDeck('watch1', 'u2', 'deck-b');
    const started = await startRoomThroughOpening(service, 'watch1', 'u1', 'u2', 'u2');
    expect(started.currentUserSeat).toBe('FIRST');
    expect(started.spectatorRoomEntry?.seats).toEqual([
      { seat: 'FIRST', displayName: 'Beta', enabled: true },
      { seat: 'SECOND', displayName: 'Alpha', enabled: true },
    ]);

    const publicEntry = await service.getRoomSpectatorEntry('watch1');
    expect(publicEntry?.seats.map((seat) => [seat.seat, seat.enabled])).toEqual([
      ['FIRST', true],
      ['SECOND', true],
    ]);
    await expect(service.getRoomSpectatorEntry('watch1', 'u1')).rejects.toMatchObject({
      code: 'ONLINE_ROOM_SPECTATOR_FORBIDDEN',
    });
    await expect(
      service.createRoomCodeSpectatorLink('watch1', 'FIRST', 'u2')
    ).rejects.toMatchObject({ code: 'ONLINE_ROOM_SPECTATOR_FORBIDDEN' });

    const roomCodeLink = await service.createRoomCodeSpectatorLink('watch1', 'FIRST');
    expect(roomCodeLink).toMatchObject({
      matchId: started.matchId,
      viewerSeat: 'FIRST',
      authorizedViewerSeats: ['FIRST', 'SECOND'],
    });
    await expect(
      matchService.joinSpectatorLink(roomCodeLink.token, {
        clientId: 'participant-tab',
        authenticatedUserId: 'u1',
      })
    ).rejects.toMatchObject({ code: 'ONLINE_ROOM_SPECTATOR_FORBIDDEN' });

    const joined = await matchService.joinSpectatorLink(roomCodeLink.token, {
      clientId: 'room-code-tab',
    });
    expect(joined.snapshot.playerViewState.match.viewerSeat).toBe('FIRST');
    const switched = await matchService.switchSpectatorView(
      roomCodeLink.token,
      joined.session.sessionId,
      'SECOND'
    );
    expect(switched.session).toMatchObject({ viewerSeat: 'SECOND', viewVersion: 2 });
    const switchedBack = await matchService.switchSpectatorView(
      roomCodeLink.token,
      joined.session.sessionId,
      'FIRST'
    );
    expect(switchedBack.session).toMatchObject({ viewerSeat: 'FIRST', viewVersion: 3 });
    expect((await service.getRoomView('watch1', 'u1')).spectatorPresence.total).toBe(1);

    const closed = await service.setOwnRoomSpectatorEntry('watch1', 'u2', false);
    expect(closed.spectatorRoomEntry?.seats.find((seat) => seat.seat === 'FIRST')?.enabled).toBe(
      false
    );
    expect(await service.getRoomSpectatorEntry('watch1')).toMatchObject({
      seats: [{ seat: 'SECOND', displayName: 'Alpha', enabled: true }],
    });
    expect((await service.getRoomView('watch1', 'u1')).spectatorPresence.total).toBe(1);
    expect((await service.getRoomView('watch1', 'u1')).spectatorPresence.viewers[0]).toMatchObject({
      viewerSeat: 'SECOND',
      authorizedViewerSeats: ['SECOND'],
      viewVersion: 4,
    });
    await expect(service.createRoomCodeSpectatorLink('watch1', 'FIRST')).rejects.toMatchObject({
      code: 'ONLINE_ROOM_SPECTATOR_CLOSED',
    });
    const afterSeatClosed = await matchService.getSpectatorSnapshot(
      roomCodeLink.token,
      joined.session.sessionId,
      { sinceSeq: joined.snapshot.seq, sinceViewVersion: joined.session.viewVersion }
    );
    expect(afterSeatClosed).toMatchObject({
      seat: 'SECOND',
      spectatorView: {
        currentViewerSeat: 'SECOND',
        authorizedViewerSeats: ['SECOND'],
        viewVersion: 4,
        authorizationNotice: {
          code: 'VIEW_AUTHORIZATION_CLOSED',
          closedViewerSeats: ['FIRST'],
          autoSwitched: true,
          message: '先攻视角的观战授权已关闭，已自动切换到仍开放的视角',
        },
      },
    });

    await service.setOwnRoomSpectatorEntry('watch1', 'u2', true);
    const afterPreferredViewReopened = await matchService.getSpectatorSnapshot(
      roomCodeLink.token,
      joined.session.sessionId,
      { sinceSeq: joined.snapshot.seq, sinceViewVersion: 4 }
    );
    expect(afterPreferredViewReopened).toMatchObject({
      seat: 'FIRST',
      spectatorView: {
        currentViewerSeat: 'FIRST',
        authorizedViewerSeats: ['FIRST', 'SECOND'],
        preferredViewerDisplayName: 'Beta',
        effectiveViewerDisplayName: 'Beta',
        viewVersion: 5,
        authorizationNotice: null,
      },
    });

    await service.setOwnRoomSpectatorEntry('watch1', 'u2', false);
    const afterPreferredViewClosedAgain = await matchService.getSpectatorSnapshot(
      roomCodeLink.token,
      joined.session.sessionId,
      { sinceSeq: joined.snapshot.seq, sinceViewVersion: 5 }
    );
    expect(afterPreferredViewClosedAgain).toMatchObject({
      seat: 'SECOND',
      spectatorView: {
        currentViewerSeat: 'SECOND',
        authorizedViewerSeats: ['SECOND'],
        preferredViewerDisplayName: 'Beta',
        effectiveViewerDisplayName: 'Alpha',
        viewVersion: 6,
      },
    });

    await service.setOwnRoomSpectatorEntry('watch1', 'u2', false);
    const afterRepeatedClose = await matchService.getSpectatorSnapshot(
      roomCodeLink.token,
      joined.session.sessionId,
      { sinceSeq: joined.snapshot.seq, sinceViewVersion: 6 }
    );
    expect(afterRepeatedClose).toEqual({
      matchId: started.matchId,
      seq: joined.snapshot.seq,
      currentPublicSeq: joined.snapshot.currentPublicSeq,
      modified: false,
      spectatorView: afterPreferredViewClosedAgain.spectatorView,
    });

    await service.setOwnRoomSpectatorEntry('watch1', 'u1', false);
    expect((await service.getRoomSpectatorEntry('watch1'))?.seats).toEqual([]);
    await expect(
      matchService.getSpectatorSnapshot(roomCodeLink.token, joined.session.sessionId)
    ).rejects.toMatchObject({
      code: 'ONLINE_SPECTATOR_AUTHORIZATION_CLOSED',
      message: '房间号观战授权已关闭，请返回首页重新输入房间号',
    });

    const reopened = await service.setOwnRoomSpectatorEntry('watch1', 'u2', true);
    expect(reopened.spectatorRoomEntry?.seats.find((seat) => seat.seat === 'FIRST')?.enabled).toBe(
      true
    );
    const reopenedLink = await service.createRoomCodeSpectatorLink('watch1', 'FIRST');
    expect(reopenedLink.viewerSeat).toBe('FIRST');
  });

  it('普通观战同一对局限制会话数并按会话限制请求频率', async () => {
    let now = 9_500_000;
    const matchService = createInMemoryMatchService({
      now: () => now,
      spectatorMaxPublicSessions: 2,
      spectatorRequestWindowMs: 10_000,
      spectatorRequestLimit: 3,
    });
    const service = new OnlineRoomService({
      now: () => now,
      matchService,
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (userId, deckId) => ({
        deckId,
        deckName: `${userId}-${deckId}`,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('limit1', 'u1');
    await service.joinRoom('limit1', 'u2');
    await service.lockDeck('limit1', 'u1', 'deck-a');
    await service.lockDeck('limit1', 'u2', 'deck-b');
    const started = await startRoomThroughOpening(service, 'limit1', 'u1', 'u2', 'u1');
    const link = await service.createRoomCodeSpectatorLink('limit1', 'FIRST');

    const first = await matchService.joinSpectatorLink(link.token, { clientId: 'limit-tab-a' });
    await matchService.joinSpectatorLink(link.token, { clientId: 'limit-tab-b' });
    await expect(
      matchService.joinSpectatorLink(link.token, { clientId: 'limit-tab-c' })
    ).rejects.toMatchObject({
      code: 'ONLINE_SPECTATOR_CAPACITY_REACHED',
      statusCode: 429,
    });

    const adminLink = await matchService.createAdminPlayerViewSpectatorLink(
      started.matchId!,
      'FIRST'
    );
    await expect(matchService.joinSpectatorLink(adminLink!.token)).resolves.toBeTruthy();
    expect((await service.getRoomView('limit1', 'u1')).spectatorPresence.total).toBe(2);

    const resumed = await matchService.joinSpectatorLink(link.token, {
      clientId: 'limit-tab-a',
    });
    expect(resumed.session.sessionId).toBe(first.session.sessionId);
    await matchService.getSpectatorSnapshot(link.token, first.session.sessionId);
    await matchService.getSpectatorPublicEvents(link.token, first.session.sessionId);
    await expect(
      matchService.getSpectatorSnapshot(link.token, first.session.sessionId)
    ).rejects.toMatchObject({
      code: 'ONLINE_SPECTATOR_RATE_LIMITED',
      statusCode: 429,
      retryAfterMs: 10_000,
      message: '观战同步暂时繁忙，请稍等',
    });

    now += 10_000;
    await expect(
      matchService.getSpectatorSnapshot(link.token, first.session.sessionId)
    ).resolves.toBeTruthy();
  });

  it('玩家视角观战默认游客编号按活跃观战者计算并复用同一客户端 session', async () => {
    let now = 9_000_000;
    const matchService = new OnlineMatchService({ now: () => now, recorder: null });
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

    await service.createRoom('spec2', 'u1');
    await service.joinRoom('spec2', 'u2');
    await service.lockDeck('spec2', 'u1', 'deck-a');
    await service.lockDeck('spec2', 'u2', 'deck-b');
    await startRoomThroughOpening(service, 'spec2', 'u1', 'u2', 'u1');
    const link = await service.createRoomCodeSpectatorLink('spec2', 'FIRST');

    const firstJoin = await matchService.joinSpectatorLink(link.token, { clientId: 'tab-a' });
    expect(firstJoin.session.displayName).toBe('游客 1');

    now += 1_000;
    const repeatedJoin = await matchService.joinSpectatorLink(link.token, { clientId: 'tab-a' });
    expect(repeatedJoin.session.sessionId).toBe(firstJoin.session.sessionId);
    expect(repeatedJoin.session.displayName).toBe('游客 1');

    const secondJoin = await matchService.joinSpectatorLink(link.token, { clientId: 'tab-b' });
    expect(secondJoin.session.displayName).toBe('游客 2');

    const roomWithTwoViewers = await service.getRoomView('spec2', 'u1');
    expect(roomWithTwoViewers.spectatorPresence.total).toBe(2);
    expect(
      roomWithTwoViewers.spectatorPresence.viewers.map((viewer) => viewer.displayName)
    ).toEqual(['游客 1', '游客 2']);

    now += 16_000;
    const afterStaleJoin = await matchService.joinSpectatorLink(link.token, { clientId: 'tab-c' });
    expect(afterStaleJoin.session.displayName).toBe('游客 1');
    await expect(
      matchService.getSpectatorSnapshot(link.token, firstJoin.session.sessionId)
    ).rejects.toMatchObject({ code: 'ONLINE_SPECTATOR_SESSION_EXPIRED' });
    const roomAfterStaleCleanup = await service.getRoomView('spec2', 'u1');
    expect(roomAfterStaleCleanup.spectatorPresence.total).toBe(1);
    expect(roomAfterStaleCleanup.spectatorPresence.viewers[0]?.displayName).toBe('游客 1');
  });

  it('双方准备开始后应进入开局猜拳，由胜者决定先后手后生成联机对局', async () => {
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

    await service.createRoom('rps1', 'u1');
    await service.joinRoom('rps1', 'u2');
    await service.lockDeck('rps1', 'u1', 'deck-a');
    await service.lockDeck('rps1', 'u2', 'deck-b');

    const hostReady = await service.markReadyToStart('rps1', 'u1');
    expect(hostReady.status).toBe('READY');
    expect(hostReady.members.find((member) => member.userId === 'u1')?.startReady).toBe(true);
    expect(hostReady.openingRps).toBeNull();

    const opening = await service.markReadyToStart('rps1', 'u2');
    expect(opening.status).toBe('OPENING');
    expect(opening.openingRps).toMatchObject({
      round: 1,
      revealed: false,
      winnerUserId: null,
    });

    const hostSubmitted = await service.submitOpeningRps('rps1', 'u1', 'ROCK');
    expect(hostSubmitted.openingRps?.choices).toEqual([
      { userId: 'u1', selected: true, gesture: 'ROCK' },
      { userId: 'u2', selected: false, gesture: null },
    ]);

    const guestViewAfterHostSubmit = await service.getRoomView('rps1', 'u2');
    expect(guestViewAfterHostSubmit.openingRps?.choices).toEqual([
      { userId: 'u1', selected: true, gesture: null },
      { userId: 'u2', selected: false, gesture: null },
    ]);

    const revealed = await service.submitOpeningRps('rps1', 'u2', 'SCISSORS');
    expect(revealed.openingRps).toMatchObject({
      revealed: true,
      winnerUserId: 'u1',
      chooserUserId: 'u1',
    });
    expect(revealed.matchId).toBeNull();

    await expect(service.chooseOpeningTurnOrder('rps1', 'u2', 'SELF_FIRST')).rejects.toMatchObject({
      code: 'ONLINE_OPENING_FORBIDDEN',
      statusCode: 403,
    });

    const started = await service.chooseOpeningTurnOrder('rps1', 'u1', 'SELF_SECOND');
    expect(started.status).toBe('IN_GAME');
    expect(started.matchId).toBeTruthy();
    expect(started.currentUserSeat).toBe('SECOND');
    expect(started.openingRps).toBeNull();

    const snapshot = await matchService.getMatchSnapshot(started.matchId!, 'u2');
    expect(snapshot?.seat).toBe('FIRST');
    expect(snapshot?.playerViewState.match.viewerSeat).toBe('FIRST');
  });

  it('开局猜拳平局时应允许重开下一轮', async () => {
    const service = new OnlineRoomService({
      matchService: createInMemoryMatchService(),
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('draw1', 'u1');
    await service.joinRoom('draw1', 'u2');
    await service.lockDeck('draw1', 'u1', 'deck-a');
    await service.lockDeck('draw1', 'u2', 'deck-b');
    await service.markReadyToStart('draw1', 'u1');
    await service.markReadyToStart('draw1', 'u2');
    await service.submitOpeningRps('draw1', 'u1', 'PAPER');
    const draw = await service.submitOpeningRps('draw1', 'u2', 'PAPER');

    expect(draw.openingRps).toMatchObject({
      round: 1,
      revealed: true,
      winnerUserId: null,
      chooserUserId: null,
    });

    const nextRound = await service.replayOpeningRps('draw1', 'u1');
    expect(nextRound.openingRps).toEqual({
      round: 2,
      choices: [
        { userId: 'u1', selected: false, gesture: null },
        { userId: 'u2', selected: false, gesture: null },
      ],
      revealed: false,
      winnerUserId: null,
      chooserUserId: null,
      revealedAt: null,
    });
  });

  it('重开请求应在对手同意后封存旧对局并回到可换卡组的准备阶段', async () => {
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
    const started = await startRoomThroughOpening(service, 'again1', 'u1', 'u2', 'u1');
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

    expect(restarted.status).toBe('PREPARING');
    expect(restarted.restartRequest).toBeNull();
    expect(restarted.matchId).toBeNull();
    expect(restarted.currentUserSeat).toBeUndefined();
    expect(restarted.openingRps).toBeNull();
    expect(restarted.members).toEqual([
      expect.objectContaining({
        userId: 'u1',
        lockedDeckId: 'deck-a',
        ready: true,
        startReady: false,
      }),
      expect.objectContaining({
        userId: 'u2',
        lockedDeckId: 'deck-b',
        ready: true,
        startReady: false,
      }),
    ]);
    expect(matchService.getMatch(previousMatchId)).toBeNull();
    expect(recorder.sealMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: previousMatchId,
        status: 'INTERRUPTED',
        completeness: 'PARTIAL',
        endReason: 'ROOM_RESTART_ACCEPTED',
      })
    );

    const relocked = await service.lockDeck('again1', 'u1', 'deck-c');
    expect(relocked.status).toBe('PREPARING');
    expect(relocked.members).toEqual([
      expect.objectContaining({
        userId: 'u1',
        lockedDeckId: 'deck-c',
        lockedDeckName: 'u1-deck-c',
        ready: true,
        startReady: false,
      }),
      expect.objectContaining({
        userId: 'u2',
        lockedDeckId: 'deck-b',
        ready: true,
        startReady: false,
      }),
    ]);

    await service.markReadyToStart('again1', 'u1');
    const opening = await service.markReadyToStart('again1', 'u2');
    expect(opening.status).toBe('OPENING');
    expect(opening.openingRps).toMatchObject({
      round: 1,
      revealed: false,
      winnerUserId: null,
    });
    await service.submitOpeningRps('again1', 'u1', 'ROCK');
    const rpsDone = await service.submitOpeningRps('again1', 'u2', 'SCISSORS');
    expect(rpsDone.openingRps?.winnerUserId).toBe('u1');
    const newMatch = await service.chooseOpeningTurnOrder('again1', 'u1', 'SELF_FIRST');
    expect(newMatch.status).toBe('IN_GAME');
    expect(newMatch.matchId).toBeTruthy();
    expect(newMatch.matchId).not.toBe(previousMatchId);
    expect(matchService.getMatch(newMatch.matchId!)).not.toBeNull();
  });

  it('房间号观战会话应跨重开等待并在新局按原玩家身份重新解析席位', async () => {
    let now = 4_500_000;
    const matchService = new OnlineMatchService({ now: () => now, recorder: null });
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

    await service.createRoom('again2', 'u1');
    await service.joinRoom('again2', 'u2');
    await service.lockDeck('again2', 'u1', 'deck-a');
    await service.lockDeck('again2', 'u2', 'deck-b');
    const firstMatch = await startRoomThroughOpening(service, 'again2', 'u1', 'u2', 'u1');
    const adminLink = await matchService.createAdminPlayerViewSpectatorLink(
      firstMatch.matchId!,
      'FIRST'
    );
    const adminJoined = await matchService.joinSpectatorLink(adminLink!.token, {
      clientId: 'single-match-admin-tab',
    });
    const link = await service.createRoomCodeSpectatorLink('again2', 'FIRST');
    const joined = await matchService.joinSpectatorLink(link.token, { clientId: 'continuity-tab' });
    expect(joined.session).toMatchObject({
      viewerSeat: 'FIRST',
      preferredViewerDisplayName: 'Alpha',
      effectiveViewerDisplayName: 'Alpha',
      attachmentGeneration: 1,
    });

    now += 1_000;
    const requested = await service.requestRestart('again2', 'u1');
    now += 1_000;
    const waitingRoom = await service.acceptRestartRequest(
      'again2',
      'u2',
      requested.restartRequest!.requestId
    );
    expect(waitingRoom.spectatorPresence.total).toBe(1);
    expect(waitingRoom.spectatorPresence.viewers[0]).toMatchObject({
      sessionId: joined.session.sessionId,
      viewerSeat: null,
      attachmentGeneration: 2,
    });
    await expect(
      matchService.getSpectatorSnapshot(adminLink!.token, adminJoined.session.sessionId)
    ).rejects.toMatchObject({ code: 'ONLINE_SPECTATOR_LINK_NOT_FOUND' });
    await expect(
      matchService.getSpectatorSnapshot(link.token, joined.session.sessionId)
    ).resolves.toMatchObject({
      status: 'WAITING_NEXT_MATCH',
      previousMatchId: firstMatch.matchId,
      attachmentGeneration: 2,
      preferredViewerDisplayName: 'Alpha',
    });

    now += 1_000;
    const restoredJoin = await matchService.joinSpectatorLink(link.token, {
      clientId: 'continuity-tab',
    });
    expect(restoredJoin.session.sessionId).toBe(joined.session.sessionId);
    expect(restoredJoin.snapshot).toMatchObject({ status: 'WAITING_NEXT_MATCH' });

    await service.markReadyToStart('again2', 'u1');
    await service.markReadyToStart('again2', 'u2');
    await service.submitOpeningRps('again2', 'u2', 'ROCK');
    await service.submitOpeningRps('again2', 'u1', 'SCISSORS');
    const secondMatch = await service.chooseOpeningTurnOrder('again2', 'u2', 'SELF_FIRST');
    expect(secondMatch.matchId).not.toBe(firstMatch.matchId);

    const rebound = await matchService.getSpectatorSnapshot(link.token, joined.session.sessionId);
    expect(rebound).toMatchObject({
      matchId: secondMatch.matchId,
      seat: 'SECOND',
      spectatorView: {
        currentViewerSeat: 'SECOND',
        attachmentGeneration: 3,
        preferredViewerDisplayName: 'Alpha',
        effectiveViewerDisplayName: 'Alpha',
      },
    });
    if ('status' in rebound) {
      throw new Error('new match should return a match snapshot');
    }
    const staleBindingSnapshot = await matchService.getSpectatorSnapshot(
      link.token,
      joined.session.sessionId,
      {
        sinceSeq: rebound.seq,
        sinceViewVersion: rebound.spectatorView.viewVersion,
        expectedRoomGeneration: link.roomGeneration!,
        expectedAttachmentGeneration: 2,
      }
    );
    expect(staleBindingSnapshot).toHaveProperty('playerViewState');
    await expect(
      matchService.getSpectatorPublicEvents(link.token, joined.session.sessionId, {
        afterSeq: 0,
        expectedRoomGeneration: link.roomGeneration!,
        expectedAttachmentGeneration: 2,
      })
    ).rejects.toMatchObject({ code: 'ONLINE_SPECTATOR_BINDING_CHANGED' });
  });

  it('重开等待期间参赛成员变化应终止旧房间观战资格', async () => {
    let now = 4_700_000;
    const matchService = new OnlineMatchService({ now: () => now, recorder: null });
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

    await service.createRoom('again4', 'u1');
    await service.joinRoom('again4', 'u2');
    await service.lockDeck('again4', 'u1', 'deck-a');
    await service.lockDeck('again4', 'u2', 'deck-b');
    await startRoomThroughOpening(service, 'again4', 'u1', 'u2', 'u1');
    const link = await service.createRoomCodeSpectatorLink('again4', 'FIRST');
    const joined = await matchService.joinSpectatorLink(link.token, {
      clientId: 'replaced-room-tab',
    });

    now += 1_000;
    const requested = await service.requestRestart('again4', 'u1');
    now += 1_000;
    await service.acceptRestartRequest('again4', 'u2', requested.restartRequest!.requestId);
    await service.leaveRoom('again4', 'u2');

    await expect(
      matchService.getSpectatorSnapshot(link.token, joined.session.sessionId)
    ).rejects.toMatchObject({
      code: 'ONLINE_SPECTATOR_ROOM_REPLACED',
      message: '原房间已失效，相同房间号的新房间不会继承本次观战资格',
    });
  });

  it('房间销毁后旧观战凭证应稳定终止且不能附着到同房间号的新代际', async () => {
    let now = 4_800_000;
    const matchService = new OnlineMatchService({ now: () => now, recorder: null });
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

    await service.createRoom('again3', 'u1');
    await service.joinRoom('again3', 'u2');
    await service.lockDeck('again3', 'u1', 'deck-a');
    await service.lockDeck('again3', 'u2', 'deck-b');
    await startRoomThroughOpening(service, 'again3', 'u1', 'u2', 'u1');
    const oldLink = await service.createRoomCodeSpectatorLink('again3', 'FIRST');
    const joined = await matchService.joinSpectatorLink(oldLink.token, { clientId: 'closed-tab' });

    await service.leaveRoom('again3', 'u1');
    await service.leaveRoom('again3', 'u2');
    now += 61_000;
    await service.cleanupExpiredRuntimeState();
    await expect(
      matchService.getSpectatorSnapshot(oldLink.token, joined.session.sessionId)
    ).rejects.toMatchObject({ code: 'ONLINE_SPECTATOR_ROOM_CLOSED' });

    await service.createRoom('again3', 'u1');
    await expect(
      matchService.getSpectatorSnapshot(oldLink.token, joined.session.sessionId)
    ).rejects.toMatchObject({ code: 'ONLINE_SPECTATOR_ROOM_CLOSED' });
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
    await service.markReadyToStart('recfail', 'u1');
    await service.markReadyToStart('recfail', 'u2');
    await service.submitOpeningRps('recfail', 'u1', 'ROCK');
    await service.submitOpeningRps('recfail', 'u2', 'SCISSORS');

    let startError: unknown;
    try {
      await service.chooseOpeningTurnOrder('recfail', 'u1', 'SELF_FIRST');
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
    expect(room?.status).toBe('OPENING');
    expect(room?.openingRps?.winnerUserId).toBe('u1');
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
    match.session.localFreePlay = true;

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
    match.session.localFreePlay = true;

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
    match.session.localFreePlay = true;

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
    const requestId =
      requestResult?.snapshot?.playerViewState.match.undo?.pendingRequest?.requestId;
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
      createPlayMemberToSlotCommand('ignored-client-player-id', memberCardId!, SlotPosition.CENTER)
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
    const requestId =
      requestResult?.snapshot?.playerViewState.match.undo?.pendingRequest?.requestId;
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
    match.session.localFreePlay = true;

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
    match.session.localFreePlay = true;

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
    const requestId =
      requestResult?.snapshot?.playerViewState.match.undo?.pendingRequest?.requestId;
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
    match.session.localFreePlay = true;

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
    const requestId =
      requestResult?.snapshot?.playerViewState.match.undo?.pendingRequest?.requestId;
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
    match.session.localFreePlay = true;

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
    match.session.localFreePlay = true;

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
    const appendCalls = vi
      .mocked(recorder.appendMatchRecordFrame)
      .mock.calls.map(([input]) => input);
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

  it('规则层拒绝命令时应在 rejected timeline 摘要中记录命令类型与原因', async () => {
    let now = 5_800_000;
    const recorder = createTestRecorder();
    const matchService = new OnlineMatchService({ now: () => now, recorder });
    const match = await matchService.createMatch({
      roomCode: 'APP04',
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
    const result = await matchService.executeCommand(
      match.matchId,
      'u1',
      createSetLiveCardCommand('ignored-client-player-id', 'not-in-hand', true)
    );

    expect(result?.success).toBe(false);
    const appendCall = vi
      .mocked(recorder.appendMatchRecordFrame)
      .mock.calls.map(([input]) => input)
      .at(-1);
    expect(appendCall).toMatchObject({
      matchId: match.matchId,
      frameType: 'COMMAND_REJECTED',
      summary: expect.stringContaining('命令被拒绝：SET_LIVE_CARD；原因：'),
      writeAuthorityCheckpoint: false,
    });
    expect(appendCall?.summary).toContain(result?.error);
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
    const started = await startRoomThroughOpening(service, 'seal1', 'u1', 'u2', 'u1');
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
    const started = await startRoomThroughOpening(service, 'sealx', 'u1', 'u2', 'u1');
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
    const started = await startRoomThroughOpening(service, 'rest1', 'u1', 'u2', 'u1');

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
    const started = await startRoomThroughOpening(service, 'gone1', 'u1', 'u2', 'u1');

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
    const started = await startRoomThroughOpening(service, 'live1', 'u1', 'u2', 'u1');

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
    const started = await startRoomThroughOpening(service, 'race1', 'u1', 'u2', 'u1');

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
    await service.markReadyToStart('ready1', 'u3');

    await service.createRoom('game1', 'u5');
    await service.joinRoom('game1', 'u6');
    await service.lockDeck('game1', 'u5', 'deck-e');
    await service.lockDeck('game1', 'u6', 'deck-f');
    const started = await startRoomThroughOpening(service, 'game1', 'u5', 'u6', 'u6');

    now += 1_000;

    await service.createRoom('game2', 'u7');
    await service.joinRoom('game2', 'u8');
    await service.lockDeck('game2', 'u7', 'deck-g');
    await service.lockDeck('game2', 'u8', 'deck-h');
    await startRoomThroughOpening(service, 'game2', 'u7', 'u8', 'u7');

    now += 11_000;
    service.touchInGameMemberByMatch(started.matchId!, 'u5');

    const summaries = await service.listAdminRoomSummaries();
    expect(summaries.map((room) => room.roomCode)).toEqual(['GAME1', 'GAME2', 'PREP1', 'READY1']);

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
