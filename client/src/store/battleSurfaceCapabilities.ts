import { GameMode } from '../../../src/shared/types/enums';

export type BattleAuthority = 'LOCAL' | 'REMOTE';

export type BattleSurfaceKind = 'LOCAL_DEBUG' | 'SOLITAIRE' | 'ONLINE' | 'REMOTE_DEBUG';

export type FreePlayPolicy = 'SESSION_GLOBAL' | 'COMMAND_FLAG';

export type ScoreConfirmPresentation = 'DEBUG_PASSTHROUGH' | 'STANDARD_MODAL';

export type RemoteBattleSessionSource = 'DEBUG' | 'ONLINE';

export interface BattleSurfaceCapabilities {
  readonly authority: BattleAuthority;
  readonly surface: BattleSurfaceKind;
  readonly canSwitchPerspective: boolean;
  readonly canSwitchLocalMode: boolean;
  readonly canShowDebugLog: boolean;
  readonly canUndo: boolean;
  readonly showFreePlayControl: boolean;
  readonly freePlayPolicy: FreePlayPolicy;
  readonly isSolitairePresentation: boolean;
  readonly scoreConfirmPresentation: ScoreConfirmPresentation;
}

interface BattleSurfaceCapabilityInput {
  readonly gameMode: GameMode;
  readonly remoteSessionSource?: RemoteBattleSessionSource | null;
}

export function deriveBattleSurfaceCapabilities(
  input: BattleSurfaceCapabilityInput
): BattleSurfaceCapabilities {
  const authority: BattleAuthority = input.remoteSessionSource ? 'REMOTE' : 'LOCAL';
  const surface = deriveBattleSurfaceKind(input);

  return {
    authority,
    surface,
    canSwitchPerspective: surface === 'LOCAL_DEBUG',
    canSwitchLocalMode: authority === 'LOCAL',
    canShowDebugLog: surface === 'LOCAL_DEBUG',
    canUndo: authority === 'LOCAL',
    showFreePlayControl: true,
    freePlayPolicy: authority === 'LOCAL' ? 'SESSION_GLOBAL' : 'COMMAND_FLAG',
    isSolitairePresentation: surface === 'SOLITAIRE',
    scoreConfirmPresentation:
      surface === 'LOCAL_DEBUG' ? 'DEBUG_PASSTHROUGH' : 'STANDARD_MODAL',
  };
}

function deriveBattleSurfaceKind(input: BattleSurfaceCapabilityInput): BattleSurfaceKind {
  if (input.remoteSessionSource === 'DEBUG') {
    return 'REMOTE_DEBUG';
  }
  if (input.remoteSessionSource === 'ONLINE') {
    return 'ONLINE';
  }
  return input.gameMode === GameMode.SOLITAIRE ? 'SOLITAIRE' : 'LOCAL_DEBUG';
}
