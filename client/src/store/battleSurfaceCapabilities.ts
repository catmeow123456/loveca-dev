import { GameMode } from '../../../src/shared/types/enums';

export type BattleAuthority = 'LOCAL' | 'REMOTE' | 'REPLAY';

export type BattleSurfaceKind =
  | 'LOCAL_DEBUG'
  | 'SOLITAIRE'
  | 'ONLINE'
  | 'REMOTE_DEBUG'
  | 'REPLAY_READONLY';

export type FreePlayPolicy = 'SESSION_GLOBAL' | 'COMMAND_FLAG';

export type ScoreConfirmPresentation = 'DEBUG_PASSTHROUGH' | 'STANDARD_MODAL';

export type RemoteBattleSessionSource = 'DEBUG' | 'ONLINE' | 'SOLITAIRE';

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
  readonly isReadOnly: boolean;
}

interface BattleSurfaceCapabilityInput {
  readonly gameMode: GameMode;
  readonly remoteSessionSource?: RemoteBattleSessionSource | null;
  readonly replaySessionActive?: boolean;
  readonly replaySourceMatchMode?: 'ONLINE' | 'SOLITAIRE' | null;
}

export function deriveBattleSurfaceCapabilities(
  input: BattleSurfaceCapabilityInput
): BattleSurfaceCapabilities {
  if (input.replaySessionActive) {
    return {
      authority: 'REPLAY',
      surface: 'REPLAY_READONLY',
      canSwitchPerspective: false,
      canSwitchLocalMode: false,
      canShowDebugLog: false,
      canUndo: false,
      showFreePlayControl: false,
      freePlayPolicy: 'COMMAND_FLAG',
      isSolitairePresentation: input.replaySourceMatchMode === 'SOLITAIRE',
      scoreConfirmPresentation: 'STANDARD_MODAL',
      isReadOnly: true,
    };
  }

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
    scoreConfirmPresentation: surface === 'LOCAL_DEBUG' ? 'DEBUG_PASSTHROUGH' : 'STANDARD_MODAL',
    isReadOnly: false,
  };
}

function deriveBattleSurfaceKind(input: BattleSurfaceCapabilityInput): BattleSurfaceKind {
  if (input.remoteSessionSource === 'DEBUG') {
    return 'REMOTE_DEBUG';
  }
  if (input.remoteSessionSource === 'ONLINE') {
    return 'ONLINE';
  }
  if (input.remoteSessionSource === 'SOLITAIRE') {
    return 'SOLITAIRE';
  }
  return input.gameMode === GameMode.SOLITAIRE ? 'SOLITAIRE' : 'LOCAL_DEBUG';
}
