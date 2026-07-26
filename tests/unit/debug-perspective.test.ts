import { describe, expect, it, vi } from 'vitest';
import type { PlayerViewState } from '../../src/online/types';
import { getDebugPerspectiveFollowTarget } from '../../client/src/lib/debugPerspective';

function createView(
  viewerPlayerId: string,
  enabledCommands: readonly boolean[],
  confirmedSeats: readonly ('FIRST' | 'SECOND')[] = []
): PlayerViewState {
  const viewerSeat = viewerPlayerId === 'player-1' ? 'FIRST' : 'SECOND';
  return {
    match: {
      viewerSeat,
      participants: {
        FIRST: { id: 'player-1', name: '玩家 1' },
        SECOND: { id: 'player-2', name: '玩家 2' },
      },
      window: confirmedSeats.length > 0 ? { windowType: 'SIMULTANEOUS_COMMIT' } : null,
      liveResult:
        confirmedSeats.length > 0
          ? {
              confirmedSeats,
            }
          : undefined,
    },
    permissions: {
      availableCommands: enabledCommands.map((enabled, index) => ({
        command: `COMMAND_${index}`,
        enabled,
      })),
    },
  } as PlayerViewState;
}

describe('debug perspective follow target', () => {
  it('当前视角失去操作权且对方取得操作权时跟随对方', () => {
    const currentView = createView('player-1', [false]);
    const opponentView = createView('player-2', [true]);

    expect(getDebugPerspectiveFollowTarget('player-1', currentView, () => opponentView)).toEqual({
      playerId: 'player-2',
      viewState: opponentView,
    });
  });

  it('当前视角仍有合法操作时不切换也不读取对方投影', () => {
    const getPlayerViewState = vi.fn(() => createView('player-2', [true]));

    expect(
      getDebugPerspectiveFollowTarget(
        'player-1',
        createView('player-1', [false, true]),
        getPlayerViewState
      )
    ).toBeNull();
    expect(getPlayerViewState).not.toHaveBeenCalled();
  });

  it('LIVE 分数已确认且对方未确认时，即使仍有桌面命令也跟随对方', () => {
    const currentView = createView('player-1', [true], ['FIRST']);
    const opponentView = createView('player-2', [true], ['FIRST']);

    expect(getDebugPerspectiveFollowTarget('player-1', currentView, () => opponentView)).toEqual({
      playerId: 'player-2',
      viewState: opponentView,
    });
  });

  it('双方都没有合法操作时保持当前视角', () => {
    expect(
      getDebugPerspectiveFollowTarget('player-1', createView('player-1', []), () =>
        createView('player-2', [false])
      )
    ).toBeNull();
  });
});
