import type { Seat } from './types.js';

export interface RemoteSnapshotOrderContext {
  readonly currentMatchId?: string | null;
  readonly currentPlayerId?: string | null;
  readonly currentSeat?: Seat | null;
  readonly currentSeq?: number | null;
  readonly remoteMatchId?: string | null;
  readonly remotePlayerId?: string | null;
  readonly remoteSeat?: Seat | null;
  readonly snapshotMatchId: string;
  readonly snapshotPlayerId: string;
  readonly snapshotSeat: Seat;
  readonly snapshotSeq: number;
}

export function shouldIgnoreRemoteSnapshotBySeq(context: RemoteSnapshotOrderContext): boolean {
  if (context.currentSeq === null || context.currentSeq === undefined) {
    return false;
  }
  if (context.snapshotSeq > context.currentSeq) {
    return false;
  }

  return (
    context.currentMatchId === context.snapshotMatchId &&
    context.currentPlayerId === context.snapshotPlayerId &&
    context.currentSeat === context.snapshotSeat &&
    context.remoteMatchId === context.snapshotMatchId &&
    context.remotePlayerId === context.snapshotPlayerId &&
    context.remoteSeat === context.snapshotSeat
  );
}
