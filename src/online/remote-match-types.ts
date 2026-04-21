import type {
  MatchSnapshotSummary,
  PlayerViewState,
  PrivateEvent,
  PublicEvent,
  Seat,
} from './types.js';

export interface RemoteMatchSnapshot {
  readonly matchId: string;
  readonly seat: Seat;
  readonly playerId: string;
  readonly seq: number;
  readonly playerViewState: PlayerViewState;
  readonly publicEvents: readonly PublicEvent[];
  readonly privateEvents: readonly PrivateEvent[];
  readonly snapshots: readonly MatchSnapshotSummary[];
}

export interface RemoteCommandResult<TSnapshot extends RemoteMatchSnapshot = RemoteMatchSnapshot> {
  readonly success: boolean;
  readonly error?: string;
  readonly snapshot?: TSnapshot;
}
