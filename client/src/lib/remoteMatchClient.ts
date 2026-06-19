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
import {
  advanceSolitaireMatchPhase,
  executeSolitaireMatchCommand,
  fetchSolitaireMatchSnapshot,
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
