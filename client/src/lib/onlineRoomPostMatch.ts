import type { MatchOriginKind } from '@game/online';

export type OnlineRoomPostMatchRestartRole = 'NONE' | 'REQUESTER' | 'RESPONDER';

export interface OnlineRoomPostMatchActionState {
  readonly kind: 'REPLAYABLE_ROOM' | 'RANKED_ROOM' | 'THEME_ROOM';
  readonly preserveRoomOnLobbyReturn: boolean;
  readonly showExplicitLeaveRoom: boolean;
  readonly restartAction: 'REQUEST' | 'WAITING' | 'RESPOND' | null;
  readonly restartDisabledReason: string | null;
}

export function getOnlineRoomPostMatchActionState(input: {
  readonly originKind: MatchOriginKind;
  readonly themeTableVersionId?: string | null;
  readonly restartRole: OnlineRoomPostMatchRestartRole;
  readonly opponentActive: boolean;
}): OnlineRoomPostMatchActionState {
  if (input.themeTableVersionId) {
    return {
      kind: 'THEME_ROOM',
      preserveRoomOnLobbyReturn: false,
      showExplicitLeaveRoom: false,
      restartAction: null,
      restartDisabledReason: null,
    };
  }

  if (input.originKind === 'RANKED') {
    return {
      kind: 'RANKED_ROOM',
      preserveRoomOnLobbyReturn: false,
      showExplicitLeaveRoom: false,
      restartAction: null,
      restartDisabledReason: null,
    };
  }

  if (input.restartRole === 'REQUESTER') {
    return {
      kind: 'REPLAYABLE_ROOM',
      preserveRoomOnLobbyReturn: true,
      showExplicitLeaveRoom: true,
      restartAction: 'WAITING',
      restartDisabledReason: null,
    };
  }

  if (input.restartRole === 'RESPONDER') {
    return {
      kind: 'REPLAYABLE_ROOM',
      preserveRoomOnLobbyReturn: true,
      showExplicitLeaveRoom: true,
      restartAction: 'RESPOND',
      restartDisabledReason: null,
    };
  }

  return {
    kind: 'REPLAYABLE_ROOM',
    preserveRoomOnLobbyReturn: true,
    showExplicitLeaveRoom: true,
    restartAction: 'REQUEST',
    restartDisabledReason: input.opponentActive ? null : '对手回到房间后可以再来一局。',
  };
}
