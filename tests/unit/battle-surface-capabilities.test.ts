import { describe, expect, it } from 'vitest';
import {
  deriveBattleSurfaceCapabilities,
  type BattleSurfaceCapabilities,
} from '../../client/src/store/battleSurfaceCapabilities';
import { GameMode } from '../../src/shared/types/enums';

describe('battle surface capabilities', () => {
  it('派生本地调试桌面能力', () => {
    expectCapabilities(deriveBattleSurfaceCapabilities({ gameMode: GameMode.DEBUG }), {
      authority: 'LOCAL',
      surface: 'LOCAL_DEBUG',
      canSwitchPerspective: true,
      canSwitchLocalMode: true,
      canShowDebugLog: true,
      canUndo: true,
      undoPolicy: 'LOCAL_IMMEDIATE',
      showFreePlayControl: true,
      freePlayPolicy: 'SESSION_GLOBAL',
      isSolitairePresentation: false,
      scoreConfirmPresentation: 'DEBUG_PASSTHROUGH',
      isReadOnly: false,
    });
  });

  it('派生本地对墙打桌面能力', () => {
    expectCapabilities(deriveBattleSurfaceCapabilities({ gameMode: GameMode.SOLITAIRE }), {
      authority: 'LOCAL',
      surface: 'SOLITAIRE',
      canSwitchPerspective: false,
      canSwitchLocalMode: true,
      canShowDebugLog: false,
      canUndo: true,
      undoPolicy: 'LOCAL_IMMEDIATE',
      showFreePlayControl: true,
      freePlayPolicy: 'SESSION_GLOBAL',
      isSolitairePresentation: true,
      scoreConfirmPresentation: 'STANDARD_MODAL',
      isReadOnly: false,
    });
  });

  it('派生正式联机桌面能力', () => {
    expectCapabilities(
      deriveBattleSurfaceCapabilities({
        gameMode: GameMode.DEBUG,
        remoteSessionSource: 'ONLINE',
      }),
      {
        authority: 'REMOTE',
        surface: 'ONLINE',
        canSwitchPerspective: false,
        canSwitchLocalMode: false,
        canShowDebugLog: false,
        canUndo: true,
        undoPolicy: 'REMOTE_REQUEST',
        showFreePlayControl: true,
        freePlayPolicy: 'COMMAND_FLAG',
        isSolitairePresentation: false,
        scoreConfirmPresentation: 'STANDARD_MODAL',
        isReadOnly: false,
      }
    );
  });

  it('派生远程调试联机桌面能力', () => {
    expectCapabilities(
      deriveBattleSurfaceCapabilities({
        gameMode: GameMode.DEBUG,
        remoteSessionSource: 'DEBUG',
      }),
      {
        authority: 'REMOTE',
        surface: 'REMOTE_DEBUG',
        canSwitchPerspective: false,
        canSwitchLocalMode: false,
        canShowDebugLog: false,
        canUndo: false,
        undoPolicy: 'NONE',
        showFreePlayControl: true,
        freePlayPolicy: 'COMMAND_FLAG',
        isSolitairePresentation: false,
        scoreConfirmPresentation: 'STANDARD_MODAL',
        isReadOnly: false,
      }
    );
  });

  it('派生远程对墙打桌面能力', () => {
    expectCapabilities(
      deriveBattleSurfaceCapabilities({
        gameMode: GameMode.DEBUG,
        remoteSessionSource: 'SOLITAIRE',
      }),
      {
        authority: 'REMOTE',
        surface: 'SOLITAIRE',
        canSwitchPerspective: false,
        canSwitchLocalMode: false,
        canShowDebugLog: false,
        canUndo: true,
        undoPolicy: 'REMOTE_IMMEDIATE',
        showFreePlayControl: true,
        freePlayPolicy: 'COMMAND_FLAG',
        isSolitairePresentation: true,
        scoreConfirmPresentation: 'STANDARD_MODAL',
        isReadOnly: false,
      }
    );
  });

  it('派生玩家视角观战只读桌面能力', () => {
    expectCapabilities(
      deriveBattleSurfaceCapabilities({
        gameMode: GameMode.DEBUG,
        remoteSessionSource: 'SPECTATOR',
      }),
      {
        authority: 'REMOTE',
        surface: 'SPECTATOR_READONLY',
        canSwitchPerspective: false,
        canSwitchLocalMode: false,
        canShowDebugLog: false,
        canUndo: false,
        undoPolicy: 'NONE',
        showFreePlayControl: false,
        freePlayPolicy: 'COMMAND_FLAG',
        isSolitairePresentation: false,
        scoreConfirmPresentation: 'STANDARD_MODAL',
        isReadOnly: true,
      }
    );
  });

  it('派生对墙打来源历史回放只读桌面能力', () => {
    expectCapabilities(
      deriveBattleSurfaceCapabilities({
        gameMode: GameMode.DEBUG,
        replaySessionActive: true,
        replaySourceMatchMode: 'SOLITAIRE',
      }),
      {
        authority: 'REPLAY',
        surface: 'REPLAY_READONLY',
        canSwitchPerspective: false,
        canSwitchLocalMode: false,
        canShowDebugLog: false,
        canUndo: false,
        undoPolicy: 'NONE',
        showFreePlayControl: false,
        freePlayPolicy: 'COMMAND_FLAG',
        isSolitairePresentation: true,
        scoreConfirmPresentation: 'STANDARD_MODAL',
        isReadOnly: true,
      }
    );
  });

  it('派生历史回放只读桌面能力', () => {
    expectCapabilities(
      deriveBattleSurfaceCapabilities({
        gameMode: GameMode.DEBUG,
        replaySessionActive: true,
      }),
      {
        authority: 'REPLAY',
        surface: 'REPLAY_READONLY',
        canSwitchPerspective: false,
        canSwitchLocalMode: false,
        canShowDebugLog: false,
        canUndo: false,
        undoPolicy: 'NONE',
        showFreePlayControl: false,
        freePlayPolicy: 'COMMAND_FLAG',
        isSolitairePresentation: false,
        scoreConfirmPresentation: 'STANDARD_MODAL',
        isReadOnly: true,
      }
    );
  });
});

function expectCapabilities(
  actual: BattleSurfaceCapabilities,
  expected: BattleSurfaceCapabilities
): void {
  expect(actual).toEqual(expected);
}
