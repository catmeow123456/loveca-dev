import type {
  DebugCommandResult,
  DebugMatchSnapshot,
  OnlineCommandResult,
  OnlineMatchSnapshot,
  OnlineMatchSnapshotResponse,
  OnlineSpectatorViewState,
  OnlineSpectatorSnapshotResponse,
  PublicEventsResponse,
} from '@game/online';
import type { GameCommand } from '@game/application/game-commands';
import {
  advanceOnlineDebugPhase,
  executeOnlineDebugCommand,
  fetchOnlineDebugSnapshot,
} from './onlineDebugClient';
import {
  advanceOnlineMatchPhase,
  acceptOnlineUndoRequest,
  createOnlineUndoRequest,
  executeOnlineMatchCommand,
  fetchOnlineMatchPublicEvents,
  fetchOnlineMatchSnapshot,
  fetchOnlineMatchSnapshotResponse,
  fetchOnlineSpectatorPublicEvents,
  fetchOnlineSpectatorSnapshotResponse,
  rejectOnlineUndoRequest,
  undoOnlineMatch,
} from './onlineClient';
import {
  advanceSolitaireMatchPhase,
  executeSolitaireMatchCommand,
  fetchSolitaireMatchPublicEvents,
  fetchSolitaireMatchSnapshot,
  fetchSolitaireMatchSnapshotResponse,
  undoSolitaireMatch,
} from './solitaireMatchClient';

export type RemoteSessionSource = 'DEBUG' | 'ONLINE' | 'SOLITAIRE' | 'SPECTATOR';
export type RemoteSnapshot = DebugMatchSnapshot | OnlineMatchSnapshot;
export type RemoteCommandExecutionResult = DebugCommandResult | OnlineCommandResult;

export interface RemoteSnapshotSyncResult {
  readonly matchId: string;
  readonly seq: number;
  readonly currentPublicSeq: number;
  readonly snapshot: RemoteSnapshot | null;
  readonly spectatorView?: OnlineSpectatorViewState;
}

export async function fetchRemoteSnapshot(
  source: RemoteSessionSource,
  matchId: string,
  seat?: DebugMatchSnapshot['seat'],
  sinceSeq?: number,
  spectatorToken?: string,
  spectatorSessionId?: string,
  spectatorViewVersion?: number,
  spectatorRoomGeneration?: string | null,
  spectatorAttachmentGeneration?: number
): Promise<RemoteSnapshot | null> {
  if (source === 'DEBUG') {
    if (!seat) {
      throw new Error('调试联机会话缺少 seat');
    }
    return fetchOnlineDebugSnapshot(matchId, seat);
  }
  if (source === 'SOLITAIRE') {
    return fetchSolitaireMatchSnapshot(matchId, sinceSeq);
  }
  if (source === 'SPECTATOR') {
    if (!spectatorToken) {
      throw new Error('观战会话缺少 token');
    }
    const response = await fetchOnlineSpectatorSnapshotResponse(
      spectatorToken,
      spectatorSessionId,
      sinceSeq,
      spectatorViewVersion,
      spectatorRoomGeneration,
      spectatorAttachmentGeneration
    );
    if (isSpectatorWaitingResponse(response)) {
      return null;
    }
    return isSnapshotNotModified(response) ? null : response;
  }

  return fetchOnlineMatchSnapshot(matchId, sinceSeq);
}

export async function fetchRemoteSnapshotSyncResult(
  source: RemoteSessionSource,
  matchId: string,
  seat?: DebugMatchSnapshot['seat'],
  sinceSeq?: number,
  spectatorToken?: string,
  spectatorSessionId?: string,
  spectatorViewVersion?: number,
  spectatorRoomGeneration?: string | null,
  spectatorAttachmentGeneration?: number
): Promise<RemoteSnapshotSyncResult> {
  if (source === 'DEBUG') {
    if (!seat) {
      throw new Error('调试联机会话缺少 seat');
    }
    const snapshot = await fetchOnlineDebugSnapshot(matchId, seat);
    return {
      matchId: snapshot.matchId,
      seq: snapshot.seq,
      currentPublicSeq: snapshot.currentPublicSeq,
      snapshot,
    };
  }

  const response =
    source === 'SOLITAIRE'
      ? await fetchSolitaireMatchSnapshotResponse(matchId, sinceSeq)
      : source === 'SPECTATOR'
        ? await fetchOnlineSpectatorSnapshotResponse(
            requireSpectatorToken(spectatorToken),
            spectatorSessionId,
            sinceSeq,
            spectatorViewVersion,
            spectatorRoomGeneration,
            spectatorAttachmentGeneration
          )
        : await fetchOnlineMatchSnapshotResponse(matchId, sinceSeq);
  if (isSpectatorWaitingResponse(response)) {
    return {
      matchId: response.previousMatchId,
      seq: sinceSeq ?? 0,
      currentPublicSeq: 0,
      snapshot: null,
    };
  }
  const snapshot = isSnapshotNotModified(response) ? null : response;
  return {
    matchId: response.matchId,
    seq: response.seq,
    currentPublicSeq: response.currentPublicSeq,
    snapshot,
    spectatorView:
      source === 'SPECTATOR' && 'spectatorView' in response
        ? (response as { readonly spectatorView: OnlineSpectatorViewState }).spectatorView
        : undefined,
  };
}

