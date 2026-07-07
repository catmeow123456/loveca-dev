import type {
  MatchSnapshotSummary,
  PlayerViewState,
  PrivateEvent,
  PublicEvent,
  Seat,
} from './types.js';

export interface RuntimeRecoveryInfo {
  readonly restoredAt: number;
  readonly checkpointSeq: number;
  readonly checkpointTimelineSeq: number;
  readonly currentPublicSeq: number;
  readonly rolledBackFromPublicSeq: number | null;
  readonly rolledBackFromTimelineSeq: number | null;
}

export interface RemoteMatchSnapshot {
  readonly matchId: string;
  readonly seat: Seat;
  readonly playerId: string;
  /** Remote state revision used for command optimistic concurrency. */
  readonly seq: number;
  /** Current public event cursor. This is intentionally separate from seq. */
  readonly currentPublicSeq: number;
  readonly playerViewState: PlayerViewState;
  readonly publicEvents?: readonly PublicEvent[];
  readonly truncated?: boolean;
  readonly droppedEventCount?: number;
  readonly recovery?: RuntimeRecoveryInfo;
}

export interface RemoteMatchHistorySnapshot extends RemoteMatchSnapshot {
  readonly publicEvents: readonly PublicEvent[];
  readonly privateEvents: readonly PrivateEvent[];
  readonly snapshots: readonly MatchSnapshotSummary[];
}

export interface PublicEventsResponse {
  readonly matchId: string;
  readonly currentPublicSeq: number;
  readonly publicEvents: readonly PublicEvent[];
  readonly truncated?: boolean;
  readonly droppedEventCount?: number;
}

export interface RemoteCommandResult<TSnapshot extends RemoteMatchSnapshot = RemoteMatchSnapshot> {
  readonly success: boolean;
  readonly error?: string;
  readonly snapshot?: TSnapshot;
}
