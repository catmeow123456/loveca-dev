import { GameMode } from '../../../src/shared/types/enums';
import type { UndoPolicy } from '../../../src/online/types';

export type BattleAuthority = 'LOCAL' | 'REMOTE' | 'REPLAY';

export type BattleSurfaceKind =
  | 'LOCAL_DEBUG'
  | 'SOLITAIRE'
  | 'ONLINE'
  | 'REMOTE_DEBUG'
  | 'SPECTATOR_READONLY'
  | 'REPLAY_READONLY';

export type FreePlayPolicy = 'SESSION_GLOBAL' | 'COMMAND_FLAG';

export type ScoreConfirmPresentation = 'DEBUG_PASSTHROUGH' | 'STANDARD_MODAL';

export type RemoteBattleSessionSource = 'DEBUG' | 'ONLINE' | 'SOLITAIRE' | 'SPECTATOR';

export interface BattleSurfaceCapabilities {
  readonly authority: BattleAuthority;
  readonly surface: BattleSurfaceKind;
  readonly canSwitchPerspective: boolean;
  readonly canSwitchLocalMode: boolean;
  readonly canShowDebugLog: boolean;
  readonly canUndo: boolean;
  readonly undoPolicy: UndoPolicy;
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
      undoPolicy: 'NONE',
      showFreePlayControl: false,
      freePlayPolicy: 'COMMAND_FLAG',
      isSolitairePresentation: input.replaySourceMatchMode === 'SOLITAIRE',
      scoreConfirmPresentation: 'STANDARD_MODAL',
      isReadOnly: true,
    };
  }

  const authority: BattleAuthority = input.remoteSessionSource ? 'REMOTE' : 'LOCAL';
  const surface = deriveBattleSurfaceKind(input);
  const undoPolicy = deriveUndoPolicy(authority, surface);
  const isSpectatorReadonly = surface === 'SPECTATOR_READONLY';

  return {
    authority,
    surface,
    canSwitchPerspective: surface === 'LOCAL_DEBUG',
    canSwitchLocalMode: authority === 'LOCAL',
    canShowDebugLog: surface === 'LOCAL_DEBUG',
    canUndo: undoPolicy !== 'NONE',
    undoPolicy,
    showFreePlayControl: !isSpectatorReadonly,
    freePlayPolicy: authority === 'LOCAL' ? 'SESSION_GLOBAL' : 'COMMAND_FLAG',
    isSolitairePresentation: surface === 'SOLITAIRE',
    scoreConfirmPresentation: surface === 'LOCAL_DEBUG' ? 'DEBUG_PASSTHROUGH' : 'STANDARD_MODAL',
    isReadOnly: isSpectatorReadonly,
  };
}

function deriveUndoPolicy(authority: BattleAuthority, surface: BattleSurfaceKind): UndoPolicy {
  if (authority === 'LOCAL') {
    return 'LOCAL_IMMEDIATE';
  }
  if (surface === 'SOLITAIRE') {
    return 'REMOTE_IMMEDIATE';
  }
  if (surface === 'ONLINE') {
    return 'REMOTE_REQUEST';
  }
  return 'NONE';
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
  if (input.remoteSessionSource === 'SPECTATOR') {
    return 'SPECTATOR_READONLY';
  }
  return input.gameMode === GameMode.SOLITAIRE ? 'SOLITAIRE' : 'LOCAL_DEBUG';
}
