import type { PlayerViewState } from '@game/online';

function hasEnabledCommand(viewState: PlayerViewState | null): boolean {
  return (
    viewState?.permissions.availableCommands.some((commandHint) => commandHint.enabled) === true
  );
}

function hasCompletedScoreCommit(viewState: PlayerViewState): boolean {
  const { liveResult, viewerSeat, window } = viewState.match;
  if (window?.windowType !== 'SIMULTANEOUS_COMMIT' || !liveResult) {
    return false;
  }

  const opponentSeat = viewerSeat === 'FIRST' ? 'SECOND' : 'FIRST';
  return (
    liveResult.confirmedSeats.includes(viewerSeat) &&
    !liveResult.confirmedSeats.includes(opponentSeat)
  );
}

/**
 * 本地调试桌面由同一名测试者操作双方。
 * 当前视角失去全部合法操作，或已完成自己的分数提交而对方仍待确认时，
 * 返回应跟随的玩家。
 */
export function getDebugPerspectiveFollowTarget(
  currentPlayerId: string,
  currentViewState: PlayerViewState | null,
  getPlayerViewState: (playerId: string) => PlayerViewState | null
): { readonly playerId: string; readonly viewState: PlayerViewState } | null {
  if (
    !currentViewState ||
    (hasEnabledCommand(currentViewState) && !hasCompletedScoreCommit(currentViewState))
  ) {
    return null;
  }

  const opponent = Object.values(currentViewState.match.participants).find(
    (participant) => participant.id !== currentPlayerId
  );
  if (!opponent) {
    return null;
  }

  const opponentViewState = getPlayerViewState(opponent.id);
  if (!opponentViewState || !hasEnabledCommand(opponentViewState)) {
    return null;
  }

  return {
    playerId: opponent.id,
    viewState: opponentViewState,
  };
}
