import type {
  DebugCommandResult,
  DebugMatchSnapshot,
  OnlineCommandResult,
  OnlineMatchSnapshot,
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
  fetchOnlineMatchSnapshot,
  rejectOnlineUndoRequest,
} from './onlineClient';
import {
  advanceSolitaireMatchPhase,
  executeSolitaireMatchCommand,
  fetchSolitaireMatchSnapshot,
  undoSolitaireMatch,
} from './solitaireMatchClient';

export type RemoteSessionSource = 'DEBUG' | 'ONLINE' | 'SOLITAIRE';
export type RemoteSnapshot = DebugMatchSnapshot | OnlineMatchSnapshot;
export type RemoteCommandExecutionResult = DebugCommandResult | OnlineCommandResult;

export async function fetchRemoteSnapshot(
  source: RemoteSessionSource,
  matchId: string,
  seat?: DebugMatchSnapshot['seat'],
  sinceSeq?: number
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

  return fetchOnlineMatchSnapshot(matchId, sinceSeq);
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
  throw new Error('当前远程对局暂不支持撤销');
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
