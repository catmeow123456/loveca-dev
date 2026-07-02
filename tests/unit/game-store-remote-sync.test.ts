import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameMode } from '../../src/shared/types/enums';
import type { PlayerViewState, PublicEventsResponse } from '../../src/online/types';
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
  currentPublicSeq: number
): RemoteSnapshot {
  return {
    matchId,
    seat: 'FIRST',
    playerId: 'player-1',
    seq,
    currentPublicSeq,
    playerViewState: createViewState(matchId, seq),
  };
}

function createPublicEventsResponse(
  matchId: string,
  currentPublicSeq: number
): PublicEventsResponse {
  return {
    matchId,
    currentPublicSeq,
    publicEvents: [],
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
    vi.mocked(fetchRemotePublicEvents).mockResolvedValueOnce(createPublicEventsResponse('match-1', 8));

    await useGameStore.getState().syncRemoteState();
    await vi.waitFor(() => {
      expect(fetchRemotePublicEvents).toHaveBeenCalledWith('ONLINE', 'match-1', 'FIRST', 5);
    });
    expect(useGameStore.getState().publicBattleLog.currentPublicSeq).toBe(8);
  });
});
