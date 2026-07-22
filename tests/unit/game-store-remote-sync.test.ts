import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameMode } from '../../src/shared/types/enums';
import type {
  PlayerViewState,
  PublicEvent,
  PublicEventsResponse,
  RuntimeRecoveryInfo,
} from '../../src/online/types';
import type { RemoteSnapshot } from '@/lib/remoteMatchClient';

vi.mock('@/lib/imageService', () => ({
  preloadImage: vi.fn(() => Promise.resolve()),
  resolveCardImagePath: vi.fn(() => '/images/medium/mock.webp'),
}));

vi.mock('@/lib/remoteMatchClient', () => ({
  advanceRemotePhase: vi.fn(),
  acceptRemoteUndoRequest: vi.fn(),
  createRemoteUndoRequest: vi.fn(),
  executeRemoteCommand: vi.fn(),
  fetchRemotePublicEvents: vi.fn(),
  fetchRemoteSnapshotSyncResult: vi.fn(),
  rejectRemoteUndoRequest: vi.fn(),
  undoRemoteMatch: vi.fn(),
}));

import { useGameStore } from '../../client/src/store/gameStore';
import {
  advanceRemotePhase,
  fetchRemotePublicEvents,
  fetchRemoteSnapshotSyncResult,
} from '@/lib/remoteMatchClient';

const EMPTY_PUBLIC_BATTLE_LOG = {
  matchId: null,
  events: [],
  cursorSeq: 0,
  currentPublicSeq: 0,
  lastReadSeq: 0,
  unreadCount: 0,
  isPanelOpen: false,
  loadState: 'idle' as const,
  error: null,
};

function createViewState(matchId: string, seq: number): PlayerViewState {
  return {
    match: {
      matchId,
      viewerSeat: 'FIRST',
      participants: {
        FIRST: { id: 'player-1', name: 'Player 1' },
        SECOND: { id: 'player-2', name: 'Player 2' },
      },
      turnCount: 1,
      phase: 'MAIN_PHASE',
      subPhase: 'NONE',
      activeSeat: 'FIRST',
      prioritySeat: 'FIRST',
      window: null,
      seq,
    },
    table: { zones: {} },
    objects: {},
    permissions: { availableCommands: [] },
    activeEffect: null,
    pendingCostPayment: null,
    uiHints: { gameMode: GameMode.DEBUG },
  };
}

function createSnapshot(
  matchId: string,
  seq: number,
  currentPublicSeq: number,
  options: {
    readonly publicEvents?: readonly PublicEvent[];
    readonly truncated?: boolean;
    readonly droppedEventCount?: number;
    readonly recovery?: RuntimeRecoveryInfo;
  } = {}
): RemoteSnapshot {
  return {
    matchId,
    seat: 'FIRST',
    playerId: 'player-1',
    seq,
    currentPublicSeq,
    playerViewState: createViewState(matchId, seq),
    ...options,
  };
}

function createPublicEventsResponse(
  matchId: string,
  currentPublicSeq: number,
  publicEvents: readonly PublicEvent[] = [],
  options: { readonly truncated?: boolean; readonly droppedEventCount?: number } = {}
): PublicEventsResponse {
  return {
    matchId,
    currentPublicSeq,
    publicEvents,
    ...options,
  };
}

function createPublicEvent(matchId: string, seq: number): PublicEvent {
  return {
    type: 'PhaseStarted',
    eventId: `public-event-${seq}`,
    matchId,
    seq,
    timestamp: 1_000 + seq,
    source: 'SYSTEM',
    phase: 'MAIN_PHASE',
    activeSeat: 'FIRST',
  };
}

function createRecoveryInfo(
  currentPublicSeq: number,
  overrides: Partial<RuntimeRecoveryInfo> = {}
): RuntimeRecoveryInfo {
  return {
    restoredAt: 2_000,
    checkpointSeq: 3,
    checkpointTimelineSeq: 7,
    currentPublicSeq,
    rolledBackFromPublicSeq: null,
    rolledBackFromTimelineSeq: null,
    ...overrides,
  };
}