function isSnapshotNotModified(
  snapshot: OnlineMatchSnapshotResponse | OnlineSpectatorSnapshotResponse
): snapshot is Extract<
  OnlineMatchSnapshotResponse | OnlineSpectatorSnapshotResponse,
  { readonly modified: false }
> {
  return 'modified' in snapshot && snapshot.modified === false;
}

function isSpectatorWaitingResponse(
  response: OnlineMatchSnapshotResponse | OnlineSpectatorSnapshotResponse
): response is Extract<OnlineSpectatorSnapshotResponse, { readonly status: 'WAITING_NEXT_MATCH' }> {
  return 'status' in response && response.status === 'WAITING_NEXT_MATCH';
}

export async function fetchRemotePublicEvents(
  source: RemoteSessionSource,
  matchId: string,
  seat?: DebugMatchSnapshot['seat'],
  afterSeq?: number,
  spectatorToken?: string,
  spectatorSessionId?: string,
  spectatorRoomGeneration?: string | null,
  spectatorAttachmentGeneration?: number
): Promise<PublicEventsResponse | null> {
  if (source === 'DEBUG') {
    if (!seat) {
      throw new Error('调试联机会话缺少 seat');
    }
    const snapshot = await fetchOnlineDebugSnapshot(matchId, seat);
    return {
      matchId: snapshot.matchId,
      currentPublicSeq: snapshot.currentPublicSeq,
      publicEvents: snapshot.publicEvents.filter((event) => event.seq > (afterSeq ?? 0)),
    };
  }
  if (source === 'SOLITAIRE') {
    return fetchSolitaireMatchPublicEvents(matchId, afterSeq);
  }
  if (source === 'SPECTATOR') {
    return fetchOnlineSpectatorPublicEvents(
      requireSpectatorToken(spectatorToken),
      spectatorSessionId,
      afterSeq,
      spectatorRoomGeneration,
      spectatorAttachmentGeneration
    );
  }

  return fetchOnlineMatchPublicEvents(matchId, afterSeq);
}

export async function executeRemoteCommand(
  source: RemoteSessionSource,
  matchId: string,
  command: GameCommand,
  seat?: DebugMatchSnapshot['seat']
): Promise<RemoteCommandExecutionResult> {
  if (source === 'DEBUG') {
    if (!seat) {
      throw new Error('调试联机会话缺少 seat');
    }
    return executeOnlineDebugCommand(matchId, seat, command);
  }
  if (source === 'SOLITAIRE') {
    return executeSolitaireMatchCommand(matchId, command);
  }
  if (source === 'SPECTATOR') {
    throw new Error('观战模式为只读，不能提交操作');
  }

  return executeOnlineMatchCommand(matchId, command);
}

export async function advanceRemotePhase(
  source: RemoteSessionSource,
  matchId: string,
  seat?: DebugMatchSnapshot['seat']
): Promise<RemoteCommandExecutionResult> {
  if (source === 'DEBUG') {
    if (!seat) {
      throw new Error('调试联机会话缺少 seat');
    }
    return advanceOnlineDebugPhase(matchId, seat);
  }
  if (source === 'SOLITAIRE') {
    return advanceSolitaireMatchPhase(matchId);
  }
  if (source === 'SPECTATOR') {
    throw new Error('观战模式为只读，不能推进阶段');
  }

  return advanceOnlineMatchPhase(matchId);
}

export async function undoRemoteMatch(
  source: RemoteSessionSource,
  matchId: string,
  input: {
    readonly expectedRevision: number;
    readonly undoEntryId: string;
    readonly idempotencyKey?: string;
  }
): Promise<RemoteCommandExecutionResult> {
  if (source === 'SOLITAIRE') {
    return undoSolitaireMatch(matchId, input);
  }
  if (source === 'ONLINE') {
    return undoOnlineMatch(matchId, input);
  }
  throw new Error('当前远程对局暂不支持撤销');
}

function requireSpectatorToken(token: string | undefined): string {
  if (!token) {
    throw new Error('观战会话缺少 token');
  }
  return token;
}

export async function createRemoteUndoRequest(
  source: RemoteSessionSource,
  matchId: string,
  input: {
    readonly expectedRevision: number;
    readonly undoEntryId: string;
    readonly idempotencyKey?: string;
  }
): Promise<RemoteCommandExecutionResult> {
  if (source === 'ONLINE') {
    return createOnlineUndoRequest(matchId, input);
  }
  throw new Error('当前远程对局不使用请求式撤销');
}

export async function acceptRemoteUndoRequest(
  source: RemoteSessionSource,
  matchId: string,
  requestId: string,
  input: {
    readonly expectedRevision: number;
    readonly idempotencyKey?: string;
    readonly grantContinuous?: boolean;
  }
): Promise<RemoteCommandExecutionResult> {
  if (source === 'ONLINE') {
    return acceptOnlineUndoRequest(matchId, requestId, input);
  }
  throw new Error('当前远程对局不支持接受撤销请求');
}

export async function rejectRemoteUndoRequest(
  source: RemoteSessionSource,
  matchId: string,
  requestId: string,
  input: {
    readonly expectedRevision: number;
    readonly idempotencyKey?: string;
  }
): Promise<RemoteCommandExecutionResult> {
  if (source === 'ONLINE') {
    return rejectOnlineUndoRequest(matchId, requestId, input);
  }
  throw new Error('当前远程对局不支持拒绝撤销请求');
}
