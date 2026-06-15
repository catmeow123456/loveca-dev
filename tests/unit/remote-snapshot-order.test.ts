import { describe, expect, it } from 'vitest';
import { shouldIgnoreRemoteSnapshotBySeq } from '../../src/online/remote-snapshot-order';

describe('remote snapshot order', () => {
  const baseContext = {
    currentMatchId: 'match-1',
    currentPlayerId: 'player-1',
    currentSeat: 'FIRST' as const,
    currentSeq: 10,
    remoteMatchId: 'match-1',
    remotePlayerId: 'player-1',
    remoteSeat: 'FIRST' as const,
    snapshotMatchId: 'match-1',
    snapshotPlayerId: 'player-1',
    snapshotSeat: 'FIRST' as const,
  };

  it('ignores older and same-seq snapshots for the same remote view', () => {
    expect(shouldIgnoreRemoteSnapshotBySeq({ ...baseContext, snapshotSeq: 9 })).toBe(true);
    expect(shouldIgnoreRemoteSnapshotBySeq({ ...baseContext, snapshotSeq: 10 })).toBe(true);
  });

  it('accepts newer snapshots for the same remote view', () => {
    expect(shouldIgnoreRemoteSnapshotBySeq({ ...baseContext, snapshotSeq: 11 })).toBe(false);
  });

  it('does not use seq protection across different remote views', () => {
    expect(
      shouldIgnoreRemoteSnapshotBySeq({
        ...baseContext,
        snapshotMatchId: 'match-2',
        snapshotSeq: 9,
      })
    ).toBe(false);
    expect(
      shouldIgnoreRemoteSnapshotBySeq({
        ...baseContext,
        snapshotPlayerId: 'player-2',
        snapshotSeq: 9,
      })
    ).toBe(false);
    expect(
      shouldIgnoreRemoteSnapshotBySeq({
        ...baseContext,
        snapshotSeat: 'SECOND',
        snapshotSeq: 9,
      })
    ).toBe(false);
  });
});