function setRemoteSession(matchId: string): void {
  useGameStore.setState({
    remoteSession: {
      source: 'ONLINE',
      matchId,
      seat: 'FIRST',
      playerId: 'player-1',
    },
    replaySession: null,
    viewingPlayerId: 'player-1',
    publicBattleLog: {
      ...EMPTY_PUBLIC_BATTLE_LOG,
      matchId,
    },
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('gameStore remote snapshot sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGameStore.setState({
      playerViewState: null,
      viewingPlayerId: null,
      remoteSession: null,
      replaySession: null,
      publicBattleLog: EMPTY_PUBLIC_BATTLE_LOG,
      ui: {
        ...useGameStore.getState().ui,
        hoveredCardId: null,
        cardDetail: null,
      },
    });
  });

  it('drops a remote snapshot response when the remote session changed while the request was in flight', async () => {
    setRemoteSession('match-old');

    const pendingSnapshot = deferred<{
      readonly matchId: string;
      readonly seq: number;
      readonly currentPublicSeq: number;
      readonly snapshot: RemoteSnapshot | null;
    }>();
    vi.mocked(fetchRemoteSnapshotSyncResult).mockReturnValueOnce(pendingSnapshot.promise);

    const syncPromise = useGameStore.getState().syncRemoteState();
    setRemoteSession('match-new');

    pendingSnapshot.resolve({
      matchId: 'match-old',
      seq: 3,
      currentPublicSeq: 9,
      snapshot: createSnapshot('match-old', 3, 9),
    });
    await syncPromise;

    expect(useGameStore.getState().remoteSession?.matchId).toBe('match-new');
    expect(useGameStore.getState().playerViewState).toBeNull();
    expect(fetchRemotePublicEvents).not.toHaveBeenCalled();
  });

  it('观战视角版本变化时应原子更新会话视角并应用对应投影', async () => {
    useGameStore.setState({
      remoteSession: {
        source: 'SPECTATOR',
        matchId: 'match-spec',
        seat: 'FIRST',
        playerId: 'player-1',
        spectatorToken: 'token-1',
        spectatorSessionId: 'session-1',
        spectatorAuthorizedViewerSeats: ['FIRST', 'SECOND'],
        spectatorViewVersion: 1,
        spectatorRoomCode: 'ROOM-1',
        spectatorRoomGeneration: 'room-gen-1',
        spectatorAttachmentGeneration: 7,
      },
      replaySession: null,
      viewingPlayerId: 'player-1',
      playerViewState: createViewState('match-spec', 4),
      ui: {
        ...useGameStore.getState().ui,
        selectedCardId: 'private-card',
        hoveredCardId: 'private-card',
        cardDetail: { kind: 'visible', cardId: 'private-card' },
        isDragging: true,
      },
    });
    const secondView = createViewState('match-spec', 4);
    const secondSnapshot: RemoteSnapshot = {
      matchId: 'match-spec',
      seat: 'SECOND',
      playerId: 'player-2',
      seq: 4,
      currentPublicSeq: 8,
      playerViewState: {
        ...secondView,
        match: { ...secondView.match, viewerSeat: 'SECOND' },
      },
    };
    vi.mocked(fetchRemoteSnapshotSyncResult).mockResolvedValueOnce({
      matchId: 'match-spec',
      seq: 4,
      currentPublicSeq: 8,
      snapshot: secondSnapshot,
      spectatorView: {
        currentViewerSeat: 'SECOND',
        authorizedViewerSeats: ['SECOND'],
        roomCode: 'ROOM-1',
        roomGeneration: 'room-gen-1',
        attachmentGeneration: 7,
        preferredViewerDisplayName: 'Alpha',
        effectiveViewerDisplayName: 'Beta',
        viewVersion: 2,
        authorizationNotice: {
          code: 'VIEW_AUTHORIZATION_CLOSED',
          closedViewerSeats: ['FIRST'],
          autoSwitched: true,
          message: '先攻视角的观战授权已关闭，已自动切换到仍开放的视角',
        },
      },
    });
    vi.mocked(fetchRemotePublicEvents).mockResolvedValueOnce(
      createPublicEventsResponse('match-spec', 8)
    );

    await useGameStore.getState().syncRemoteState();

    expect(fetchRemoteSnapshotSyncResult).toHaveBeenCalledWith(
      'SPECTATOR',
      'match-spec',
      'FIRST',
      4,
      'token-1',
      'session-1',
      1,
      'room-gen-1',
      7
    );
    expect(useGameStore.getState().remoteSession).toMatchObject({
      seat: 'SECOND',
      playerId: 'player-2',
      spectatorAuthorizedViewerSeats: ['SECOND'],
      spectatorViewVersion: 2,
      spectatorAuthorizationNotice: {
        code: 'VIEW_AUTHORIZATION_CLOSED',
        autoSwitched: true,
      },
    });
    expect(useGameStore.getState().viewingPlayerId).toBe('player-2');
    expect(useGameStore.getState().playerViewState?.match.viewerSeat).toBe('SECOND');
    expect(useGameStore.getState().ui).toMatchObject({
      selectedCardId: null,
      hoveredCardId: null,
      cardDetail: null,
      isDragging: false,
    });
  });

  it('观战未修改响应的视角元数据相同时保留原会话对象引用', async () => {
    const spectatorSession = {
      source: 'SPECTATOR' as const,
      matchId: 'match-spec-stable',
      seat: 'FIRST' as const,
      playerId: 'player-1',
      spectatorToken: 'token-stable',
      spectatorSessionId: 'session-stable',
      spectatorAuthorizedViewerSeats: ['FIRST', 'SECOND'] as const,
      spectatorViewVersion: 3,
      spectatorAuthorizationNotice: null,
      spectatorSyncGeneration: 0,
      spectatorRoomCode: 'ROOM-STABLE',
      spectatorRoomGeneration: 'room-gen-stable',
      spectatorAttachmentGeneration: 3,
    };
    useGameStore.setState({
      remoteSession: spectatorSession,
      viewingPlayerId: 'player-1',
      playerViewState: createViewState('match-spec-stable', 7),
      publicBattleLog: {
        ...EMPTY_PUBLIC_BATTLE_LOG,
        matchId: 'match-spec-stable',
        cursorSeq: 4,
        currentPublicSeq: 4,
      },
    });
    vi.mocked(fetchRemoteSnapshotSyncResult).mockResolvedValueOnce({
      matchId: 'match-spec-stable',
      seq: 7,
      currentPublicSeq: 4,
      snapshot: null,
      spectatorView: {
        currentViewerSeat: 'FIRST',
        authorizedViewerSeats: ['FIRST', 'SECOND'],
        roomCode: 'ROOM-STABLE',
        roomGeneration: 'room-gen-stable',
        attachmentGeneration: 3,
        preferredViewerDisplayName: 'Alpha',
        effectiveViewerDisplayName: 'Alpha',
        viewVersion: 3,
        authorizationNotice: null,
      },
    });

    await useGameStore.getState().syncRemoteState();

    expect(useGameStore.getState().remoteSession).toBe(spectatorSession);
    expect(fetchRemotePublicEvents).not.toHaveBeenCalled();
  });

  it('开始切换视角后丢弃旧视角在途快照', async () => {
    useGameStore.setState({
      remoteSession: {
        source: 'SPECTATOR',
        matchId: 'match-spec-switch',
        seat: 'FIRST',
        playerId: 'player-1',
        spectatorToken: 'token-switch',
        spectatorSessionId: 'session-switch',
        spectatorAuthorizedViewerSeats: ['FIRST', 'SECOND'],
        spectatorViewVersion: 1,
        spectatorSyncGeneration: 0,
        spectatorRoomCode: 'ROOM-LOG',
        spectatorRoomGeneration: 'room-gen-log',
        spectatorAttachmentGeneration: 1,
      },
      viewingPlayerId: 'player-1',
      playerViewState: createViewState('match-spec-switch', 2),
    });
    const pendingSnapshot = deferred<{
      readonly matchId: string;
      readonly seq: number;
      readonly currentPublicSeq: number;
      readonly snapshot: RemoteSnapshot | null;
    }>();
    vi.mocked(fetchRemoteSnapshotSyncResult).mockReturnValueOnce(pendingSnapshot.promise);

    const syncPromise = useGameStore.getState().syncRemoteState();
    useGameStore.getState().invalidateSpectatorSync();
    pendingSnapshot.resolve({
      matchId: 'match-spec-switch',
      seq: 3,
      currentPublicSeq: 0,
      snapshot: createSnapshot('match-spec-switch', 3, 0),
    });
    await syncPromise;

    expect(useGameStore.getState().playerViewState?.match.seq).toBe(2);
    expect(useGameStore.getState().remoteSession?.spectatorSyncGeneration).toBe(1);
  });

  it('does not fetch public events for a not-modified snapshot when the public cursor is already current', async () => {
    setRemoteSession('match-1');
    useGameStore.setState({
      playerViewState: createViewState('match-1', 4),
      publicBattleLog: {
        ...EMPTY_PUBLIC_BATTLE_LOG,
        matchId: 'match-1',
        cursorSeq: 12,
        currentPublicSeq: 12,
      },
    });
    vi.mocked(fetchRemoteSnapshotSyncResult).mockResolvedValueOnce({
      matchId: 'match-1',
      seq: 4,
      currentPublicSeq: 12,
      snapshot: null,
    });

    await useGameStore.getState().syncRemoteState();

    expect(fetchRemotePublicEvents).not.toHaveBeenCalled();
  });

  it('fetches public events after applying a snapshot only when the explicit public cursor is behind', async () => {
    setRemoteSession('match-1');
    useGameStore.setState({
      publicBattleLog: {
        ...EMPTY_PUBLIC_BATTLE_LOG,
        matchId: 'match-1',
        cursorSeq: 5,
        currentPublicSeq: 5,
      },
    });
    vi.mocked(fetchRemoteSnapshotSyncResult).mockResolvedValueOnce({
      matchId: 'match-1',
      seq: 6,
      currentPublicSeq: 8,
      snapshot: createSnapshot('match-1', 6, 8),
    });
    vi.mocked(fetchRemotePublicEvents).mockResolvedValueOnce(
      createPublicEventsResponse('match-1', 8)
    );

    await useGameStore.getState().syncRemoteState();
    await vi.waitFor(() => {
      expect(fetchRemotePublicEvents).toHaveBeenCalledWith('ONLINE', 'match-1', 'FIRST', 5);
    });
    expect(useGameStore.getState().publicBattleLog.currentPublicSeq).toBe(8);
  });

  it('观战快照同步等待所需的公开日志增量完成后才结束本轮调度', async () => {
    useGameStore.setState({
      remoteSession: {
        source: 'SPECTATOR',
        matchId: 'match-spec-log',
        seat: 'FIRST',
        playerId: 'player-1',
        spectatorToken: 'token-log',
        spectatorSessionId: 'session-log',
        spectatorAuthorizedViewerSeats: ['FIRST'],
        spectatorViewVersion: 1,
        spectatorSyncGeneration: 0,
      },
      playerViewState: createViewState('match-spec-log', 4),
      publicBattleLog: {
        ...EMPTY_PUBLIC_BATTLE_LOG,
        matchId: 'match-spec-log',
        cursorSeq: 5,
        currentPublicSeq: 5,
      },
    });
    vi.mocked(fetchRemoteSnapshotSyncResult).mockResolvedValueOnce({
      matchId: 'match-spec-log',
      seq: 5,
      currentPublicSeq: 8,
      snapshot: createSnapshot('match-spec-log', 5, 8),
      spectatorView: {
        currentViewerSeat: 'FIRST',
        authorizedViewerSeats: ['FIRST'],
        roomCode: 'ROOM-LOG',
        roomGeneration: 'room-gen-log',
        attachmentGeneration: 1,
        preferredViewerDisplayName: 'Alpha',
        effectiveViewerDisplayName: 'Alpha',
        viewVersion: 1,
        authorizationNotice: null,
      },
    });
    const pendingEvents = deferred<PublicEventsResponse | null>();
    vi.mocked(fetchRemotePublicEvents).mockReturnValueOnce(pendingEvents.promise);
    let settled = false;

    const syncPromise = useGameStore
      .getState()
      .syncRemoteState()
      .then(() => {
        settled = true;
      });
    await vi.waitFor(() => expect(fetchRemotePublicEvents).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);

    pendingEvents.resolve(createPublicEventsResponse('match-spec-log', 8));
    await syncPromise;
    expect(settled).toBe(true);
  });

  it('resets retained public events when the server truncates an old cursor', async () => {
    const staleEvent = createPublicEvent('match-1', 1);
    const latestEvent = createPublicEvent('match-1', 20);
    setRemoteSession('match-1');
    useGameStore.setState({
      playerViewState: createViewState('match-1', 4),
      publicBattleLog: {
        ...EMPTY_PUBLIC_BATTLE_LOG,
        matchId: 'match-1',
        events: [staleEvent],
        cursorSeq: 1,
        currentPublicSeq: 1,
      },
    });
    vi.mocked(fetchRemoteSnapshotSyncResult).mockResolvedValueOnce({
      matchId: 'match-1',
      seq: 4,
      currentPublicSeq: 20,
      snapshot: null,
    });
    vi.mocked(fetchRemotePublicEvents).mockResolvedValueOnce(
      createPublicEventsResponse('match-1', 20, [latestEvent], {
        truncated: true,
        droppedEventCount: 18,
      })
    );

    await useGameStore.getState().syncRemoteState();
    await vi.waitFor(() => {
      expect(fetchRemotePublicEvents).toHaveBeenCalledWith('ONLINE', 'match-1', 'FIRST', 1);
    });

    const log = useGameStore.getState().publicBattleLog;
    expect(log.events.map((event) => event.seq)).toEqual([20]);
    expect(log.cursorSeq).toBe(20);
    expect(log.currentPublicSeq).toBe(20);
  });

  it('resets local public log from a recovery snapshot before merging restored events', async () => {
    const staleEvent = createPublicEvent('match-1', 30);
    const restoredEvent = createPublicEvent('match-1', 12);
    setRemoteSession('match-1');
    useGameStore.setState({
      playerViewState: createViewState('match-1', 4),
      publicBattleLog: {
        ...EMPTY_PUBLIC_BATTLE_LOG,
        matchId: 'match-1',
        events: [staleEvent],
        cursorSeq: 30,
        currentPublicSeq: 30,
      },
    });
    vi.mocked(fetchRemoteSnapshotSyncResult).mockResolvedValueOnce({
      matchId: 'match-1',
      seq: 40,
      currentPublicSeq: 12,
      snapshot: createSnapshot('match-1', 40, 12, {
        publicEvents: [restoredEvent],
        truncated: true,
        droppedEventCount: 11,
        recovery: createRecoveryInfo(12, {
          rolledBackFromPublicSeq: 30,
          rolledBackFromTimelineSeq: 18,
        }),
      }),
    });

    await useGameStore.getState().syncRemoteState();

    const log = useGameStore.getState().publicBattleLog;
    expect(log.events.map((event) => event.seq)).toEqual([12]);
    expect(log.currentPublicSeq).toBe(12);
    expect(log.cursorSeq).toBe(12);
  });

  it('accepts a recovery snapshot even when its seq is not newer than the local view', async () => {
    const restoredEvent = createPublicEvent('match-1', 12);
    setRemoteSession('match-1');
    useGameStore.setState({
      viewingPlayerId: 'match-1:FIRST:user-1',
      playerViewState: createViewState('match-1', 40),
      publicBattleLog: {
        ...EMPTY_PUBLIC_BATTLE_LOG,
        matchId: 'match-1',
        events: [createPublicEvent('match-1', 30)],
        cursorSeq: 30,
        currentPublicSeq: 30,
      },
    });
    vi.mocked(fetchRemoteSnapshotSyncResult).mockResolvedValueOnce({
      matchId: 'match-1',
      seq: 40,
      currentPublicSeq: 12,
      snapshot: createSnapshot('match-1', 40, 12, {
        publicEvents: [restoredEvent],
        truncated: true,
        droppedEventCount: 11,
        recovery: createRecoveryInfo(12),
      }),
    });

    await useGameStore.getState().syncRemoteState();

    const log = useGameStore.getState().publicBattleLog;
    expect(log.events.map((event) => event.seq)).toEqual([12]);
    expect(log.currentPublicSeq).toBe(12);
    expect(useGameStore.getState().playerViewState?.match.seq).toBe(40);
  });

  it('applies recovery snapshots from failed remote phase advances before surfacing the error', async () => {
    const restoredEvent = createPublicEvent('match-1', 9);
    setRemoteSession('match-1');
    useGameStore.setState({
      playerViewState: createViewState('match-1', 4),
      publicBattleLog: {
        ...EMPTY_PUBLIC_BATTLE_LOG,
        matchId: 'match-1',
        events: [createPublicEvent('match-1', 20)],
        cursorSeq: 20,
        currentPublicSeq: 20,
      },
    });
    vi.mocked(advanceRemotePhase).mockResolvedValueOnce({
      success: false,
      error: '对局已恢复到最近保存点，请刷新后重试',
      snapshot: createSnapshot('match-1', 50, 9, {
        publicEvents: [restoredEvent],
        truncated: true,
        droppedEventCount: 8,
        recovery: createRecoveryInfo(9, {
          rolledBackFromPublicSeq: 20,
          rolledBackFromTimelineSeq: 14,
        }),
      }),
    } as never);

    useGameStore.getState().advancePhase();

    await vi.waitFor(() => {
      expect(useGameStore.getState().playerViewState?.match.seq).toBe(50);
    });

    const log = useGameStore.getState().publicBattleLog;
    expect(log.events.map((event) => event.seq)).toEqual([9]);
    expect(log.currentPublicSeq).toBe(9);
  });

  it('keeps a public event card detail pinned while visible cards are hovered', () => {
    const pinnedDetail = {
      kind: 'public-event-card' as const,
      cardCode: 'PL!HS-bp5-001-SEC',
      publicObjectId: 'obj-public-event-card',
    };

    useGameStore.getState().setCardDetail(pinnedDetail);
    useGameStore.getState().setHoveredCard('visible-card-1');

    expect(useGameStore.getState().ui.hoveredCardId).toBe('visible-card-1');
    expect(useGameStore.getState().ui.cardDetail).toEqual(pinnedDetail);

    useGameStore.getState().setHoveredCard(null);

    expect(useGameStore.getState().ui.hoveredCardId).toBeNull();
    expect(useGameStore.getState().ui.cardDetail).toEqual(pinnedDetail);
  });

  it('clears a public event card detail when the public battle log closes', () => {
    useGameStore.setState({
      publicBattleLog: {
        ...EMPTY_PUBLIC_BATTLE_LOG,
        matchId: 'match-1',
        isPanelOpen: true,
      },
    });
    useGameStore.getState().setCardDetail({
      kind: 'public-event-card',
      cardCode: 'PL!HS-bp5-001-SEC',
      publicObjectId: 'obj-public-event-card',
    });

    useGameStore.getState().setPublicBattleLogPanelOpen(false);

    expect(useGameStore.getState().ui.cardDetail).toBeNull();
  });

  it('clears a public event card detail when a different remote match snapshot is applied', async () => {
    setRemoteSession('match-new');
    useGameStore.setState({
      playerViewState: createViewState('match-old', 4),
      ui: {
        ...useGameStore.getState().ui,
        cardDetail: {
          kind: 'public-event-card',
          cardCode: 'PL!HS-bp5-001-SEC',
          publicObjectId: 'obj-public-event-card',
        },
      },
    });
    vi.mocked(fetchRemoteSnapshotSyncResult).mockResolvedValueOnce({
      matchId: 'match-new',
      seq: 1,
      currentPublicSeq: 1,
      snapshot: createSnapshot('match-new', 1, 1),
    });

    await useGameStore.getState().syncRemoteState();

    expect(useGameStore.getState().playerViewState?.match.matchId).toBe('match-new');
    expect(useGameStore.getState().ui.cardDetail).toBeNull();
  });
});
