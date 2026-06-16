import { describe, expect, it } from 'vitest';
import {
  deriveBattleSurfaceCapabilities,
  type BattleSurfaceCapabilities,
} from '../../client/src/store/battleSurfaceCapabilities';
import { GameMode } from '../../src/shared/types/enums';

describe('battle surface capabilities', () => {
  it('派生本地调试桌面能力', () => {
    expectCapabilities(
      deriveBattleSurfaceCapabilities({ gameMode: GameMode.DEBUG }),
      {
        authority: 'LOCAL',
        surface: 'LOCAL_DEBUG',
        canSwitchPerspective: true,
        canSwitchLocalMode: true,
        canShowDebugLog: true,
        canUndo: true,
        showFreePlayControl: true,
        freePlayPolicy: 'SESSION_GLOBAL',
        isSolitairePresentation: false,
        scoreConfirmPresentation: 'DEBUG_PASSTHROUGH',
      }
    );
  });

  it('派生本地对墙打桌面能力', () => {
    expectCapabilities(
      deriveBattleSurfaceCapabilities({ gameMode: GameMode.SOLITAIRE }),
      {
        authority: 'LOCAL',
        surface: 'SOLITAIRE',
        canSwitchPerspective: false,
        canSwitchLocalMode: true,
        canShowDebugLog: false,
        canUndo: true,
        showFreePlayControl: true,
        freePlayPolicy: 'SESSION_GLOBAL',
        isSolitairePresentation: true,
        scoreConfirmPresentation: 'STANDARD_MODAL',
      }
    );
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
        canUndo: false,
        showFreePlayControl: true,
        freePlayPolicy: 'COMMAND_FLAG',
        isSolitairePresentation: false,
        scoreConfirmPresentation: 'STANDARD_MODAL',
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
        showFreePlayControl: true,
        freePlayPolicy: 'COMMAND_FLAG',
        isSolitairePresentation: false,
        scoreConfirmPresentation: 'STANDARD_MODAL',
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
