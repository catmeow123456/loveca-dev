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
  executeOnlineMatchCommand,
  fetchOnlineMatchSnapshot,
} from './onlineClient';

export type RemoteSessionSource = 'DEBUG' | 'ONLINE';
export type RemoteSnapshot = DebugMatchSnapshot | OnlineMatchSnapshot;
export type RemoteCommandExecutionResult = DebugCommandResult | OnlineCommandResult;

export async function fetchRemoteSnapshot(
  source: RemoteSessionSource,
  matchId: string,
  seat?: DebugMatchSnapshot['seat']
): Promise<RemoteSnapshot> {
  if (source === 'DEBUG') {
    if (!seat) {
      throw new Error('调试联机会话缺少 seat');
    }
    return fetchOnlineDebugSnapshot(matchId, seat);
  }

  return fetchOnlineMatchSnapshot(matchId);
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

  return advanceOnlineMatchPhase(matchId);
}
